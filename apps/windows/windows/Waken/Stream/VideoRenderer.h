// The picture of the computer played on: H.264 or HEVC decoded by Media Foundation on the graphics card (D3D11),
// turned into RGB by the D3D11 video processor, drawn into a composition drawing surface the stream view shows.
// (WinUI 3's compositor, the one React Native Windows uses, takes no swap chain: a drawing surface on our own
// D3D11 device instead, as React Native Windows draws its own content.)
#pragma once

#include <d3d11_4.h>
#include <dxgi1_3.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include <winrt/base.h>
#include <winrt/Microsoft.UI.Composition.interop.h>

#include "Limelight.h"

namespace Waken::Stream {

class VideoRenderer {
 public:
  /// On the UI thread, before the connection: the device the view's drawing surface is made on.
  bool Create(int width, int height, std::string &error);
  ID3D11Device *Device() const { return m_device.get(); }
  /// The surface each picture is drawn into, at the video size.
  void SetTarget(winrt::com_ptr<winrt::Microsoft::UI::Composition::ICompositionDrawingSurfaceInterop> target);

  /// Whether Windows has a decoder for this format (HEVC needs Microsoft's paid extension on many PCs).
  static bool CanDecode(bool hevc);

  /// moonlight-common-c's decoder callbacks, on its decoder thread.
  int Setup(int videoFormat, int width, int height, int fps);
  int Submit(PDECODE_UNIT unit);
  /// A whole picture in Annex B (a PlayStation's, through chiaki): DR_OK, or DR_NEED_IDR when it could not be decoded.
  int SubmitAnnexB(const uint8_t *data, size_t size, bool keyframe);
  void Cleanup();

  std::atomic<uint64_t> frames{0}, bytes{0}, dropped{0};

 private:
  bool SetOutputType();
  bool Present(IMFSample *sample);
  bool EnsureProcessor(UINT inputWidth, UINT inputHeight);

  std::mutex m_lock;
  int m_width = 0, m_height = 0, m_fps = 60;
  winrt::com_ptr<ID3D11Device> m_device;
  winrt::com_ptr<ID3D11DeviceContext> m_context;
  winrt::com_ptr<ID3D11VideoDevice> m_videoDevice;
  winrt::com_ptr<ID3D11VideoContext> m_videoContext;
  winrt::com_ptr<winrt::Microsoft::UI::Composition::ICompositionDrawingSurfaceInterop> m_target;
  winrt::com_ptr<IMFDXGIDeviceManager> m_manager;
  UINT m_resetToken = 0;
  winrt::com_ptr<IMFTransform> m_decoder;
  bool m_providesSamples = false;
  UINT m_processorWidth = 0, m_processorHeight = 0;
  winrt::com_ptr<ID3D11VideoProcessorEnumerator> m_enumerator;
  winrt::com_ptr<ID3D11VideoProcessor> m_processor;
  winrt::com_ptr<ID3D11Texture2D> m_frame; // the picture in RGB, copied into the surface
  winrt::com_ptr<ID3D11VideoProcessorOutputView> m_frameView;
  std::vector<uint8_t> m_picture;
  LONGLONG m_time = 0;
};

} // namespace Waken::Stream
