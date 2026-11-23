// Waken for Mac, first build: the stream server (Sunshine) and the Waken agent live inside this app.
// The user installs nothing else. Waken configures both on first launch and stops them when it quits.
import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Security

private let agentPort: UInt16 = 47100
private let sunshinePort: UInt16 = 47989
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
        try value.write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        return value
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
            // This Mac only: remote devices come in through Waken's own encrypted tunnel, never straight from the network.
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

final class Services {
    let paths = Paths.standard
    let resources = Bundle.main.resourceURL!  // always set for an app bundle
    private(set) var sunshine: Process?
    private(set) var agent: Process?
    private(set) var tunnel: Process?
    private(set) var token = ""
    /// Latest state of the Waken network, as reported by the tunnel helper.
    var onTunnelStatus: ((TunnelStatus) -> Void)?

    private var sunshineBinary: URL { resources.appendingPathComponent("Sunshine.app/Contents/MacOS/Sunshine") }
    private var agentBinary: URL { resources.appendingPathComponent("agent/Waken.Agent") }
    private var tunnelBinary: URL { resources.appendingPathComponent("waken-tunnel") }

    func start() throws {
        try Setup.privateFolder(paths.root)
        try Setup.privateFolder(paths.sunshine)
        try Setup.privateFolder(paths.agent)
        let password = try Setup.secret(named: "sunshine-admin", in: paths.root)
        token = try Setup.secret(named: "agent-token", in: paths.root)
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
        guard waitForPort(agentPort) else { throw ServiceError.notStarted("agent") }
        try startTunnel()
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
    func restartSunshine() throws {
        if let server = sunshine, server.isRunning {
            server.terminate()
            let deadline = Date().addingTimeInterval(5)
            while server.isRunning && Date() < deadline { usleep(100_000) }
            if server.isRunning { kill(server.processIdentifier, SIGKILL) }
        }
        try launchSunshine()
    }

    /// The private network that lets the owner's devices reach this Mac from anywhere. Sunshine and the agent
    /// stay on 127.0.0.1: the tunnel delivers their traffic locally, to the owner's devices only.
    private func startTunnel() throws {
        try Setup.privateFolder(paths.tunnel)
        let process = Process()
        process.executableURL = tunnelBinary
        let input = Pipe(), output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        // A status line may arrive in several reads: keep the unfinished end for the next one.
        var pending = Data()
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            pending.append(data)
            while let end = pending.firstIndex(of: UInt8(ascii: "\n")) {
                let line = String(decoding: pending[pending.startIndex..<end], as: UTF8.self)
                pending.removeSubrange(pending.startIndex...end)
                guard line.hasPrefix("STATUS "),
                      let status = try? JSONDecoder().decode(TunnelStatus.self, from: Data(line.dropFirst(7).utf8)) else { continue }
                DispatchQueue.main.async { self?.onTunnelStatus?(status) }
            }
        }
        try process.run()
        tunnel = process
        // The configuration holds the agent token: sent on stdin, never on the command line.
        let config: [String: String] = [
            "role": "host",
            "dir": paths.tunnel.path,
            "name": Host.current().localizedName ?? "Mac",
            "agentToken": token,
        ]
        try input.fileHandleForWriting.write(contentsOf: JSONSerialization.data(withJSONObject: config))
        try input.fileHandleForWriting.close()
    }

    func stop() {
        for process in [tunnel, agent, sunshine].compactMap({ $0 }) where process.isRunning {
            process.terminate()
            let deadline = Date().addingTimeInterval(5)
            while process.isRunning && Date() < deadline { usleep(100_000) }
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        }
    }

