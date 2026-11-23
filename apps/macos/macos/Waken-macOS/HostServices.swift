// The host side of Waken for Mac: the stream server (Sunshine), the Waken agent and the Waken network live
// inside this app. Nothing else to install: Waken configures them on first launch and stops them when it quits.
import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Security

let agentPort: UInt16 = 47100
let sunshinePort: UInt16 = 47989
private let startTimeout: TimeInterval = 30

/// Everything Waken writes: one private folder, readable by this user only.
struct Paths {
  let root: URL
  var sunshine: URL { root.appendingPathComponent("sunshine", isDirectory: true) }
  var agent: URL { root.appendingPathComponent("agent", isDirectory: true) }
  var config: URL { sunshine.appendingPathComponent("sunshine.conf") }
  var certificate: URL { sunshine.appendingPathComponent("credentials/cacert.pem") }
  var apps: URL { sunshine.appendingPathComponent("apps.json") }
  var log: URL { sunshine.appendingPathComponent("sunshine.log") }
  var agentLog: URL { agent.appendingPathComponent("agent.log") }
  var tunnel: URL { root.appendingPathComponent("tunnel", isDirectory: true) }
  /// The app's own settings (devices, library choices), one JSON file per key.
  var store: URL { root.appendingPathComponent("app", isDirectory: true) }

  static let standard = Paths(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("Waken", isDirectory: true))
}

enum Setup {
  static func randomSecret() -> String {
    var bytes = [UInt8](repeating: 0, count: 24)
    precondition(SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess, "no system randomness")
    return bytes.map { String(format: "%02x", $0) }.joined()
  }

  /// A secret kept in a file only this user can read, created the first time.
  static func secret(named name: String, in folder: URL) throws -> String {
    let url = folder.appendingPathComponent(name)
    if let existing = try? String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !existing.isEmpty {
      return existing
    }
    let value = randomSecret()
    try writePrivate(value, to: url)
    return value
  }

  /// Written readable by this user only, from the first byte (no window where it is world readable).
  static func writePrivate(_ text: String, to url: URL) throws {
    let fd = open(url.path, O_WRONLY | O_CREAT | O_TRUNC, 0o600)
    guard fd >= 0 else { throw CocoaError(.fileWriteNoPermission) }
    defer { close(fd) }
    fchmod(fd, 0o600)
    let data = Data(text.utf8)
    let written = data.withUnsafeBytes { write(fd, $0.baseAddress, data.count) }
    guard written == data.count else { throw CocoaError(.fileWriteUnknown) }
  }

  static func privateFolder(_ url: URL) throws {
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
  }

  static func writeSunshineConfig(_ p: Paths) throws {
    let lines = [
      "sunshine_name = \(Host.current().localizedName ?? "Mac")",
      "file_apps = \(p.apps.path)",
      "credentials_file = \(p.sunshine.appendingPathComponent("credentials.json").path)",
      "pkey = \(p.sunshine.appendingPathComponent("credentials/cakey.pem").path)",
      "cert = \(p.certificate.path)",
      "file_state = \(p.sunshine.appendingPathComponent("state.json").path)",
      "log_path = \(p.log.path)",
      // Waken drives Sunshine: no tray icon of its own, admin page for this Mac only, no router changes.
      "system_tray = disabled",
      "origin_web_ui_allowed = pc",
      "upnp = disabled",
      // This Mac only: other devices come in through Waken's own encrypted network, never straight from the LAN.
      "bind_address = 127.0.0.1",
      "notify_pre_releases = disabled",
    ]
    try (lines.joined(separator: "\n") + "\n").write(to: p.config, atomically: true, encoding: .utf8)
    if !FileManager.default.fileExists(atPath: p.apps.path) {
      let apps = #"{"env":{},"apps":[{"name":"Desktop","image-path":"desktop.png"}]}"#
      try apps.write(to: p.apps, atomically: true, encoding: .utf8)
    }
  }
}

