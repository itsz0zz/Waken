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

// MARK: Bureau

// The illustration of "Bureau" (the computer's whole desktop, streamed): window stickers and a pointer on the home
// screen's yellow. Drawn here once for the app (packages/ui/assets/art, through useGameArt) and for this README.

/// The classic pointer, tip at p, height h.
func cursor(_ cg: CGContext, at p: CGPoint, height h: CGFloat, fill: NSColor, rim: NSColor, rimWidth: CGFloat, tilt: CGFloat = -8) {
  let k = h / 40
  let pts: [CGPoint] = [(0, 0), (0, 34), (9, 26.5), (15, 40), (21.5, 37), (15.5, 24), (27, 24)].map { CGPoint(x: p.x + $0.0 * k, y: p.y + $0.1 * k) }
  let path = NSBezierPath()
  path.move(to: pts[0])
  for q in pts.dropFirst() { path.line(to: q) }
  path.close()
  path.lineJoinStyle = .round
  path.lineWidth = rimWidth * 2
  rotated(cg, tilt, about: p) {
    cg.saveGState()
    shadow(cg, blur: 14, y: 8, alpha: 0.22)
    rim.setStroke()
    path.stroke()
    cg.restoreGState()
    rim.setStroke()
    path.stroke()
    fill.setFill()
    path.fill()
  }
}

/// A window sticker: white rim, title bar with three dots, a few content lines, maybe a button.
func windowSticker(_ cg: CGContext, _ r: CGRect, bar: NSColor, body: NSColor, tilt: CGFloat, lines: NSColor, button: NSColor? = nil) {
  sticker(cg, r, radius: 16, rim: 6, fill: body, tilt: tilt) {
    bar.setFill()
    CGRect(x: r.minX, y: r.minY, width: r.width, height: 26).fill()
    for i in 0..<3 {
      white.withAlphaComponent(0.9).setFill()
      NSBezierPath(ovalIn: CGRect(x: r.minX + 12 + CGFloat(i) * 15, y: r.minY + 8, width: 10, height: 10)).fill()
    }
    lines.setFill()
    rounded(CGRect(x: r.minX + 16, y: r.minY + 44, width: r.width * 0.55, height: 10), 5).fill()
    rounded(CGRect(x: r.minX + 16, y: r.minY + 62, width: r.width * 0.38, height: 10), 5).fill()
    if let button {
      button.setFill()
      rounded(CGRect(x: r.minX + 16, y: r.maxY - 36, width: 64, height: 22), 11).fill()
    }
  }
}

/// A four-point sparkle.
func sparkle(_ c: CGPoint, _ r: CGFloat, _ color: NSColor) {
  let k = r * 0.15
  let p = NSBezierPath()
  p.move(to: CGPoint(x: c.x, y: c.y - r))
  p.curve(to: CGPoint(x: c.x + r, y: c.y), controlPoint1: CGPoint(x: c.x + k, y: c.y - k), controlPoint2: CGPoint(x: c.x + k, y: c.y - k))
  p.curve(to: CGPoint(x: c.x, y: c.y + r), controlPoint1: CGPoint(x: c.x + k, y: c.y + k), controlPoint2: CGPoint(x: c.x + k, y: c.y + k))
  p.curve(to: CGPoint(x: c.x - r, y: c.y), controlPoint1: CGPoint(x: c.x - k, y: c.y + k), controlPoint2: CGPoint(x: c.x - k, y: c.y + k))
  p.curve(to: CGPoint(x: c.x, y: c.y - r), controlPoint1: CGPoint(x: c.x - k, y: c.y - k), controlPoint2: CGPoint(x: c.x - k, y: c.y - k))
  color.setFill()
  p.fill()
}

let art = root.appendingPathComponent("packages/ui/assets/art")
try? FileManager.default.createDirectory(at: art, withIntermediateDirectories: true)

