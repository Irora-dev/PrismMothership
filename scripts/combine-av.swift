// Mux a music track onto a silent video using AVFoundation (no ffmpeg on this machine).
//
//   swift combine.swift <video> <audio> <out.mp4> [startSeconds] [fadeSeconds]
//
// Two passes on purpose:
//   1. Re-encode ONLY the audio — trimmed to the video's length with a fade-out, since the
//      track is far longer than the video and would otherwise stop dead mid-bar.
//   2. Mux that against the original video with the PASSTHROUGH preset, so the 1080p60
//      video is copied bit-for-bit rather than re-encoded. (Export presets re-encode both
//      tracks, and a volume ramp is impossible in passthrough — hence the split.)

import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count >= 4 else {
  print("usage: swift combine.swift <video> <audio> <out.mp4> [startSeconds] [fadeSeconds]")
  exit(1)
}
let videoURL = URL(fileURLWithPath: args[1])
let audioURL = URL(fileURLWithPath: args[2])
let outURL = URL(fileURLWithPath: args[3])
let startSec = args.count > 4 ? Double(args[4]) ?? 0 : 0
let fadeSec = args.count > 5 ? Double(args[5]) ?? 2.0 : 2.0

let TS: CMTimeScale = 600
func t(_ s: Double) -> CMTime { CMTime(seconds: s, preferredTimescale: TS) }

let vAsset = AVURLAsset(url: videoURL)
let aAsset = AVURLAsset(url: audioURL)
let vDur = vAsset.duration
let vSec = CMTimeGetSeconds(vDur)
let aSec = CMTimeGetSeconds(aAsset.duration)

guard let vSrc = vAsset.tracks(withMediaType: .video).first else {
  print("✗ no video track in \(videoURL.lastPathComponent)"); exit(1)
}
guard let aSrc = aAsset.tracks(withMediaType: .audio).first else {
  print("✗ no audio track in \(audioURL.lastPathComponent)"); exit(1)
}

// How much music we can use from the chosen start point.
let available = max(0, aSec - startSec)
let useSec = min(vSec, available)
if useSec <= 0 { print("✗ start offset \(startSec)s is past the end of the track (\(aSec)s)"); exit(1) }
let fade = min(fadeSec, useSec / 2)

print("video : \(String(format: "%.1f", vSec))s, \(Int(vSrc.naturalSize.width))x\(Int(vSrc.naturalSize.height)) @ \(String(format: "%.0f", vSrc.nominalFrameRate))fps, silent")
print("music : \(String(format: "%.1f", aSec))s → using \(String(format: "%.1f", useSec))s from \(String(format: "%.1f", startSec))s, \(String(format: "%.1f", fade))s fade-out")

let tmpAudio = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("prism-bed-\(UUID().uuidString).m4a")

func export(_ asset: AVAsset, preset: String, to url: URL, fileType: AVFileType, mix: AVAudioMix?) -> Bool {
  try? FileManager.default.removeItem(at: url)
  guard let s = AVAssetExportSession(asset: asset, presetName: preset) else {
    print("✗ preset unavailable: \(preset)"); return false
  }
  s.outputURL = url
  s.outputFileType = fileType
  if let mix { s.audioMix = mix }
  let sem = DispatchSemaphore(value: 0)
  s.exportAsynchronously { sem.signal() }
  sem.wait()
  if s.status != .completed {
    print("✗ export failed (\(preset)): \(s.error?.localizedDescription ?? "unknown")")
    return false
  }
  return true
}

// ── pass 1: the trimmed, faded music bed ─────────────────────────────────────
let bed = AVMutableComposition()
guard let bedTrack = bed.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { exit(1) }
do {
  try bedTrack.insertTimeRange(CMTimeRange(start: t(startSec), duration: t(useSec)), of: aSrc, at: .zero)
} catch {
  print("✗ could not read the music: \(error.localizedDescription)"); exit(1)
}
let params = AVMutableAudioMixInputParameters(track: bedTrack)
params.setVolumeRamp(fromStartVolume: 1.0, toEndVolume: 0.0, timeRange: CMTimeRange(start: t(useSec - fade), duration: t(fade)))
let mix = AVMutableAudioMix()
mix.inputParameters = [params]

guard export(bed, preset: AVAssetExportPresetAppleM4A, to: tmpAudio, fileType: .m4a, mix: mix) else { exit(1) }
print("✓ music bed rendered (AAC, faded)")

// ── pass 2: mux, video copied through untouched ──────────────────────────────
let final = AVMutableComposition()
let bedAsset = AVURLAsset(url: tmpAudio)
guard let vOut = final.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
      let aOut = final.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid),
      let bedSrc = bedAsset.tracks(withMediaType: .audio).first
else { exit(1) }
do {
  try vOut.insertTimeRange(CMTimeRange(start: .zero, duration: vDur), of: vSrc, at: .zero)
  vOut.preferredTransform = vSrc.preferredTransform // keep any rotation metadata
} catch {
  print("✗ video insert failed: \(error.localizedDescription)"); exit(1)
}
do {
  // Use the bed's OWN duration: AAC encoding lands on frame boundaries, so the
  // rendered file is a few ms shorter than requested and asking for the exact
  // requested range runs past its end.
  let bedRange = bedSrc.timeRange
  try aOut.insertTimeRange(CMTimeRange(start: bedRange.start, duration: CMTimeMinimum(bedRange.duration, vDur)), of: bedSrc, at: .zero)
} catch {
  print("✗ audio insert failed: \(error.localizedDescription)"); exit(1)
}

var ok = export(final, preset: AVAssetExportPresetPassthrough, to: outURL, fileType: .mp4, mix: nil)
if ok { print("✓ muxed with PASSTHROUGH — video re-encoded: no") } else {
  print("… passthrough refused, falling back to a re-encode")
  ok = export(final, preset: AVAssetExportPresetHighestQuality, to: outURL, fileType: .mp4, mix: nil)
  if ok { print("✓ muxed with HIGHEST QUALITY — video re-encoded: yes") }
}
try? FileManager.default.removeItem(at: tmpAudio)
guard ok else { exit(1) }

// ── verify the output rather than trusting the exporter ──────────────────────
let check = AVURLAsset(url: outURL)
let cv = check.tracks(withMediaType: .video).first
let ca = check.tracks(withMediaType: .audio).first
let size = (try? FileManager.default.attributesOfItem(atPath: outURL.path)[.size] as? Int) ?? 0
print("""

result: \(outURL.path)
  duration : \(String(format: "%.1f", CMTimeGetSeconds(check.duration)))s
  video    : \(cv != nil ? "\(Int(cv!.naturalSize.width))x\(Int(cv!.naturalSize.height)) @ \(String(format: "%.0f", cv!.nominalFrameRate))fps" : "MISSING")
  audio    : \(ca != nil ? "present" : "MISSING")
  size     : \(String(format: "%.1f", Double(size ?? 0) / 1_048_576))MB
""")
