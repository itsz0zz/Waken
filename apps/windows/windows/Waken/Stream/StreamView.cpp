#include "pch.h"

#include "StreamView.h"

#include <JSValueComposition.h>
#include <winrt/Microsoft.ReactNative.Composition.Input.h>
#include <winrt/Microsoft.ReactNative.Composition.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Microsoft.Graphics.DirectX.h>
#include <winrt/Microsoft.UI.Composition.interop.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.h>
#include <Xinput.h>

#include <algorithm>
#include <atomic>
#include <mutex>
#include <optional>
#include <set>
#include <thread>

#include "StreamLog.h"
#include "StreamSession.h"

#pragma comment(lib, "xinput.lib")

namespace Waken::Stream {

using namespace winrt::Microsoft::ReactNative;
namespace Input = winrt::Microsoft::ReactNative::Composition::Input;

REACT_STRUCT(StreamViewProps)
struct StreamViewProps : winrt::implements<StreamViewProps, IComponentProps> {
  StreamViewProps(ViewProps props, IComponentProps const &cloneFrom) : ViewProps(props) {
    if (cloneFrom) {
      auto from = cloneFrom.as<StreamViewProps>();
      address = from->address;
      appVersion = from->appVersion;
      gfeVersion = from->gfeVersion;
      rtspSessionUrl = from->rtspSessionUrl;
      riKey = from->riKey;
      riKeyId = from->riKeyId;
      serverCodecModeSupport = from->serverCodecModeSupport;
      videoWidth = from->videoWidth;
      videoHeight = from->videoHeight;
      fps = from->fps;
      bitrateKbps = from->bitrateKbps;
      hevc = from->hevc;
      remote = from->remote;
      muted = from->muted;
    }
  }

  void SetProp(uint32_t hash, winrt::hstring propName, IJSValueReader value) noexcept {
    ReadProp(hash, propName, value, *this);
  }

  REACT_FIELD(address)
  std::string address;
  REACT_FIELD(appVersion)
  std::string appVersion;
  REACT_FIELD(gfeVersion)
  std::string gfeVersion;
  REACT_FIELD(rtspSessionUrl)
  std::string rtspSessionUrl;
  REACT_FIELD(riKey)
  std::string riKey;
  REACT_FIELD(riKeyId)
  int32_t riKeyId{0};
  REACT_FIELD(serverCodecModeSupport)
  int32_t serverCodecModeSupport{0};
  REACT_FIELD(videoWidth)
  int32_t videoWidth{0};
  REACT_FIELD(videoHeight)
  int32_t videoHeight{0};
  REACT_FIELD(fps)
  int32_t fps{60};
  REACT_FIELD(bitrateKbps)
  int32_t bitrateKbps{20000};
  REACT_FIELD(hevc)
  bool hevc{true};
  REACT_FIELD(remote)
  bool remote{true};
  REACT_FIELD(muted)
  bool muted{false};
  REACT_FIELD(onStateChange)
  bool onStateChange{false};
  REACT_FIELD(onStats)
  bool onStats{false};

  const ViewProps ViewProps;
};

namespace {

// Around the HUD's button only (top left, 40 DIP at 16 from the edge, lower when the figures show). The rest of the
// top belongs to the computer, whose window title bars sit there.
constexpr float kDeadZoneWidth = 72;
constexpr float kDeadZoneHeight = 96;

template <typename Point> bool InDeadZone(Point const &p) { return p.X < kDeadZoneWidth && p.Y < kDeadZoneHeight; }

char Modifiers() {
  char m = 0;
  if (GetKeyState(VK_SHIFT) & 0x8000) m |= 0x01;
  if (GetKeyState(VK_CONTROL) & 0x8000) m |= 0x02;
  if (GetKeyState(VK_MENU) & 0x8000) m |= 0x04;
  if ((GetKeyState(VK_LWIN) | GetKeyState(VK_RWIN)) & 0x8000) m |= 0x08;
  return m;
}

short Clamp(double value) {
  if (!(value == value)) return 0;
  return static_cast<short>(std::max(-32768.0, std::min(32767.0, value)));
}

} // namespace

struct StreamView : winrt::implements<StreamView, winrt::Windows::Foundation::IInspectable> {
  ~StreamView() { StopStream(); }

