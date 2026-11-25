import AppKit
import Darwin
import Foundation
import Network
import React
import Security

/// The Mac host, seen from JavaScript: starts the services, reports their state and the permissions,
/// relays the network commands, and keeps the app's settings in a private file.
@objc(WakenHost)
final class WakenHostModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  /// Read once by JavaScript: whether this build may use Sign in with Apple. A release (Developer ID) never may,
  /// Apple keeps it for the Mac App Store; the app then hides the button.
  @objc func constantsToExport() -> [AnyHashable: Any]! {
    var signIn = false
    if let task = SecTaskCreateFromSelf(nil) {
      signIn = SecTaskCopyValueForEntitlement(task, "com.apple.developer.applesignin" as CFString, nil) != nil
    }
    return ["appleSignIn": signIn]
  }

  private var services: HostServices { HostServices.shared }

  override init() {
    super.init()
    // Follows the network from the start: its first answer comes a moment later.
    _ = NetworkPath.shared
  }

  @objc func start(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    services.startOnce()
    resolve(nil)
  }

  /// Réglages: the version and whether this build updates itself (Sparkle, a release build). Sparkle finds the new
  /// versions on its own and shows them in its window: nothing "available" to report here.
  @objc func updateStatus(_ check: Bool, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let updater = Updater.shared
    let json: [String: Any] = ["supported": updater.enabled, "version": updater.version]
    let data = (try? JSONSerialization.data(withJSONObject: json)) ?? Data("{}".utf8)
    resolve(String(decoding: data, as: UTF8.self))
  }

  /// Réglages: Sparkle's window, which looks for a new version and installs it.
  @objc func installUpdate(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      Updater.shared.checkForUpdates()
      resolve(nil)
    }
  }

  @objc func status(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    var status: [String: Any] = [
      "embedded": services.embedded,
      "sunshine": services.sunshineRunning,
      "agent": services.agentRunning,
      "screen": Permissions.screen,
      "control": Permissions.control,
      "deviceName": Host.current().localizedName ?? "Mac",
    ]
    if let error = services.startError { status["error"] = error }
    // This Mac's own agent: the app shows its library and starts its games locally.
    if let token = try? String(contentsOf: services.paths.root.appendingPathComponent("agent-token"), encoding: .utf8) {
      status["agentToken"] = token.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if let tunnel = services.currentTunnelStatus() { status["tunnel"] = tunnel }
    resolve(status)
  }

  @objc func requestPermission(_ kind: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      if kind == "screen" { Permissions.requestScreen() } else { Permissions.requestControl() }
    }
    resolve(nil)
  }

  @objc func openSettings(_ kind: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async { Permissions.open(kind) }
    resolve(nil)
  }

  /// Picks up a permission just granted: macOS only applies it to processes started after.
  @objc func restartServer(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    services.restartSunshine()
    resolve(nil)
  }

  /// {identityToken, authorizationCode} from Apple's sheet, or null when the user closed it.
  @objc func appleSignIn(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    AppleSignIn.shared.start { result in
      switch result {
      case .success(let credential): resolve(credential)
      case .failure(let error): reject("waken", error.localizedDescription, error)
      }
    }
  }

  @objc func pushToken(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    PushRegistrar.shared.requestToken { result in
      switch result {
      case .success(let token): resolve(token)
      case .failure(let error): reject("waken", error.localizedDescription, error)
      }
    }
  }

  /// {wifi, awdl}: this Mac reaches the network over Wi-Fi, and AWDL (AirDrop, Handoff) is up on the same radio.
  /// Together they make a stream stutter: AWDL takes the radio away several times a second.
  @objc func wifiInfo(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(["wifi": NetworkPath.shared.onWifi, "awdl": NetworkPath.interfaceUp("awdl0")])
  }

  @objc func copyText(_ text: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
    }
    resolve(nil)
  }

  @objc func tunnelJoin(_ controlUrl: String, authKey: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    services.tunnelJoin(controlURL: controlUrl, authKey: authKey) { result in
      switch result {
      case .success: resolve(nil)
      case .failure(let error): reject("waken", error.localizedDescription, error)
      }
    }
  }

  @objc func tunnelCommand(_ cmd: String, peer: String?, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard ["hello", "setPeer", "logout"].contains(cmd) else { return reject("waken", "Commande inconnue", nil) }
    services.tunnelCommand(cmd, peer: peer) { result in
      switch result {
      case .success(let value):
        if let data = try? JSONSerialization.data(withJSONObject: ["result": value], options: [.fragmentsAllowed]) {
          resolve(String(decoding: data, as: UTF8.self))
        } else {
          resolve(#"{"result":null}"#)
        }
      case .failure(let error):
        reject("waken", error.localizedDescription, error)
      }
    }
  }

  // MARK: Settings storage

  /// One file per key, in the private folder. Keys come from the app's own code; anything else is refused.
  private func file(for key: String) throws -> URL {
    guard key.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else {
      throw NSError(domain: "Waken", code: 3, userInfo: [NSLocalizedDescriptionKey: "Clé de réglage invalide"])
    }
    try Setup.privateFolder(services.paths.root)
    try Setup.privateFolder(services.paths.store)
    return services.paths.store.appendingPathComponent("\(key).json")
  }

  @objc func storageGet(_ key: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      let url = try file(for: key)
      resolve(FileManager.default.fileExists(atPath: url.path) ? try String(contentsOf: url, encoding: .utf8) : nil)
    } catch {
      reject("waken", error.localizedDescription, error)
    }
  }

  @objc func storageSet(_ key: String, value: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      // Written beside, then moved: a crash mid-write never leaves half a configuration.
      let url = try file(for: key)
      let temp = url.appendingPathExtension("tmp")
      try Setup.writePrivate(value, to: temp)
      _ = try FileManager.default.replaceItemAt(url, withItemAt: temp)
      resolve(nil)
    } catch {
      reject("waken", error.localizedDescription, error)
    }
  }

  @objc func storageRemove(_ key: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      try? FileManager.default.removeItem(at: try file(for: key))
      resolve(nil)
    } catch {
      reject("waken", error.localizedDescription, error)
    }
  }
}

/// How this Mac reaches the network right now, followed from the start of the app.
final class NetworkPath {
  static let shared = NetworkPath()
  private let monitor = NWPathMonitor()
  private let lock = NSLock()
  private var wifi = false

  private init() {
    monitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      // A cable wins: with both, the stream goes through the Ethernet port.
      let onWifi = path.status == .satisfied && path.usesInterfaceType(.wifi) && !path.usesInterfaceType(.wiredEthernet)
      self.lock.lock()
      self.wifi = onWifi
      self.lock.unlock()
    }
    monitor.start(queue: DispatchQueue(label: "fr.wakenplay.network-path"))
  }

  var onWifi: Bool {
    lock.lock()
    defer { lock.unlock() }
    return wifi
  }

  /// Whether a network interface is up: readable by any app, no permission needed.
  static func interfaceUp(_ name: String) -> Bool {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return false }
    defer { freeifaddrs(list) }
    var item: UnsafeMutablePointer<ifaddrs>? = first
    while let entry = item {
      if String(cString: entry.pointee.ifa_name) == name, (Int32(entry.pointee.ifa_flags) & IFF_UP) != 0 { return true }
      item = entry.pointee.ifa_next
    }
    return false
  }
}
