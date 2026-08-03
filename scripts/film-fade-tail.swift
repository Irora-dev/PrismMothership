// Fade the LAST N seconds of a video to black, as a standalone clip.
//
//   swift scripts/film-fade-tail.swift <video> <out.mp4> <fadeSeconds>
//
// Why a separate tail clip rather than fading the whole film: a video-composition
// opacity ramp forces a re-encode of every frame, and this footage has been kept
// passthrough all the way through the edit. So only the tail is encoded, and
// film-edit.swift then joins `video@0:(dur-fade)` + this clip — the body of the
// film is still copied, and just the final couple of seconds are re-encoded.
//
// Prints the exact cut point to use, so the join is not guesswork.
//
// The ramp is smoothstep-eased, matching stills-to-video.swift: a linear fade
// appears to hang at full brightness and then rush to black.

import AVFoundation
import CoreGraphics
import Foundation

let a = CommandLine.arguments
guard a.count >= 4 else {
  print("usage: swift scripts/film-fade-tail.swift <video> <out.mp4> <fadeSeconds>")
  exit(1)
}
let srcURL = URL(fileURLWithPath: a[1])
let outURL = URL(fileURLWithPath: a[2])
let FADE = Double(a[3]) ?? 2.0

let asset = AVURLAsset(url: srcURL)
guard let track = asset.tracks(withMediaType: .video).first else { print("✗ no video track"); exit(1) }
let dur = CMTimeGetSeconds(asset.duration)
guard FADE > 0, FADE < dur else { print("✗ fade must be > 0 and < the video's \(dur)s"); exit(1) }
let W = Int(track.naturalSize.width.rounded())
let H = Int(track.naturalSize.height.rounded())
let fps = track.nominalFrameRate > 0 ? Double(track.nominalFrameRate) : 60
let start = dur - FADE
let TS: CMTimeScale = 600

print(String(format: "source  : %.3fs  %dx%d @ %.2ffps", dur, W, H, fps))
print(String(format: "fading  : %.3f → %.3f  (%.3fs)", start, dur, FADE))

// ── read just the tail ────────────────────────────────────────────────────────
let reader = try AVAssetReader(asset: asset)
reader.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: TS), duration: CMTime(seconds: FADE + 0.5, preferredTimescale: TS))
let rout = AVAssetReaderTrackOutput(track: track, outputSettings: [
  kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
])
rout.alwaysCopiesSampleData = false
reader.add(rout)
reader.startReading()

// ── write the faded tail, matching the source's geometry and rate ─────────────
try? FileManager.default.removeItem(at: outURL)
let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
let win = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 22_000_000,
    AVVideoMaxKeyFrameIntervalKey: Int(fps.rounded()),
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
  ],
])
win.expectsMediaDataInRealTime = false
let ad = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: win, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
  kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
])
writer.add(win)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

var firstPTS: Double? = nil
var written = 0
var lastAlpha = 1.0

while let sb = rout.copyNextSampleBuffer() {
  guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
  let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb))
  if firstPTS == nil { firstPTS = pts }
  let rel = pts - (firstPTS ?? pts)
  if rel > FADE { break }                       // past the fade — the film ends here
  let t = min(1, max(0, rel / FADE))            // 0 → 1 across the fade
  let alpha = 1 - (t * t * (3 - 2 * t))         // smoothstep, full → black
  lastAlpha = alpha

  guard let pool = ad.pixelBufferPool else { print("✗ no pixel buffer pool"); exit(1) }
  var outPB: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, pool, &outPB)
  guard let dst = outPB else { exit(1) }

  // draw the decoded frame onto black at the ramped alpha
  CVPixelBufferLockBaseAddress(pb, .readOnly)
  CVPixelBufferLockBaseAddress(dst, [])
  if let sbase = CVPixelBufferGetBaseAddress(pb), let dbase = CVPixelBufferGetBaseAddress(dst) {
    let sw = CVPixelBufferGetWidth(pb), sh = CVPixelBufferGetHeight(pb)
    let sstride = CVPixelBufferGetBytesPerRow(pb)
    let bitmap = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    if let sctx = CGContext(data: sbase, width: sw, height: sh, bitsPerComponent: 8, bytesPerRow: sstride,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: bitmap),
       let img = sctx.makeImage(),
       let dctx = CGContext(data: dbase, width: W, height: H, bitsPerComponent: 8,
                            bytesPerRow: CVPixelBufferGetBytesPerRow(dst),
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: bitmap) {
      dctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
      dctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
      dctx.setAlpha(CGFloat(alpha))
      dctx.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H))
    }
  }
  CVPixelBufferUnlockBaseAddress(dst, [])
  CVPixelBufferUnlockBaseAddress(pb, .readOnly)

  while !win.isReadyForMoreMediaData { usleep(2000) }
  ad.append(dst, withPresentationTime: CMTime(value: CMTimeValue(Double(written) * Double(TS) / fps), timescale: TS))
  written += 1
}

win.markAsFinished()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
guard writer.status == .completed else {
  print("✗ write failed: \(writer.error?.localizedDescription ?? "?")"); exit(1)
}

let check = AVURLAsset(url: outURL)
print("""

result: \(outURL.path)
  frames     : \(written) (\(String(format: "%.3f", CMTimeGetSeconds(check.duration)))s)
  ends at    : alpha \(String(format: "%.4f", lastAlpha)) — \(lastAlpha < 0.02 ? "black ✓" : "⚠ NOT black")

next: join the untouched body to this tail —
  swift scripts/film-edit.swift <out-master.mp4> "\(srcURL.path)@0:\(String(format: "%.3f", start))" "\(outURL.path)"
""")
