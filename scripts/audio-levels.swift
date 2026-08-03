// Peak audio level over a window, so silence and fades are measured rather than guessed.
//
//   swift scripts/audio-levels.swift <file> [head|tail] [seconds] [bucket]
//
//   swift scripts/audio-levels.swift track.mp3 head 6       # find a silent intro
//   swift scripts/audio-levels.swift film.mp4  tail 3       # check a fade-out
//
// `head` also reports the FIRST bucket that crosses an audible threshold, which is
// the number to pass to combine-av as the music in-point when a track opens with a
// gap — leaving that gap in means the film starts on silence.
//
// Decodes to PCM and reads the samples, so this reflects what is actually in the
// file rather than what an exporter was asked to do.

import AVFoundation
import Foundation

let a = CommandLine.arguments
guard a.count >= 2 else {
  print("usage: swift scripts/audio-levels.swift <file> [head|tail] [seconds] [bucket]")
  exit(1)
}
let url = URL(fileURLWithPath: a[1])
let mode = a.count >= 3 ? a[2].lowercased() : "tail"
let WINDOW = a.count >= 4 ? (Double(a[3]) ?? 3) : 3
let BUCKET = a.count >= 5 ? (Double(a[4]) ?? 0.25) : 0.25

let asset = AVURLAsset(url: url)
guard let tr = asset.tracks(withMediaType: .audio).first else { print("✗ no audio track"); exit(1) }
let dur = CMTimeGetSeconds(asset.duration)

let reader = try AVAssetReader(asset: asset)
// Reading only the window we care about keeps this fast on long tracks.
if mode == "head" {
  reader.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: WINDOW, preferredTimescale: 600))
} else {
  let s = max(0, dur - WINDOW)
  reader.timeRange = CMTimeRange(start: CMTime(seconds: s, preferredTimescale: 600), duration: CMTime(seconds: WINDOW + 0.5, preferredTimescale: 600))
}
let out = AVAssetReaderTrackOutput(track: tr, outputSettings: [
  AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16,
  AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
])
reader.add(out)
reader.startReading()

var buckets = [Int: Int]()
while let sb = out.copyNextSampleBuffer() {
  let t = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb))
  guard let bb = CMSampleBufferGetDataBuffer(sb) else { continue }
  var len = 0
  var ptr: UnsafeMutablePointer<Int8>?
  CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &len, dataPointerOut: &ptr)
  guard let p = ptr else { continue }
  let n = len / 2
  var peak = 0
  p.withMemoryRebound(to: Int16.self, capacity: n) { s in
    for i in 0..<n { peak = max(peak, abs(Int(s[i]))) }
  }
  let k = Int(t / BUCKET)
  buckets[k] = max(buckets[k] ?? 0, peak)
}

print(String(format: "%@  —  %.2fs total, %@ %.2fs in %.2fs buckets",
             (a[1] as NSString).lastPathComponent, dur, mode, WINDOW, BUCKET))
let AUDIBLE = 0.02 // 2% of full scale — above dither/encoder noise, below any real content
var firstAudible: Double? = nil
for k in buckets.keys.sorted() {
  let v = buckets[k]!
  let pct = Double(v) / 32767.0
  if firstAudible == nil, pct >= AUDIBLE { firstAudible = Double(k) * BUCKET }
  let bar = String(repeating: "█", count: max(0, Int(pct * 40)))
  print(String(format: "  %6.2fs  %5.1f%%  %@", Double(k) * BUCKET, pct * 100, bar))
}
if mode == "head" {
  if let f = firstAudible, f > 0 {
    print(String(format: "\n⚠ SILENT INTRO: audio first crosses %.0f%% at %.2fs.", AUDIBLE * 100, f))
    print(String(format: "  Pass %.2f as combine-av's start offset, or the film opens on silence.", f))
  } else if firstAudible != nil {
    print("\n✓ audio starts immediately — no gap to trim.")
  } else {
    print("\n⚠ nothing audible in this window at all.")
  }
}
