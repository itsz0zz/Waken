import AppKit
import Foundation
import React

/// The Mac host, seen from JavaScript: starts the services, reports their state and the permissions,
/// relays the network commands, and keeps the app's settings in a private file.
@objc(WakenHost)
final class WakenHostModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private var services: HostServices { HostServices.shared }

  @objc func start(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    services.startOnce()
    resolve(nil)
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
