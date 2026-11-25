// Waken.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "Waken.h"

#include "AutolinkedNativeModules.g.h"

#include <csignal>

#include <dbghelp.h>
#pragma comment(lib, "dbghelp.lib")

#include "NativeModules.h"
#include "Stream/StreamLog.h"
#include "Stream/StreamView.h"
#include "WakenHost.h"
#ifdef WAKEN_VELOPACK
#include "Velopack.hpp"
#endif

// What happened before a crash, in %LOCALAPPDATA%\Waken\waken.log (for this packaged app, Windows keeps it in
// %LOCALAPPDATA%\Packages\Waken_<id>\LocalCache\Local\Waken). Rewritten at each start.
namespace {
std::mutex logMutex;
HANDLE logFile = INVALID_HANDLE_VALUE;

void OpenLog() {
  auto root = Waken::DataRoot();
  if (root.empty()) return;
  std::error_code ignored;
  std::filesystem::create_directories(root, ignored);
  logFile = CreateFileW((root / L"waken.log").c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  // UTF-8 mark: Windows PowerShell's Get-Content would read the accents as another code page otherwise.
  DWORD written = 0;
  if (logFile != INVALID_HANDLE_VALUE) ::WriteFile(logFile, "\xEF\xBB\xBF", 3, &written, nullptr);
}

/// Written straight to the file (no buffer): the line is there even if the app dies right after.
void WriteLog(std::string const &line) noexcept {
  if (logFile == INVALID_HANDLE_VALUE) return;
  SYSTEMTIME t;
  GetLocalTime(&t);
  char stamp[16];
  sprintf_s(stamp, "%02d:%02d:%02d.%03d ", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
  std::string text = stamp + line + "\r\n";
  DWORD written = 0;
  ::WriteFile(logFile, text.data(), static_cast<DWORD>(text.size()), &written, nullptr);
}

void Log(std::string const &line) noexcept {
  std::lock_guard lock(logMutex);
  WriteLog(line);
}

/// Who called: each frame as module+offset, with the nearest symbol DbgHelp knows (exports at least).
void LogStack() noexcept {
  void *frames[48];
  USHORT count = RtlCaptureStackBackTrace(1, 48, frames, nullptr);
  HANDLE process = GetCurrentProcess();
  SymSetOptions(SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS);
  bool symbols = SymInitialize(process, nullptr, TRUE);
  alignas(SYMBOL_INFO) char buffer[sizeof(SYMBOL_INFO) + 256];
  for (USHORT i = 0; i < count; ++i) {
    auto address = reinterpret_cast<DWORD64>(frames[i]);
    HMODULE module = nullptr;
    wchar_t path[MAX_PATH] = L"?";
    if (GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, reinterpret_cast<LPCWSTR>(frames[i]), &module)) {
      GetModuleFileNameW(module, path, MAX_PATH);
    }
    char line[512];
    sprintf_s(line, "  #%02u %ls+0x%llx", static_cast<unsigned>(i), std::filesystem::path(path).filename().c_str(), static_cast<unsigned long long>(address - reinterpret_cast<DWORD64>(module)));
    std::string text = line;
    auto symbol = reinterpret_cast<SYMBOL_INFO *>(buffer);
    symbol->SizeOfStruct = sizeof(SYMBOL_INFO);
    symbol->MaxNameLen = 255;
    DWORD64 displacement = 0;
    if (symbols && SymFromAddr(process, address, &displacement, symbol)) {
      sprintf_s(line, " %s+0x%llx", symbol->Name, static_cast<unsigned long long>(displacement));
      text += line;
    }
    WriteLog(text);
  }
}

/// The fatal ends, which would otherwise leave nothing but 0xc0000409 in the event log.
void InstallCrashLog() {
  // std::terminate (an exception out of a noexcept function, among others) ends in abort: SIGABRT.
  signal(SIGABRT, [](int) {
    if (logMutex.try_lock()) {
      WriteLog("Arrêt : abort (std::terminate ou assertion). Voir les lignes au-dessus.");
      logMutex.unlock();
    }
  });
  std::set_terminate([] {
    std::string what = "std::terminate";
    try {
      if (auto e = std::current_exception()) std::rethrow_exception(e);
    } catch (std::exception const &e) {
      what += std::string(" : ") + e.what();
    } catch (winrt::hresult_error const &e) {
      what += " : " + Waken::Narrow(std::wstring(e.message()));
    } catch (...) {
      what += " : exception inconnue";
    }
    std::lock_guard lock(logMutex);
    WriteLog(what);
    LogStack();
    std::abort();
  });
  _set_invalid_parameter_handler([](wchar_t const *, wchar_t const *, wchar_t const *, unsigned, uintptr_t) {
    {
      std::lock_guard lock(logMutex);
      WriteLog("Arrêt : paramètre invalide passé à la bibliothèque C, appelé depuis :");
      LogStack();
    }
    std::abort();
  });
}

/// React Native's own messages (JavaScript console included), from warnings up.
void LogReactNative(winrt::Microsoft::ReactNative::LogLevel level, winrt::hstring const &message) noexcept {
  using winrt::Microsoft::ReactNative::LogLevel;
  if (level < LogLevel::Info) return;
  static char const *names[] = {"trace", "info", "warning", "error", "fatal"};
  Log(std::string("[") + names[static_cast<int>(level)] + "] " + winrt::to_string(message));
}

#ifdef WAKEN_UNPACKAGED
/// Without MSIX nothing declares the app's fonts to Windows, and React Native Windows only finds a font by its
/// family name in the system collection (DirectWrite). So they are installed for this user, as Windows' own
/// "Install" does without administrator rights: the file in %LOCALAPPDATA%\Microsoft\Windows\Fonts, its entry in
/// HKCU's font list. Done before React Native starts, again only when a file is missing or changed.
void InstallFonts() noexcept {
  wchar_t exe[MAX_PATH];
  GetModuleFileNameW(nullptr, exe, MAX_PATH);
  const auto source = std::filesystem::path(exe).parent_path() / L"Fonts";
  wchar_t *local = nullptr;
  if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) return;
  const auto target = std::filesystem::path(local) / L"Microsoft" / L"Windows" / L"Fonts";
  CoTaskMemFree(local);
  std::error_code error;
  std::filesystem::create_directories(target, error);
  HKEY key = nullptr;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", 0, nullptr, 0,
                      KEY_SET_VALUE, nullptr, &key, nullptr) != ERROR_SUCCESS) {
    Log("Polices : liste des polices de l'utilisateur inaccessible");
    return;
  }
  int installed = 0;
  for (auto const &entry : std::filesystem::directory_iterator(source, error)) {
    if (entry.path().extension() != L".ttf") continue;
    const auto file = target / entry.path().filename();
    const bool same = std::filesystem::exists(file, error) &&
                      std::filesystem::file_size(file, error) == std::filesystem::file_size(entry.path(), error);
    if (!same) {
      // A font in use (another Waken open) cannot be replaced: the copy in place stays until the next start.
      if (!std::filesystem::copy_file(entry.path(), file, std::filesystem::copy_options::overwrite_existing, error)) {
        Log("Polices : copie impossible de " + Waken::Narrow(entry.path().filename().wstring()));
        continue;
      }
      ++installed;
    }
    const std::wstring name = L"Waken " + entry.path().stem().wstring() + L" (TrueType)";
    const std::wstring path = file.wstring();
    RegSetValueExW(key, name.c_str(), 0, REG_SZ, reinterpret_cast<BYTE const *>(path.c_str()),
                   static_cast<DWORD>((path.size() + 1) * sizeof(wchar_t)));
    AddFontResourceExW(path.c_str(), 0, nullptr);
  }
  RegCloseKey(key);
  if (installed > 0) {
    // The other apps (and Windows' font cache) learn of them; never waits on a window that does not answer.
    SendMessageTimeoutW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0, SMTO_ABORTIFHUNG, 1000, nullptr);
    Log("Polices installées pour l'utilisateur : " + std::to_string(installed));
  }
}
#endif
} // namespace

