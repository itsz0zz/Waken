// SPDX-License-Identifier: LicenseRef-AGPL-3.0-only-OpenSSL
#include "pch.h"

#include <winsock2.h>
#include <ws2tcpip.h>

#include "PlayStation.h"

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

#include <chiaki/base64.h>
#include <chiaki/common.h>
#include <chiaki/discovery.h>
#include <chiaki/discoveryservice.h>
#include <chiaki/log.h>
#include <chiaki/regist.h>

#include "StreamLog.h"

namespace Waken::Stream::PlayStation {

namespace {

void LogLine(ChiakiLogLevel level, const char *msg, void *) {
  if (level & (CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING | CHIAKI_LOG_INFO)) Log(std::string("[chiaki] ") + msg);
}

/// chiaki_lib_init, once: its sockets (WSAStartup) and crypto.
bool Ready() {
  static const bool ready = chiaki_lib_init() == CHIAKI_ERR_SUCCESS;
  return ready;
}

ChiakiLog *TheLog() {
  static ChiakiLog log = [] {
    ChiakiLog l{};
    chiaki_log_init(&l, CHIAKI_LOG_ALL & ~CHIAKI_LOG_VERBOSE, LogLine, nullptr);
    return l;
  }();
  return &log;
}

std::string Escape(const char *value) {
  std::string out;
  for (const char *c = value ? value : ""; *c; c++) {
    if (*c == '"' || *c == '\\') out += '\\';
    if (static_cast<unsigned char>(*c) >= 0x20) out += *c;
  }
  return out;
}

std::string Hex(const uint8_t *bytes, size_t size) {
  static const char *digits = "0123456789abcdef";
  std::string out;
  for (size_t i = 0; i < size; i++) {
    out += digits[bytes[i] >> 4];
    out += digits[bytes[i] & 15];
  }
  return out;
}

/// What the discovery service saw last.
struct Found {
  std::mutex lock;
  std::string json = "[]";
};

void Discovered(ChiakiDiscoveryHost *hosts, size_t count, void *user) {
  std::string json = "[";
  for (size_t i = 0; i < count; i++) {
    ChiakiDiscoveryHost *host = &hosts[i];
    const char *state = host->state == CHIAKI_DISCOVERY_HOST_STATE_READY ? "ready" : host->state == CHIAKI_DISCOVERY_HOST_STATE_STANDBY ? "standby" : "unknown";
    if (i) json += ",";
    json += "{\"host\":\"" + Escape(host->host_addr) + "\",\"name\":\"" + Escape(host->host_name) + "\",\"id\":\"" + Escape(host->host_id) +
        "\",\"ps5\":" + (chiaki_discovery_host_is_ps5(host) ? "true" : "false") + ",\"state\":\"" + state + "\",\"systemVersion\":\"" +
        Escape(host->system_version) + "\",\"app\":\"" + Escape(host->running_app_name) + "\"}";
  }
  auto found = static_cast<Found *>(user);
  std::lock_guard guard(found->lock);
  found->json = json + "]";
}

/// One registration: chiaki calls back from its thread, the caller waits for it.
struct Registration {
  std::mutex lock;
  std::condition_variable done;
  bool finished = false;
  std::string json;
  std::string error;
};

void Registered(ChiakiRegistEvent *event, void *user) {
  auto registration = static_cast<Registration *>(user);
  std::lock_guard guard(registration->lock);
  if (event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_SUCCESS && event->registered_host) {
    ChiakiRegisteredHost *host = event->registered_host;
    // ASCII hex, padded with zeros to its 16 bytes.
    std::string key(host->rp_regist_key, strnlen(host->rp_regist_key, sizeof(host->rp_regist_key)));
    char nickname[sizeof(host->server_nickname) + 1] = {};
    memcpy(nickname, host->server_nickname, sizeof(host->server_nickname));
    registration->json = "{\"registKey\":\"" + Escape(key.c_str()) + "\",\"rpKey\":\"" + Hex(host->rp_key, sizeof(host->rp_key)) +
        "\",\"rpKeyType\":" + std::to_string(host->rp_key_type) + ",\"mac\":\"" + Hex(host->server_mac, sizeof(host->server_mac)) +
        "\",\"nickname\":\"" + Escape(nickname) + "\",\"ps5\":" + (chiaki_target_is_ps5(host->target) ? "true" : "false") +
        ",\"target\":" + std::to_string(static_cast<int>(host->target)) + "}";
  } else if (event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_CANCELED) {
    registration->error = "Liaison annulée.";
  } else {
    registration->error = "La console a refusé la liaison : vérifie le code (il change à chaque ouverture de l'écran) et ton compte PSN.";
  }
  registration->finished = true;
  registration->done.notify_all();
}

} // namespace

std::string Discover(double seconds) {
  Found found;
  if (!Ready()) return found.json;
  ChiakiDiscoveryServiceOptions options{};
  options.ping_ms = 500;
  options.ping_initial_ms = 50;
  options.hosts_max = 16;
  options.host_drop_pings = 3;
  options.cb = Discovered;
  options.cb_user = &found;
  // The whole network's broadcast: both consoles answer it, on their own port each.
  sockaddr_in broadcast{};
  broadcast.sin_family = AF_INET;
  broadcast.sin_addr.s_addr = INADDR_BROADCAST;
  sockaddr_storage address{};
  memcpy(&address, &broadcast, sizeof(broadcast));
  options.send_addr = &address;
  options.send_addr_size = sizeof(broadcast);
  ChiakiDiscoveryService service;
  if (chiaki_discovery_service_init(&service, &options, TheLog()) == CHIAKI_ERR_SUCCESS) {
    std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<long long>(seconds * 1000)));
    chiaki_discovery_service_fini(&service);
  }
  std::lock_guard guard(found.lock);
  return found.json;
}