enum ServiceError: LocalizedError {
  case notStarted(String)
  case missing(String)
  var errorDescription: String? {
    switch self {
    case .notStarted(let name): return "\(name) n'a pas démarré."
    case .missing(let name): return "\(name) manque dans l'app : reconstruis-la avec apps/macos/scripts/embed-host.sh."
    }
  }
}

/// Sunshine, the agent and the network helper, started together and stopped together.
final class HostServices {
  static let shared = HostServices()

  let paths = Paths.standard
  private let resources = Bundle.main.resourceURL!  // always set for an app bundle
  private(set) var sunshine: Process?
  private(set) var agent: Process?
  private(set) var tunnel: Process?
  private var tunnelInput: FileHandle?
  private let queue = DispatchQueue(label: "fr.wakenplay.mac.host")
  private var started = false
  private(set) var startError: String?

  /// Latest network status line from the helper, as JSON.
  private(set) var tunnelStatus: String?
  private var nextCommand = 1
  private var pending: [Int: (Result<Any, Error>) -> Void] = [:]
  private let lock = NSLock()

  private var sunshineBinary: URL { resources.appendingPathComponent("Sunshine.app/Contents/MacOS/Sunshine") }
  private var agentBinary: URL { resources.appendingPathComponent("agent/Waken.Agent") }
  private var tunnelBinary: URL { resources.appendingPathComponent("waken-tunnel") }

  var embedded: Bool { FileManager.default.isExecutableFile(atPath: sunshineBinary.path) }

  /// Starts everything once, in the background. Safe to call again.
  func startOnce() {
    queue.async { [self] in
      guard !started else { return }
      started = true
      do {
        try start()
      } catch {
        startError = error.localizedDescription
      }
    }
  }

