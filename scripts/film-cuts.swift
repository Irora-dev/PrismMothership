// Detect every scene cut in a video, at frame precision, in ONE sequential pass.
//
//   swift scripts/film-cuts.swift <video> [threshold] [minShotSeconds]
//
// Why sequential: AVAssetImageGenerator with zero tolerance re-seeks for every
// sample, which on a 60fps 1080p file costs seconds per frame. AVAssetReader
// streams the decoder forward, so the whole film is read once at near disk speed.
//
// Each frame is reduced to a 64-bit dHash sampled straight out of the pixel
// buffer (9x8 nearest-neighbour luma, no intermediate CGImage). A cut is a
// consecutive-frame hamming distance above `threshold`; shots shorter than
// `minShotSeconds` are reported with a ⚠ because a sub-second shot inside a
// longer take is usually a misplaced clip, not an edit.

import AVFoundation
import CoreVideo
import Foundation

let a = CommandLine.arguments
guard a.count >= 2 else {
  print("usage: swift scripts/film-cuts.swift <video> [threshold] [minShotSeconds]")
  exit(1)
}
let url = URL(fileURLWithPath: a[1])
let THRESH = a.count >= 3 ? (Int(a[2]) ?? 14) : 14
let MIN_SHOT = a.count >= 4 ? (Double(a[3]) ?? 1.5) : 1.5

let asset = AVURLAsset(url: url)
guard let track = asset.tracks(withMediaType: .video).first else { print("✗ no video track"); exit(1) }
let reader = try AVAssetReader(asset: asset)
let out = AVAssetReaderTrackOutput(track: track, outputSettings: [
  kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
])
out.alwaysCopiesSampleData = false
reader.add(out)
reader.startReading()

let GW = 9, GH = 8
func hashOf(_ pb: CVPixelBuffer) -> UInt64 {
  CVPixelBufferLockBaseAddress(pb, .readOnly)
  defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
  guard let base = CVPixelBufferGetBaseAddress(pb) else { return 0 }
  let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
  let stride = CVPixelBufferGetBytesPerRow(pb)
  let p = base.assumingMemoryBound(to: UInt8.self)
  var g = [Int](repeating: 0, count: GW * GH)
  for gy in 0..<GH {
    // average a few rows per cell so a single scanline of noise cannot flip a bit
    let y0 = gy * h / GH, y1 = max(y0 + 1, (gy + 1) * h / GH)
    for gx in 0..<GW {
      let x0 = gx * w / GW, x1 = max(x0 + 1, (gx + 1) * w / GW)
      var sum = 0, n = 0
      var y = y0
      while y < y1 {
        var x = x0
        while x < x1 {
          let o = y * stride + x * 4
          sum += (Int(p[o]) * 29 + Int(p[o + 1]) * 150 + Int(p[o + 2]) * 77) >> 8  // BGR -> luma
          n += 1
          x += max(1, (x1 - x0) / 3)
        }
        y += max(1, (y1 - y0) / 3)
      }
      g[gy * GW + gx] = n > 0 ? sum / n : 0
    }
  }
  var bits: UInt64 = 0, i = 0
  for gy in 0..<GH {
    for gx in 0..<(GW - 1) {
      if g[gy * GW + gx] > g[gy * GW + gx + 1] { bits |= (1 << UInt64(i)) }
      i += 1
    }
  }
  return bits
}
func hamming(_ x: UInt64, _ y: UInt64) -> Int { (x ^ y).nonzeroBitCount }

struct Cut { let t: Double; let dist: Int }
var cuts: [Cut] = []
var prev: UInt64 = 0
var frames = 0
var lastT = 0.0
while let sb = out.copyNextSampleBuffer() {
  guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
  let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb))
  let h = hashOf(pb)
  if frames > 0 {
    let d = hamming(prev, h)
    if d >= THRESH { cuts.append(Cut(t: t, dist: d)) }
  }
  prev = h
  lastT = t
  frames += 1
}
guard reader.status == .completed || reader.status == .reading else {
  print("✗ read failed: \(reader.error?.localizedDescription ?? "?")"); exit(1)
}
let dur = CMTimeGetSeconds(asset.duration)
print("read \(frames) frames, \(String(format: "%.2f", dur))s (last pts \(String(format: "%.2f", lastT)))")
print("threshold hamming ≥ \(THRESH)\n")

// shots = the spans between cuts
var bounds: [Double] = [0.0] + cuts.map { $0.t } + [dur]
print("SHOTS")
for i in 0..<(bounds.count - 1) {
  let s = bounds[i], e = bounds[i + 1], len = e - s
  let short = len < MIN_SHOT
  print(String(format: "  %2d  %7.3f → %7.3f  (%6.3fs)%@", i, s, e, len, short ? "  ⚠ short" : ""))
}
print("\nCUTS (\(cuts.count))")
for c in cuts { print(String(format: "  %7.3f   Δ%d", c.t, c.dist)) }

// A short shot wedged between two shots of the SAME scene is a misplaced clip.
print("\nSUSPECTED MISPLACED CLIPS (a short shot interrupting one continuous take)")
var flagged = 0
for i in 1..<max(1, bounds.count - 2) {
  let s = bounds[i], e = bounds[i + 1]
  guard e - s < MIN_SHOT else { continue }
  print(String(format: "  %7.3f → %7.3f  (%.3fs) — cutting this rejoins the surrounding take", s, e, e - s))
  flagged += 1
}
if flagged == 0 { print("  none") }
