// Scan a video: sample frames, fingerprint them, and report repeated footage.
//
//   swift scripts/film-scan.swift <video> [stepSeconds] [dumpDir] [from] [to]
//
// Why this exists: an edited montage can silently contain the SAME clip twice
// (a timeline export bug, a double-appended source). Eyeballing a 45s film at
// 60fps does not find that; fingerprinting every sampled frame does.
//
// Each sampled frame is reduced to a 64-bit dHash (9x8 grayscale, compare each
// pixel to its right neighbour). Two frames within HAMMING bits are the same
// picture. Non-adjacent matches are the interesting ones: that is footage the
// viewer sees twice. Adjacent matches just mean a static shot, so runs are
// collapsed into segments first and segments are compared to each other.

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count >= 2 else {
  print("usage: swift scripts/film-scan.swift <video> [stepSeconds] [dumpDir]")
  exit(1)
}
let videoURL = URL(fileURLWithPath: a[1])
let STEP = a.count >= 3 ? (Double(a[2]) ?? 0.5) : 0.5
let dumpDir: URL? = a.count >= 4 ? URL(fileURLWithPath: a[3]) : nil
if let d = dumpDir { try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true) }

let asset = AVURLAsset(url: videoURL)
let fullDuration = CMTimeGetSeconds(asset.duration)
guard fullDuration > 0 else { print("✗ no duration — unreadable?"); exit(1) }
let FROM = a.count >= 5 ? (Double(a[4]) ?? 0) : 0
let duration = a.count >= 6 ? min(Double(a[5]) ?? fullDuration, fullDuration) : fullDuration

let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: 640, height: 360)

// 9x8 grayscale -> 64-bit difference hash
func dhash(_ img: CGImage) -> UInt64 {
  let w = 9, h = 8
  var px = [UInt8](repeating: 0, count: w * h)
  guard let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0) else { return 0 }
  ctx.interpolationQuality = .low
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  var bits: UInt64 = 0, n = 0
  for y in 0..<h {
    for x in 0..<(w - 1) {
      if px[y * w + x] > px[y * w + x + 1] { bits |= (1 << UInt64(n)) }
      n += 1
    }
  }
  return bits
}
func hamming(_ x: UInt64, _ y: UInt64) -> Int { (x ^ y).nonzeroBitCount }

// mean luminance, so we can name black frames (the cuts) rather than call them repeats
func luma(_ img: CGImage) -> Int {
  var px = [UInt8](repeating: 0, count: 16 * 9)
  guard let ctx = CGContext(data: &px, width: 16, height: 9, bitsPerComponent: 8, bytesPerRow: 16,
                            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0) else { return 0 }
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: 16, height: 9))
  return Int(px.map { Int($0) }.reduce(0, +) / px.count)
}

struct Sample { let t: Double; let hash: UInt64; let luma: Int }
var samples: [Sample] = []
var t = FROM
while t < duration {
  let time = CMTime(seconds: t, preferredTimescale: 600)
  if let img = try? gen.copyCGImage(at: time, actualTime: nil) {
    samples.append(Sample(t: t, hash: dhash(img), luma: luma(img)))
    if let d = dumpDir {
      let name = String(format: "t%07.2f.jpg", t).replacingOccurrences(of: " ", with: "0")
      let u = d.appendingPathComponent(name)
      if let dest = CGImageDestinationCreateWithURL(u as CFURL, UTType.jpeg.identifier as CFString, 1, nil) {
        CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: 0.6] as CFDictionary)
        CGImageDestinationFinalize(dest)
      }
    }
  }
  t += STEP
}
print("sampled \(samples.count) frames over \(String(format: "%.2f", duration))s every \(STEP)s")

// Collapse runs of the same picture into segments (a held shot is one segment)
let SAME = 6           // hamming <= SAME means the same picture
struct Segment { var start: Double; var end: Double; var hash: UInt64; var dark: Bool }
var segs: [Segment] = []
for s in samples {
  let dark = s.luma < 16
  if var last = segs.last, hamming(last.hash, s.hash) <= SAME, last.dark == dark {
    last.end = s.t
    segs[segs.count - 1] = last
  } else {
    segs.append(Segment(start: s.t, end: s.t, hash: s.hash, dark: dark))
  }
}
print("\nSEGMENTS (\(segs.count))")
for (i, s) in segs.enumerated() {
  let len = s.end - s.start + STEP
  print(String(format: "  %2d  %6.2f → %6.2f  (%5.2fs)%@  #%016llx", i, s.start, s.end + STEP, len, s.dark ? "  ⬛dark" : "", s.hash))
}

// Repeated footage: two non-adjacent segments showing the same picture
print("\nREPEATS (same picture, non-adjacent segments)")
var found = 0
var reported = Set<String>()
for i in 0..<segs.count {
  if segs[i].dark { continue }
  for j in (i + 1)..<segs.count {
    if segs[j].dark { continue }
    if j == i + 1 { continue }
    if hamming(segs[i].hash, segs[j].hash) <= SAME {
      let key = "\(i)-\(j)"
      if reported.contains(key) { continue }
      reported.insert(key)
      found += 1
      print(String(format: "  seg %2d (%6.2f→%6.2f) == seg %2d (%6.2f→%6.2f)   hamming %d",
                   i, segs[i].start, segs[i].end + STEP, j, segs[j].start, segs[j].end + STEP,
                   hamming(segs[i].hash, segs[j].hash)))
    }
  }
}
if found == 0 { print("  none — no sampled frame repeats elsewhere in the film") }

// Longest repeated stretch: walk forward from every matching pair
print("\nREPEATED STRETCHES (consecutive sample runs that recur)")
var stretches: [(Double, Double, Double, Int)] = []  // aStart, bStart, seconds, frames
var usedB = Set<Int>()
for i in 0..<samples.count {
  guard i + 4 < samples.count else { break }
  for j in (i + 4)..<samples.count {
    if usedB.contains(j) { continue }
    if samples[i].luma < 16 { continue }
    guard hamming(samples[i].hash, samples[j].hash) <= SAME else { continue }
    var n = 0
    while i + n < samples.count, j + n < samples.count,
          hamming(samples[i + n].hash, samples[j + n].hash) <= SAME { n += 1 }
    if n >= 4 {   // at least 4 samples in a row = a real repeated stretch
      stretches.append((samples[i].t, samples[j].t, Double(n) * STEP, n))
      for k in 0..<n { usedB.insert(j + k) }
    }
  }
}
if stretches.isEmpty {
  print("  none ≥\(4 * STEP)s")
} else {
  for s in stretches.sorted(by: { $0.2 > $1.2 }) {
    print(String(format: "  %.2fs of footage at %6.2f plays AGAIN at %6.2f  (%d samples)", s.2, s.0, s.1, s.3))
  }
}
if let d = dumpDir { print("\nframes → \(d.path)") }