  private func start() throws {
    guard embedded else { throw ServiceError.missing("Sunshine") }
    stopOrphans()
    try Setup.privateFolder(paths.root)
    try Setup.privateFolder(paths.sunshine)
    try Setup.privateFolder(paths.agent)
    let password = try Setup.secret(named: "sunshine-admin", in: paths.root)
    let token = try Setup.secret(named: "agent-token", in: paths.root)
    try Setup.writeSunshineConfig(paths)

    // Admin credentials of the embedded Sunshine: generated, never shown, only the agent uses them.
    let creds = Process()
    creds.executableURL = sunshineBinary
    creds.arguments = [paths.config.path, "--creds", "admin", password]
    creds.standardOutput = FileHandle.nullDevice
    creds.standardError = FileHandle.nullDevice
    try creds.run()
    creds.waitUntilExit()

    try launchSunshine()

    let helper = Process()
    helper.executableURL = agentBinary
    helper.currentDirectoryURL = agentBinary.deletingLastPathComponent()
    var env = ProcessInfo.processInfo.environment
    env["Urls"] = "http://127.0.0.1:\(agentPort)"
    env["Agent__Token"] = token
    env["Agent__SunshineHost"] = "127.0.0.1"
    env["Agent__SunshineUser"] = "admin"
    env["Agent__SunshinePassword"] = password
    env["Agent__SunshineCertPath"] = paths.certificate.path
    env["Agent__DataDir"] = paths.agent.path
    if let key = try? String(contentsOf: resources.appendingPathComponent("steamgriddb.key"), encoding: .utf8) {
      env["Agent__SteamGridDbKey"] = key.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    helper.environment = env
    FileManager.default.createFile(atPath: paths.agentLog.path, contents: nil, attributes: [.posixPermissions: 0o600])
    let log = try FileHandle(forWritingTo: paths.agentLog)
    helper.standardOutput = log
    helper.standardError = log
    try helper.run()
    agent = helper
    guard waitForPort(agentPort) else { throw ServiceError.notStarted("L'agent") }

    try startTunnel(token: token)
  }

  /// A Waken killed without quitting (crash, kill, an update replacing the app) leaves its Sunshine and agent
  /// running. They hold the ports: the new Sunshine cannot start, and the old one, cut from its app, sends no
  /// picture. Any left over from a previous run goes before this one starts.
  private func stopOrphans() {
    let names = ["Contents/Resources/Sunshine.app/Contents/MacOS/Sunshine", "Contents/Resources/agent/Waken.Agent", "Contents/Resources/waken-tunnel"]
    for name in names {
      let pkill = Process()
      pkill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
      // Our own processes only (pkill never touches another user's), matched on their full path.
      pkill.arguments = ["-TERM", "-f", name]
      try? pkill.run()
      pkill.waitUntilExit()
    }
    let deadline = Date().addingTimeInterval(8)
    while (Self.isListening(sunshinePort) || Self.isListening(agentPort)) && Date() < deadline { usleep(200_000) }
    for name in names where Self.isListening(sunshinePort) || Self.isListening(agentPort) {
      let pkill = Process()
      pkill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
      pkill.arguments = ["-KILL", "-f", name]
      try? pkill.run()
      pkill.waitUntilExit()
    }
  }

  private func launchSunshine() throws {
    let server = Process()
    server.executableURL = sunshineBinary
    server.arguments = [paths.config.path]
    server.currentDirectoryURL = paths.sunshine
    server.standardOutput = FileHandle.nullDevice
    server.standardError = FileHandle.nullDevice
    try server.run()
    sunshine = server
    guard waitForPort(sunshinePort) else { throw ServiceError.notStarted("Sunshine") }
  }

  /// Picks up a permission granted while Sunshine runs: macOS only applies it to processes started after.
  func restartSunshine() {
    queue.async { [self] in
      if let server = sunshine, server.isRunning {
        server.terminate()
        let deadline = Date().addingTimeInterval(5)
        while server.isRunning && Date() < deadline { usleep(100_000) }
        if server.isRunning { kill(server.processIdentifier, SIGKILL) }
      }
      try? launchSunshine()
    }
  }

  /// The Waken network. Sunshine and the agent stay on 127.0.0.1: the tunnel delivers their traffic locally,
  /// to the owner's devices only. Its stdin stays open: it carries commands, and closing it stops the helper.
  private func startTunnel(token: String) throws {
    try Setup.privateFolder(paths.tunnel)
    let process = Process()
    process.executableURL = tunnelBinary
    let input = Pipe(), output = Pipe()
    process.standardInput = input
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    // A line may arrive in several reads: keep the unfinished end for the next one.
    var buffer = Data()
    output.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty else { return }
      buffer.append(data)
      while let end = buffer.firstIndex(of: UInt8(ascii: "\n")) {
        let line = String(decoding: buffer[buffer.startIndex..<end], as: UTF8.self)
        buffer.removeSubrange(buffer.startIndex...end)
        self?.handle(line: line)
      }
    }
    try process.run()
    tunnel = process
    tunnelInput = input.fileHandleForWriting
    // The configuration holds the agent token: sent on stdin, never on the command line.
    var config: [String: String] = [
      "role": "host",
      "dir": paths.tunnel.path,
      "name": Host.current().localizedName ?? "Mac",
      "agentToken": token,
    ]
    // The Waken account's network once this Mac joined it (Tailscale's otherwise).
    if let control = UserDefaults.standard.string(forKey: Self.controlURLKey), !control.isEmpty {
      config["controlUrl"] = control
    }
    try send(config)
  }

  private func handle(line: String) {
    if line.hasPrefix("STATUS ") {
      lock.lock()
      tunnelStatus = String(line.dropFirst(7))
      lock.unlock()
    } else if line.hasPrefix("REPLY "),
      let object = try? JSONSerialization.jsonObject(with: Data(line.dropFirst(6).utf8)) as? [String: Any],
      let id = object["id"] as? Int
    {
      lock.lock()
      let callback = pending.removeValue(forKey: id)
      lock.unlock()
      if let message = object["error"] as? String {
        callback?(.failure(NSError(domain: "Waken", code: 1, userInfo: [NSLocalizedDescriptionKey: message])))
      } else {
        callback?(.success(object["result"] ?? NSNull()))
      }
    }
  }