    private func waitForPort(_ port: UInt16) -> Bool {
        let deadline = Date().addingTimeInterval(startTimeout)
        while Date() < deadline {
            if Services.isListening(port) { return true }
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

struct TunnelStatus: Decodable {
    struct Node: Decodable { let name: String; let ip: String }
    let state: String
    let loginUrl: String?
    let error: String?
    let node: Node?
    enum CodingKeys: String, CodingKey { case state, loginUrl, error, node = "self" }
}

enum ServiceError: LocalizedError {
    case notStarted(String)
    var errorDescription: String? {
        switch self {
        case .notStarted(let name): return "\(name) n'a pas démarré."
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let services = Services()
    private var window: NSWindow!
    private let serverLine = NSTextField(labelWithString: "Serveur de stream : démarrage…")
    private let screenLine = NSTextField(labelWithString: "")
    private let networkLine = NSTextField(labelWithString: "Réseau Waken : démarrage…")
    private let signInButton = NSButton(title: "Se connecter…", target: nil, action: nil)
    private var loginURL: URL?
    private let screenButton = NSButton(title: "Autoriser l'enregistrement de l'écran…", target: nil, action: nil)
    private let controlLine = NSTextField(labelWithString: "")
    private let controlButton = NSButton(title: "Autoriser le contrôle à distance…", target: nil, action: nil)
    private var timer: Timer?
    private var controlAllowed = false

    /// Both checks: the system may record the grant under either service.
    private static var canControl: Bool { AXIsProcessTrusted() || CGPreflightPostEventAccess() }

    private static func requestControl() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        _ = CGRequestPostEventAccess()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        services.onTunnelStatus = { [weak self] status in self?.show(status) }
        // Asked by Waken itself: the embedded server inherits the permission.
        if !CGPreflightScreenCaptureAccess() { CGRequestScreenCaptureAccess() }
        // Mouse and keyboard from the other devices: macOS drops posted events without this permission, silently.
        // Waken shows the system request itself (one click on "Allow"); the embedded Sunshine inherits it.
        // Since macOS 27.3 it is listed under "System & App Protection Override".
        controlAllowed = Self.canControl
        if !controlAllowed { Self.requestControl() }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                try services.start()
                DispatchQueue.main.async { self.showReady() }
            } catch {
                DispatchQueue.main.async { self.serverLine.stringValue = "Erreur : \(error.localizedDescription)" }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.refresh() }
        refresh()
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        services.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func buildWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 320), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Waken"
        window.center()

        let title = NSTextField(labelWithString: "Waken")
        title.font = .systemFont(ofSize: 28, weight: .bold)
        let hint = NSTextField(wrappingLabelWithString: "Connecte-toi avec le même compte sur ton iPhone : ce Mac y apparaîtra tout seul, chez toi comme ailleurs.")
        signInButton.target = self
        signInButton.action = #selector(signIn)
        signInButton.isHidden = true
        screenButton.target = self
        screenButton.action = #selector(openScreenSettings)
        controlButton.target = self
        controlButton.action = #selector(openAccessibilitySettings)

        let stack = NSStackView(views: [title, serverLine, screenLine, screenButton, controlLine, controlButton, networkLine, signInButton, hint])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 24, left: 24, bottom: 24, right: 24)
        window.contentView = stack
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    private func showReady() {}

    private func show(_ status: TunnelStatus) {
        loginURL = status.loginUrl.flatMap(URL.init(string:)).flatMap { $0.scheme == "https" ? $0 : nil }
        switch status.state {
        case "running": networkLine.stringValue = "Réseau Waken : connecté\(status.node.map { " (\($0.ip))" } ?? "")"
        case "needs-login": networkLine.stringValue = "Réseau Waken : connecte-toi pour jouer depuis tes autres appareils"
        case "error": networkLine.stringValue = "Réseau Waken : erreur \(status.error ?? "")"
        default: networkLine.stringValue = "Réseau Waken : démarrage…"
        }
        signInButton.isHidden = status.state != "needs-login" || loginURL == nil
    }

    private func refresh() {
        let running = services.sunshine?.isRunning == true && Services.isListening(sunshinePort)
        let agent = services.agent?.isRunning == true && Services.isListening(agentPort)
        if services.sunshine != nil {
            serverLine.stringValue = running && agent ? "Serveur de stream : prêt" : "Serveur de stream : arrêté (voir ~/Library/Application Support/Waken)"
        }
        let allowed = CGPreflightScreenCaptureAccess()
        screenLine.stringValue = allowed ? "Enregistrement de l'écran : autorisé" : "Enregistrement de l'écran : à autoriser pour Waken, puis relancer Waken"
        screenButton.isHidden = allowed
        let control = Self.canControl
        if control && !controlAllowed {
            // Just allowed: restart the stream server so it can use it, no need to relaunch Waken.
            controlLine.stringValue = "Souris et clavier à distance : autorisés, redémarrage du serveur…"
            DispatchQueue.global(qos: .userInitiated).async { [services] in try? services.restartSunshine() }
        }
        controlAllowed = control
        controlLine.stringValue = control ? "Souris et clavier à distance : autorisés" : "Souris et clavier à distance : à autoriser pour Waken"
        controlButton.isHidden = control
    }

    @objc private func signIn() {
        if let loginURL { NSWorkspace.shared.open(loginURL) }
    }

    @objc private func openAccessibilitySettings() {
        Self.requestControl()
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)  // constant, valid URL: "System & App Protection Override" since macOS 27.3
    }

    @objc private func openScreenSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)  // constant, valid URL
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
