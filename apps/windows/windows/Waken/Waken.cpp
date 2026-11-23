// Waken.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "Waken.h"

#include "AutolinkedNativeModules.g.h"

#include <csignal>

#include "NativeModules.h"
#include "WakenHost.h"

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
    Log(what);
    std::abort();
  });
  _set_invalid_parameter_handler([](wchar_t const *, wchar_t const *, wchar_t const *, unsigned, uintptr_t) {
    Log("Arrêt : paramètre invalide passé à la bibliothèque C");
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
} // namespace

// A PackageProvider containing any turbo modules you define within this app project
struct CompReactPackageProvider
    : winrt::implements<CompReactPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
 public: // IReactPackageProvider
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
  }
};

// The entry point of the Win32 application
_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE instance, HINSTANCE, PSTR /* commandLine */, int showCmd) {
  // Initialize WinRT
  winrt::init_apartment(winrt::apartment_type::single_threaded);

  OpenLog();
  InstallCrashLog();
  Log("Waken démarre");

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
  appWindow.Resize({1280, 800});

  // Get the ReactViewOptions so we can set the initial RN component to load
  auto viewOptions{reactNativeWin32App.ReactViewOptions()};
  viewOptions.ComponentName(L"Waken");

  // Start the app
  reactNativeWin32App.Start();
}
