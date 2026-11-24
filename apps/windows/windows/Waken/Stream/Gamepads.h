// The controllers of this PC during a stream, through SDL3: Xbox ones, DualShock 4 and DualSense (USB or
// Bluetooth), Switch Pro and the others SDL knows. Sticks, buttons, touchpad, gyroscope and battery go to the
// computer; its vibrations, trigger vibrations and light bar colour come back to them.
// Every SDL call happens on the controllers' own thread, started with the app (the Manettes page lists them
// outside any stream): what the computer or the page asks is queued for it.
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace Waken::Stream {

class Gamepads {
 public:
  /// One for the app: SDL itself is.
  static Gamepads &Instance();

  /// The stream view: canSend says when it takes input (controllers are announced then); nullptr once it is over.
  void SetSender(std::function<bool()> canSend);
  bool CanSend();

  // The Manettes page.
  /// The controllers connected, as JSON: [{id, name, kind, battery?, charging, rumble, motion, touchpad, light}].
  std::string ListJson();
  void Test(std::string const &id);
  /// Vibration strength (0 to 1), motion sensors on or off, the kind announced: auto, xbox or playstation.
  void SetOptions(double rumble, bool motion, std::string const &kind);
  float RumbleScale() const { return m_rumble; }
  bool MotionOn() const { return m_motion; }
  /// -1: as plugged in; otherwise the LI_CTYPE_ announced for every controller.
  int ForcedKind() const { return m_kind; }

  // moonlight-common-c's callbacks, from its threads.
  void Rumble(uint16_t number, uint16_t low, uint16_t high);
  void RumbleTriggers(uint16_t number, uint16_t left, uint16_t right);
  void Motion(uint16_t number, uint8_t type, uint16_t reportRateHz);
  void Light(uint16_t number, uint8_t red, uint8_t green, uint8_t blue);

 private:
  struct Request {
    enum class Kind { Rumble, Triggers, Motion, Light, Test } kind;
    uint16_t number;
    uint16_t a, b, c;
  };

  void EnsureRunning();
  void Run();
  void Queue(Request request);

  std::mutex m_senderLock;
  std::function<bool()> m_canSend;
  std::once_flag m_started;
  std::thread m_thread;
  std::mutex m_lock;
  std::vector<Request> m_requests;
  std::string m_list = "[]";
  std::atomic<float> m_rumble{1.0f};
  std::atomic<bool> m_motion{true};
  std::atomic<int> m_kind{-1};
};

} // namespace Waken::Stream