  private func send(_ object: [String: Any]) throws {
    var data = try JSONSerialization.data(withJSONObject: object)
    data.append(UInt8(ascii: "\n"))
    try tunnelInput?.write(contentsOf: data)
  }

  /// A command to the network helper: hello, setPeer, logout.
  /// The coordination server this Mac's network runs on, kept for the next launches.
  static let controlURLKey = "WakenControlURL"

  /// Restarts the network on the account's coordination server, signed in with a single-use key.
  func tunnelJoin(controlURL: String, authKey: String, completion: @escaping (Result<Any, Error>) -> Void) {
    if controlURL.isEmpty {
      UserDefaults.standard.removeObject(forKey: Self.controlURLKey)
    } else {
      UserDefaults.standard.set(controlURL, forKey: Self.controlURLKey)
    }
    tunnelCommand("join", peer: nil, extra: ["controlUrl": controlURL, "authKey": authKey], completion: completion)
  }

  func tunnelCommand(_ cmd: String, peer: String?, extra: [String: Any] = [:], completion: @escaping (Result<Any, Error>) -> Void) {
    lock.lock()
    let id = nextCommand
    nextCommand += 1
    pending[id] = completion
    lock.unlock()
    var object: [String: Any] = ["id": id, "cmd": cmd]
    if let peer { object["peer"] = peer }
    object.merge(extra) { _, new in new }
    do {
      guard tunnelInput != nil else { throw NSError(domain: "Waken", code: 2, userInfo: [NSLocalizedDescriptionKey: "Le réseau Waken n'est pas démarré."]) }
      try send(object)
    } catch {
      lock.lock()
      pending.removeValue(forKey: id)
      lock.unlock()
      completion(.failure(error))
    }
  }

  func currentTunnelStatus() -> String? {
    lock.lock()
    defer { lock.unlock() }
    return tunnelStatus
  }

  func stop() {
    try? tunnelInput?.close()
    for process in [tunnel, agent, sunshine].compactMap({ $0 }) where process.isRunning {
      process.terminate()
      let deadline = Date().addingTimeInterval(5)
      while process.isRunning && Date() < deadline { usleep(100_000) }
      if process.isRunning { kill(process.processIdentifier, SIGKILL) }
    }
  }

  var sunshineRunning: Bool { sunshine?.isRunning == true && Self.isListening(sunshinePort) }
  var agentRunning: Bool { agent?.isRunning == true && Self.isListening(agentPort) }

  private func waitForPort(_ port: UInt16) -> Bool {
    let deadline = Date().addingTimeInterval(startTimeout)
    while Date() < deadline {
      if Self.isListening(port) { return true }
      usleep(250_000)
    }
    return false
  }

  static func isListening(_ port: UInt16) -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    var address = sockaddr_in()
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = port.bigEndian
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    return withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 }
    }
  }
}

/// macOS permissions the stream server needs, asked by Waken itself: the embedded Sunshine inherits them.
enum Permissions {
  static var screen: Bool { CGPreflightScreenCaptureAccess() }
  /// Mouse and keyboard from the other devices. Since macOS 27.3: "System & App Protection Override".
  static var control: Bool { AXIsProcessTrusted() || CGPreflightPostEventAccess() }

  static func requestScreen() {
    if !screen { CGRequestScreenCaptureAccess() }
  }

  static func requestControl() {
    _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    _ = CGRequestPostEventAccess()
  }

  static func open(_ pane: String) {
    let anchor = pane == "screen" ? "Privacy_ScreenCapture" : "Privacy_Accessibility"
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)")!)  // constant anchors, valid URL
  }
}
