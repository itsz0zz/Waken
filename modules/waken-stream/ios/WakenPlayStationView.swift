import ExpoModulesCore
import UIKit

/// The PS5 / PS4 stream on iPhone and iPad: the console's picture (MLPlayStationSession, chiaki), this device's
/// controllers as its DualSense.
class WakenPlayStationView: ExpoView, MLPlayStationSessionDelegate {
  let onStateChange = EventDispatcher()
  let onStats = EventDispatcher()

  var link: [String: Any] = [:]
  var videoHeight = 1080
  var fps = 60
  var bitrateKbps = 0
  var hevc = true
  var muted = false {
    didSet { session?.muted = muted }
  }

  private var session: MLPlayStationSession?
  private var statsTimer: Timer?
  private var started = false
  private var idleTimerWasDisabled: Bool?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
  }

  deinit {
    statsTimer?.invalidate()
    session?.stop()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    session?.displayLayer.frame = bounds
  }

  override func removeFromSuperview() {
    stopStream()
    super.removeFromSuperview()
  }

  func startIfReady() {
    guard !started, let host = link["host"] as? String, let registKey = link["registKey"] as? String, let rpKey = link["rpKey"] as? String else { return }
    started = true
    let s = MLPlayStationSession(
      host: host, registKey: registKey, rpKey: rpKey, ps5: link["ps5"] as? Bool ?? true, accountId: link["accountId"] as? String,
      height: Int32(videoHeight), fps: Int32(fps), bitrateKbps: Int32(bitrateKbps), hevc: hevc)
    s.delegate = self
    s.muted = muted
    s.displayLayer.frame = bounds
    layer.addSublayer(s.displayLayer)
    session = s
    s.start()
    idleTimerWasDisabled = UIApplication.shared.isIdleTimerDisabled
    UIApplication.shared.isIdleTimerDisabled = true
    statsTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      guard let s = self?.session else { return }
      self?.onStats(["rttMs": s.rttMs(), "fps": s.measuredFps(), "bitrateKbps": s.measuredBitrateKbps(), "droppedFrames": s.droppedFrames()])
    }
  }

  func stopStream() {
    statsTimer?.invalidate()
    statsTimer = nil
    session?.stop()
    session?.displayLayer.removeFromSuperlayer()
    session = nil
    if let was = idleTimerWasDisabled {
      UIApplication.shared.isIdleTimerDisabled = was
      idleTimerWasDisabled = nil
    }
  }

  // MARK: MLPlayStationSessionDelegate

  func playStationStateChanged(_ state: String, message: String?) {
    var event: [String: Any] = ["state": state]
    if let message { event["message"] = message }
    onStateChange(event)
  }
}
