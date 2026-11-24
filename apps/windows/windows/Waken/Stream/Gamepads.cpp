#include "pch.h"

#include "Gamepads.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <map>

#include <SDL3/SDL.h>

#include "Limelight.h"
#include "StreamLog.h"

namespace Waken::Stream {

namespace {

/// The protocol numbers up to 16 controllers (a 16-bit mask).
constexpr int kMaxControllers = 16;
/// SDL's rumble lasts this long unless changed: the computer sends a new strength (or zero) when it changes.
constexpr Uint32 kRumbleMs = 30000;
constexpr auto kTick = std::chrono::milliseconds(4);
constexpr auto kBatteryEvery = std::chrono::seconds(60);
constexpr auto kListEvery = std::chrono::seconds(1);
constexpr Uint32 kTestMs = 400;
constexpr float kDegreesPerRadian = 180.0f / 3.14159265358979f;

/// A controller of this stream: its number, held while it stays connected, and what the computer asked of it.
struct Pad {
  SDL_Gamepad *gamepad = nullptr;
  uint8_t number = 0;
  uint16_t gyroHz = 0, accelHz = 0;
  Uint64 lastGyro = 0, lastAccel = 0;
  bool dirty = false;
};

/// The kind the computer emulates (Sunshine on Windows: an Xbox 360 or a DualShock 4) and games show the buttons of.
uint8_t KindOf(SDL_Gamepad *gamepad) {
  switch (SDL_GetGamepadType(gamepad)) {
    case SDL_GAMEPAD_TYPE_XBOX360:
    case SDL_GAMEPAD_TYPE_XBOXONE:
      return LI_CTYPE_XBOX;
    case SDL_GAMEPAD_TYPE_PS3:
    case SDL_GAMEPAD_TYPE_PS4:
    case SDL_GAMEPAD_TYPE_PS5:
      return LI_CTYPE_PS;
    case SDL_GAMEPAD_TYPE_NINTENDO_SWITCH_PRO:
    case SDL_GAMEPAD_TYPE_NINTENDO_SWITCH_JOYCON_LEFT:
    case SDL_GAMEPAD_TYPE_NINTENDO_SWITCH_JOYCON_RIGHT:
    case SDL_GAMEPAD_TYPE_NINTENDO_SWITCH_JOYCON_PAIR:
      return LI_CTYPE_NINTENDO;
    default:
      return LI_CTYPE_UNKNOWN;
  }
}

/// SDL's buttons as the protocol's bits.
constexpr std::array<std::pair<SDL_GamepadButton, uint32_t>, 21> kButtons{{
    {SDL_GAMEPAD_BUTTON_SOUTH, A_FLAG},
    {SDL_GAMEPAD_BUTTON_EAST, B_FLAG},
    {SDL_GAMEPAD_BUTTON_WEST, X_FLAG},
    {SDL_GAMEPAD_BUTTON_NORTH, Y_FLAG},
    {SDL_GAMEPAD_BUTTON_DPAD_UP, UP_FLAG},
    {SDL_GAMEPAD_BUTTON_DPAD_DOWN, DOWN_FLAG},
    {SDL_GAMEPAD_BUTTON_DPAD_LEFT, LEFT_FLAG},
    {SDL_GAMEPAD_BUTTON_DPAD_RIGHT, RIGHT_FLAG},
    {SDL_GAMEPAD_BUTTON_LEFT_SHOULDER, LB_FLAG},
    {SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER, RB_FLAG},
    {SDL_GAMEPAD_BUTTON_START, PLAY_FLAG},
    {SDL_GAMEPAD_BUTTON_BACK, BACK_FLAG},
    {SDL_GAMEPAD_BUTTON_LEFT_STICK, LS_CLK_FLAG},
    {SDL_GAMEPAD_BUTTON_RIGHT_STICK, RS_CLK_FLAG},
    {SDL_GAMEPAD_BUTTON_GUIDE, SPECIAL_FLAG},
    {SDL_GAMEPAD_BUTTON_MISC1, MISC_FLAG},
    {SDL_GAMEPAD_BUTTON_TOUCHPAD, TOUCHPAD_FLAG},
    {SDL_GAMEPAD_BUTTON_RIGHT_PADDLE1, PADDLE1_FLAG},
    {SDL_GAMEPAD_BUTTON_LEFT_PADDLE1, PADDLE2_FLAG},
    {SDL_GAMEPAD_BUTTON_RIGHT_PADDLE2, PADDLE3_FLAG},
    {SDL_GAMEPAD_BUTTON_LEFT_PADDLE2, PADDLE4_FLAG},
}};

/// SDL's sticks point down for a positive Y, the protocol's up.
short Up(Sint16 value) { return value == -32768 ? 32767 : static_cast<short>(-value); }
unsigned char Trigger(Sint16 value) { return static_cast<unsigned char>(std::max(0, static_cast<int>(value)) * 255 / 32767); }

std::string Escape(std::string const &text) {
  std::string out;
  for (char c : text) {
    if (c == '"' || c == '\\') out += '\\';
    if (static_cast<unsigned char>(c) >= 0x20) out += c;
  }
  return out;
}

const char *KindName(SDL_Gamepad *gamepad) {
  switch (KindOf(gamepad)) {
    case LI_CTYPE_XBOX: return "xbox";
    case LI_CTYPE_PS: return "playstation";
    case LI_CTYPE_NINTENDO: return "nintendo";
    default: return "other";
  }
}

class Session {
 public:
  explicit Session(Gamepads &owner) : m_owner(owner) {}