void Waken::Stream::Log(std::string const &line) noexcept {
  ::Log(line);
}

// A PackageProvider containing any turbo modules you define within this app project
struct CompReactPackageProvider
    : winrt::implements<CompReactPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
 public: // IReactPackageProvider
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
    // Playing from this PC on another of the owner's computers (Stream/StreamView.cpp).
    Waken::Stream::RegisterStreamView(packageBuilder);
  }
};

// The entry point of the Win32 application
_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE instance, HINSTANCE, PSTR /* commandLine */, int showCmd) {
#ifdef WAKEN_VELOPACK
  // Velopack starts the app with arguments of its own at install, update and uninstall: answered here, and the
  // process then ends at once. A normal start goes on.
  try {
    Velopack::VelopackApp::Build().Run();
  } catch (...) {
  }
#endif
  // Initialize WinRT
  winrt::init_apartment(winrt::apartment_type::single_threaded);

  OpenLog();
  InstallCrashLog();
  Log("Waken démarre");
#ifdef WAKEN_UNPACKAGED
  // Without MSIX: the Windows App SDK runtime ships in this folder, and React Native Windows turns the SDK's own
  // initializer off. Loaded by hand before anything uses it, each step in the log.
  if (HMODULE runtime = LoadLibraryW(L"Microsoft.WindowsAppRuntime.dll")) {
    using EnsureIsLoaded = HRESULT(__stdcall *)();
    if (auto ensure = reinterpret_cast<EnsureIsLoaded>(GetProcAddress(runtime, "WindowsAppRuntime_EnsureIsLoaded"))) {
      const HRESULT hr = ensure();
      char text[96];
      sprintf_s(text, "Windows App SDK chargé (sans MSIX) : 0x%08lX", static_cast<unsigned long>(hr));
      Log(text);
    } else {
      Log("Windows App SDK : WindowsAppRuntime_EnsureIsLoaded introuvable");
    }
  } else {
    Log("Windows App SDK : Microsoft.WindowsAppRuntime.dll introuvable à côté de Waken.exe");
  }
  InstallFonts();
#endif

  // Enable per monitor DPI scaling
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  // Find the path hosting the app exe file
  WCHAR appDirectory[MAX_PATH];
  GetModuleFileNameW(NULL, appDirectory, MAX_PATH);
  PathCchRemoveFileSpec(appDirectory, MAX_PATH);

  // Create a ReactNativeWin32App with the ReactNativeAppBuilder
  auto reactNativeWin32App{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};

  // Configure the initial InstanceSettings for the app's ReactNativeHost
  auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};
  settings.NativeLogger(&LogReactNative);
  // Register any autolinked native modules
  RegisterAutolinkedNativeModulePackages(settings.PackageProviders());
  // Register any native modules defined within this app project
  settings.PackageProviders().Append(winrt::make<CompReactPackageProvider>());

