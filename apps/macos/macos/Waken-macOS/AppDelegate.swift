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
    }
    .defaultSize(width: 1280, height: 800)
    // The Arcade ground runs under the traffic lights, like the mockups: no grey title bar.
    .windowStyle(.hiddenTitleBar)
  }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
  private let reactNativeDelegate: ReactNativeDelegate

  /// Sunshine, the agent and the network helper stop with the app, never orphaned.
  func applicationWillTerminate(_ notification: Notification) {
    HostServices.shared.stop()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
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
