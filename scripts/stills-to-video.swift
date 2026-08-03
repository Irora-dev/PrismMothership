// Turn still images into a video segment, each held for a fixed time.
//
//   swift scripts/stills-to-video.swift <out.mp4> <fps> <secondsPerStill> <W> <H> <img…> [--fade <s>]
//
//   swift scripts/stills-to-video.swift stills.mp4 60 1 1920 1080 a.png b.png … --fade 2
//
// `--fade <s>` appends s seconds in which the LAST still fades to black. It is
// appended rather than taken out of the stills' own dwell, so every still is
// still seen at full brightness for its full second.
//
// Built to append a slideshow tail onto footage, so it encodes to the SAME
// geometry and frame rate as the footage — that is what lets film-edit.swift
// still concatenate with PASSTHROUGH instead of re-encoding the whole film.
//
// Images are scaled to FILL the frame and centre-cropped, never letterboxed:
// surprise black bars part-way through a trailer read as a mistake, and the
// cropped slivers are background. Aspect is preserved (no stretching).

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

var a = CommandLine.arguments
// pull the optional --fade <s> out before the variadic image list
var FADE = 0.0
if let i = a.firstIndex(of: "--fade") {
  guard i + 1 < a.count, let v = Double(a[i + 1]) else { print("✗ --fade needs a number"); exit(1) }
  FADE = v
  a.removeSubrange(i...(i + 1))
}
guard a.count >= 7 else {
  print("usage: swift scripts/stills-to-video.swift <out.mp4> <fps> <secondsPerStill> <W> <H> <img…> [--fade <s>]")
  exit(1)
}
let outURL = URL(fileURLWithPath: a[1])
let FPS = Int(a[2]) ?? 60
let SECS = Double(a[3]) ?? 1.0
let W = Int(a[4]) ?? 1920
let H = Int(a[5]) ?? 1080
let images = a[6...].map { URL(fileURLWithPath: $0) }
let perStill = max(1, Int((Double(FPS) * SECS).rounded()))
let TS: CMTimeScale = 600

func load(_ u: URL) -> CGImage? {
  guard let s = CGImageSourceCreateWithURL(u as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(s, 0, nil)
}

try? FileManager.default.removeItem(at: outURL)
let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
let vin = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 22_000_000,        // match the footage's ~22Mbps
    AVVideoMaxKeyFrameIntervalKey: FPS,          // a keyframe a second keeps cuts clean
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
  ],
])
vin.expectsMediaDataInRealTime = false
let ad = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vin, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
  kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
])
writer.add(vin)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

var frame = 0
var lastImg: CGImage?
var lastRect: CGRect = .zero
for (i, u) in images.enumerated() {
  guard let img = load(u) else { print("✗ cannot read \(u.lastPathComponent)"); exit(1) }
  // scale to FILL, centred
  let sx = Double(W) / Double(img.width), sy = Double(H) / Double(img.height)
  let s = max(sx, sy)
  let dw = Double(img.width) * s, dh = Double(img.height) * s
  let rect = CGRect(x: (Double(W) - dw) / 2, y: (Double(H) - dh) / 2, width: dw, height: dh)

  guard let pool = ad.pixelBufferPool else { print("✗ no pixel buffer pool"); exit(1) }
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
  guard let buf = pb else { exit(1) }
  CVPixelBufferLockBaseAddress(buf, [])
  if let base = CVPixelBufferGetBaseAddress(buf),
     let ctx = CGContext(data: base, width: W, height: H, bitsPerComponent: 8,
                         bytesPerRow: CVPixelBufferGetBytesPerRow(buf),
                         space: CGColorSpaceCreateDeviceRGB(),
                         bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) {
    ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
    ctx.interpolationQuality = .high
    ctx.draw(img, in: rect)
  }
  CVPixelBufferUnlockBaseAddress(buf, [])

  // hold the same buffer for the whole dwell — no re-draw per frame
  for _ in 0..<perStill {
    while !vin.isReadyForMoreMediaData { usleep(2000) }
    ad.append(buf, withPresentationTime: CMTime(value: CMTimeValue(frame * Int(TS) / FPS), timescale: TS))
    frame += 1
  }
  let crop = Int(((dw - Double(W)) / 2).rounded())
  print(String(format: "  %2d. %@  %dx%d → cropped %dpx per side", i + 1, u.lastPathComponent, img.width, img.height, max(0, crop)))
  lastImg = img
  lastRect = rect
}

// ── optional fade of the last still to black ─────────────────────────────────
// Drawn per frame (the alpha changes every frame, so unlike a held still this
// cannot reuse one buffer). Eased so the fall-off reads smoothly rather than
// linearly — a linear fade appears to hang at the top and rush at the bottom.
if FADE > 0, let img = lastImg {
  let fadeFrames = max(1, Int((Double(FPS) * FADE).rounded()))
  guard let pool = ad.pixelBufferPool else { print("✗ no pixel buffer pool"); exit(1) }
  for f in 0..<fadeFrames {
    let t = Double(f + 1) / Double(fadeFrames)      // 0 → 1 across the fade
    let alpha = 1.0 - (t * t * (3 - 2 * t))         // smoothstep, full → black
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
    guard let buf = pb else { exit(1) }
    CVPixelBufferLockBaseAddress(buf, [])
    if let base = CVPixelBufferGetBaseAddress(buf),
       let ctx = CGContext(data: base, width: W, height: H, bitsPerComponent: 8,
                           bytesPerRow: CVPixelBufferGetBytesPerRow(buf),
                           space: CGColorSpaceCreateDeviceRGB(),
                           bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) {
      ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
      ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
      ctx.interpolationQuality = .high
      ctx.setAlpha(CGFloat(max(0, alpha)))
      ctx.draw(img, in: lastRect)
    }
    CVPixelBufferUnlockBaseAddress(buf, [])
    while !vin.isReadyForMoreMediaData { usleep(2000) }
    ad.append(buf, withPresentationTime: CMTime(value: CMTimeValue(frame * Int(TS) / FPS), timescale: TS))
    frame += 1
  }
  print(String(format: "  + fade to black over %.2fs (%d frames), eased", FADE, fadeFrames))
}
vin.markAsFinished()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
guard writer.status == .completed else {
  print("✗ write failed: \(writer.error?.localizedDescription ?? "?")"); exit(1)
}
let check = AVURLAsset(url: outURL)
print("""

result: \(outURL.path)
  stills   : \(images.count) × \(String(format: "%.2f", SECS))s
  duration : \(String(format: "%.3f", CMTimeGetSeconds(check.duration)))s
  frames   : \(frame) @ \(FPS)fps (\(W)x\(H))
""")
