import CoreGraphics

// Pure input mapping, tested on the Mac by Tests/run.sh: keep UIKit out of this file.

enum KeyMap {
  /// moonlight-common-c expects the high bit set on virtual-key codes, which does not fit a positive Int16.
  static func keyCode(_ virtualKey: UInt16) -> Int16 {
    Int16(bitPattern: virtualKey | 0x8000)
  }

  /// USB HID usage (key position) to Windows virtual key, as on a US keyboard: Sunshine turns it back into a position.
  static func windowsVK(hidUsage usage: Int) -> UInt16? {
    switch usage {
    case 0x04...0x1D: return UInt16(0x41 + usage - 0x04)  // A-Z
    case 0x1E...0x26: return UInt16(0x31 + usage - 0x1E)  // 1-9
    case 0x3A...0x45: return UInt16(0x70 + usage - 0x3A)  // F1-F12
    case 0x59...0x61: return UInt16(0x61 + usage - 0x59)  // keypad 1-9
    case 0x68...0x73: return UInt16(0x7C + usage - 0x68)  // F13-F24
    default: return others[usage]
    }
  }

  private static let others: [Int: UInt16] = [
    0x27: 0x30,  // 0
    0x28: 0x0D, 0x29: 0x1B, 0x2A: 0x08, 0x2B: 0x09, 0x2C: 0x20,  // Enter, Esc, Backspace, Tab, Space
    0x2D: 0xBD, 0x2E: 0xBB, 0x2F: 0xDB, 0x30: 0xDD, 0x31: 0xDC, 0x32: 0xDC,  // - = [ ] \ #
    0x33: 0xBA, 0x34: 0xDE, 0x35: 0xC0, 0x36: 0xBC, 0x37: 0xBE, 0x38: 0xBF,  // ; ' ` , . /
    0x64: 0xE2,  // the extra ISO key, < > on AZERTY
    0x39: 0x14, 0x46: 0x2C, 0x47: 0x91, 0x48: 0x13,  // Caps Lock, Print Screen, Scroll Lock, Pause
    0x49: 0x2D, 0x4A: 0x24, 0x4B: 0x21, 0x4C: 0x2E, 0x4D: 0x23, 0x4E: 0x22,  // Insert, Home, PgUp, Delete, End, PgDn
    0x4F: 0x27, 0x50: 0x25, 0x51: 0x28, 0x52: 0x26,  // arrows
    0x53: 0x90, 0x54: 0x6F, 0x55: 0x6A, 0x56: 0x6D, 0x57: 0x6B, 0x58: 0x0D,  // keypad Num Lock / * - + Enter
    0x62: 0x60, 0x63: 0x6E,  // keypad 0 and .
    0xE0: 0xA2, 0xE1: 0xA0, 0xE2: 0xA4, 0xE3: 0x5B,  // left Ctrl, Shift, Alt, Windows
    0xE4: 0xA3, 0xE5: 0xA1, 0xE6: 0xA5, 0xE7: 0x5C,  // right Ctrl, Shift, Alt, Windows
  ]
}

enum PointerMath {
  /// Where a point of the view lands in a video shown aspect-fit inside `container`. Black bars clamp to the edge.
  static func hostPoint(_ point: CGPoint, container: CGRect, video: CGSize) -> (x: Int16, y: Int16)? {
    guard container.width > 0, container.height > 0, video.width >= 1, video.height >= 1 else { return nil }
    let scale = min(container.width / video.width, container.height / video.height)
    let left = container.midX - video.width * scale / 2
    let top = container.midY - video.height * scale / 2
    let x = min(max((point.x - left) / scale, 0), video.width - 1)
    let y = min(max((point.y - top) / scale, 0), video.height - 1)
    return (clamp(x), clamp(y))
  }

  static func clamp(_ value: CGFloat) -> Int16 {
    guard value.isFinite else { return 0 }
    return Int16(max(CGFloat(Int16.min), min(CGFloat(Int16.max), value)))
  }

  /// Turns fractional movements into whole steps without losing slow ones.
  struct Accumulator {
    private var rest: CGFloat = 0

    mutating func add(_ value: CGFloat) -> Int16 {
      guard value.isFinite else { return 0 }
      rest += value
      let whole = rest.rounded(.towardZero)
      rest -= whole
      return clamp(whole)
    }
  }
}
