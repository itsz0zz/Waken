// The host side of Waken for Windows, as seen from JavaScript (NativeModules / TurboModuleRegistry "WakenHost").
//
// This module stays small on purpose: it only starts the Waken agent and keeps the app's files. The agent then
// starts and watches Sunshine (the stream server) and the Waken network (see agent/Waken.Agent/Host), and the
// app talks to it over HTTP on 127.0.0.1. Everything runs in a Windows job object closed with the app: Sunshine,
// the agent and the network never outlive Waken, even when it crashes or is killed.
#pragma once

#include "pch.h"

#include <winsock2.h>
#include <ws2tcpip.h>

#include <bcrypt.h>
#include <shellapi.h>
#include <shlobj.h>

#include <cctype>
#include <cstdio>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>

#include "NativeModules.h"
#include "Stream/Gamepads.h"
#include "Stream/PlayStation.h"

#pragma comment(lib, "bcrypt.lib")

namespace Waken {

namespace fs = std::filesystem;
using winrt::Microsoft::ReactNative::ReactPromise;

inline constexpr unsigned short AgentPort = 47100;

/// The app's window and its UI thread, set by WinMain: the full screen of a stream is the window's.
inline winrt::Microsoft::UI::Windowing::AppWindow &MainWindow() {
  static winrt::Microsoft::UI::Windowing::AppWindow window{nullptr};
  return window;
}
inline winrt::Microsoft::UI::Dispatching::DispatcherQueue &UiQueue() {
  static winrt::Microsoft::UI::Dispatching::DispatcherQueue queue{nullptr};
  return queue;
}

/// Everything Waken writes, in the user's own profile: %LOCALAPPDATA%\Waken.
inline fs::path DataRoot() {
  PWSTR local = nullptr;
  fs::path root;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) root = fs::path(local) / L"Waken";
  CoTaskMemFree(local);
  return root;
}

/// Where the app keeps what it ships beside its exe: host\agent, host\sunshine, host\waken-tunnel.exe.
inline fs::path HostFolder() {
  wchar_t exe[MAX_PATH];
  GetModuleFileNameW(nullptr, exe, MAX_PATH);
  return fs::path(exe).parent_path() / L"host";
}

inline std::string RandomSecret() {
  unsigned char bytes[24];
  if (!BCRYPT_SUCCESS(BCryptGenRandom(nullptr, bytes, sizeof(bytes), BCRYPT_USE_SYSTEM_PREFERRED_RNG))) {
    throw std::runtime_error("Pas de hasard système");
  }
  static const char *hex = "0123456789abcdef";
  std::string out;
  for (auto b : bytes) {
    out.push_back(hex[b >> 4]);
    out.push_back(hex[b & 15]);
  }
  return out;
}

inline std::string ReadFile(fs::path const &path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return {};
  std::ostringstream text;
  text << in.rdbuf();
  return text.str();
}

/// Written beside, then moved over: a crash never leaves half a file.
inline void WriteFile(fs::path const &path, std::string const &text) {
  fs::create_directories(path.parent_path());
  auto temp = path;
  temp += L".tmp";
  {
    std::ofstream out(temp, std::ios::binary | std::ios::trunc);
    out << text;
  }
  fs::rename(temp, path);
}

/// A secret kept in the profile (only this user and the system can read it), created the first time.
inline std::string Secret(std::wstring const &name) {
  auto path = DataRoot() / name;
  auto existing = ReadFile(path);
  while (!existing.empty() && isspace(static_cast<unsigned char>(existing.back()))) existing.pop_back();
  if (!existing.empty()) return existing;
  auto value = RandomSecret();
  WriteFile(path, value);
  return value;
}

inline std::wstring Widen(std::string const &text) {
  if (text.empty()) return {};
  int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
  std::wstring out(size, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size);
  return out;
}

