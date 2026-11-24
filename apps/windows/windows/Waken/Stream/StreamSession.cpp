#include "pch.h"

#include "StreamSession.h"

#include <condition_variable>
#include <cstdarg>
#include <deque>
#include <thread>

#include "Gamepads.h"
#include "StreamLog.h"

namespace Waken::Stream {

namespace {

std::mutex g_currentLock;
std::shared_ptr<StreamSession> g_current;

std::shared_ptr<StreamSession> Current() {
  std::lock_guard lock(g_currentLock);
  return g_current;
}

void SetCurrent(std::shared_ptr<StreamSession> session) {
  std::lock_guard lock(g_currentLock);
  g_current = std::move(session);
}

/// moonlight-common-c is one global state machine: a connection is fully stopped before the next one starts.
void Enqueue(std::function<void()> task) {
  static std::mutex lock;
  static std::condition_variable ready;
  static std::deque<std::function<void()>> tasks;
  static std::once_flag started;
  std::call_once(started, [] {
    std::thread([] {
      for (;;) {
        std::function<void()> next;
        {
          std::unique_lock guard(lock);
          ready.wait(guard, [] { return !tasks.empty(); });
          next = std::move(tasks.front());
          tasks.pop_front();
        }
        next();
      }
    }).detach();
  });
  {
    std::lock_guard guard(lock);
    tasks.push_back(std::move(task));
  }
  ready.notify_one();
}

/// Media Foundation and Direct3D are COM: each of moonlight's threads that reaches them joins the process's apartment.
void EnsureCom() {
  thread_local bool done = false;
  if (!done) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    done = true;
  }
}

void FromHex(std::string const &hex, char *out, size_t size) {
  memset(out, 0, size);
  for (size_t i = 0; i < size && i * 2 + 1 < hex.size(); i++) {
    out[i] = static_cast<char>(std::stoi(hex.substr(i * 2, 2), nullptr, 16));
  }
}

/* ---------- moonlight-common-c's callbacks ---------- */

int DrSetup(int videoFormat, int width, int height, int redrawRate, void *, int) {
  EnsureCom();
  auto s = Current();
  return s ? s->Video().Setup(videoFormat, width, height, redrawRate) : -1;
}
void DrNothing() {}
void DrCleanup() {
  if (auto s = Current()) s->Video().Cleanup();
}
int DrSubmit(PDECODE_UNIT unit) {
  EnsureCom();
  auto s = Current();
  return s ? s->Video().Submit(unit) : DR_OK;
}

int ArInit(int, const POPUS_MULTISTREAM_CONFIGURATION opus, void *, int) {
  auto s = Current();
  return s ? s->Audio().Init(opus) : -1;
}
void ArNothing() {}
void ArCleanup() {
  if (auto s = Current()) s->Audio().Cleanup();
}
void ArPlay(char *data, int length) {
  if (auto s = Current()) s->Audio().Play(data, length);
}

void ClStageStarting(int stage) {
  if (auto s = Current()) s->Emit("connecting", LiGetStageName(stage));
}
void ClStageComplete(int) {}
void ClStageFailed(int stage, int errorCode) {
  Log(std::string("[stream] échec à l'étape ") + LiGetStageName(stage) + " (" + std::to_string(errorCode) + ")");
  if (auto s = Current()) s->Emit("error", std::string("Échec à l'étape ") + LiGetStageName(stage) + " (" + std::to_string(errorCode) + ")");
}
void ClStarted() {
  Log("[stream] connecté");
  if (auto s = Current()) {
    s->SetConnected(true);
    s->Emit("streaming");
  }
}
void ClTerminated(int errorCode) {
  Log("[stream] terminé (" + std::to_string(errorCode) + ")");
  if (auto s = Current()) {
    s->SetConnected(false);
    s->Emit(errorCode == 0 ? "stopped" : "error", "Connexion terminée (" + std::to_string(errorCode) + ")");
  }
}
void ClLog(const char *format, ...) {
  char text[512];
  va_list args;
  va_start(args, format);
  vsnprintf(text, sizeof(text), format, args);
  va_end(args);
  std::string line = text;
  while (!line.empty() && (line.back() == '\n' || line.back() == '\r')) line.pop_back();
  Log("[moonlight] " + line);
}
// What the computer asks of the controllers: queued for their own thread (Gamepads).
void ClRumble(unsigned short number, unsigned short low, unsigned short high) { Gamepads::Instance().Rumble(number, low, high); }
void ClRumbleTriggers(uint16_t number, uint16_t left, uint16_t right) { Gamepads::Instance().RumbleTriggers(number, left, right); }
void ClMotion(uint16_t number, uint8_t type, uint16_t hz) { Gamepads::Instance().Motion(number, type, hz); }
void ClLight(uint16_t number, uint8_t r, uint8_t g, uint8_t b) { Gamepads::Instance().Light(number, r, g, b); }
void ClStatus(int) {}

} // namespace

StreamSession::StreamSession(LaunchInfo launch, StateListener listener) : m_launch(std::move(launch)), m_listener(std::move(listener)) {}

StreamSession::~StreamSession() = default;

bool StreamSession::CreateVideo(std::string &error) {
  try {
    return m_video.Create(m_launch.width, m_launch.height, error);
  } catch (winrt::hresult_error const &e) {
    error = winrt::to_string(e.message());
    return false;
  }
}

void StreamSession::Emit(std::string const &state, std::string const &message) {
  if (m_cancelled && state != "stopped") return;
  if (m_listener) m_listener(state, message);
}

void StreamSession::Start() {
  Enqueue([self = shared_from_this()] { self->Connect(); });
}