#if BUNDLE
  // Load the JS bundle from a file (not Metro):
  // Set the path (on disk) where the .bundle file is located
  settings.BundleRootPath(std::wstring(L"file://").append(appDirectory).append(L"\\Bundle\\").c_str());
  // Set the name of the bundle file (without the .bundle extension)
  settings.JavaScriptBundleFile(L"index.windows");
  // Disable hot reload
  settings.UseFastRefresh(false);
#else
  // Load the JS bundle from Metro
  settings.JavaScriptBundleFile(L"index");
  // Enable hot reload
  settings.UseFastRefresh(true);
#endif
#if _DEBUG
  // For Debug builds
  // Enable Direct Debugging of JS
  settings.UseDirectDebugger(true);
  // Enable the Developer Menu
  settings.UseDeveloperSupport(true);
#else
  // For Release builds:
  // Disable Direct Debugging of JS
  settings.UseDirectDebugger(false);
  // Disable the Developer Menu
  settings.UseDeveloperSupport(false);
#endif

  // Get the AppWindow so we can configure its initial title and size
  auto appWindow{reactNativeWin32App.AppWindow()};
  appWindow.Title(L"Waken");
  // The title bar's icon: a WinUI window shows none by itself. The one in the app's resources (Waken.rc), at the
  // size Windows draws there.
  if (auto icon = static_cast<HICON>(LoadImageW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDI_ICON1), IMAGE_ICON,
                                                GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_SHARED))) {
    appWindow.SetIcon(winrt::Microsoft::UI::GetIconIdFromIcon(icon));
  }
  // No Windows title bar: the app draws under it, as Discord does (DesktopApp's titleBar strip), and only the
  // three buttons stay, in Waken's colours. The strip's height is the system's, draggable as a title bar.
  Waken::StyleTitleBar(appWindow, false);
  appWindow.Resize({1280, 800});
  // For the stream's full screen (WakenHost.setFullscreen).
  Waken::MainWindow() = appWindow;
  Waken::UiQueue() = winrt::Microsoft::UI::Dispatching::DispatcherQueue::GetForCurrentThread();

  // Get the ReactViewOptions so we can set the initial RN component to load
  auto viewOptions{reactNativeWin32App.ReactViewOptions()};
  viewOptions.ComponentName(L"Waken");

  // Start the app
  reactNativeWin32App.Start();
}