inline std::string Narrow(std::wstring const &text) {
  if (text.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
  std::string out(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size, nullptr, nullptr);
  return out;
}

inline std::string JsonString(std::string const &text) {
  std::string out = "\"";
  for (char c : text) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buffer[8];
          sprintf_s(buffer, "\\u%04x", c);
          out += buffer;
        } else {
          out += c;
        }
    }
  }
  return out + "\"";
}

inline std::string ComputerName() {
  wchar_t name[256];
  DWORD size = 256;
  if (GetComputerNameExW(ComputerNameDnsHostname, name, &size)) return Narrow(name);
  return "PC";
}

/// Something answers on the agent's port: the agent started at boot by Windows (scripts\install-service.ps1).
inline bool AgentListening() {
  static const bool ready = [] {
    WSADATA data;
    return WSAStartup(MAKEWORD(2, 2), &data) == 0;
  }();
  if (!ready) return false;
  SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s == INVALID_SOCKET) return false;
  u_long nonBlocking = 1;
  ioctlsocket(s, FIONBIO, &nonBlocking);
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_port = htons(AgentPort);
  inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
  connect(s, reinterpret_cast<sockaddr *>(&address), sizeof(address));
  fd_set writable;
  FD_ZERO(&writable);
  FD_SET(s, &writable);
  timeval wait{0, 300000};
  bool open = select(0, nullptr, &writable, nullptr, &wait) > 0;
  if (open) {
    int error = 0;
    int size = sizeof(error);
    open = getsockopt(s, SOL_SOCKET, SO_ERROR, reinterpret_cast<char *>(&error), &size) == 0 && error == 0;
  }
  closesocket(s);
  return open;
}

/// Runs a program hidden and waits for it: its exit code, -1 when it could not start.
inline long RunHidden(std::wstring command) {
  STARTUPINFOW startup{sizeof(startup)};
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(nullptr, command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) return -1;
  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD code = 0;
  GetExitCodeProcess(process.hProcess, &code);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return static_cast<long>(code);
}

/// Waken starts with Windows: install-service.ps1 put its programs in %ProgramFiles%\Waken, or its "Waken" task
/// shows. The task alone is not enough to tell: run as SYSTEM, it can be hidden from a user who is not elevated.
inline bool StartsWithWindows() {
  wchar_t programs[MAX_PATH];
  if (GetEnvironmentVariableW(L"ProgramFiles", programs, MAX_PATH) &&
      fs::exists(fs::path(programs) / L"Waken" / L"host" / L"agent" / L"Waken.Agent.exe")) {
    return true;
  }
  wchar_t system[MAX_PATH];
  GetSystemDirectoryW(system, MAX_PATH);
  return RunHidden(L"\"" + std::wstring(system) + L"\\schtasks.exe\" /Query /TN Waken") == 0;
}

/// install-service.ps1 from the app's host folder, elevated: Windows asks the user first (UAC). Its exit code;
/// ERROR_CANCELLED when the user said no.
inline long RunStartupScript(bool enable, bool disableFastStartup) {
  auto script = HostFolder() / L"install-service.ps1";
  if (!fs::exists(script)) return ERROR_FILE_NOT_FOUND;
  std::wstring args = L"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script.wstring() + L"\" -FromApp";
  if (!enable) args += L" -Uninstall";
  if (disableFastStartup) args += L" -DisableFastStartup";
  SHELLEXECUTEINFOW info{sizeof(info)};
  info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
  info.lpVerb = L"runas";
  info.lpFile = L"powershell.exe";
  info.lpParameters = args.c_str();
  info.nShow = SW_HIDE;
  if (!ShellExecuteExW(&info)) return static_cast<long>(GetLastError());
  // A few minutes at most (copy, task, network card): past that the app stops waiting, the script goes on.
  if (WaitForSingleObject(info.hProcess, 5 * 60 * 1000) == WAIT_TIMEOUT) {
    CloseHandle(info.hProcess);
    return static_cast<long>(WAIT_TIMEOUT);
  }
  DWORD code = 0;
  GetExitCodeProcess(info.hProcess, &code);
  CloseHandle(info.hProcess);
  return static_cast<long>(code);
}