  void Initialize(ComponentView const &view) {
    m_view = view;
    auto weak = get_weak();
    m_keyDown = view.KeyDown(winrt::auto_revoke, [weak](auto const &, Input::KeyRoutedEventArgs const &args) {
      if (auto self = weak.get()) self->Key(args, true);
    });
    m_keyUp = view.KeyUp(winrt::auto_revoke, [weak](auto const &, Input::KeyRoutedEventArgs const &args) {
      if (auto self = weak.get()) self->Key(args, false);
    });
    m_pointerMoved = view.PointerMoved(winrt::auto_revoke, [weak](auto const &, Input::PointerRoutedEventArgs const &args) {
      if (auto self = weak.get()) self->Pointer(args);
    });
    m_pointerPressed = view.PointerPressed(winrt::auto_revoke, [weak](auto const &, Input::PointerRoutedEventArgs const &args) {
      if (auto self = weak.get()) self->Pointer(args);
    });
    m_pointerReleased = view.PointerReleased(winrt::auto_revoke, [weak](auto const &, Input::PointerRoutedEventArgs const &args) {
      if (auto self = weak.get()) self->Pointer(args);
    });
    m_wheel = view.PointerWheelChanged(winrt::auto_revoke, [weak](auto const &, Input::PointerRoutedEventArgs const &args) {
      if (auto self = weak.get()) self->Wheel(args);
    });
    m_lostFocus = view.LostFocus(winrt::auto_revoke, [weak](auto const &, auto const &) {
      if (auto self = weak.get()) self->ReleaseKeys();
    });
    m_unmounted = view.Unmounted(winrt::auto_revoke, [weak](auto const &, auto const &) {
      if (auto self = weak.get()) self->StopStream();
    });
  }

  winrt::Microsoft::UI::Composition::Visual CreateVisual(ComponentView const &view) {
    auto compositor = view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().Compositor();
    m_visual = compositor.CreateSpriteVisual();
    // The picture lives in a visual of its own, inside the component's: React Native Windows sets the component
    // visual's brush itself (its background colour) at each update, which wiped the picture out.
    m_content = compositor.CreateSpriteVisual();
    m_content.RelativeSizeAdjustment({1.0f, 1.0f});
    m_content.Brush(compositor.CreateColorBrush(winrt::Windows::UI::Color{255, 0, 0, 0}));
    m_visual.Children().InsertAtTop(m_content);
    // The props came first: the stream waited for its visual.
    if (m_pending) {
      auto launch = std::move(*m_pending);
      m_pending.reset();
      StartStream(std::move(launch));
    }
    return m_visual;
  }

  void UpdateLayout(LayoutMetrics const &metrics) {
    if (!m_visual) return;
    m_visual.Size({metrics.Frame.Width * metrics.PointScaleFactor, metrics.Frame.Height * metrics.PointScaleFactor});
    Log("[stream] vue " + std::to_string(static_cast<int>(metrics.Frame.Width)) + "x" + std::to_string(static_cast<int>(metrics.Frame.Height)) +
        " (échelle " + std::to_string(metrics.PointScaleFactor) + ")");
  }

  void SetEmitter(EventEmitter const &emitter) {
    std::lock_guard lock(m_emitterLock);
    m_emitter = emitter;
  }

  void UpdateProps(winrt::com_ptr<StreamViewProps> const &props) {
    if (props) {
      m_muted = props->muted;
      if (m_session) m_session->Audio().SetMuted(m_muted);
    }
    if (!props || m_session || m_pending || props->address.empty() || props->rtspSessionUrl.empty() || props->videoWidth <= 0 || props->videoHeight <= 0) return;
    LaunchInfo launch;
    launch.address = props->address;
    launch.appVersion = props->appVersion.empty() ? "7.1.431.-1" : props->appVersion;
    launch.gfeVersion = props->gfeVersion;
    launch.rtspSessionUrl = props->rtspSessionUrl;
    launch.riKey = props->riKey;
    launch.riKeyId = props->riKeyId;
    launch.serverCodecModeSupport = props->serverCodecModeSupport;
    launch.width = props->videoWidth;
    launch.height = props->videoHeight;
    launch.fps = props->fps > 0 ? props->fps : 60;
    launch.bitrateKbps = props->bitrateKbps > 0 ? props->bitrateKbps : 20000;
    launch.hevc = props->hevc;
    launch.remote = props->remote;
    m_videoWidth = launch.width;
    m_videoHeight = launch.height;
    if (!m_visual) {
      m_pending = std::move(launch);
      return;
    }
    StartStream(std::move(launch));
  }

