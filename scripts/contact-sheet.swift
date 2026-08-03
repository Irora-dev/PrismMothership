// Build a contact sheet from a directory of frames, so a whole film can be read at a glance.
//
//   swift scripts/contact-sheet.swift <framesDir> <out.jpg> [cols] [thumbWidth]
//
// Frames are laid out in filename order with their name burned into each cell —
// the timestamp is the point of the sheet, a grid of unlabelled thumbnails tells
// you a shot repeats but not where.

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count >= 3 else {
  print("usage: swift scripts/contact-sheet.swift <framesDir> <out.jpg> [cols] [thumbWidth]")
  exit(1)
}
let dir = URL(fileURLWithPath: a[1])
let outURL = URL(fileURLWithPath: a[2])
let COLS = a.count >= 4 ? (Int(a[3]) ?? 10) : 10
let TW = a.count >= 5 ? (Int(a[4]) ?? 320) : 320

let files = (try! FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))
  .filter { ["jpg", "jpeg", "png"].contains($0.pathExtension.lowercased()) }
  .sorted { $0.lastPathComponent < $1.lastPathComponent }
guard !files.isEmpty else { print("✗ no frames in \(dir.path)"); exit(1) }

func load(_ u: URL) -> CGImage? {
  guard let s = CGImageSourceCreateWithURL(u as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(s, 0, nil)
}
guard let probe = load(files[0]) else { print("✗ unreadable first frame"); exit(1) }
let TH = Int(Double(TW) * Double(probe.height) / Double(probe.width))
let LABEL = 26
let rows = (files.count + COLS - 1) / COLS
let W = COLS * TW, H = rows * (TH + LABEL)

guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpaceCreateDeviceRGB(),
                          bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else {
  print("✗ no context"); exit(1)
}
ctx.setFillColor(CGColor(red: 0.05, green: 0.05, blue: 0.07, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))

let font = CTFontCreateWithName("Menlo" as CFString, 17, nil)
for (i, f) in files.enumerated() {
  guard let img = load(f) else { continue }
  let col = i % COLS, row = i / COLS
  let x = col * TW
  let y = H - (row + 1) * (TH + LABEL)          // CG origin is bottom-left
  ctx.draw(img, in: CGRect(x: x + 2, y: y + LABEL, width: TW - 4, height: TH - 2))

  let label = f.deletingPathExtension().lastPathComponent
  let attrs: [CFString: Any] = [
    kCTFontAttributeName: font,
    kCTForegroundColorAttributeName: CGColor(red: 0.75, green: 0.85, blue: 1, alpha: 1),
  ]
  let attr = CFAttributedStringCreate(nil, label as CFString, attrs as CFDictionary)!
  let line = CTLineCreateWithAttributedString(attr)
  ctx.textPosition = CGPoint(x: x + 6, y: y + 6)
  CTLineDraw(line, ctx)
}

guard let out = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
  print("✗ encode failed"); exit(1)
}
CGImageDestinationAddImage(dest, out, [kCGImageDestinationLossyCompressionQuality: 0.72] as CFDictionary)
CGImageDestinationFinalize(dest)
print("✓ \(files.count) frames, \(COLS)×\(rows) → \(outURL.path) (\(W)×\(H))")