std::string Register(std::string const &host, bool ps5, std::string const &accountId, std::string const &pin) {
  if (!Ready()) throw std::runtime_error("Le protocole PlayStation n'a pas démarré.");
  uint8_t account[CHIAKI_PSN_ACCOUNT_ID_SIZE + 8] = {};
  size_t accountSize = sizeof(account);
  if (chiaki_base64_decode(accountId.c_str(), accountId.size(), account, &accountSize) != CHIAKI_ERR_SUCCESS || accountSize != CHIAKI_PSN_ACCOUNT_ID_SIZE)
    throw std::runtime_error("Identifiant de compte PSN invalide : reconnecte-toi à PlayStation Network.");
  std::string digits;
  for (char c : pin)
    if (c >= '0' && c <= '9') digits += c;
  if (digits.size() != 8) throw std::runtime_error("Le code de liaison a 8 chiffres.");

  Registration registration;
  ChiakiRegistInfo info{};
  info.target = ps5 ? CHIAKI_TARGET_PS5_1 : CHIAKI_TARGET_PS4_10;
  info.host = host.c_str();
  info.broadcast = false;
  info.pin = static_cast<uint32_t>(std::stoul(digits));
  memcpy(info.psn_account_id, account, CHIAKI_PSN_ACCOUNT_ID_SIZE);
  ChiakiRegist regist;
  if (chiaki_regist_start(&regist, TheLog(), &info, Registered, &registration) != CHIAKI_ERR_SUCCESS)
    throw std::runtime_error("La liaison n'a pas pu démarrer.");
  {
    std::unique_lock guard(registration.lock);
    // chiaki gives up by itself; this only guards against a thread that would never call back.
    registration.done.wait_for(guard, std::chrono::minutes(2), [&] { return registration.finished; });
  }
  chiaki_regist_stop(&regist);
  chiaki_regist_fini(&regist);
  if (!registration.json.empty()) return registration.json;
  throw std::runtime_error(registration.error.empty() ? "La console ne répond pas." : registration.error);
}

std::string Wake(std::string const &host, std::string const &registKey, bool ps5) {
  if (!Ready()) return "Le protocole PlayStation n'a pas démarré.";
  if (registKey.empty() || registKey.size() > 8) return "Clé de liaison invalide : relie la console à nouveau.";
  char *end = nullptr;
  unsigned long long credential = strtoull(registKey.c_str(), &end, 16);
  if (!end || *end) return "Clé de liaison invalide : relie la console à nouveau.";
  ChiakiErrorCode error = chiaki_discovery_wakeup(TheLog(), nullptr, host.c_str(), credential, ps5);
  return error == CHIAKI_ERR_SUCCESS ? std::string() : std::string("Réveil non envoyé : ") + chiaki_error_string(error);
}

} // namespace Waken::Stream::PlayStation
