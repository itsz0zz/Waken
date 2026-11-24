// The README's pictures, drawn with Waken's own fonts (Anton, Inter), colours (packages/ui/src/tokens.ts, theme
// "Arcade") and Lucide icons (read from the lucide-react-native package). PNG, so they look the same on GitHub and
// Forgejo, which load no web fonts.
//
//   swift docs/readme/render.swift        (from the repository's root, after pnpm install)
import AppKit
import CoreText

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let out = root.appendingPathComponent("docs/readme")
let scale: CGFloat = 2

// MARK: Brand

func hex(_ s: String, _ alpha: CGFloat = 1) -> NSColor {
  var v: UInt64 = 0
  Scanner(string: String(s.dropFirst())).scanHexInt64(&v)
  return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: alpha)
}
let ink = hex("#0B0B0F"), ink2 = hex("#3F424D"), white = NSColor.white
let blue = hex("#2F7BFF"), lime = hex("#C8FF2E"), soft = hex("#F1F2F6")
let sun = [hex("#EFFF3A"), hex("#F6FF9E"), white]
let sky = [hex("#4E97FF"), hex("#A6CBFF"), white]
let limeGround = [hex("#BDFF2E"), hex("#E6FFA6"), white]

let fontDir = root.appendingPathComponent("apps/macos/macos/Waken-macOS/Fonts")
for file in ["Anton-Regular", "Inter-Medium", "Inter-SemiBold", "Inter-Bold", "Inter-ExtraBold"] {
  CTFontManagerRegisterFontsForURL(fontDir.appendingPathComponent("\(file).ttf") as CFURL, .process, nil)
}
func anton(_ size: CGFloat) -> NSFont { NSFont(name: "Anton-Regular", size: size)! }
func inter(_ weight: String, _ size: CGFloat) -> NSFont { NSFont(name: "Inter-\(weight)", size: size)! }

// MARK: Lucide

/// A Lucide icon as an image: its nodes, read from lucide-react-native, written back as SVG.
func lucide(_ name: String, color: String, stroke: CGFloat = 2) -> NSImage {
  let pnpm = root.appendingPathComponent("node_modules/.pnpm")
  let dir = try! FileManager.default.contentsOfDirectory(atPath: pnpm.path).first { $0.hasPrefix("lucide-react-native@") }!
  let file = pnpm.appendingPathComponent("\(dir)/node_modules/lucide-react-native/dist/esm/icons/\(name).mjs")
  let js = try! String(contentsOf: file, encoding: .utf8)
  var elements = ""
  // A node is ["tag", { attributes }], on one line or, for long paths, spread over several.
  let node = try! NSRegularExpression(pattern: #"\[\s*"(\w+)",\s*\{([^}]*)\}\s*\]"#)
  let attribute = try! NSRegularExpression(pattern: #"(\w+): "([^"]*)""#)
  for m in node.matches(in: js, range: NSRange(js.startIndex..., in: js)) {
    let tag = String(js[Range(m.range(at: 1), in: js)!])
    let body = String(js[Range(m.range(at: 2), in: js)!])
    var attrs = ""
    for a in attribute.matches(in: body, range: NSRange(body.startIndex..., in: body)) {
      let key = String(body[Range(a.range(at: 1), in: body)!])
      if key == "key" { continue }
      attrs += " \(key)=\"\(body[Range(a.range(at: 2), in: body)!])\""
    }
    elements += "<\(tag)\(attrs)/>"
  }
  let svg = """
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="\(color)" \
  stroke-width="\(stroke)" stroke-linecap="round" stroke-linejoin="round">\(elements)</svg>
  """
  return NSImage(data: svg.data(using: .utf8)!)!
}

// MARK: Drawing

/// A canvas in points, top-left origin, saved at 2x.
func canvas(_ name: String, _ width: CGFloat, _ height: CGFloat, _ draw: (CGContext) -> Void) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
                             bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                             colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  let ns = NSGraphicsContext(bitmapImageRep: rep)!
  let cg = ns.cgContext
  cg.translateBy(x: 0, y: height * scale)
  cg.scaleBy(x: scale, y: -scale)
  NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: true)
  draw(cg)
  NSGraphicsContext.current = nil
  try! rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent("\(name).png"))
  print("docs/readme/\(name).png")
}

