// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL
// StreamSession for a linked PS5 or PS4: chiaki's session instead of moonlight-common-c's, feeding the same video
// renderer (Media Foundation) and sound (Opus), the PC's controllers merged into the console's one DualSense.
#include "pch.h"

#include <winsock2.h>
#include <ws2tcpip.h>

#include "StreamSession.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <thread>

#include <chiaki/common.h>
#include <chiaki/controller.h>
#include <chiaki/log.h>
#include <chiaki/session.h>

#include "Gamepads.h"
#include "StreamLog.h"

namespace Waken::Stream {

/// chiaki's session and what runs beside it, kept alive by StreamSession until its threads are over.
struct PlayStationConnection {
  ChiakiLog log{};
  ChiakiSession session{};
  bool initialized = false;
  std::atomic<bool> running{false};
  std::thread input;
  std::weak_ptr<StreamSession> owner;
  bool hevc = false;
};

namespace {

constexpr auto kInputEvery = std::chrono::milliseconds(4);

void EnsureComHere() {
  thread_local bool done = false;
  if (!done) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    done = true;
  }
}

void LogLine(ChiakiLogLevel level, const char *msg, void *) {
  if (level & (CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING | CHIAKI_LOG_INFO)) Log(std::string("[chiaki] ") + msg);
}

std::vector<uint8_t> FromHex(std::string const &hex) {
  std::vector<uint8_t> out;
  for (size_t i = 0; i + 1 < hex.size(); i += 2) out.push_back(static_cast<uint8_t>(std::stoi(hex.substr(i, 2), nullptr, 16)));
  return out;
}

/// A key frame: an IDR picture (H.264 type 5, HEVC types 16 to 21) somewhere in the access unit.
bool HasKeyframe(const uint8_t *buf, size_t size, bool hevc) {
  for (size_t i = 0; i + 3 < size; i++) {
    if (buf[i] != 0 || buf[i + 1] != 0 || buf[i + 2] != 1) continue;
    const uint8_t header = buf[i + 3];
    if (hevc) {
      const int type = (header >> 1) & 0x3F;
      if (type >= 16 && type <= 21) return true;
    } else if ((header & 0x1F) == 5) {
      return true;
    }
  }
  return false;
}

std::shared_ptr<StreamSession> OwnerOf(void *user) { return static_cast<PlayStationConnection *>(user)->owner.lock(); }

bool VideoSample(uint8_t *buf, size_t size, int32_t, bool, void *user) {
  EnsureComHere();
  auto owner = OwnerOf(user);
  if (!owner) return true;
  const bool hevc = static_cast<PlayStationConnection *>(user)->hevc;
  return owner->Video().SubmitAnnexB(buf, size, HasKeyframe(buf, size, hevc)) == DR_OK;
}

void AudioHeader(ChiakiAudioHeader *header, void *user) {
  EnsureComHere();
  auto owner = OwnerOf(user);
  if (!owner) return;
  OPUS_MULTISTREAM_CONFIGURATION opus{};
  opus.sampleRate = static_cast<int>(header->rate);
  opus.channelCount = header->channels;
  opus.streams = 1;
  opus.coupledStreams = header->channels == 2 ? 1 : 0;
  opus.samplesPerFrame = static_cast<int>(header->frame_size);
  opus.mapping[0] = 0;
  opus.mapping[1] = 1;
  owner->Audio().Init(&opus);
}

void AudioFrame(uint8_t *buf, size_t size, void *user) {
  EnsureComHere();
  if (auto owner = OwnerOf(user)) owner->Audio().Play(reinterpret_cast<const char *>(buf), static_cast<int>(size));
}

void Event(ChiakiEvent *event, void *user) {
  auto owner = OwnerOf(user);
  if (!owner) return;
  switch (event->type) {
    case CHIAKI_EVENT_CONNECTED:
      owner->SetConnected(true);
      owner->Emit("streaming");
      break;
    case CHIAKI_EVENT_LOGIN_PIN_REQUEST:
      owner->Emit("pin");
      break;
    case CHIAKI_EVENT_RUMBLE:
      Gamepads::Instance().RumbleAll(static_cast<uint16_t>(event->rumble.left * 257), static_cast<uint16_t>(event->rumble.right * 257));
      break;
    case CHIAKI_EVENT_QUIT: {
      owner->SetConnected(false);
      const ChiakiQuitReason reason = event->quit.reason;
      if (!chiaki_quit_reason_is_error(reason)) {
        owner->Emit("stopped");
      } else {
        std::string why = chiaki_quit_reason_string(reason);
        if (event->quit.reason_str) why += std::string(" (") + event->quit.reason_str + ")";
        Log("[playstation] fin : " + why);
        owner->Emit("error", "La console a coupé : " + why);
      }
      break;
    }
    default:
      break;
  }
}

/// moonlight's button bits (the merged controllers) as chiaki's.
uint32_t ChiakiButtons(uint32_t b) {
  uint32_t out = 0;
  if (b & A_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_CROSS;
  if (b & B_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_MOON;
  if (b & X_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_BOX;
  if (b & Y_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_PYRAMID;
  if (b & LEFT_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_DPAD_LEFT;
  if (b & RIGHT_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_DPAD_RIGHT;
  if (b & UP_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_DPAD_UP;
  if (b & DOWN_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_DPAD_DOWN;
  if (b & LB_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_L1;
  if (b & RB_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_R1;
  if (b & LS_CLK_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_L3;
  if (b & RS_CLK_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_R3;
  if (b & PLAY_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_OPTIONS;
  if (b & BACK_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_SHARE;
  if (b & SPECIAL_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_PS;
  if (b & TOUCHPAD_FLAG) out |= CHIAKI_CONTROLLER_BUTTON_TOUCHPAD;
  return out;
}

int16_t Down(int16_t up) { return up == -32768 ? 32767 : static_cast<int16_t>(-up); }

/// The controllers, read every 4 ms, sent when they change.
void InputLoop(PlayStationConnection *connection) {
  ChiakiControllerState sent;
  chiaki_controller_state_set_idle(&sent);
  while (connection->running) {
    const PadState pad = Gamepads::Instance().Merged();
    ChiakiControllerState state;
    chiaki_controller_state_set_idle(&state);
    state.buttons = ChiakiButtons(pad.buttons);
    state.l2_state = pad.leftTrigger;
    state.r2_state = pad.rightTrigger;
    // The console's sticks point down for a positive Y.
    state.left_x = pad.leftX;
    state.left_y = Down(pad.leftY);
    state.right_x = pad.rightX;
    state.right_y = Down(pad.rightY);
    if (!chiaki_controller_state_equals(&state, &sent)) {
      sent = state;
      chiaki_session_set_controller_state(&connection->session, &state);
    }
    std::this_thread::sleep_for(kInputEvery);
  }
}

} // namespace

void StreamSession::ConnectPlayStation() {
  EnsureComHere();
  static const bool ready = chiaki_lib_init() == CHIAKI_ERR_SUCCESS;
  if (!ready) return Emit("error", "Le protocole PlayStation n'a pas démarré.");
  auto registKey = m_launch.psRegistKey;
  auto rpKey = FromHex(m_launch.psRpKey);
  if (registKey.empty() || registKey.size() > CHIAKI_SESSION_AUTH_SIZE || rpKey.size() != 0x10)
    return Emit("error", "Liaison incomplète : relie la console à nouveau.");

  auto connection = std::shared_ptr<PlayStationConnection>(new PlayStationConnection());
  connection->owner = weak_from_this();
  m_playstation = connection;
  chiaki_log_init(&connection->log, CHIAKI_LOG_ALL & ~CHIAKI_LOG_VERBOSE, LogLine, nullptr);

  // The console's own sizes: 1080p or 720p, 60 or 30 frames per second; HEVC only from a PS5 this PC can decode.
  ChiakiConnectVideoProfile profile{};
  chiaki_connect_video_profile_preset(&profile, m_launch.height >= 1080 ? CHIAKI_VIDEO_RESOLUTION_PRESET_1080p : CHIAKI_VIDEO_RESOLUTION_PRESET_720p,
      m_launch.fps >= 60 ? CHIAKI_VIDEO_FPS_PRESET_60 : CHIAKI_VIDEO_FPS_PRESET_30);
  if (m_launch.bitrateKbps > 0) profile.bitrate = static_cast<unsigned int>(m_launch.bitrateKbps);
  connection->hevc = m_launch.psPs5 && m_launch.hevc && VideoRenderer::CanDecode(true);
  profile.codec = connection->hevc ? CHIAKI_CODEC_H265 : CHIAKI_CODEC_H264;
  if (m_video.Setup(connection->hevc ? VIDEO_FORMAT_H265 : VIDEO_FORMAT_H264, static_cast<int>(profile.width), static_cast<int>(profile.height),
          static_cast<int>(profile.max_fps)) != 0)
    return Emit("error", "Décodeur vidéo indisponible.");

  ChiakiConnectInfo info{};
  info.ps5 = m_launch.psPs5;
  info.host = m_launch.psHost.c_str();
  memcpy(info.regist_key, registKey.data(), registKey.size()); // the rest stays zero, as chiaki wants
  memcpy(info.morning, rpKey.data(), sizeof(info.morning));
  info.video_profile = profile;
  info.video_profile_auto_downgrade = true;
  info.enable_keyboard = false;
  info.enable_dualsense = true;
  info.packet_loss_max = 0.05;
  info.enable_idr_on_fec_failure = true;
  // The PSN account id, 8 bytes in base64.
  {
    static const std::string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::vector<uint8_t> account;
    uint32_t bits = 0;
    int count = 0;
    for (char c : m_launch.psAccountId) {
      auto at = alphabet.find(c);
      if (at == std::string::npos) continue;
      bits = (bits << 6) | static_cast<uint32_t>(at);
      count += 6;
      if (count >= 8) {
        count -= 8;
        account.push_back(static_cast<uint8_t>((bits >> count) & 0xFF));
      }
    }
    if (account.size() == CHIAKI_PSN_ACCOUNT_ID_SIZE) memcpy(info.psn_account_id, account.data(), CHIAKI_PSN_ACCOUNT_ID_SIZE);
  }

  if (chiaki_session_init(&connection->session, &info, &connection->log) != CHIAKI_ERR_SUCCESS) return Emit("error", "Session PlayStation impossible.");
  connection->initialized = true;
  void *user = connection.get();
  chiaki_session_set_event_cb(&connection->session, Event, user);
  chiaki_session_set_video_sample_cb(&connection->session, VideoSample, user);
  ChiakiAudioSink sink{};
  sink.user = user;
  sink.header_cb = AudioHeader;
  sink.frame_cb = AudioFrame;
  chiaki_session_set_audio_sink(&connection->session, &sink);
  Log("[playstation] connexion à " + m_launch.psHost + ", " + std::to_string(profile.width) + "x" + std::to_string(profile.height) + " " +
      (connection->hevc ? "HEVC" : "H.264"));
  Emit("connecting", "PlayStation");
  if (chiaki_session_start(&connection->session) != CHIAKI_ERR_SUCCESS) {
    chiaki_session_fini(&connection->session);
    connection->initialized = false;
    return Emit("error", "Connexion à la console impossible.");
  }
  connection->running = true;
  connection->input = std::thread(InputLoop, connection.get());
}

void StreamSession::StopPlayStation() {
  auto connection = m_playstation;
  Gamepads::Instance().RumbleAll(0, 0);
  // chiaki joins its threads: on a thread of our own, never on one of chiaki's.
  std::thread([connection, self = shared_from_this()] {
    if (connection) {
      connection->running = false;
      if (connection->input.joinable()) connection->input.join();
      if (connection->initialized) {
        chiaki_session_stop(&connection->session);
        chiaki_session_join(&connection->session);
        chiaki_session_fini(&connection->session);
        connection->initialized = false;
      }
    }
    self->m_video.Cleanup();
    self->m_audio.Cleanup();
  }).detach();
}

uint32_t StreamSession::PlayStationRttMs() const {
  auto connection = m_playstation;
  return connection && connection->initialized ? static_cast<uint32_t>(connection->session.rtt_us / 1000) : 0;
}

} // namespace Waken::Stream