  ~Session() {
    for (auto &[id, pad] : m_pads) SDL_CloseGamepad(pad.gamepad);
  }

  void Handle(SDL_Event const &event) {
    switch (event.type) {
      case SDL_EVENT_GAMEPAD_ADDED:
        Add(event.gdevice.which);
        break;
      case SDL_EVENT_GAMEPAD_REMOVED:
        Remove(event.gdevice.which);
        break;
      case SDL_EVENT_GAMEPAD_AXIS_MOTION:
      case SDL_EVENT_GAMEPAD_BUTTON_DOWN:
      case SDL_EVENT_GAMEPAD_BUTTON_UP:
        if (auto pad = Find(event.gbutton.which)) pad->dirty = true;
        break;
      case SDL_EVENT_GAMEPAD_TOUCHPAD_DOWN:
      case SDL_EVENT_GAMEPAD_TOUCHPAD_MOTION:
      case SDL_EVENT_GAMEPAD_TOUCHPAD_UP:
        Touch(event.gtouchpad);
        break;
      case SDL_EVENT_GAMEPAD_SENSOR_UPDATE:
        Sensor(event.gsensor);
        break;
      case SDL_EVENT_JOYSTICK_BATTERY_UPDATED:
        if (auto pad = Find(event.jbattery.which); pad && Live()) Battery(*pad);
        break;
      default:
        break;
    }
  }

  /// After a round of events: each controller that changed sends its whole state once.
  void Flush() {
    const bool live = Live();
    if (live && !m_announced) {
      // The stream just started taking input: the controllers already there are said now.
      for (auto &[id, pad] : m_pads) Announce(pad);
      m_announced = true;
    } else if (!live) {
      m_announced = false;
    }
    if (!live) return;
    for (auto &[id, pad] : m_pads) {
      if (!pad.dirty) continue;
      pad.dirty = false;
      Send(pad);
    }
    if (std::chrono::steady_clock::now() - m_lastBattery >= kBatteryEvery) {
      m_lastBattery = std::chrono::steady_clock::now();
      for (auto &[id, pad] : m_pads) Battery(pad);
    }
  }

  void Rumble(uint16_t number, uint16_t low, uint16_t high) {
    if (auto pad = Number(number)) SDL_RumbleGamepad(pad->gamepad, Scaled(low), Scaled(high), kRumbleMs);
  }

  void Triggers(uint16_t number, uint16_t left, uint16_t right) {
    if (auto pad = Number(number)) SDL_RumbleGamepadTriggers(pad->gamepad, Scaled(left), Scaled(right), kRumbleMs);
  }

  /// The Manettes page's short vibration.
  void Test(uint16_t number) {
    const auto strength = static_cast<Uint16>(65535 * std::max(0.3f, m_owner.RumbleScale()));
    if (auto pad = Number(number)) SDL_RumbleGamepad(pad->gamepad, strength, strength, kTestMs);
  }