/// One key of the app's storage: a file named after it, nothing outside the store folder.
inline fs::path StoreFile(std::string const &key) {
  std::wstring safe;
  for (wchar_t c : Widen(key)) safe.push_back(iswalnum(c) || c == L'-' || c == L'_' || c == L'.' ? c : L'_');
  return DataRoot() / L"app" / (safe + L".json");
}

/// The agent and everything it starts, in one job closed with the app.
class HostProcess {
 public:
  static HostProcess &Instance() {
    static HostProcess instance;
    return instance;
  }

  void StartOnce() {
    std::lock_guard lock(m_mutex);
    // Started again when the agent started with Windows is gone (turned off from the Réglages).
    if (m_started && m_boot && !AgentListening()) {
      m_started = false;
      m_boot = false;
    }
    if (m_started) return;
    m_started = true;
    try {
      Start();
    } catch (std::exception const &e) {
      m_error = e.what();
    }
  }

  std::string StatusJson() {
    std::lock_guard lock(m_mutex);
    bool embedded = fs::exists(HostFolder() / L"agent" / L"Waken.Agent.exe");
    // Started at boot (a Windows task, as SYSTEM): it outlives the app, which only talks to it. Also the case once
    // turned on from the Réglages, which stopped the app's own agent.
    if (!m_boot && m_agent.hProcess && WaitForSingleObject(m_agent.hProcess, 0) == WAIT_OBJECT_0 && AgentListening()) m_boot = true;
    bool running = m_boot && AgentListening();
    if (m_agent.hProcess) {
      DWORD code = 0;
      running = GetExitCodeProcess(m_agent.hProcess, &code) && code == STILL_ACTIVE;
    }
    std::string json = "{\"embedded\":" + std::string(embedded || m_boot ? "true" : "false") + ",\"agent\":" +
        (running ? "true" : "false") + ",\"boot\":" + (m_boot ? "true" : "false") + ",\"deviceName\":" + JsonString(ComputerName());
    if (!m_token.empty()) json += ",\"agentToken\":" + JsonString(m_token);
    if (!m_error.empty()) json += ",\"error\":" + JsonString(m_error);
    return json + "}";
  }

 private:
  HostProcess() = default;

  void Start() {
    auto root = DataRoot();
    if (root.empty()) throw std::runtime_error("Dossier de l'app introuvable");
    fs::create_directories(root);
    auto host = HostFolder();
    auto agentExe = host / L"agent" / L"Waken.Agent.exe";
    if (!fs::exists(agentExe)) throw std::runtime_error("L'agent manque dans l'app : reconstruis-la avec apps\\windows\\scripts\\build.ps1.");

    m_token = Secret(L"agent-token");
    auto password = Secret(L"sunshine-admin");
    // The agent started at boot already runs, with these same secrets (install-service.ps1 took them from here).
    if (AgentListening()) {
      m_boot = true;
      return;
    }

    // Closing the last handle (the app exits, crashes or is killed) ends every process of the job.
    m_job = CreateJobObjectW(nullptr, nullptr);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(m_job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));

    // The agent's settings, the token among them: in its environment, never on a command line.
    std::wstring env;
    auto block = GetEnvironmentStringsW();
    for (auto at = block; *at; at += wcslen(at) + 1) env.append(at).push_back(L'\0');
    FreeEnvironmentStringsW(block);
    auto add = [&](std::wstring const &name, std::wstring const &value) { env.append(name + L"=" + value).push_back(L'\0'); };
    add(L"Urls", L"http://127.0.0.1:" + std::to_wstring(AgentPort));
    add(L"Agent__Token", Widen(m_token));
    add(L"Agent__SunshineHost", L"127.0.0.1");
    add(L"Agent__SunshineUser", L"admin");
    add(L"Agent__SunshinePassword", Widen(password));
    add(L"Agent__SunshineCertPath", (root / L"sunshine" / L"credentials" / L"cacert.pem").wstring());
    add(L"Agent__DataDir", (root / L"agent").wstring());
    // The agent runs the stream server and the network itself (agent/Waken.Agent/Host).
    add(L"Agent__Host__Enabled", L"true");
    add(L"Agent__Host__Root", root.wstring());
    add(L"Agent__Host__SunshineExe", (host / L"sunshine" / L"sunshine.exe").wstring());
    add(L"Agent__Host__TunnelExe", (host / L"waken-tunnel.exe").wstring());
    add(L"Agent__Host__DeviceName", Widen(ComputerName()));
    auto key = ReadFile(host / L"steamgriddb.key");
    while (!key.empty() && isspace(static_cast<unsigned char>(key.back()))) key.pop_back();
    if (!key.empty()) add(L"Agent__SteamGridDbKey", Widen(key));
    env.push_back(L'\0');

