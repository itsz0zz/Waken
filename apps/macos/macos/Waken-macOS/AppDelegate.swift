import SwiftUI
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import Sparkle

@main
struct WakenApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

  var body: some Scene {
    Window("Waken", id: "main") {
      ReactNativeView(factory: appDelegate.reactNativeFactory)
        // Up to the window's top edge, under the traffic lights.
        .ignoresSafeArea()
        .preferredColorScheme(.light)
    }
    .defaultSize(width: 1280, height: 800)
    // The Arcade ground runs under the traffic lights, like the mockups: no grey title bar.
    .windowStyle(.hiddenTitleBar)
    .commands {
      CommandGroup(after: .appInfo) {
        Button("Rechercher les mises à jour…") { Updater.shared.checkForUpdates() }
          .disabled(!Updater.shared.enabled)
      }
    }
  }
}

// MARK: - Updates

/// Updates from the GitHub releases (Sparkle): a signed DMG and its appcast, put there by scripts/release.sh. The
/// feed and the public key are in Info.plist of a release build only: a development build never updates itself.
final class Updater {
  static let shared = Updater()
  private var controller: SPUStandardUpdaterController?

  /// This build can update: it carries the feed and the key.
  var enabled: Bool { controller != nil }
  var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

  /// Checks in the background on its own schedule (once a day), and asks before installing.
  func start() {
    guard controller == nil,
      Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil,
      Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") != nil
    else { return }
    controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
  }

  /// Sparkle's own window: up to date, or the new version with its notes and an Install button.
  func checkForUpdates() {
    controller?.checkForUpdates(nil)
  }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
  private let reactNativeDelegate: ReactNativeDelegate

  /// Waken is drawn light (Arcade): system-colored parts (the text caret, selection, menus) follow it, not the
  /// Mac's dark mode, or the caret would be white on the white fields.
  func applicationWillFinishLaunching(_ notification: Notification) {
    NSApp.appearance = NSAppearance(named: .aqua)
    stopServicesOnSignals()
  }

  /// Killed instead of quit (kill, an update, logging out): Sunshine, the agent and the network still stop,
  /// or they would be left running without the app.
  private var signalSources: [DispatchSourceSignal] = []
  private func stopServicesOnSignals() {
    for sig in [SIGTERM, SIGINT, SIGHUP] {
      signal(sig, SIG_IGN)
      let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
      source.setEventHandler {
        HostServices.shared.stop()
        Self.quitNow()
      }
      source.resume()
      signalSources.append(source)
    }
  }

  /// Sunshine, the agent and the network helper stop with the app, never orphaned.
  func applicationWillTerminate(_ notification: Notification) {
    HostServices.shared.stop()
    Self.quitNow()
  }

  /// Ends the process once the services are stopped. exit() would run C++ destructors that tear React Native
  /// down while its JavaScript thread still runs (an animation's setNativeProps then aborted on a destroyed view
  /// tree, and every quit ended in a crash report): nothing is left to save at this point.
  static func quitNow() -> Never {
    UserDefaults.standard.synchronize()
    _exit(0)
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    Updater.shared.start()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    PushRegistrar.shared.received(deviceToken)
  }

  func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    PushRegistrar.shared.failed(error)
  }
  let reactNativeFactory: RCTReactNativeFactory

  override init() {
    // Swift needs every stored property set before super.init (the template had it the other way round).
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    super.init()
  }
}

// MARK: - React Native Delegate

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

// MARK: - React Native SwiftUI View

struct ReactNativeView: NSViewRepresentable {
  let factory: RCTReactNativeFactory

  func makeNSView(context: Context) -> NSView {
    factory.rootViewFactory.view(withModuleName: "Waken")
  }

  func updateNSView(_ nsView: NSView, context: Context) {}
}