  /// The list the Manettes page shows, as JSON.
  std::string Describe() {
    std::string json = "[";
    for (auto &[id, pad] : m_pads) {
      SDL_Gamepad *gamepad = pad.gamepad;
      const SDL_PropertiesID properties = SDL_GetGamepadProperties(gamepad);
      const char *name = SDL_GetGamepadName(gamepad);
      int percent = -1;
      const SDL_PowerState power = SDL_GetGamepadPowerInfo(gamepad, &percent);
      if (json.size() > 1) json += ",";
      json += "{\"id\":\"" + std::to_string(pad.number) + "\",\"name\":\"" + Escape(name ? name : "Manette") + "\",\"kind\":\"" + KindName(gamepad) + "\"";
      if (percent >= 0 && percent <= 100) json += ",\"battery\":" + std::to_string(percent / 100.0);
      json += std::string(",\"charging\":") + (power == SDL_POWERSTATE_CHARGING ? "true" : "false");
      json += std::string(",\"rumble\":") + (SDL_GetBooleanProperty(properties, SDL_PROP_GAMEPAD_CAP_RUMBLE_BOOLEAN, false) ? "true" : "false");
      json += std::string(",\"motion\":") + (SDL_GamepadHasSensor(gamepad, SDL_SENSOR_GYRO) ? "true" : "false");
      json += std::string(",\"touchpad\":") + (SDL_GetNumGamepadTouchpads(gamepad) > 0 ? "true" : "false");
      json += std::string(",\"light\":") + (SDL_GetBooleanProperty(properties, SDL_PROP_GAMEPAD_CAP_RGB_LED_BOOLEAN, false) ? "true" : "false") + "}";
    }
    return json + "]";
  }

  /// The sensors drain the battery: on only while a game listens, at the rate it asks.
  void Motion(uint16_t number, uint8_t type, uint16_t hz) {
    auto pad = Number(number);
    if (!pad || !m_owner.MotionOn()) return;
    const SDL_SensorType sensor = type == LI_MOTION_TYPE_GYRO ? SDL_SENSOR_GYRO : SDL_SENSOR_ACCEL;
    (type == LI_MOTION_TYPE_GYRO ? pad->gyroHz : pad->accelHz) = hz;
    if (SDL_GamepadHasSensor(pad->gamepad, sensor)) SDL_SetGamepadSensorEnabled(pad->gamepad, sensor, hz > 0);
  }

  void Light(uint16_t number, uint8_t red, uint8_t green, uint8_t blue) {
    if (auto pad = Number(number)) SDL_SetGamepadLED(pad->gamepad, red, green, blue);
  }

 private:
  bool Live() const { return m_owner.CanSend(); }

  Uint16 Scaled(uint16_t value) const { return static_cast<Uint16>(value * m_owner.RumbleScale()); }

  Pad *Find(SDL_JoystickID id) {
    auto found = m_pads.find(id);
    return found == m_pads.end() ? nullptr : &found->second;
  }

  Pad *Number(uint16_t number) {
    for (auto &[id, pad] : m_pads) {
      if (pad.number == number) return &pad;
    }
    return nullptr;
  }

  uint16_t Mask() const {
    uint16_t mask = 0;
    for (auto const &[id, pad] : m_pads) mask |= static_cast<uint16_t>(1 << pad.number);
    return mask;
  }

  void Add(SDL_JoystickID id) {
    if (Find(id)) return;
    int number = 0;
    while (number < kMaxControllers && Number(static_cast<uint16_t>(number))) number++;
    if (number == kMaxControllers) return;
    SDL_Gamepad *gamepad = SDL_OpenGamepad(id);
    if (!gamepad) {
      Log(std::string("[manette] ouverture impossible : ") + SDL_GetError());
      return;
    }
    Pad &pad = m_pads[id];
    pad.gamepad = gamepad;
    pad.number = static_cast<uint8_t>(number);
    const char *name = SDL_GetGamepadName(gamepad);
    Log("[manette] " + std::string(name ? name : "manette") + " branchée, numéro " + std::to_string(number));
    if (Live()) Announce(pad);
  }

  void Remove(SDL_JoystickID id) {
    auto found = m_pads.find(id);
    if (found == m_pads.end()) return;
    const uint8_t number = found->second.number;
    SDL_CloseGamepad(found->second.gamepad);
    m_pads.erase(found);
    Log("[manette] numéro " + std::to_string(number) + " débranchée");
    // A last state with this controller out of the mask: the computer unplugs its virtual one.
    if (Live()) LiSendMultiControllerEvent(number, Mask(), 0, 0, 0, 0, 0, 0, 0);
  }