/// The app's grounds: a gradient fading to white at the bottom.
func ground(_ cg: CGContext, _ rect: CGRect, _ stops: [NSColor], _ locations: [CGFloat], angle: CGFloat = 180) {
  let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: stops.map(\.cgColor) as CFArray, locations: locations)!
  let r = angle * .pi / 180
  let c = CGPoint(x: rect.midX, y: rect.midY)
  let len = abs(rect.width * sin(r)) / 2 + abs(rect.height * cos(r)) / 2
  let d = CGVector(dx: sin(r) * len, dy: -cos(r) * len)
  cg.saveGState()
  cg.clip(to: rect)
  cg.drawLinearGradient(gradient, start: CGPoint(x: c.x - d.dx, y: c.y - d.dy), end: CGPoint(x: c.x + d.dx, y: c.y + d.dy),
                        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
  cg.restoreGState()
}

func rounded(_ rect: CGRect, _ radius: CGFloat) -> NSBezierPath { NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius) }

/// Text in a box; returns its height.
@discardableResult
func text(_ s: String, _ font: NSFont, _ color: NSColor, in rect: CGRect, align: NSTextAlignment = .left, kern: CGFloat = 0, line: CGFloat = 0) -> CGFloat {
  let p = NSMutableParagraphStyle()
  p.alignment = align
  p.lineBreakMode = .byWordWrapping
  if line > 0 { p.minimumLineHeight = line; p.maximumLineHeight = line }
  let a = NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: p, .kern: kern])
  a.draw(with: rect, options: [.usesLineFragmentOrigin])
  return a.boundingRect(with: rect.size, options: [.usesLineFragmentOrigin]).height
}

func width(_ s: String, _ font: NSFont, kern: CGFloat = 0) -> CGFloat {
  NSAttributedString(string: s, attributes: [.font: font, .kern: kern]).size().width
}

/// Draws rotated by degrees about a point.
func rotated(_ cg: CGContext, _ degrees: CGFloat, about p: CGPoint, _ draw: () -> Void) {
  cg.saveGState()
  cg.translateBy(x: p.x, y: p.y)
  cg.rotate(by: degrees * .pi / 180)
  cg.translateBy(x: -p.x, y: -p.y)
  draw()
  cg.restoreGState()
}

func shadow(_ cg: CGContext, blur: CGFloat, y: CGFloat, alpha: CGFloat) {
  cg.setShadow(offset: CGSize(width: 0, height: y), blur: blur, color: NSColor(white: 0, alpha: alpha).cgColor)
}

/// A white-rimmed sticker card, as the app's tilted covers.
func sticker(_ cg: CGContext, _ rect: CGRect, radius: CGFloat, rim: CGFloat, fill: NSColor, tilt: CGFloat, content: (() -> Void)? = nil) {
  rotated(cg, tilt, about: CGPoint(x: rect.midX, y: rect.midY)) {
    cg.saveGState()
    shadow(cg, blur: 30, y: 14, alpha: 0.18)
    white.setFill()
    rounded(rect.insetBy(dx: -rim, dy: -rim), radius + rim).fill()
    cg.restoreGState()
    fill.setFill()
    rounded(rect, radius).fill()
    cg.saveGState()
    rounded(rect, radius).addClip()
    content?()
    cg.restoreGState()
  }
}

func icon(_ name: String, color: String, in rect: CGRect, stroke: CGFloat = 2) {
  lucide(name, color: color, stroke: stroke).draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
}

let appIcon = NSImage(contentsOf: root.appendingPathComponent("apps/macos/macos/Waken-macOS/Assets.xcassets/AppIcon.appiconset/icon_512x512@2x.png"))!