 private:
  void StartStream(LaunchInfo launch) {
    auto weak = get_weak();
    auto dispatcher = m_view.ReactContext().UIDispatcher();
    // From moonlight's threads to JavaScript, through the UI thread.
    auto listener = [weak, dispatcher](std::string const &state, std::string const &message) {
      dispatcher.Post([weak, state, message] {
        if (auto self = weak.get()) self->EmitState(state, message);
      });
    };
    m_session = std::make_shared<StreamSession>(std::move(launch), listener);
    m_session->Audio().SetMuted(m_muted);

    std::string error;
    if (!m_session->CreateVideo(error)) {
      Log("[stream] " + error);
      EmitState("error", error);
      return;
    }
    // A drawing surface on the stream's own D3D11 device, as the visual's content, scaled to fit (black bars
    // around a picture of another shape). The decoder draws each picture into it.
    try {
      auto compositor = m_visual.Compositor();
      winrt::Microsoft::UI::Composition::CompositionGraphicsDevice graphics{nullptr};
      winrt::check_hresult(compositor.as<winrt::Microsoft::UI::Composition::ICompositorInterop>()->CreateGraphicsDevice(
          m_session->Video().Device(), &graphics));
      auto surface = graphics.CreateDrawingSurface(
          {static_cast<float>(m_videoWidth), static_cast<float>(m_videoHeight)},
          winrt::Microsoft::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
          winrt::Microsoft::Graphics::DirectX::DirectXAlphaMode::Ignore);
      m_session->Video().SetTarget(surface.as<winrt::Microsoft::UI::Composition::ICompositionDrawingSurfaceInterop>());
      auto brush = compositor.CreateSurfaceBrush(surface);
      brush.Stretch(winrt::Microsoft::UI::Composition::CompositionStretch::Uniform);
      m_content.Brush(brush);
      m_graphics = graphics;
    } catch (winrt::hresult_error const &e) {
      Log("[stream] affichage : " + winrt::to_string(e.message()));
      EmitState("error", "Affichage de la vidéo impossible");
      return;
    }

    EmitState("connecting", {});
    m_session->Start();
    m_view.TryFocus(FocusState::Programmatic);
    m_running = true;
    m_controllers = std::thread([this, self = get_strong()] { PollControllers(); });
    m_stats = std::thread([this, self = get_strong()] { ReportStats(); });
  }

  void StopStream() {
    if (!m_session) return;
    ReleaseKeys();
    m_running = false;
    // Never waits for itself: the last reference can be released by one of these threads.
    for (std::thread *worker : {&m_controllers, &m_stats}) {
      if (!worker->joinable()) continue;
      if (worker->get_id() == std::this_thread::get_id()) worker->detach();
      else worker->join();
    }
    m_session->Stop();
    m_session = nullptr;
  }

  void EmitState(std::string const &state, std::string const &message) {
    std::lock_guard lock(m_emitterLock);
    if (!m_emitter) return;
    m_emitter.DispatchEvent(L"stateChange", [state, message](IJSValueWriter const &writer) {
      writer.WriteObjectBegin();
      writer.WritePropertyName(L"state");
      writer.WriteString(winrt::to_hstring(state));
      if (!message.empty()) {
        writer.WritePropertyName(L"message");
        writer.WriteString(winrt::to_hstring(message));
      }
      writer.WriteObjectEnd();
    });
  }

  /// Once a second, the HUD's figures.
  void ReportStats() {
    auto dispatcher = m_view.ReactContext().UIDispatcher();
    auto weak = get_weak();
    while (m_running) {
      for (int i = 0; i < 10 && m_running; i++) std::this_thread::sleep_for(std::chrono::milliseconds(100));
      auto session = m_session;
      if (!m_running || !session || !session->Live()) continue;
      const double fps = session->Fps(), kbps = session->BitrateKbps();
      const double rtt = session->RttMs(), dropped = session->DroppedFrames();
      dispatcher.Post([weak, fps, kbps, rtt, dropped] {
        auto self = weak.get();
        if (!self) return;
        std::lock_guard lock(self->m_emitterLock);
        if (!self->m_emitter) return;
        self->m_emitter.DispatchEvent(L"stats", [=](IJSValueWriter const &writer) {
          writer.WriteObjectBegin();
          writer.WritePropertyName(L"rttMs");
          writer.WriteDouble(rtt);
          writer.WritePropertyName(L"fps");
          writer.WriteDouble(fps);
          writer.WritePropertyName(L"bitrateKbps");
          writer.WriteDouble(kbps);
          writer.WritePropertyName(L"droppedFrames");
          writer.WriteDouble(dropped);
          writer.WriteObjectEnd();
        });
      });
    }
  }