    fs::create_directories(root / L"agent");
    SECURITY_ATTRIBUTES inherit{sizeof(inherit), nullptr, TRUE};
    HANDLE log = CreateFileW((root / L"agent" / L"agent.log").c_str(), GENERIC_WRITE, FILE_SHARE_READ, &inherit, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);

    STARTUPINFOW startup{sizeof(startup)};
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdOutput = log;
    startup.hStdError = log;
    startup.hStdInput = nullptr;
    std::wstring command = L"\"" + agentExe.wstring() + L"\"";
    auto dir = agentExe.parent_path().wstring();
    BOOL ok = CreateProcessW(
        agentExe.c_str(), command.data(), nullptr, nullptr, TRUE,
        CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | CREATE_SUSPENDED, env.data(), dir.c_str(), &startup, &m_agent);
    if (log != INVALID_HANDLE_VALUE) CloseHandle(log);
    if (!ok) throw std::runtime_error("L'agent n'a pas démarré (" + std::to_string(GetLastError()) + ")");
    // In the job before it runs a single instruction: its children (Sunshine, the network) are in it too.
    AssignProcessToJobObject(m_job, m_agent.hProcess);
    ResumeThread(m_agent.hThread);
  }

  std::mutex m_mutex;
  bool m_started = false;
  bool m_boot = false;
  std::string m_error;
  std::string m_token;
  HANDLE m_job = nullptr;
  PROCESS_INFORMATION m_agent{};
};

REACT_MODULE(WakenHost)
struct WakenHost {
  /// Starts the agent (which starts Sunshine and the network), once, off the UI thread.
  REACT_METHOD(start)
  void start(ReactPromise<void> &&result) noexcept {
    std::thread([result = std::move(result)]() mutable {
      HostProcess::Instance().StartOnce();
      result.Resolve();
    }).detach();
  }

  /// {embedded, agent, deviceName, agentToken?, error?} as JSON. Sunshine and the network: ask the agent.
  REACT_METHOD(status)
  void status(ReactPromise<std::string> &&result) noexcept {
    result.Resolve(HostProcess::Instance().StatusJson());
  }

  REACT_METHOD(storageGet)
  void storageGet(std::string key, ReactPromise<winrt::Microsoft::ReactNative::JSValue> &&result) noexcept {
    auto path = StoreFile(key);
    if (!fs::exists(path)) return result.Resolve(nullptr);
    result.Resolve(ReadFile(path));
  }

  REACT_METHOD(storageSet)
  void storageSet(std::string key, std::string value, ReactPromise<void> &&result) noexcept {
    try {
      WriteFile(StoreFile(key), value);
      result.Resolve();
    } catch (std::exception const &e) {
      result.Reject(e.what());
    }
  }

  /// The window full screen (a stream) or back to normal. On the UI thread, which owns the window.
  REACT_METHOD(setFullscreen)
  void setFullscreen(bool on) noexcept {
    auto queue = UiQueue();
    if (!queue) return;
    queue.TryEnqueue([on] {
      auto window = MainWindow();
      if (!window) return;
      using winrt::Microsoft::UI::Windowing::AppWindowPresenterKind;
      window.SetPresenter(on ? AppWindowPresenterKind::FullScreen : AppWindowPresenterKind::Default);
    });
  }

