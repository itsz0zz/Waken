import UIKit

/// Invisible first responder that brings up the on-screen keyboard and hands over what is typed.
final class TextCaptureView: UIView, UIKeyInput {
  var onText: ((String) -> Void)?
  var onBackspace: (() -> Void)?
  var onReturn: (() -> Void)?
  var onHardwareKeys: ((Set<UIPress>, Bool) -> Set<UIPress>)?

  /// A hardware key is already sent as a key: its text must not be sent as well.
  private var hardwareKeysDown = 0

  var autocorrectionType: UITextAutocorrectionType = .no
  var autocapitalizationType: UITextAutocapitalizationType = .none
  var spellCheckingType: UITextSpellCheckingType = .no
  var smartQuotesType: UITextSmartQuotesType = .no
  var smartDashesType: UITextSmartDashesType = .no
  var keyboardAppearance: UIKeyboardAppearance = .dark

  override var canBecomeFirstResponder: Bool { true }
  var hasText: Bool { true }  // keeps Backspace repeating

  func insertText(_ text: String) {
    guard hardwareKeysDown == 0 else { return }
    if text == "\n" { onReturn?() } else { onText?(text) }
  }

  func deleteBackward() {
    guard hardwareKeysDown == 0 else { return }
    onBackspace?()
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let unhandled = onHardwareKeys?(presses, true) ?? presses
    hardwareKeysDown += presses.count - unhandled.count
    if !unhandled.isEmpty { super.pressesBegan(unhandled, with: event) }
  }

  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    release(presses)
    super.pressesEnded(presses, with: event)
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    release(presses)
    super.pressesCancelled(presses, with: event)
  }

  override func resignFirstResponder() -> Bool {
    hardwareKeysDown = 0
    return super.resignFirstResponder()
  }

  private func release(_ presses: Set<UIPress>) {
    let unhandled = onHardwareKeys?(presses, false) ?? presses
    hardwareKeysDown = max(0, hardwareKeysDown - (presses.count - unhandled.count))
  }
}
