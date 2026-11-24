// One stream at a time (moonlight-common-c is a global state machine): the connection, its decoder and sound,
// and what the view needs to know about it. Every moonlight callback comes through here.
#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <string>

#include "AudioRenderer.h"
#include "VideoRenderer.h"

namespace Waken::Stream {

struct LaunchInfo {
  std::string address, appVersion, gfeVersion, rtspSessionUrl, riKey;
  int serverCodecModeSupport = 0, riKeyId = 0;
  int width = 0, height = 0, fps = 60, bitrateKbps = 20000;
  bool hevc = true, remote = true;
  /// A linked PS5 or PS4 instead of a computer (chiaki, PlayStationSession.cpp): its address and its link's keys.
  std::string psHost, psRegistKey, psRpKey, psAccountId;
  bool psPs5 = true;
  bool PlayStation() const { return !psHost.empty(); }
};

/// chiaki's session, opaque here (PlayStationSession.cpp).
struct PlayStationConnection;

/// What the view hears: "connecting" (with the stage), "streaming", "stopped", "error" (with a message).
using StateListener = std::function<void(std::string const &state, std::string const &message)>;

class StreamSession : public std::enable_shared_from_this<StreamSession> {
 public:
  StreamSession(LaunchInfo launch, StateListener listener);
  ~StreamSession();

  /// On the UI thread: the device the view's drawing surface is made on, before the connection.
  bool CreateVideo(std::string &error);

  /// Both return at once: connections start and stop one after the other, on a thread of their own.
  void Start();
  void Stop();

  bool Live() const { return m_connected.load(); }
  /// A PlayStation: input goes as its DualSense, never through moonlight-common-c.
  bool PlayStation() const { return m_launch.PlayStation(); }
  uint32_t RttMs() const;
  double Fps();
  double BitrateKbps();
  uint32_t DroppedFrames() const { return static_cast<uint32_t>(m_video.dropped.load()); }
  /// The HUD's timings since the last call (a computer's stream: a PlayStation has none).
  WakenFrameTimes FrameTimes() { return m_video.CloseTimes(); }
  void SetSmoothing(bool on) { m_video.SetSmoothing(on); }
  int ReserveFrames() { return m_video.ReserveFrames(); }

  // moonlight-common-c's callbacks, through the current session.
  VideoRenderer &Video() { return m_video; }
  AudioRenderer &Audio() { return m_audio; }
  void Emit(std::string const &state, std::string const &message = {});
  void SetConnected(bool connected) { m_connected = connected; }

 private:
  void Connect();
  // A PlayStation (PlayStationSession.cpp).
  void ConnectPlayStation();
  void StopPlayStation();
  uint32_t PlayStationRttMs() const;
  std::shared_ptr<PlayStationConnection> m_playstation;

  LaunchInfo m_launch;
  StateListener m_listener;
  VideoRenderer m_video;
  AudioRenderer m_audio;
  std::atomic<bool> m_connected{false};
  std::atomic<bool> m_cancelled{false};
  uint64_t m_lastFrames = 0, m_lastBytes = 0;
  ULONGLONG m_lastTick = 0;
  double m_fps = 0, m_kbps = 0;
};

} // namespace Waken::Stream
