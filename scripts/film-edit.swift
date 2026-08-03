// Cut a film from ranges of one or more source clips — an edit list, no ffmpeg.
//
//   swift scripts/film-edit.swift <out.mp4> <clip[@start:end]> [more clips…]
//
//   swift scripts/film-edit.swift out.mp4 \
//     footage.mp4@0:14.933 footage.mp4@16.9:38.983 footage.mp4@39.867:end
//
// `@start:end` is in seconds; `end` may be the literal "end". A clip with no
// range is used whole. Segments are concatenated in the order given.
//
// PASSTHROUGH is tried first so the footage is copied rather than re-encoded.
// A cut that lands mid-GOP can defeat it, so the export falls back to a high
// bitrate re-encode and SAYS WHICH ONE HAPPENED — a silent re-encode is a
// quality regression you would otherwise only notice on the third generation.
//
// The join times in the OUTPUT timeline are printed so they can be verified
// with film-cuts.swift / film-scan.swift rather than trusted.

import AVFoundation
import Foundation

let a = CommandLine.arguments
guard a.count >= 3 else {
  print("usage: swift scripts/film-edit.swift <out.mp4> <clip[@start:end]> [more…]")
  exit(1)
}
let outURL = URL(fileURLWithPath: a[1])
let TS: CMTimeScale = 600
func ct(_ s: Double) -> CMTime { CMTime(seconds: s, preferredTimescale: TS) }

struct Seg { let url: URL; let start: Double; let end: Double? }
var segs: [Seg] = []
for spec in a[2...] {
  // split on the LAST @ so a path containing @ still works
  guard let at = spec.lastIndex(of: "@") else {
    segs.append(Seg(url: URL(fileURLWithPath: spec), start: 0, end: nil)); continue
  }
  let path = String(spec[spec.startIndex..<at])
  let range = String(spec[spec.index(after: at)...])
  let parts = range.split(separator: ":", maxSplits: 1).map(String.init)
  guard parts.count == 2, let s = Double(parts[0]) else {
    print("✗ bad range in \(spec) — want clip@start:end"); exit(1)
  }
  let e: Double? = parts[1].lowercased() == "end" ? nil : Double(parts[1])
  if parts[1].lowercased() != "end" && e == nil { print("✗ bad end in \(spec)"); exit(1) }
  segs.append(Seg(url: URL(fileURLWithPath: path), start: s, end: e))
}

let comp = AVMutableComposition()
guard let vt = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { exit(1) }
var cursor = CMTime.zero
var joins: [Double] = []
var transform: CGAffineTransform = .identity

for (i, seg) in segs.enumerated() {
  let asset = AVURLAsset(url: seg.url)
  guard let v = asset.tracks(withMediaType: .video).first else {
    print("✗ no video track in \(seg.url.lastPathComponent)"); exit(1)
  }
  let full = CMTimeGetSeconds(asset.duration)
  let end = min(seg.end ?? full, full)
  guard end > seg.start else {
    print("✗ empty range \(seg.start):\(end) on \(seg.url.lastPathComponent)"); exit(1)
  }
  let dur = end - seg.start
  do {
    try vt.insertTimeRange(CMTimeRange(start: ct(seg.start), duration: ct(dur)), of: v, at: cursor)
  } catch {
    print("✗ insert failed for \(seg.url.lastPathComponent)@\(seg.start):\(end) — \(error.localizedDescription)")
    exit(1)
  }
  transform = v.preferredTransform
  if i > 0 { joins.append(CMTimeGetSeconds(cursor)) }
  print(String(format: "  + %@  %7.3f → %7.3f  (%6.3fs)  at out %7.3f",
               seg.url.lastPathComponent, seg.start, end, dur, CMTimeGetSeconds(cursor)))
  cursor = CMTimeAdd(cursor, ct(dur))
}
vt.preferredTransform = transform
print(String(format: "\ntotal: %.3fs from %d segment(s)", CMTimeGetSeconds(cursor), segs.count))

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
var reencoded = false
var ok = export(AVAssetExportPresetPassthrough)
if ok {
  print("✓ PASSTHROUGH — footage copied, not re-encoded")
} else {
  ok = export(AVAssetExportPresetHighestQuality)
  reencoded = ok
  if ok { print("⚠ passthrough refused (a cut lands mid-GOP) — re-encoded at highest quality") }
}
guard ok else { exit(1) }

let check = AVURLAsset(url: outURL)
let cv = check.tracks(withMediaType: .video).first
let size = (try? FileManager.default.attributesOfItem(atPath: outURL.path)[.size] as? Int) ?? 0
print("""

result: \(outURL.path)
  duration   : \(String(format: "%.3f", CMTimeGetSeconds(check.duration)))s
  video      : \(cv != nil ? "\(Int(cv!.naturalSize.width))x\(Int(cv!.naturalSize.height)) @ \(String(format: "%.2f", cv!.nominalFrameRate))fps" : "MISSING")
  re-encoded : \(reencoded ? "YES" : "no")
  size       : \(String(format: "%.1f", Double(size ?? 0) / 1_048_576))MB
  joins at   : \(joins.map { String(format: "%.3f", $0) }.joined(separator: ", "))
""")