  bool CanSend() const { return m_session && m_session->Live(); }

  /// Windows' own virtual keys: Sunshine takes them as they are. Everything goes to the game, nothing to the app.
  void Key(Input::KeyRoutedEventArgs const &args, bool down) {
    args.Handled(true);
    if (!CanSend()) return;
    const int vk = static_cast<int>(args.Key());
    if (vk <= 0 || vk > 0xFE) return;
    if (down) {
      m_pressed.insert(vk);
    } else if (!m_pressed.erase(vk)) {
      return;
    }
    LiSendKeyboardEvent(static_cast<short>(0x8000 | vk), down ? KEY_ACTION_DOWN : KEY_ACTION_UP, Modifiers());
  }

  void ReleaseKeys() {
    if (CanSend()) {
      for (int vk : m_pressed) LiSendKeyboardEvent(static_cast<short>(0x8000 | vk), KEY_ACTION_UP, 0);
    }
    m_pressed.clear();
  }

  /// The pointer where it is in the picture, shown aspect-fit in the view: the black bars clamp to the edges.
  void Pointer(Input::PointerRoutedEventArgs const &args) {
    args.Handled(true);
    auto point = args.GetCurrentPoint(m_view.Tag());
    // The HUD's button stays the app's: nothing goes to the computer from there, unless a button pressed in the
    // picture is still held.
    if (m_buttons == 0 && InDeadZone(point.Position())) return;
    auto frame = m_view.LayoutMetrics().Frame;
    if (CanSend() && frame.Width > 0 && frame.Height > 0 && m_videoWidth > 0 && m_videoHeight > 0) {
      const double scale = std::min(frame.Width / m_videoWidth, frame.Height / m_videoHeight);
      const double left = (frame.Width - m_videoWidth * scale) / 2, top = (frame.Height - m_videoHeight * scale) / 2;
      const double x = std::clamp((point.Position().X - left) / scale, 0.0, m_videoWidth - 1.0);
      const double y = std::clamp((point.Position().Y - top) / scale, 0.0, m_videoHeight - 1.0);
      LiSendMousePositionEvent(Clamp(x), Clamp(y), static_cast<short>(m_videoWidth), static_cast<short>(m_videoHeight));
    }

    // Each button that changed since the last event: pressed or released.
    auto properties = point.Properties();
    const int buttons = (properties.IsLeftButtonPressed() ? 1 : 0) | (properties.IsMiddleButtonPressed() ? 2 : 0) |
        (properties.IsRightButtonPressed() ? 4 : 0) | (properties.IsXButton1Pressed() ? 8 : 0) | (properties.IsXButton2Pressed() ? 16 : 0);
    const int changed = buttons ^ m_buttons;
    if (changed && CanSend()) {
      const int moonlight[] = {BUTTON_LEFT, BUTTON_MIDDLE, BUTTON_RIGHT, BUTTON_X1, BUTTON_X2};
      for (int i = 0; i < 5; i++) {
        if (changed & (1 << i)) LiSendMouseButtonEvent((buttons & (1 << i)) ? BUTTON_ACTION_PRESS : BUTTON_ACTION_RELEASE, moonlight[i]);
      }
    }
    if (buttons && !m_buttons) {
      m_view.TryFocus(FocusState::Pointer);
      m_view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().CapturePointer(args.Pointer());
    } else if (!buttons && m_buttons) {
      m_view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().ReleasePointerCapture(args.Pointer());
    }
    m_buttons = buttons;
  }

  /// 120 per notch, as the protocol wants.
  void Wheel(Input::PointerRoutedEventArgs const &args) {
    args.Handled(true);
    if (!CanSend()) return;
    auto point = args.GetCurrentPoint(m_view.Tag());
    if (InDeadZone(point.Position())) return;
    auto properties = point.Properties();
    if (!properties.IsHorizontalMouseWheel()) LiSendHighResScrollEvent(static_cast<short>(properties.MouseWheelDelta()));
  }

