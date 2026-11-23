import CoreGraphics

func check(_ condition: Bool, _ message: String, line: UInt = #line) {
  if !condition { fatalError("line \(line): \(message)") }
}

// The conversion that used to crash on the first key press.
for usage in 0...0xFF {
  guard let key = KeyMap.windowsVK(hidUsage: usage) else { continue }
  check(UInt16(bitPattern: KeyMap.keyCode(key)) == key | 0x8000, "key code of \(usage)")
  check(key > 0 && key < 0xFF, "virtual key of \(usage)")
}
check(KeyMap.windowsVK(hidUsage: 0x04) == 0x41, "A")
check(KeyMap.windowsVK(hidUsage: 0x1D) == 0x5A, "Z")
check(KeyMap.windowsVK(hidUsage: 0x27) == 0x30, "0")
check(KeyMap.windowsVK(hidUsage: 0x45) == 0x7B, "F12")
check(KeyMap.windowsVK(hidUsage: 0x61) == 0x69, "keypad 9")
check(KeyMap.windowsVK(hidUsage: 0x64) == 0xE2, "ISO key")
check(KeyMap.windowsVK(hidUsage: 0x01) == nil, "unknown")

let video = CGSize(width: 1920, height: 1080)
let wide = CGRect(x: 0, y: 0, width: 1000, height: 450)  // bars left and right
func host(_ x: CGFloat, _ y: CGFloat) -> (x: Int16, y: Int16) {
  PointerMath.hostPoint(CGPoint(x: x, y: y), container: wide, video: video)!
}
check(host(500, 225) == (960, 540), "centre")
check(host(0, 0) == (0, 0), "left bar")
check(host(1000, 450) == (1919, 1079), "bottom right")
check(host(300, 225) == (480, 540), "quarter")
let tall = CGRect(x: 0, y: 0, width: 400, height: 800)  // bars above and below
check(PointerMath.hostPoint(CGPoint(x: 200, y: 400), container: tall, video: video)! == (960, 540), "portrait centre")
check(PointerMath.hostPoint(.zero, container: .zero, video: video) == nil, "no size")

check(PointerMath.clamp(1e9) == Int16.max && PointerMath.clamp(-1e9) == Int16.min && PointerMath.clamp(.nan) == 0, "clamp")
var steps = PointerMath.Accumulator()
var total = 0
for _ in 0..<100 { total += Int(steps.add(0.25)) }
check(total == 25, "slow movements")

print("StreamInput: ok")
