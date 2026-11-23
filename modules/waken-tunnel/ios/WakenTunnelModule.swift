import ExpoModulesCore
import UIKit
@_implementationOnly import WakenTunnelC  // private: the app linking this module never needs the C header

/// The Waken network inside the app (client side). Each call returns the Go side's JSON as is.
public class WakenTunnelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WakenTunnel")

    AsyncFunction("start") { (name: String?) throws -> String in
      let dir = try Self.stateFolder()
      let deviceName = (name?.isEmpty == false ? name : nil) ?? UIDevice.current.name
      let config: [String: Any] = ["role": "client", "dir": dir.path, "name": deviceName]
      let json = String(decoding: try JSONSerialization.data(withJSONObject: config), as: UTF8.self)
      return json.withCString { Self.take(WakenTunnelStart(UnsafeMutablePointer(mutating: $0))) }
    }

    AsyncFunction("status") { () -> String in
      Self.take(WakenTunnelStatus())
    }

    AsyncFunction("setPeer") { (peer: String) -> String in
      peer.withCString { Self.take(WakenTunnelSetPeer(UnsafeMutablePointer(mutating: $0))) }
    }

    AsyncFunction("hello") { (peer: String) -> String in
      peer.withCString { Self.take(WakenTunnelHello(UnsafeMutablePointer(mutating: $0))) }
    }

    AsyncFunction("logout") { () -> String in
      Self.take(WakenTunnelLogout())
    }

    AsyncFunction("stop") {
      WakenTunnelStop()
    }
  }

  /// The node's identity lives in Application Support, out of iCloud backups: signing in is per device.
  private static func stateFolder() throws -> URL {
    var url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("WakenTunnel", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try url.setResourceValues(values)
    return url
  }

  private static func take(_ pointer: UnsafeMutablePointer<CChar>?) -> String {
    guard let pointer else { return #"{"error":"réponse vide"}"# }
    defer { WakenTunnelFree(pointer) }
    return String(cString: pointer)
  }
}
