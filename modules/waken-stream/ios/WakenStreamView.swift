import ExpoModulesCore
import GameController
import UIKit

/// Hosts the AVSampleBufferDisplayLayer fed by MLStreamSession and forwards controller,
/// touch, pointer and keyboard input to Sunshine.
class WakenStreamView: ExpoView, MLStreamSessionDelegate {
  static weak var current: WakenStreamView?

  let onStateChange = EventDispatcher()
  let onStats = EventDispatcher()

  var launch: [String: Any] = [:]
  let config = MLStreamConfig()

  private(set) var session: MLStreamSession?
  private var statsTimer: Timer?
  private var started = false

  private let textCapture = TextCaptureView(frame: .zero)
  private var touchInput: StreamTouchInput?
  private var observers: [NSObjectProtocol] = []
  private var keyboardInset: CGFloat = 0
  private var pressedKeys: Set<UInt16> = []
  private var mouseX = PointerMath.Accumulator()
  private var mouseY = PointerMath.Accumulator()
  private var idleTimerWasDisabled: Bool?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    WakenStreamView.current = self
    setupTextCapture()
    touchInput = StreamTouchInput(view: self)
    setupInput()
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
    statsTimer?.invalidate()
    session?.stop()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // The picture moves above the on-screen keyboard, so that the field being typed in stays visible.
    session?.displayLayer.frame = videoArea
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { captureHardwareKeyboard() }
  }

  override func removeFromSuperview() {
    stopStream()
    super.removeFromSuperview()
  }

  // MARK: Lifecycle

  func startIfReady() {
    guard !started, config.width > 0, let address = launch["address"] as? String, let rtsp = launch["rtspSessionUrl"] as? String else { return }
    started = true

    let info = MLLaunchInfo()
    info.address = address
    info.appVersion = launch["appVersion"] as? String ?? "7.1.431.-1"
    info.gfeVersion = launch["gfeVersion"] as? String
    info.rtspSessionUrl = rtsp
    info.serverCodecModeSupport = Int32(launch["serverCodecModeSupport"] as? Int ?? 0)
    info.riKey = Data(hex: launch["riKey"] as? String ?? "")
    info.riKeyId = Int32(launch["riKeyId"] as? Int ?? 0)

    let s = MLStreamSession(launch: info, config: config)
    s.delegate = self
    s.displayLayer.frame = videoArea
    layer.addSublayer(s.displayLayer)
    session = s

    onStateChange(["state": "connecting"])
    s.start()
    keepScreenOn(true)
    captureHardwareKeyboard()

    statsTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      guard let s = self?.session else { return }
      self?.onStats(["rttMs": s.estimatedRttMs(), "fps": s.measuredFps(), "bitrateKbps": s.measuredBitrateKbps(), "droppedFrames": s.droppedFrames()])
    }
  }

  func stopStream() {
    statsTimer?.invalidate()
    statsTimer = nil
    releaseKeys()
    _ = textCapture.resignFirstResponder()
    keepScreenOn(false)
    session?.stop()
    session = nil
  }

  // MARK: MLStreamSessionDelegate

  func streamStageChanged(_ stage: String) { onStateChange(["state": "connecting", "stage": stage]) }
  func streamStarted() { onStateChange(["state": "streaming"]) }
  func streamTerminated(_ errorCode: Int32) {
    keepScreenOn(false)
    onStateChange(["state": errorCode == 0 ? "stopped" : "error", "message": "Connexion terminée (\(errorCode))"])
  }
  func streamFailed(atStage stage: String, error errorCode: Int32) {
    keepScreenOn(false)
    onStateChange(["state": "error", "stage": stage, "message": "Échec à l'étape \(stage) (\(errorCode))"])
  }

  // MARK: Screen

  private var videoArea: CGRect {
    CGRect(x: bounds.minX, y: bounds.minY, width: bounds.width, height: max(0, bounds.height - keyboardInset))
  }

  private func keepScreenOn(_ on: Bool) {
    let application = UIApplication.shared
    if on {
      if idleTimerWasDisabled == nil { idleTimerWasDisabled = application.isIdleTimerDisabled }
      application.isIdleTimerDisabled = true
    } else if let previous = idleTimerWasDisabled {
      application.isIdleTimerDisabled = previous
      idleTimerWasDisabled = nil
    }
  }

  // MARK: Input

  func movePointer(to point: CGPoint) {
    let video = CGSize(width: CGFloat(config.width), height: CGFloat(config.height))
    guard let session, let target = PointerMath.hostPoint(point, container: videoArea, video: video) else { return }
    session.sendMouseX(target.x, y: target.y, referenceWidth: PointerMath.clamp(video.width), referenceHeight: PointerMath.clamp(video.height))
  }

  private func setupInput() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] note in
      self?.keyboardChanged(note)
    })
    observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.releaseKeys()
    })
    observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.captureHardwareKeyboard()
    })
    observers.append(center.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { [weak self] note in
      if let c = note.object as? GCController { self?.bind(controller: c) }
    })
    GCController.controllers().forEach(bind(controller:))
    observers.append(center.addObserver(forName: .GCMouseDidConnect, object: nil, queue: .main) { [weak self] note in
      if let m = note.object as? GCMouse { self?.bind(mouse: m) }
    })
    GCMouse.mice().forEach(bind(mouse:))
  }

  /// Gamepad → LiSendMultiControllerEvent. Button bits follow moonlight-common-c (Limelight.h).
  private func bind(controller: GCController) {
    guard let pad = controller.extendedGamepad else { return }
    let index = Int16(GCController.controllers().firstIndex(of: controller) ?? 0)
    pad.valueChangedHandler = { [weak self] gp, _ in
      var b: Int32 = 0
      func set(_ pressed: Bool, _ flag: Int32) { if pressed { b |= flag } }
      set(gp.buttonA.isPressed, 0x1000)       // A_FLAG
      set(gp.buttonB.isPressed, 0x2000)       // B_FLAG
      set(gp.buttonX.isPressed, 0x4000)       // X_FLAG
      set(gp.buttonY.isPressed, Int32(bitPattern: 0x8000)) // Y_FLAG
      set(gp.dpad.up.isPressed, 0x0001)
      set(gp.dpad.down.isPressed, 0x0002)
      set(gp.dpad.left.isPressed, 0x0004)
      set(gp.dpad.right.isPressed, 0x0008)
      set(gp.buttonMenu.isPressed, 0x0010)    // PLAY_FLAG
      set(gp.buttonOptions?.isPressed ?? false, 0x0020) // BACK_FLAG
      set(gp.leftThumbstickButton?.isPressed ?? false, 0x0040)
      set(gp.rightThumbstickButton?.isPressed ?? false, 0x0080)
      set(gp.leftShoulder.isPressed, 0x0100)
      set(gp.rightShoulder.isPressed, 0x0200)
      set(gp.buttonHome?.isPressed ?? false, 0x0400) // SPECIAL_FLAG
      let axis = { (v: Float) in Int16(max(-32768, min(32767, v * 32767))) }
      self?.session?.sendController(index, buttons: b,
                                    lt: UInt8(gp.leftTrigger.value * 255), rt: UInt8(gp.rightTrigger.value * 255),
                                    lx: axis(gp.leftThumbstick.xAxis.value), ly: axis(gp.leftThumbstick.yAxis.value),
                                    rx: axis(gp.rightThumbstick.xAxis.value), ry: axis(gp.rightThumbstick.yAxis.value),
                                    activeMask: Int16(1 << index))
    }
  }

  /// Relative mouse (iPad pointer, Mac): needed for FPS games.
  private func bind(mouse: GCMouse) {
    guard let input = mouse.mouseInput else { return }
    input.mouseMovedHandler = { [weak self] _, dx, dy in
      guard let self else { return }
      let x = self.mouseX.add(CGFloat(dx))
      let y = self.mouseY.add(CGFloat(-dy))
      if x != 0 || y != 0 { self.session?.sendMouseDeltaX(x, y: y) }
    }
    input.leftButton.pressedChangedHandler = { [weak self] _, _, p in self?.session?.sendMouseButton(1, down: p) }
    input.middleButton?.pressedChangedHandler = { [weak self] _, _, p in self?.session?.sendMouseButton(2, down: p) }
    input.rightButton?.pressedChangedHandler = { [weak self] _, _, p in self?.session?.sendMouseButton(3, down: p) }
    input.scroll.yAxis.valueChangedHandler = { [weak self] _, v in self?.session?.sendScroll(PointerMath.clamp(CGFloat(v) * 120)) }
  }

  // MARK: Keyboard

  override var canBecomeFirstResponder: Bool { true }

  /// The view must be first responder to receive key presses, unless the on-screen keyboard already is.
  private func captureHardwareKeyboard() {
    guard window != nil, !textCapture.isFirstResponder else { return }
    _ = becomeFirstResponder()
  }

  func toggleKeyboard() {
    if textCapture.isFirstResponder {
      _ = textCapture.resignFirstResponder()
      captureHardwareKeyboard()
    } else {
      _ = textCapture.becomeFirstResponder()
    }
  }

  private func setupTextCapture() {
    textCapture.onText = { [weak self] text in self?.session?.sendText(text) }
    textCapture.onBackspace = { [weak self] in self?.typeKey(0x08) }
    textCapture.onReturn = { [weak self] in self?.typeKey(0x0D) }
    textCapture.onHardwareKeys = { [weak self] presses, down in self?.forward(presses, down: down) ?? presses }
    addSubview(textCapture)
  }

  private func keyboardChanged(_ note: Notification) {
    guard let window, let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
    let overlap = bounds.intersection(convert(window.convert(frame, from: window.screen.coordinateSpace), from: window))
    keyboardInset = overlap.isNull ? 0 : overlap.height
    setNeedsLayout()
    // Dismissed with the keyboard's own key: take the hardware keyboard back.
    if keyboardInset == 0 { DispatchQueue.main.async { [weak self] in self?.captureHardwareKeyboard() } }
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let unhandled = forward(presses, down: true)
    if !unhandled.isEmpty { super.pressesBegan(unhandled, with: event) }
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let unhandled = forward(presses, down: false)
    if !unhandled.isEmpty { super.pressesEnded(unhandled, with: event) }
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let unhandled = forward(presses, down: false)
    if !unhandled.isEmpty { super.pressesCancelled(unhandled, with: event) }
  }

  /// Returns the presses that are not keys Windows knows.
  private func forward(_ presses: Set<UIPress>, down: Bool) -> Set<UIPress> {
    var unhandled = Set<UIPress>()
    for press in presses {
      guard let key = press.key, let vk = KeyMap.windowsVK(hidUsage: key.keyCode.rawValue) else {
        unhandled.insert(press)
        continue
      }
      // A release can reach both the text view and this one: send it once.
      if down {
        pressedKeys.insert(vk)
      } else if pressedKeys.remove(vk) == nil {
        continue
      }
      var modifiers: CChar = 0
      if key.modifierFlags.contains(.shift) { modifiers |= 0x01 }
      if key.modifierFlags.contains(.control) { modifiers |= 0x02 }
      if key.modifierFlags.contains(.alternate) { modifiers |= 0x04 }
      if key.modifierFlags.contains(.command) { modifiers |= 0x08 }
      session?.sendKey(KeyMap.keyCode(vk), down: down, modifiers: modifiers)
    }
    return unhandled
  }

  private func typeKey(_ vk: UInt16) {
    session?.sendKey(KeyMap.keyCode(vk), down: true, modifiers: 0)
    session?.sendKey(KeyMap.keyCode(vk), down: false, modifiers: 0)
  }

  private func releaseKeys() {
    for vk in pressedKeys { session?.sendKey(KeyMap.keyCode(vk), down: false, modifiers: 0) }
    pressedKeys.removeAll()
  }
}

extension Data {
  init(hex: String) {
    var d = Data(capacity: hex.count / 2)
    var i = hex.startIndex
    while i < hex.endIndex, let j = hex.index(i, offsetBy: 2, limitedBy: hex.endIndex) {
      if let b = UInt8(hex[i..<j], radix: 16) { d.append(b) }
      i = j
    }
    self = d
  }
}
