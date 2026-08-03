// Assemble a film: a directory of PNG intro frames, then one or more clips appended.
//
//   swift scripts/film-from-frames.swift <framesDir> <fps> <out.mp4> <clip1> [clip2 ...]
//
// The intro frames come from render-intro-frames.mjs, which renders them ON the live
// Spectrum site — so the bands, the fonts and the wordmark gradient are the site's own
// pixels rather than a reimplementation.
//
// The last ~0.8s of the intro cross-fades to clip1's own first frame, so the join is a
// butt-cut and every clip is copied through with PASSTHROUGH. Only the intro is encoded.

import AVFoundation
import CoreGraphics
import ImageIO
import Foundation

let a = CommandLine.arguments
guard a.count >= 5 else {
  print("usage: swift scripts/film-from-frames.swift <framesDir> <fps> <out.mp4> <clip1> [clip2 ...]")
  exit(1)
}
let framesDir = URL(fileURLWithPath: a[1])
let FPS = Int(a[2]) ?? 30
let outURL = URL(fileURLWithPath: a[3])
let clipURLs = a[4...].map { URL(fileURLWithPath: $0) }

let frameFiles = (try! FileManager.default.contentsOfDirectory(at: framesDir, includingPropertiesForKeys: nil))
  .filter { $0.pathExtension.lowercased() == "png" }
  .sorted { $0.lastPathComponent < $1.lastPathComponent }
guard !frameFiles.isEmpty else { print("✗ no PNGs in \(framesDir.path)"); exit(1) }

func loadImage(_ u: URL) -> CGImage? {
  guard let src = CGImageSourceCreateWithURL(u as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(src, 0, nil)
}
guard let probe = loadImage(frameFiles[0]) else { print("✗ can't read the first frame"); exit(1) }
let W = probe.width, H = probe.height
let TS: CMTimeScale = 600

// clip1's first frame — the dissolve target
let clip1 = AVURLAsset(url: clipURLs[0])
let ig = AVAssetImageGenerator(asset: clip1)
ig.appliesPreferredTrackTransform = true
ig.requestedTimeToleranceBefore = .zero
ig.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 60)
let target = try? ig.copyCGImage(at: .zero, actualTime: nil)
let dissolveFrames = min(frameFiles.count / 3, Int(0.8 * Double(FPS)))
print("intro: \(frameFiles.count) frames @ \(FPS)fps (\(W)x\(H)), dissolving over the last \(dissolveFrames)")

let introURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("film-intro-\(UUID().uuidString).mp4")
let writer = try AVAssetWriter(outputURL: introURL, fileType: .mp4)
let vin = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 20_000_000, AVVideoMaxKeyFrameIntervalKey: FPS],
])
vin.expectsMediaDataInRealTime = false
let ad = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vin, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
  kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
])
writer.add(vin)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

for (i, file) in frameFiles.enumerated() {
  while !vin.isReadyForMoreMediaData { usleep(2000) }
  guard let img = loadImage(file), let pool = ad.pixelBufferPool else { print("✗ frame \(i)"); exit(1) }
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
  guard let buf = pb else { exit(1) }
  CVPixelBufferLockBaseAddress(buf, [])
  if let base = CVPixelBufferGetBaseAddress(buf),
     let c = CGContext(data: base, width: W, height: H, bitsPerComponent: 8,
                       bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(),
                       bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) {
    c.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H))
    // ease the last frames toward the footage so the cut is invisible
    let fromEnd = frameFiles.count - 1 - i
    if fromEnd < dissolveFrames, let target {
      let p = 1 - (Double(fromEnd) / Double(dissolveFrames))
      c.setAlpha(CGFloat(p * p * (3 - 2 * p)))
      c.draw(target, in: CGRect(x: 0, y: 0, width: W, height: H))
    }
  }
  CVPixelBufferUnlockBaseAddress(buf, [])
  ad.append(buf, withPresentationTime: CMTime(value: CMTimeValue(i * Int(TS) / FPS), timescale: TS))
}
vin.markAsFinished()
let s1 = DispatchSemaphore(value: 0)
writer.finishWriting { s1.signal() }
s1.wait()
guard writer.status == .completed else { print("✗ intro write: \(writer.error?.localizedDescription ?? "?")"); exit(1) }
print("✓ intro encoded")

let comp = AVMutableComposition()
guard let vt = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { exit(1) }
let introAsset = AVURLAsset(url: introURL)
guard let iv = introAsset.tracks(withMediaType: .video).first else { exit(1) }
var cursor = CMTime.zero
try vt.insertTimeRange(CMTimeRange(start: .zero, duration: introAsset.duration), of: iv, at: cursor)
cursor = introAsset.duration
for u in clipURLs {
  let asset = AVURLAsset(url: u)
  guard let v = asset.tracks(withMediaType: .video).first else { print("✗ no video in \(u.lastPathComponent)"); exit(1) }
  try vt.insertTimeRange(CMTimeRange(start: .zero, duration: asset.duration), of: v, at: cursor)
  vt.preferredTransform = v.preferredTransform
  print("  + \(u.lastPathComponent) (\(String(format: "%.1f", CMTimeGetSeconds(asset.duration)))s)")
  cursor = CMTimeAdd(cursor, asset.duration)
}

try? FileManager.default.removeItem(at: outURL)
func export(_ preset: String) -> Bool {
  guard let ex = AVAssetExportSession(asset: comp, presetName: preset) else { return false }
  ex.outputURL = outURL
  ex.outputFileType = .mp4
  let s = DispatchSemaphore(value: 0)
  ex.exportAsynchronously { s.signal() }
  s.wait()
  if ex.status != .completed { print("… \(preset): \(ex.error?.localizedDescription ?? "failed")"); return false }
  return true
}
var ok = export(AVAssetExportPresetPassthrough)
if ok { print("✓ PASSTHROUGH — footage untouched") } else { ok = export(AVAssetExportPresetHighestQuality); if ok { print("✓ re-encoded at highest quality") } }
try? FileManager.default.removeItem(at: introURL)
guard ok else { exit(1) }

let check = AVURLAsset(url: outURL)
let size = (try? FileManager.default.attributesOfItem(atPath: outURL.path)[.size] as? Int) ?? 0
print("""

result: \(outURL.path)
  duration : \(String(format: "%.1f", CMTimeGetSeconds(check.duration)))s
  size     : \(String(format: "%.1f", Double(size ?? 0) / 1_048_576))MB
""")