/// On the connection thread. Blocks until connected or failed: the stream then runs on moonlight's threads.
void StreamSession::Connect() {
  if (m_cancelled) return;
  EnsureCom();
  SetCurrent(shared_from_this());

  SERVER_INFORMATION server;
  LiInitializeServerInformation(&server);
  server.address = m_launch.address.c_str();
  server.serverInfoAppVersion = m_launch.appVersion.c_str();
  server.serverInfoGfeVersion = m_launch.gfeVersion.empty() ? nullptr : m_launch.gfeVersion.c_str();
  server.rtspSessionUrl = m_launch.rtspSessionUrl.c_str();
  server.serverCodecModeSupport = m_launch.serverCodecModeSupport;

  STREAM_CONFIGURATION config;
  LiInitializeStreamConfiguration(&config);
  config.width = m_launch.width;
  config.height = m_launch.height;
  config.fps = m_launch.fps;
  config.bitrate = m_launch.bitrateKbps;
  config.packetSize = m_launch.remote ? 1024 : 1392;
  config.streamingRemotely = m_launch.remote ? STREAM_CFG_REMOTE : STREAM_CFG_AUTO;
  config.audioConfiguration = AUDIO_CONFIGURATION_STEREO;
  // Only what this PC can decode: without Microsoft's HEVC extension, the computer sends H.264.
  const bool hevc = m_launch.hevc && VideoRenderer::CanDecode(true);
  if (m_launch.hevc && !hevc) Log("[stream] pas de décodeur HEVC sur ce PC : H.264 demandé");
  config.supportedVideoFormats = hevc ? (VIDEO_FORMAT_H264 | VIDEO_FORMAT_H265) : VIDEO_FORMAT_H264;
  config.colorSpace = COLORSPACE_REC_709;
  config.colorRange = COLOR_RANGE_LIMITED;
  config.encryptionFlags = static_cast<int>(ENCFLG_ALL);
  FromHex(m_launch.riKey, config.remoteInputAesKey, sizeof(config.remoteInputAesKey));
  memset(config.remoteInputAesIv, 0, sizeof(config.remoteInputAesIv));
  const uint32_t keyId = static_cast<uint32_t>(m_launch.riKeyId);
  config.remoteInputAesIv[0] = static_cast<char>((keyId >> 24) & 0xff);
  config.remoteInputAesIv[1] = static_cast<char>((keyId >> 16) & 0xff);
  config.remoteInputAesIv[2] = static_cast<char>((keyId >> 8) & 0xff);
  config.remoteInputAesIv[3] = static_cast<char>(keyId & 0xff);

  DECODER_RENDERER_CALLBACKS video;
  LiInitializeVideoCallbacks(&video);
  video.setup = DrSetup;
  video.start = DrNothing;
  video.stop = DrNothing;
  video.cleanup = DrCleanup;
  video.submitDecodeUnit = DrSubmit;

  AUDIO_RENDERER_CALLBACKS audio;
  LiInitializeAudioCallbacks(&audio);
  audio.init = ArInit;
  audio.start = ArNothing;
  audio.stop = ArNothing;
  audio.cleanup = ArCleanup;
  audio.decodeAndPlaySample = ArPlay;

  CONNECTION_LISTENER_CALLBACKS listener;
  LiInitializeConnectionCallbacks(&listener);
  listener.stageStarting = ClStageStarting;
  listener.stageComplete = ClStageComplete;
  listener.stageFailed = ClStageFailed;
  listener.connectionStarted = ClStarted;
  listener.connectionTerminated = ClTerminated;
  listener.logMessage = ClLog;
  listener.rumble = ClRumble;
  listener.rumbleTriggers = ClRumbleTriggers;
  listener.setMotionEventState = ClMotion;
  listener.setControllerLED = ClLight;
  listener.connectionStatusUpdate = ClStatus;

  Log("[stream] connexion à " + m_launch.address + ", " + std::to_string(m_launch.width) + "x" + std::to_string(m_launch.height) + " " + std::to_string(m_launch.fps) + " i/s");
  const int result = LiStartConnection(&server, &config, &listener, &video, &audio, nullptr, 0, nullptr, 0);
  if (result != 0) {
    Log("[stream] connexion impossible (" + std::to_string(result) + ")");
    Emit("error", "Connexion impossible (" + std::to_string(result) + ")");
    SetCurrent(nullptr);
  }
}

void StreamSession::Stop() {
  if (m_cancelled.exchange(true)) return;
  m_connected = false;
  // Unblocks a connection still being set up. Only ours: not one that may have replaced it.
  if (Current().get() == this) LiInterruptConnection();
  Enqueue([self = shared_from_this()] {
    if (Current() == self) {
      LiStopConnection();
      SetCurrent(nullptr);
    }
    self->m_video.Cleanup();
    self->m_audio.Cleanup();
  });
}

uint32_t StreamSession::RttMs() const {
  uint32_t rtt = 0, variance = 0;
  return m_connected && LiGetEstimatedRttInfo(&rtt, &variance) ? rtt : 0;
}

/// Since the previous call (the view asks once a second).
double StreamSession::Fps() {
  const ULONGLONG now = GetTickCount64();
  const uint64_t frames = m_video.frames.load(), bytes = m_video.bytes.load();
  if (m_lastTick != 0 && now > m_lastTick) {
    const double seconds = static_cast<double>(now - m_lastTick) / 1000.0;
    m_fps = static_cast<double>(frames - m_lastFrames) / seconds;
    m_kbps = static_cast<double>(bytes - m_lastBytes) * 8.0 / 1000.0 / seconds;
  }
  m_lastTick = now;
  m_lastFrames = frames;
  m_lastBytes = bytes;
  return m_fps;
}

double StreamSession::BitrateKbps() { return m_kbps; }

} // namespace Waken::Stream