  /// What the controller is and can do: the computer picks the virtual controller and the features to forward.
  void Announce(Pad &pad) {
    SDL_Gamepad *gamepad = pad.gamepad;
    const SDL_PropertiesID properties = SDL_GetGamepadProperties(gamepad);
    uint16_t capabilities = LI_CCAP_ANALOG_TRIGGERS;
    if (SDL_GetBooleanProperty(properties, SDL_PROP_GAMEPAD_CAP_RUMBLE_BOOLEAN, false)) capabilities |= LI_CCAP_RUMBLE;
    if (SDL_GetBooleanProperty(properties, SDL_PROP_GAMEPAD_CAP_TRIGGER_RUMBLE_BOOLEAN, false)) capabilities |= LI_CCAP_TRIGGER_RUMBLE;
    if (SDL_GetBooleanProperty(properties, SDL_PROP_GAMEPAD_CAP_RGB_LED_BOOLEAN, false)) capabilities |= LI_CCAP_RGB_LED;
    if (SDL_GetNumGamepadTouchpads(gamepad) > 0) capabilities |= LI_CCAP_TOUCHPAD;
    if (m_owner.MotionOn() && SDL_GamepadHasSensor(gamepad, SDL_SENSOR_ACCEL)) capabilities |= LI_CCAP_ACCEL;
    if (m_owner.MotionOn() && SDL_GamepadHasSensor(gamepad, SDL_SENSOR_GYRO)) capabilities |= LI_CCAP_GYRO;
    int percent = -1;
    const SDL_PowerState power = SDL_GetGamepadPowerInfo(gamepad, &percent);
    if (power != SDL_POWERSTATE_ERROR && power != SDL_POWERSTATE_UNKNOWN && power != SDL_POWERSTATE_NO_BATTERY) capabilities |= LI_CCAP_BATTERY_STATE;

    uint32_t buttons = 0;
    for (auto const &[button, flag] : kButtons) {
      if (SDL_GamepadHasButton(gamepad, button)) buttons |= flag;
    }
    const int forced = m_owner.ForcedKind();
    LiSendControllerArrivalEvent(pad.number, Mask(), forced >= 0 ? static_cast<uint8_t>(forced) : KindOf(gamepad), buttons, capabilities);
    Send(pad);
    Battery(pad);
  }

  void Send(Pad const &pad) {
    SDL_Gamepad *gamepad = pad.gamepad;
    int buttons = 0;
    for (auto const &[button, flag] : kButtons) {
      if (SDL_GetGamepadButton(gamepad, button)) buttons |= static_cast<int>(flag);
    }
    LiSendMultiControllerEvent(pad.number, Mask(), buttons, Trigger(SDL_GetGamepadAxis(gamepad, SDL_GAMEPAD_AXIS_LEFT_TRIGGER)),
                               Trigger(SDL_GetGamepadAxis(gamepad, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER)), SDL_GetGamepadAxis(gamepad, SDL_GAMEPAD_AXIS_LEFTX),
                               Up(SDL_GetGamepadAxis(gamepad, SDL_GAMEPAD_AXIS_LEFTY)), SDL_GetGamepadAxis(gamepad, SDL_GAMEPAD_AXIS_RIGHTX),
                               Up(SDL_GetGamepadAxis(gamepad, SDL_GAMEPAD_AXIS_RIGHTY)));
  }

  /// The first touchpad (the protocol's only one with a single touchpad), coordinates from the top left, 0 to 1.
  void Touch(SDL_GamepadTouchpadEvent const &touch) {
    auto pad = Find(touch.which);
    if (!pad || touch.touchpad != 0 || !Live()) return;
    const uint8_t type = touch.type == SDL_EVENT_GAMEPAD_TOUCHPAD_DOWN ? LI_TOUCH_EVENT_DOWN
        : touch.type == SDL_EVENT_GAMEPAD_TOUCHPAD_UP                  ? LI_TOUCH_EVENT_UP
                                                                       : LI_TOUCH_EVENT_MOVE;
    LiSendControllerTouchEvent(pad->number, type, static_cast<uint32_t>(touch.finger), touch.x, touch.y, touch.pressure);
  }

