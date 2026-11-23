import AppKit
import UserNotifications

/// The Mac's APNs token for the Waken account's notifications (new device, machine ready, end of a session).
/// macOS hands the token to the app delegate: this keeps the callers waiting until it arrives.
final class PushRegistrar: NSObject, UNUserNotificationCenterDelegate {
  static let shared = PushRegistrar()

  private let lock = NSLock()
  private var waiting: [(Result<String?, Error>) -> Void] = []
  private var token: String?

  /// Asks the permission once, then the token. Nil when the user said no.
  func requestToken(_ completion: @escaping (Result<String?, Error>) -> Void) {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    center.requestAuthorization(options: [.alert, .sound]) { granted, error in
      if let error { return completion(.failure(error)) }
      guard granted else { return completion(.success(nil)) }
      self.lock.lock()
      if let token = self.token {
        self.lock.unlock()
        return completion(.success(token))
      }
      self.waiting.append(completion)
      self.lock.unlock()
      DispatchQueue.main.async { NSApplication.shared.registerForRemoteNotifications() }
      // Apple never answering (no network, no push entitlement in this build) must not hang the caller.
      DispatchQueue.global().asyncAfter(deadline: .now() + 20) { self.finish(.success(nil)) }
    }
  }

  func received(_ deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    lock.lock()
    token = hex
    lock.unlock()
    finish(.success(hex))
  }

  func failed(_ error: Error) {
    finish(.failure(error))
  }

  private func finish(_ result: Result<String?, Error>) {
    lock.lock()
    let callers = waiting
    waiting = []
    lock.unlock()
    callers.forEach { $0(result) }
  }

  /// Shown even while Waken is in front: "your Mac is ready" is worth seeing anywhere.
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list])
  }
}
