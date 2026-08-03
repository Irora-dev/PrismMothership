// make-boomerang.swift — render a forward+reversed "boomerang" video so the
// browser's native <video loop> plays a seamless ping-pong (the JS reverse
// scrub judders by construction: decoders seek keyframes badly backward).
//
//   swift scripts/make-boomerang.swift <in.mp4> <out.mp4> [bitrateMbps]
//
// Method: decode ALL frames once (AVAssetReader, sequential — the only fast
// decode path), keep them as pixel buffers, then write forward + reversed
// (skipping the duplicated apex + seam frames) at the source's fps/geometry.
// Memory: frames are held decoded — fine for short hero clips (~5s); refuse
// inputs that would balloon past ~2.5GB rather than silently thrashing.

import AVFoundation
import CoreVideo
import Foundation

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write(("error: " + msg + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: make-boomerang.swift <in.mp4> <out.mp4> [bitrateMbps]") }
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let bitrateMbps = args.count > 3 ? Double(args[3]) ?? 10 : 10

let asset = AVURLAsset(url: inURL)
guard let track = asset.tracks(withMediaType: .video).first else { fail("no video track") }
let size = track.naturalSize.applying(track.preferredTransform)
let W = Int(abs(size.width)), H = Int(abs(size.height))
let fps = track.nominalFrameRate > 0 ? Double(track.nominalFrameRate) : 30
let durationSec = CMTimeGetSeconds(asset.duration)
let estFrames = Int(durationSec * fps)
let estBytes = estFrames * W * H * 4
guard estBytes < 2_500_000_000 else { fail("clip too large to buffer (\(estFrames) frames @ \(W)x\(H) ≈ \(estBytes / 1_000_000)MB) — trim it first") }

// ── decode every frame ────────────────────────────────────────────────────────
guard let reader = try? AVAssetReader(asset: asset) else { fail("reader init") }
let readOut = AVAssetReaderTrackOutput(
  track: track,
  outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
)
readOut.alwaysCopiesSampleData = false
reader.add(readOut)
reader.startReading()

var frames: [CVPixelBuffer] = []
frames.reserveCapacity(estFrames + 8)
while let sb = readOut.copyNextSampleBuffer() {
  guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
  // deep-copy: the reader recycles its pool buffers
  var copy: CVPixelBuffer?
  CVPixelBufferCreate(nil, CVPixelBufferGetWidth(pb), CVPixelBufferGetHeight(pb), CVPixelBufferGetPixelFormatType(pb), CVBufferGetAttachments(pb, .shouldPropagate), &copy)
  guard let dst = copy else { fail("pixel buffer alloc") }
  CVPixelBufferLockBaseAddress(pb, .readOnly)
  CVPixelBufferLockBaseAddress(dst, [])
  for plane in 0..<max(1, CVPixelBufferGetPlaneCount(pb)) {
    let src = CVPixelBufferGetPlaneCount(pb) == 0 ? CVPixelBufferGetBaseAddress(pb) : CVPixelBufferGetBaseAddressOfPlane(pb, plane)
    let dstP = CVPixelBufferGetPlaneCount(pb) == 0 ? CVPixelBufferGetBaseAddress(dst) : CVPixelBufferGetBaseAddressOfPlane(dst, plane)
    let hgt = CVPixelBufferGetPlaneCount(pb) == 0 ? CVPixelBufferGetHeight(pb) : CVPixelBufferGetHeightOfPlane(pb, plane)
    let bpr = CVPixelBufferGetPlaneCount(pb) == 0 ? CVPixelBufferGetBytesPerRow(pb) : CVPixelBufferGetBytesPerRowOfPlane(pb, plane)
    memcpy(dstP, src, hgt * bpr)
  }
  CVPixelBufferUnlockBaseAddress(dst, [])
  CVPixelBufferUnlockBaseAddress(pb, .readOnly)
  frames.append(dst)
}
guard reader.status == .completed, frames.count > 2 else { fail("decode failed (\(frames.count) frames, status \(reader.status.rawValue))") }
print("decoded \(frames.count) frames @ \(W)x\(H) \(String(format: "%.2f", fps))fps")

// ── write forward + reversed ──────────────────────────────────────────────────
try? FileManager.default.removeItem(at: outURL)
guard let writer = try? AVAssetWriter(outputURL: outURL, fileType: .mp4) else { fail("writer init") }
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: W,
  AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: Int(bitrateMbps * 1_000_000),
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoMaxKeyFrameIntervalKey: Int(fps * 2),
  ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

// forward 0..N-1, then N-2..1 — the apex and the seam frame each appear once,
// so the loop point (last→first) is the same motion step as everywhere else
var sequence = Array(0..<frames.count)
sequence += stride(from: frames.count - 2, through: 1, by: -1)

let frameDur = CMTime(value: 1, timescale: CMTimeScale(round(fps * 1000)) )
let scale = CMTimeScale(round(fps * 1000))
var idx = 0
let sema = DispatchSemaphore(value: 0)
input.requestMediaDataWhenReady(on: DispatchQueue(label: "boom.write")) {
  while input.isReadyForMoreMediaData {
    if idx >= sequence.count {
      input.markAsFinished()
      sema.signal()
      return
    }
    let t = CMTime(value: CMTimeValue(idx * 1000), timescale: scale)
    if !adaptor.append(frames[sequence[idx]], withPresentationTime: t) {
      FileHandle.standardError.write("append failed at \(idx): \(String(describing: writer.error))\n".data(using: .utf8)!)
      input.markAsFinished()
      sema.signal()
      return
    }
    idx += 1
  }
}
sema.wait()
_ = frameDur // silence unused in release paths
writer.finishWriting {
  if writer.status == .completed {
    let sz = (try? FileManager.default.attributesOfItem(atPath: outURL.path)[.size] as? Int) ?? 0
    print("wrote \(sequence.count) frames → \(outURL.lastPathComponent) (\((sz ?? 0) / 1_000_000)MB)")
  } else {
    fail("finish failed: \(String(describing: writer.error))")
  }
  exit(writer.status == .completed ? 0 : 1)
}
RunLoop.main.run()