  /// Up to four controllers (XInput, so Xbox and compatible ones), read 250 times a second, sent when they change.
  /// XInput's button bits are the protocol's own.
  void PollControllers() {
    XINPUT_STATE last[XUSER_MAX_COUNT]{};
    bool connected[XUSER_MAX_COUNT]{};
    while (m_running) {
      uint16_t mask = 0;
      XINPUT_STATE now[XUSER_MAX_COUNT]{};
      bool present[XUSER_MAX_COUNT]{};
      for (DWORD i = 0; i < XUSER_MAX_COUNT; i++) {
        present[i] = XInputGetState(i, &now[i]) == ERROR_SUCCESS;
        if (present[i]) mask |= static_cast<uint16_t>(1 << i);
      }
      for (DWORD i = 0; i < XUSER_MAX_COUNT; i++) {
        const bool changed = present[i] != connected[i] || (present[i] && now[i].dwPacketNumber != last[i].dwPacketNumber);
        if (!changed) continue;
        connected[i] = present[i];
        last[i] = now[i];
        if (!CanSend()) continue;
        const XINPUT_GAMEPAD &pad = now[i].Gamepad;
        LiSendMultiControllerEvent(static_cast<uint8_t>(i), mask, present[i] ? pad.wButtons : 0, present[i] ? pad.bLeftTrigger : 0,
                                   present[i] ? pad.bRightTrigger : 0, present[i] ? pad.sThumbLX : 0, present[i] ? pad.sThumbLY : 0,
                                   present[i] ? pad.sThumbRX : 0, present[i] ? pad.sThumbRY : 0);
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(4));
    }
  }

  ComponentView m_view{nullptr};
  winrt::Microsoft::UI::Composition::SpriteVisual m_visual{nullptr};
  winrt::Microsoft::UI::Composition::SpriteVisual m_content{nullptr};
  winrt::Microsoft::UI::Composition::CompositionGraphicsDevice m_graphics{nullptr};
  std::shared_ptr<StreamSession> m_session;
  std::optional<LaunchInfo> m_pending;
  std::mutex m_emitterLock;
  EventEmitter m_emitter{nullptr};
  int m_videoWidth = 0, m_videoHeight = 0;
  bool m_muted = false;
  std::set<int> m_pressed;
  int m_buttons = 0;
  std::atomic<bool> m_running{false};
  std::thread m_controllers, m_stats;
  ComponentView::KeyDown_revoker m_keyDown;
  ComponentView::KeyUp_revoker m_keyUp;
  ComponentView::PointerMoved_revoker m_pointerMoved;
  ComponentView::PointerPressed_revoker m_pointerPressed;
  ComponentView::PointerReleased_revoker m_pointerReleased;
  ComponentView::PointerWheelChanged_revoker m_wheel;
  ComponentView::LostFocus_revoker m_lostFocus;
  ComponentView::Unmounted_revoker m_unmounted;
};

void RegisterStreamView(IReactPackageBuilder const &packageBuilder) noexcept {
  packageBuilder.as<IReactPackageBuilderFabric>().AddViewComponent(L"WakenStreamView", [](IReactViewComponentBuilder const &builder) noexcept {
    auto compositionBuilder = builder.as<winrt::Microsoft::ReactNative::Composition::IReactCompositionViewComponentBuilder>();
    builder.SetCreateProps([](ViewProps props, IComponentProps const &cloneFrom) noexcept {
      return winrt::make<StreamViewProps>(props, cloneFrom);
    });
    builder.SetUpdatePropsHandler([](ComponentView const &view, IComponentProps const &newProps, IComponentProps const &) noexcept {
      if (newProps) view.UserData().as<StreamView>()->UpdateProps(newProps.as<StreamViewProps>());
    });
    builder.SetUpdateEventEmitterHandler([](ComponentView const &view, EventEmitter const &emitter) noexcept {
      view.UserData().as<StreamView>()->SetEmitter(emitter);
    });
    compositionBuilder.SetViewComponentViewInitializer([](ComponentView const &view) noexcept {
      auto data = winrt::make_self<StreamView>();
      data->Initialize(view);
      view.UserData(*data);
    });
    compositionBuilder.SetCreateVisualHandler([](ComponentView const &view) noexcept {
      return view.UserData().as<StreamView>()->CreateVisual(view);
    });
    compositionBuilder.SetUpdateLayoutMetricsHandler([](ComponentView const &view, LayoutMetrics const &metrics, LayoutMetrics const &) noexcept {
      view.UserData().as<StreamView>()->UpdateLayout(metrics);
    });
  });
}

} // namespace Waken::Stream