/// The W mark alone: the app icon without its transparent margin (the macOS grid keeps ~10% around). In the image's
/// own points, whatever its pixel density.
func mark(in rect: CGRect) {
  let side = appIcon.size.width
  let crop = NSRect(x: side * 100 / 1024, y: side * 100 / 1024, width: side * 824 / 1024, height: side * 824 / 1024)
  appIcon.draw(in: rect, from: crop, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
}

func pill(_ cg: CGContext, _ label: String, iconName: String, at p: CGPoint, dark: Bool) -> CGFloat {
  let font = inter("Bold", 22)
  let w = 26 + 28 + 12 + width(label, font) + 28
  let rect = CGRect(x: p.x, y: p.y, width: w, height: 56)
  cg.saveGState()
  if !dark { shadow(cg, blur: 16, y: 6, alpha: 0.10) }
  (dark ? ink : white).setFill()
  rounded(rect, 28).fill()
  cg.restoreGState()
  icon(iconName, color: dark ? "#C8FF2E" : "#0B0B0F", in: CGRect(x: p.x + 24, y: p.y + 14, width: 28, height: 28), stroke: 2.4)
  text(label, font, dark ? white : ink, in: CGRect(x: p.x + 24 + 28 + 12, y: p.y + 14, width: w, height: 30))
  return w
}

// MARK: Banner

canvas("banner", 1280, 520) { cg in
  let all = CGRect(x: 0, y: 0, width: 1280, height: 520)
  ground(cg, all, sun, [0, 0.42, 1], angle: 165)

  // Wordmark row.
  mark(in: CGRect(x: 64, y: 50, width: 60, height: 60))
  text("WAKEN", anton(46), ink, in: CGRect(x: 138, y: 46, width: 300, height: 70), kern: 1)

  // The headline, as the home screen's.
  text("ON JOUE ?", anton(150), ink, in: CGRect(x: 58, y: 118, width: 700, height: 200))
  text("Réveille ton PC ou ta PS5 depuis n’importe où,\npuis joue sur Mac, iPhone, iPad et Windows.",
       inter("Medium", 25), ink2, in: CGRect(x: 66, y: 318, width: 680, height: 80), line: 36)

  var x: CGFloat = 64
  x += pill(cg, "Réveil", iconName: "power", at: CGPoint(x: x, y: 420), dark: true) + 14
  x += pill(cg, "Stream", iconName: "monitor-play", at: CGPoint(x: x, y: 420), dark: false) + 14
  _ = pill(cg, "Manettes", iconName: "gamepad-2", at: CGPoint(x: x, y: 420), dark: false)

  // The tilted cards of the home screen: a lime one behind, the blue "Bureau" one, the W sticker over them.
  sticker(cg, CGRect(x: 840, y: 92, width: 360, height: 250), radius: 34, rim: 8, fill: lime, tilt: 7)
  sticker(cg, CGRect(x: 770, y: 120, width: 400, height: 270), radius: 36, rim: 9, fill: blue, tilt: -5) {
    text("BUREAU", anton(64), white, in: CGRect(x: 806, y: 286, width: 360, height: 90), kern: 1)
    // The HUD's figures along its top, as on a stream.
    let figures = "Réseau 12 ms   ·   60 i/s   ·   HEVC 4K"
    text(figures, inter("Bold", 17), white.withAlphaComponent(0.92), in: CGRect(x: 800, y: 142, width: 360, height: 30))
  }
  sticker(cg, CGRect(x: 1068, y: 318, width: 150, height: 150), radius: 36, rim: 8, fill: ink, tilt: 8) {
    mark(in: CGRect(x: 1068, y: 318, width: 150, height: 150))
  }
  // A controller sticker, bottom left of the cards.
  sticker(cg, CGRect(x: 748, y: 400, width: 96, height: 96), radius: 26, rim: 7, fill: white, tilt: -9) {
    icon("gamepad-2", color: "#2F7BFF", in: CGRect(x: 766, y: 418, width: 60, height: 60), stroke: 2.2)
  }
}

// MARK: How it works

canvas("comment-ca-marche", 1280, 560) { cg in
  ground(cg, CGRect(x: 0, y: 0, width: 1280, height: 560), sky, [0, 0.52, 1])
  text("COMMENT ÇA MARCHE", anton(64), white, in: CGRect(x: 0, y: 40, width: 1280, height: 90), align: .center, kern: 1)

  let steps: [(String, String, String, String)] = [
    ("1", "power", "Réveil", "Wake-on-LAN, prise connectée ou relais : la machine sort de veille, même éteinte, même de loin."),
    ("2", "shield-check", "Connexion", "Le réseau Waken relie tes appareils d’un même compte, chiffré, sans ouvrir de port sur la box."),
    ("3", "gamepad-2", "Jeu", "Sunshine diffuse, Waken affiche : image, son, manettes, souris et clavier. Le jeu se lance tout seul."),
  ]
  let cardW: CGFloat = 340, gap: CGFloat = 70
  let left = (1280 - (cardW * 3 + gap * 2)) / 2
  for (i, step) in steps.enumerated() {
    let x = left + CGFloat(i) * (cardW + gap)
    let card = CGRect(x: x, y: 170, width: cardW, height: 320)
    cg.saveGState()
    shadow(cg, blur: 34, y: 16, alpha: 0.16)
    white.setFill()
    rounded(card, 34).fill()
    cg.restoreGState()
    // The number, as the home screen's top games.
    text(step.0, anton(96), i == 1 ? lime : blue, in: CGRect(x: x + 26, y: 150, width: 80, height: 130))
    let bubble = CGRect(x: x + cardW - 26 - 76, y: 196, width: 76, height: 76)
    (i == 1 ? ink : soft).setFill()
    NSBezierPath(ovalIn: bubble).fill()
    icon(step.1, color: i == 1 ? "#C8FF2E" : "#0B0B0F", in: bubble.insetBy(dx: 20, dy: 20), stroke: 2.2)
    text(step.2, inter("ExtraBold", 32), ink, in: CGRect(x: x + 30, y: 300, width: cardW - 60, height: 44))
    text(step.3, inter("Medium", 19), ink2, in: CGRect(x: x + 30, y: 350, width: cardW - 60, height: 130), line: 28)
    if i < steps.count - 1 {
      icon("chevron-right", color: "#FFFFFF", in: CGRect(x: x + cardW + 13, y: 306, width: 44, height: 44), stroke: 3)
    }
  }
}

// MARK: Platforms

canvas("plateformes", 1280, 460) { cg in
  ground(cg, CGRect(x: 0, y: 0, width: 1280, height: 460), limeGround, [0, 0.5, 1])
  text("PARTOUT", anton(64), ink, in: CGRect(x: 0, y: 36, width: 1280, height: 90), align: .center, kern: 1)

  let devices: [(String, String, String, Bool)] = [
    ("laptop", "Mac", "Joue et diffuse", true),
    ("monitor", "Windows", "Joue et diffuse", true),
    ("smartphone", "iPhone et iPad", "Joue", false),
    ("gamepad-2", "PS5 et PS4", "Réveil et Remote Play", false),
  ]
  let cardW: CGFloat = 250, gap: CGFloat = 30
  let left = (1280 - (cardW * 4 + gap * 3)) / 2
  for (i, d) in devices.enumerated() {
    let x = left + CGFloat(i) * (cardW + gap)
    let card = CGRect(x: x, y: 150, width: cardW, height: 250)
    let dark = i == 0
    cg.saveGState()
    shadow(cg, blur: 30, y: 14, alpha: 0.14)
    (dark ? ink : white).setFill()
    rounded(card, 32).fill()
    cg.restoreGState()
    icon(d.0, color: dark ? "#C8FF2E" : "#2F7BFF", in: CGRect(x: x + 28, y: 178, width: 64, height: 64), stroke: 2)
    text(d.1, inter("ExtraBold", 28), dark ? white : ink, in: CGRect(x: x + 28, y: 270, width: cardW - 40, height: 40))
    text(d.2, inter("Medium", 19), dark ? white.withAlphaComponent(0.75) : ink2, in: CGRect(x: x + 28, y: 312, width: cardW - 40, height: 30))
    if d.3 {
      // Hosts carry their own server: a small lime tag.
      let tag = CGRect(x: x + 28, y: 352, width: 132, height: 30)
      (dark ? lime : ink).setFill()
      rounded(tag, 15).fill()
      text("HÔTE + CLIENT", inter("ExtraBold", 13), dark ? ink : lime, in: tag.offsetBy(dx: 0, dy: 7), align: .center, kern: 0.6)
    }
  }
}

// MARK: Screenshot

canvas("accueil", 1280, 940) { cg in
  ground(cg, CGRect(x: 0, y: 0, width: 1280, height: 940), sky, [0, 0.55, 1])
  let shot = NSImage(contentsOf: out.appendingPathComponent("source/home.png"))!
  let w: CGFloat = 1120
  let h = w * shot.size.height / shot.size.width
  let window = CGRect(x: (1280 - w) / 2, y: (940 - h - 40) / 2, width: w, height: h + 40)
  cg.saveGState()
  shadow(cg, blur: 60, y: 26, alpha: 0.28)
  white.setFill()
  rounded(window, 22).fill()
  cg.restoreGState()
  cg.saveGState()
  rounded(window, 22).addClip()
  // The window's title bar and its three buttons.
  hex("#F6F6F8").setFill()
  CGRect(x: window.minX, y: window.minY, width: w, height: 40).fill()
  for (i, c) in ["#FF5F57", "#FEBC2E", "#28C840"].enumerated() {
    hex(c).setFill()
    NSBezierPath(ovalIn: CGRect(x: window.minX + 18 + CGFloat(i) * 22, y: window.minY + 13, width: 14, height: 14)).fill()
  }
  shot.draw(in: CGRect(x: window.minX, y: window.minY + 40, width: w, height: h), from: .zero, operation: .sourceOver,
            fraction: 1, respectFlipped: true, hints: nil)
  cg.restoreGState()
}
