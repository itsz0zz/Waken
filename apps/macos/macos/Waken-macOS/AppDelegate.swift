import SwiftUI
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

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
        exit(0)
      }
      source.resume()
      signalSources.append(source)
    }
  }

  /// Sunshine, the agent and the network helper stop with the app, never orphaned.
  func applicationWillTerminate(_ notification: Notification) {
    HostServices.shared.stop()
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