  /// The Manettes page: the PC's controllers (SDL3, Stream/Gamepads.cpp) as JSON, a test vibration, the options.
  REACT_METHOD(gamepads)
  void gamepads(ReactPromise<std::string> &&result) noexcept {
    result.Resolve(Stream::Gamepads::Instance().ListJson());
  }

  REACT_METHOD(testGamepad)
  void testGamepad(std::string id, ReactPromise<void> &&result) noexcept {
    Stream::Gamepads::Instance().Test(id);
    result.Resolve();
  }

  REACT_METHOD(setGamepadOptions)
  void setGamepadOptions(double rumble, bool motion, std::string kind) noexcept {
    Stream::Gamepads::Instance().SetOptions(rumble, motion, kind);
  }

  /// Réglages: does Waken start with Windows (and wake from the network)?
  REACT_METHOD(startsWithWindows)
  void startsWithWindows(ReactPromise<bool> &&result) noexcept {
    std::thread([result = std::move(result)]() mutable { result.Resolve(StartsWithWindows()); }).detach();
  }

  /// Réglages: Waken starts with Windows, or no longer, through install-service.ps1 after Windows' confirmation.
  REACT_METHOD(setStartsWithWindows)
  void setStartsWithWindows(bool enable, bool disableFastStartup, ReactPromise<void> &&result) noexcept {
    std::thread([enable, disableFastStartup, result = std::move(result)]() mutable {
      long code = RunStartupScript(enable, disableFastStartup);
      if (code == 0) {
        // Off again: this app's own agent takes over.
        if (!enable) HostProcess::Instance().StartOnce();
        return result.Resolve();
      }
      if (code == ERROR_CANCELLED) return result.Reject("Annulé : Windows n'a pas eu ta confirmation.");
      if (code == ERROR_FILE_NOT_FOUND) return result.Reject("Le script manque dans l'app : reconstruis-la avec build.ps1.");
      if (code == WAIT_TIMEOUT) return result.Reject("Le script ne s'est pas terminé après 5 minutes : regarde %TEMP%\\waken-install.log.");
      if (code == 1) return result.Reject("Le script s'est arrêté sur une erreur : elle est dans la fenêtre qu'il vient d'ouvrir, et dans %TEMP%\\waken-install.log.");
      result.Reject(("Le réglage n'a pas abouti (code " + std::to_string(code) + ").").c_str());
    }).detach();
  }

  /// PS5 and PS4 (libchiaki, Stream/PlayStation.cpp): found on this network, linked with their code, woken.
  REACT_METHOD(discoverConsoles)
  void discoverConsoles(double seconds, ReactPromise<std::string> &&result) noexcept {
    std::thread([seconds, result = std::move(result)]() mutable { result.Resolve(Stream::PlayStation::Discover(seconds)); }).detach();
  }

  REACT_METHOD(registerConsole)
  void registerConsole(std::string host, bool ps5, std::string accountId, std::string pin, ReactPromise<std::string> &&result) noexcept {
    std::thread([host, ps5, accountId, pin, result = std::move(result)]() mutable {
      try {
        result.Resolve(Stream::PlayStation::Register(host, ps5, accountId, pin));
      } catch (std::exception const &e) {
        result.Reject(e.what());
      }
    }).detach();
  }

  REACT_METHOD(wakeConsole)
  void wakeConsole(std::string host, std::string registKey, bool ps5, ReactPromise<void> &&result) noexcept {
    std::thread([host, registKey, ps5, result = std::move(result)]() mutable {
      auto error = Stream::PlayStation::Wake(host, registKey, ps5);
      if (error.empty()) result.Resolve();
      else result.Reject(error.c_str());
    }).detach();
  }

  REACT_METHOD(storageRemove)
  void storageRemove(std::string key, ReactPromise<void> &&result) noexcept {
    std::error_code ignored;
    fs::remove(StoreFile(key), ignored);
    result.Resolve();
  }
};

} // namespace Waken
