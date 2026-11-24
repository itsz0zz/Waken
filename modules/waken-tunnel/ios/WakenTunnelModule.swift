import ExpoModulesCore
import UIKit
@_implementationOnly import WakenTunnelC  // private: the app linking this module never needs the C header

/// The Waken network inside the app (client side). Each call returns the Go side's JSON as is.
public class WakenTunnelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WakenTunnel")

    // controlUrl: the Waken account's network ("" for Tailscale's, nil to keep the running one's).
    // authKey: single-use, only to sign in; never stored on this side.
    AsyncFunction("start") { (name: String?, controlUrl: String?, authKey: String?) throws -> String in
      let dir = try Self.stateFolder()
      let deviceName = (name?.isEmpty == false ? name : nil) ?? UIDevice.current.name
      var config: [String: Any] = ["role": "client", "dir": dir.path, "name": deviceName]
      if let controlUrl {
        config["controlUrl"] = controlUrl
      } else if let running = Self.runningControl() {
        config["controlUrl"] = running
      }
      if let authKey, !authKey.isEmpty { config["authKey"] = authKey }
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

    // Wake-on-LAN from the iPhone: the magic packet to each address, UDP port 9. A broadcast only leaves with
    // Apple's multicast entitlement; a plain address (the computer's, the home's public one) leaves without.
    AsyncFunction("sendMagicPacket") { (mac: String, targets: [String]) throws -> Int in
      try Self.sendMagicPacket(mac: mac, targets: targets)
    }
  }

  private static func sendMagicPacket(mac: String, targets: [String]) throws -> Int {
    let hex = Array(mac.filter(\.isHexDigit))
    guard hex.count == 12 else { throw MagicPacketError.badAddress }
    let card = stride(from: 0, to: 12, by: 2).compactMap { UInt8(String(hex[$0..<$0 + 2]), radix: 16) }
    var packet = [UInt8](repeating: 0xFF, count: 6)
    for _ in 0..<16 { packet += card }

    let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
    guard fd >= 0 else { throw MagicPacketError.noSocket }
    defer { close(fd) }
    var on: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &on, socklen_t(MemoryLayout<Int32>.size))
    var sent = 0
    for target in Set(targets) {
      var address = sockaddr_in()
      address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
      address.sin_family = sa_family_t(AF_INET)
      address.sin_port = in_port_t(9).bigEndian
      guard inet_pton(AF_INET, target, &address.sin_addr) == 1 else { continue }
      let result = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, packet, packet.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
      }
      if result == packet.count { sent += 1 }
    }
    return sent
  }

  private enum MagicPacketError: Error, CustomStringConvertible {
    case badAddress, noSocket
    var description: String { self == .badAddress ? "Adresse matérielle invalide" : "Envoi réseau impossible" }
  }

  /// The network the running tunnel is on, so a start without one keeps it.
  private static func runningControl() -> String? {
    let status = take(WakenTunnelStatus())
    guard let data = status.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      (object["state"] as? String) != "stopped"
    else { return nil }
    return object["control"] as? String ?? ""
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