/// Wide, for the "hero" pictures (home, grid, game page): 480x300.
canvas("../../packages/ui/assets/art/desktop-hero", 480, 300) { cg in
  ground(cg, CGRect(x: 0, y: 0, width: 480, height: 300), sun, [0, 0.55, 1], angle: 165)
  windowSticker(cg, CGRect(x: 70, y: 70, width: 190, height: 140), bar: ink, body: lime, tilt: -8, lines: ink.withAlphaComponent(0.25))
  windowSticker(cg, CGRect(x: 150, y: 46, width: 210, height: 150), bar: hex("#1E5FD6"), body: blue, tilt: 4, lines: white.withAlphaComponent(0.45))
  windowSticker(cg, CGRect(x: 214, y: 120, width: 200, height: 138), bar: ink, body: white, tilt: -3, lines: soft, button: blue)
  cursor(cg, at: CGPoint(x: 330, y: 196), height: 70, fill: ink, rim: white, rimWidth: 5)
  sparkle(CGPoint(x: 410, y: 70), 15, white)
  sparkle(CGPoint(x: 56, y: 236), 11, blue)
}

/// Tall, for the "cover" pictures (the phone's home cards, search): 300x400.
canvas("../../packages/ui/assets/art/desktop-cover", 300, 400) { cg in
  ground(cg, CGRect(x: 0, y: 0, width: 300, height: 400), sun, [0, 0.55, 1], angle: 165)
  windowSticker(cg, CGRect(x: 30, y: 60, width: 170, height: 130), bar: ink, body: lime, tilt: -8, lines: ink.withAlphaComponent(0.25))
  windowSticker(cg, CGRect(x: 92, y: 132, width: 180, height: 130), bar: hex("#1E5FD6"), body: blue, tilt: 5, lines: white.withAlphaComponent(0.45))
  windowSticker(cg, CGRect(x: 40, y: 222, width: 190, height: 136), bar: ink, body: white, tilt: -3, lines: soft, button: blue)
  cursor(cg, at: CGPoint(x: 170, y: 292), height: 66, fill: ink, rim: white, rimWidth: 5)
  sparkle(CGPoint(x: 250, y: 62), 15, white)
  sparkle(CGPoint(x: 262, y: 340), 11, blue)
}

let desktopHero = NSImage(contentsOf: art.appendingPathComponent("desktop-hero.png"))!

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
  let desk = CGRect(x: 770, y: 120, width: 400, height: 270)
  sticker(cg, desk, radius: 36, rim: 9, fill: blue, tilt: -5) {
    // The app's own "Bureau" picture, filling the card as a cover does.
    let fill = max(desk.width / desktopHero.size.width, desk.height / desktopHero.size.height)
    let w = desktopHero.size.width * fill, h = desktopHero.size.height * fill
    desktopHero.draw(in: CGRect(x: desk.midX - w / 2, y: desk.midY - h / 2, width: w, height: h), from: .zero,
                     operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
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

// MARK: Home screen

// The app's home screen, drawn as the app draws it: a made-up machine (PC-SALON) and games whose covers come from
// SteamGridDB (docs/readme/source/games, fetched with a SteamGridDB key, kept out of the repository), with Waken's own
// pictures for Bureau and for a game without a cover.

/** A picture filling a rect, cropped as a cover. */
func cover(_ image: NSImage, in rect: CGRect) {
  let fill = max(rect.width / image.size.width, rect.height / image.size.height)
  let w = image.size.width * fill, h = image.size.height * fill
  image.draw(in: CGRect(x: rect.midX - w / 2, y: rect.midY - h / 2, width: w, height: h), from: .zero, operation: .sourceOver,
             fraction: 1, respectFlipped: true, hints: nil)
}

/** Waken's picture for a game without one (NoCover in packages/ui): its colour, its giant initial, its name. */
func noCover(_ cg: CGContext, _ title: String, in r: CGRect) {
  ground(cg, r, [hex("#7A5CFF"), hex("#5A3FE0")], [0, 1], angle: 150)
  text(String(title.prefix(1)), anton(r.height * 1.35), white.withAlphaComponent(0.16),
       in: CGRect(x: r.maxX - r.height * 0.95, y: r.minY - r.height * 0.3, width: r.width, height: r.height * 2))
  sparkle(CGPoint(x: r.minX + r.width * 0.14, y: r.minY + r.height * 0.2), r.height * 0.08, white)
  let size = max(13, min(40, r.width / 6.2))
  text(title.uppercased(), anton(size), white, in: CGRect(x: r.minX + 8, y: r.maxY - size * 1.5 - 6, width: r.width - 16, height: size * 1.4))
}

/** A rank digit of the arcade lists: blue Anton, thick white outline, black drop. */
func rank(_ n: Int, at p: CGPoint, size: CGFloat) {
  let font = anton(size)
  let s = String(n)
  let draw = { (color: NSColor, stroke: CGFloat, dx: CGFloat, dy: CGFloat) in
    NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: color, .strokeColor: color, .strokeWidth: -stroke])
      .draw(at: CGPoint(x: p.x + dx, y: p.y + dy))
  }
  draw(ink, 16, size * 0.08, size * 0.09)
  draw(white, 16, 0, 0)
  NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: blue]).draw(at: p)
}

