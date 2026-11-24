// The controllers of this PC during a stream, through SDL3: Xbox ones, DualShock 4 and DualSense (USB or
// Bluetooth), Switch Pro and the others SDL knows. Sticks, buttons, touchpad, gyroscope and battery go to the
// computer; its vibrations, trigger vibrations and light bar colour come back to them.
// Every SDL call happens on the controllers' own thread: what the computer asks is queued for it.
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

namespace Waken::Stream {

class Gamepads {
 public:
  /// One for the app: SDL itself is.
  static Gamepads &Instance();

  /// canSend: the stream takes input now. Controllers are announced once it does.
  void Start(std::function<bool()> canSend);
  void Stop();

  // moonlight-common-c's callbacks, from its threads.
  void Rumble(uint16_t number, uint16_t low, uint16_t high);
  void RumbleTriggers(uint16_t number, uint16_t left, uint16_t right);
  void Motion(uint16_t number, uint8_t type, uint16_t reportRateHz);
  void Light(uint16_t number, uint8_t red, uint8_t green, uint8_t blue);

 private:
  struct Request {
    enum class Kind { Rumble, Triggers, Motion, Light } kind;
    uint16_t number;
    uint16_t a, b, c;
  };

  void Run();
  void Queue(Request request);

  std::function<bool()> m_canSend;
  std::atomic<bool> m_running{false};
  std::thread m_thread;
  std::mutex m_lock;
  std::vector<Request> m_requests;
};

} // namespace Waken::Stream