  /// SDL's axes are the ones Sunshine expects; the gyroscope goes from radians to degrees per second.
  void Sensor(SDL_GamepadSensorEvent const &sensor) {
    auto pad = Find(sensor.which);
    if (!pad || !Live()) return;
    const bool gyro = sensor.sensor == SDL_SENSOR_GYRO;
    const uint16_t hz = gyro ? pad->gyroHz : pad->accelHz;
    if (hz == 0) return;
    Uint64 &last = gyro ? pad->lastGyro : pad->lastAccel;
    if (sensor.timestamp - last < 1'000'000'000ull / hz) return;
    last = sensor.timestamp;
    const float scale = gyro ? kDegreesPerRadian : 1.0f;
    LiSendControllerMotionEvent(pad->number, gyro ? LI_MOTION_TYPE_GYRO : LI_MOTION_TYPE_ACCEL, sensor.data[0] * scale, sensor.data[1] * scale,
                                sensor.data[2] * scale);
  }

  void Battery(Pad const &pad) {
    int percent = -1;
    uint8_t state = LI_BATTERY_STATE_UNKNOWN;
    switch (SDL_GetGamepadPowerInfo(pad.gamepad, &percent)) {
      case SDL_POWERSTATE_ON_BATTERY: state = LI_BATTERY_STATE_DISCHARGING; break;
      case SDL_POWERSTATE_CHARGING: state = LI_BATTERY_STATE_CHARGING; break;
      case SDL_POWERSTATE_CHARGED: state = LI_BATTERY_STATE_FULL; break;
      case SDL_POWERSTATE_NO_BATTERY: return;
      default: break;
    }
    LiSendControllerBatteryEvent(pad.number, state, percent >= 0 && percent <= 100 ? static_cast<uint8_t>(percent) : LI_BATTERY_PERCENTAGE_UNKNOWN);
  }

  Gamepads &m_owner;
  std::map<SDL_JoystickID, Pad> m_pads;
  bool m_announced = false;
  std::chrono::steady_clock::time_point m_lastBattery = std::chrono::steady_clock::now();
};

} // namespace

Gamepads &Gamepads::Instance() {
  static Gamepads instance;
  return instance;
}

void Gamepads::EnsureRunning() {
  // For the app's whole life: SDL watches the controllers from launch, a stream only says when to send.
  std::call_once(m_started, [this] {
    m_thread = std::thread([this] { Run(); });
    m_thread.detach();
  });
}

void Gamepads::SetSender(std::function<bool()> canSend) {
  EnsureRunning();
  std::lock_guard lock(m_senderLock);
  m_canSend = std::move(canSend);
}

bool Gamepads::CanSend() {
  std::lock_guard lock(m_senderLock);
  return m_canSend && m_canSend();
}

std::string Gamepads::ListJson() {
  EnsureRunning();
  std::lock_guard lock(m_lock);
  return m_list;
}

void Gamepads::Test(std::string const &id) {
  try {
    Queue({Request::Kind::Test, static_cast<uint16_t>(std::stoi(id)), 0, 0, 0});
  } catch (std::exception const &) {
    // Not one of ours.
  }
}

void Gamepads::SetOptions(double rumble, bool motion, std::string const &kind) {
  EnsureRunning();
  m_rumble = static_cast<float>(std::clamp(rumble, 0.0, 1.0));
  m_motion = motion;
  m_kind = kind == "xbox" ? LI_CTYPE_XBOX : kind == "playstation" ? LI_CTYPE_PS : -1;
}

void Gamepads::Queue(Request request) {
  EnsureRunning();
  std::lock_guard lock(m_lock);
  m_requests.push_back(request);
}

void Gamepads::Rumble(uint16_t number, uint16_t low, uint16_t high) { Queue({Request::Kind::Rumble, number, low, high, 0}); }
void Gamepads::RumbleTriggers(uint16_t number, uint16_t left, uint16_t right) { Queue({Request::Kind::Triggers, number, left, right, 0}); }
void Gamepads::Motion(uint16_t number, uint8_t type, uint16_t reportRateHz) { Queue({Request::Kind::Motion, number, type, reportRateHz, 0}); }
void Gamepads::Light(uint16_t number, uint8_t red, uint8_t green, uint8_t blue) { Queue({Request::Kind::Light, number, red, green, blue}); }

void Gamepads::Run() {
  // Waken is often not the window in front while streaming (the HUD, another screen): controllers keep working.
  SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
  if (!SDL_Init(SDL_INIT_GAMEPAD)) {
    Log(std::string("[manette] SDL ne démarre pas : ") + SDL_GetError());
    return;
  }
  Session session(*this);
  auto lastList = std::chrono::steady_clock::time_point{};
  for (;;) {
    std::vector<Request> requests;
    {
      std::lock_guard lock(m_lock);
      requests.swap(m_requests);
    }
    for (auto const &r : requests) {
      switch (r.kind) {
        case Request::Kind::Rumble: session.Rumble(r.number, r.a, r.b); break;
        case Request::Kind::Triggers: session.Triggers(r.number, r.a, r.b); break;
        case Request::Kind::Motion: session.Motion(r.number, static_cast<uint8_t>(r.a), r.b); break;
        case Request::Kind::Light: session.Light(r.number, static_cast<uint8_t>(r.a), static_cast<uint8_t>(r.b), static_cast<uint8_t>(r.c)); break;
        case Request::Kind::Test: session.Test(r.number); break;
      }
    }
    SDL_Event event;
    while (SDL_PollEvent(&event)) session.Handle(event);
    session.Flush();
    if (std::chrono::steady_clock::now() - lastList >= kListEvery) {
      lastList = std::chrono::steady_clock::now();
      auto list = session.Describe();
      std::lock_guard lock(m_lock);
      m_list = std::move(list);
    }
    std::this_thread::sleep_for(kTick);
  }
}

} // namespace Waken::Stream