/** The four squares the app puts after a Windows game's name. */
func windowsMark(at p: CGPoint, size: CGFloat) {
  ink.setFill()
  let c = size * 0.46, g = size - c * 2
  for (x, y) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
    CGRect(x: p.x + CGFloat(x) * (c + g), y: p.y + CGFloat(y) * (c + g), width: c, height: c).fill()
  }
}

let gamesDir = out.appendingPathComponent("source/games")
func game(_ name: String) -> NSImage? {
  for ext in ["png", "jpg"] {
    if let image = NSImage(contentsOf: gamesDir.appendingPathComponent("\(name).\(ext)")) { return image }
  }
  return nil
}

if let gta = game("gta-vi"), let elden = game("elden-ring") {
  canvas("accueil", 1280, 800) { cg in
    ground(cg, CGRect(x: 0, y: 0, width: 1280, height: 800), sky, [0, 0.55, 1])
    let win = CGRect(x: 80, y: 60, width: 1120, height: 680)
    cg.saveGState()
    shadow(cg, blur: 60, y: 26, alpha: 0.28)
    white.setFill()
    rounded(win, 22).fill()
    cg.restoreGState()
    cg.saveGState()
    rounded(win, 22).addClip()
    hex("#F6F6F8").setFill()
    CGRect(x: win.minX, y: win.minY, width: win.width, height: 40).fill()
    for (i, c) in ["#FF5F57", "#FEBC2E", "#28C840"].enumerated() {
      hex(c).setFill()
      NSBezierPath(ovalIn: CGRect(x: win.minX + 18 + CGFloat(i) * 22, y: win.minY + 13, width: 14, height: 14)).fill()
    }
    // The app, from its top left.
    let o = CGPoint(x: win.minX, y: win.minY + 40)
    let app = CGRect(x: o.x, y: o.y, width: win.width, height: win.height - 40)
    ground(cg, app, sun, [0, 0.42, 1], angle: 165)
    func at(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect { CGRect(x: o.x + x, y: o.y + y, width: w, height: h) }

    // Top bar: the wordmark, the tabs, the search, the notifications, the account.
    text("WAKEN", anton(34), ink, in: at(28, 22, 140, 50), kern: 0.5)
    white.withAlphaComponent(0.6).setFill()
    rounded(at(150, 20, 420, 50), 25).fill()
    ink.setFill()
    rounded(at(156, 25, 104, 40), 20).fill()
    for (label, x, active) in [("Accueil", 172.0, true), ("Jeux", 284.0, false), ("Machines", 352.0, false), ("Réglages", 466.0, false)] {
      text(label, inter("Bold", 16), active ? white : ink, in: at(CGFloat(x), 34, 110, 24))
    }
    white.withAlphaComponent(0.6).setFill()
    rounded(at(690, 20, 270, 50), 25).fill()
    icon("search", color: "#3F424D", in: at(708, 34, 22, 22), stroke: 2)
    text("Rechercher un jeu", inter("Medium", 16), ink2, in: at(740, 33, 200, 24))
    white.setFill()
    NSBezierPath(ovalIn: at(972, 20, 50, 50)).fill()
    icon("bell", color: "#0B0B0F", in: at(985, 33, 24, 24), stroke: 2)
    blue.setFill()
    NSBezierPath(ovalIn: at(1034, 20, 50, 50)).fill()
    text("AL", inter("ExtraBold", 18), white, in: at(1034, 33, 50, 24), align: .center)

    // The hero: the question, the last game, the button.
    text("ON JOUE ?", anton(124), ink, in: at(24, 96, 560, 170))
    text("Un clic et GTA VI se lance tout seul sur ta machine.", inter("Medium", 18), ink2, in: at(30, 268, 520, 28))
    ink.setFill()
    rounded(at(28, 312, 152, 56), 28).fill()
    lime.setFill()
    NSBezierPath(ovalIn: at(36, 320, 40, 40)).fill()
    let play = NSBezierPath()
    play.move(to: CGPoint(x: o.x + 51, y: o.y + 330))
    play.line(to: CGPoint(x: o.x + 51, y: o.y + 350))
    play.line(to: CGPoint(x: o.x + 66, y: o.y + 340))
    play.close()
    ink.setFill()
    play.fill()
    text("Jouer", inter("ExtraBold", 18), white, in: at(92, 329, 80, 26))

    let big = at(610, 96, 380, 244)
    sticker(cg, big, radius: 30, rim: 8, fill: ink, tilt: -5) { cover(gta, in: big) }
    let small = at(890, 250, 196, 132)
    sticker(cg, small, radius: 24, rim: 7, fill: ink, tilt: 8) { cover(desktopHero, in: small) }
    let sticker2 = at(586, 262, 92, 92)
    sticker(cg, sticker2, radius: 24, rim: 6, fill: ink, tilt: -10) { mark(in: sticker2) }

    // The games of the machine, ranked.
    text("Tes jeux", inter("ExtraBold", 24), ink, in: at(28, 430, 200, 34))
    text("Tout voir", inter("Bold", 15), ink, in: at(1010, 438, 90, 22))
    ink.setFill()
    CGRect(x: o.x + 1010, y: o.y + 458, width: 66, height: 1.5).fill()
    let tiles: [(String, (CGRect) -> Void)] = [
      ("Bureau", { r in cover(desktopHero, in: r) }),
      ("GTA VI", { r in cover(gta, in: r) }),
      ("Elden Ring", { r in cover(elden, in: r) }),
      ("Hytale", { r in noCover(cg, "Hytale", in: r) }),
    ]
    for (i, tile) in tiles.enumerated() {
      let x = 24 + CGFloat(i) * 270
      let art = at(x + 26, 486, 118, 104)
      sticker(cg, art, radius: 20, rim: 5, fill: ink, tilt: i % 2 == 0 ? -6 : 5) { tile.1(art) }
      rank(i + 1, at: CGPoint(x: o.x + x, y: o.y + 524), size: 74)
      let nameFont = inter("ExtraBold", 18)
      text(tile.0, nameFont, ink, in: at(x + 162, 512, 120, 26))
      windowsMark(at: CGPoint(x: o.x + x + 166 + min(width(tile.0, nameFont), 96), y: o.y + 517), size: 15)
      text("PC-SALON", inter("Medium", 13), ink2, in: at(x + 162, 542, 120, 20))
    }
    cg.restoreGState()
  }
} else {
  print("docs/readme/accueil.png gardé tel quel : pas de pochettes dans docs/readme/source/games (SteamGridDB).")
}
