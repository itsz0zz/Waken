import GameController
import UIKit

/// Touch as a mouse: tap = click, drag = drag, long press or two-finger tap = right click, two-finger drag = scroll.
final class StreamTouchInput: NSObject {
  private enum Button {
    static let left: Int32 = 1
    static let right: Int32 = 3
  }

  /// Games polling the mouse miss a click released in the same frame.
  private static let clickDuration: TimeInterval = 0.05
  /// Wheel units (120 = one notch) per point of finger movement.
  private static let scrollPerPoint: CGFloat = 6

  private weak var view: WakenStreamView?
  private var scroll = PointerMath.Accumulator()
  private var dragging = false

  init(view: WakenStreamView) {
    self.view = view
    super.init()

    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    let twoFingerTap = UITapGestureRecognizer(target: self, action: #selector(secondaryTapped(_:)))
    twoFingerTap.numberOfTouchesRequired = 2
    let longPress = UILongPressGestureRecognizer(target: self, action: #selector(longPressed(_:)))
    let drag = UIPanGestureRecognizer(target: self, action: #selector(dragged(_:)))
    drag.maximumNumberOfTouches = 1
    let twoFingerDrag = UIPanGestureRecognizer(target: self, action: #selector(scrolled(_:)))
    twoFingerDrag.minimumNumberOfTouches = 2
    twoFingerDrag.maximumNumberOfTouches = 2

    for recognizer in [tap, twoFingerTap, longPress, drag, twoFingerDrag] {
      // A hardware pointer already goes through GCMouse.
      recognizer.allowedTouchTypes = [UITouch.TouchType.direct, .pencil].map { NSNumber(value: $0.rawValue) }
      view.addGestureRecognizer(recognizer)
    }
  }

  /// On a Mac clicks also arrive as touches.
  private var mouseHasPriority: Bool {
    ProcessInfo.processInfo.isiOSAppOnMac && GCMouse.current != nil
  }

  @objc private func tapped(_ gesture: UITapGestureRecognizer) {
    click(Button.left, at: gesture.location(in: view))
  }

  @objc private func secondaryTapped(_ gesture: UITapGestureRecognizer) {
    click(Button.right, at: gesture.location(in: view))
  }

  @objc private func longPressed(_ gesture: UILongPressGestureRecognizer) {
    if gesture.state == .began { click(Button.right, at: gesture.location(in: view)) }
  }

  @objc private func dragged(_ gesture: UIPanGestureRecognizer) {
    guard let view, !mouseHasPriority else { return }
    let point = gesture.location(in: view)
    switch gesture.state {
    case .began:
      // The pan is recognised a few points late: press where the finger landed.
      let moved = gesture.translation(in: view)
      view.movePointer(to: CGPoint(x: point.x - moved.x, y: point.y - moved.y))
      view.session?.sendMouseButton(Button.left, down: true)
      dragging = true
      view.movePointer(to: point)
    case .changed:
      view.movePointer(to: point)
    case .ended, .cancelled, .failed:
      if dragging { view.session?.sendMouseButton(Button.left, down: false) }
      dragging = false
    default:
      break
    }
  }

  @objc private func scrolled(_ gesture: UIPanGestureRecognizer) {
    guard let view, !mouseHasPriority else { return }
    let step = scroll.add(gesture.translation(in: view).y * Self.scrollPerPoint)
    gesture.setTranslation(.zero, in: view)
    if step != 0 { view.session?.sendScroll(step) }
  }

  private func click(_ button: Int32, at point: CGPoint) {
    guard let view, !mouseHasPriority, let session = view.session else { return }
    view.movePointer(to: point)
    session.sendMouseButton(button, down: true)
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.clickDuration) { session.sendMouseButton(button, down: false) }
  }
}
