// SPDX-License-Identifier: Apache-2.0
import Foundation

struct HostClock: Codable {
  let numerator: UInt32
  let denominator: UInt32

  func nanoseconds(_ ticks: UInt64) -> UInt64 {
    // Split first: multiplying a long-running host's raw ticks can overflow.
    let divisor = UInt64(denominator)
    return (ticks / divisor) * UInt64(numerator)
      + ((ticks % divisor) * UInt64(numerator)) / divisor
  }
  func milliseconds(from: UInt64, to: UInt64) -> Double {
    Double(to >= from ? nanoseconds(to - from) : 0) / 1_000_000
  }
}

struct PostedKey: Codable {
  let code: UInt16
  let down: Bool
  let flags: UInt64
  let before: UInt64
  let after: UInt64
}

struct RecordedFrame: Codable {
  let index: Int
  var displayTicks: UInt64?
  let status: Int
  var width: Int = 0
  var height: Int = 0
  var bytesPerRow: Int = 0
  var file: String?
  var persistedFrom: Int?
  var sha256: String?
  var contentRect: [Double]?
  var contentScale: Double?
  var scaleFactor: Double?
  var receivedTicks: UInt64 = 0
  var panelChanged: Bool?
  var changedFraction: Double?
  var fieldText: String?
  var resultText: String?
  var resultConfidence: Double?
}

struct ProcessSample: Codable {
  let pid: Int32
  let parentPid: Int32
  let role: String
  let executable: String
  let residentBytes: UInt64?
  let sampledTicks: UInt64
}
struct RSSSample: Codable {
  let requestedTicks: UInt64
  let startedTicks: UInt64
  let finishedTicks: UInt64
  let complete: Bool
  let processes: [ProcessSample]
  let sharedServices: [ProcessSample]
  var unattributedHelpers: [ProcessSample] = []
}
struct CaptureSettings: Codable {
  var refreshHz: Double = 60
  var sourceRect: [Double] = []
  var pixelWidth: Int = 0
  var pixelHeight: Int = 0
  var minimumFrameInterval: String = "zero"
  var queueLimit: Int = 4
  var coordinateSystem: String = "display-local top-left points; ROIs are capture-local pixels"
}
struct TrialRecord: Codable {
  var schemaVersion = 1
  let id: String
  let launcher: String
  let layout: String
  var gapMs: Int
  let clock: HostClock
  var classification = "personal-login-pilot"
  var expectedResult = "Safari"
  var expectedField = "safari"
  var keys: [PostedKey] = []
  var frames: [RecordedFrame] = []
  var faults: [String] = []
  var rss: RSSSample?
  var capture = CaptureSettings()
  var setup: [String: String] = [:]
  var deadlineTicks: UInt64?
  var endTicks: UInt64?
  var actualKeyGapsMs: [Double] = []
  var hotkeyToFirstKeyMs: Double?
  var recognition: [String: String] = [:]
  var cadence: [String: String] = [:]
  var keyLossStatus = "unknown_requires_field_and_physical_sequence_inspection"
  var compositionFaults: [String] = []
  var substitutionFaults: [String] = []

  init(id: String, launcher: String, layout: String, gapMS: Int, clock: HostClock) {
    self.id = id; self.launcher = launcher; self.layout = layout
    self.gapMs = gapMS; self.clock = clock
  }
}

struct PilotConfig: Codable {
  var launcher: String
  var layout: String
  var gapMs: Int
  var sourceRect: [Double]
  var fieldRect: [Double]
  var resultRect: [Double]
  var panelRect: [Double]
  var expectedResult: String
  var inputSourceId: String
  var neutralBundleId: String
  var shortcutOwnership: String
  var refreshHz: Double
  var pixelDelta: Int
  var changedFraction: Double

  func validate() throws {
    func validRect(_ values: [Double]) -> Bool {
      guard values.count == 4 else { return false }
      for value in values {
        guard value.isFinite && value >= 0 else { return false }
      }
      return values[2] > 0 && values[3] > 0
    }
    // Keep the expressions small for the older Swift compiler on macOS CI.
    guard validRect(sourceRect), validRect(panelRect), validRect(fieldRect), validRect(resultRect) else {
      throw ProbeError.message("invalid frozen capture rectangle")
    }
    guard sourceRect[2] * sourceRect[3] <= 1_000_000,
          ["spotlight", "raycast"].contains(launcher),
          ["abc", "korean-2-set"].contains(layout), [0, 8, 30].contains(gapMs),
          refreshHz.isFinite, refreshHz >= 24, refreshHz <= 240,
          (1...255).contains(pixelDelta), changedFraction > 0, changedFraction <= 1,
          !expectedResult.isEmpty, !shortcutOwnership.isEmpty else {
      throw ProbeError.message("invalid frozen pilot configuration")
    }
    let expectedSource = layout == "abc" ? "com.apple.keylayout.ABC" : "com.apple.inputmethod.Korean.2SetKorean"
    let unsafeNeutral = ["com.apple.loginwindow", "com.apple.Spotlight", "com.raycast.macos"]
    guard inputSourceId == expectedSource, !neutralBundleId.isEmpty, !unsafeNeutral.contains(neutralBundleId) else {
      throw ProbeError.message("invalid input source or neutral app")
    }
  }
}

enum ProbeError: Error {
  case message(String)
}

extension JSONEncoder {
  static var probe: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    encoder.keyEncodingStrategy = .convertToSnakeCase
    return encoder
  }
}
extension JSONDecoder {
  static var probe: JSONDecoder {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return decoder
  }
}

struct ProcessIdentity {
  let pid: Int32
  let parentPid: Int32
  let executable: String
}

func attributedPIDs(_ processes: [ProcessIdentity], bundlePath: String, mainPIDs: Set<Int32>) -> Set<Int32> {
  var result = mainPIDs.union(processes.filter { $0.executable.hasPrefix(bundlePath + "/") }.map(\.pid))
  var previous = Set<Int32>()
  while previous != result {
    previous = result
    result.formUnion(processes.filter { result.contains($0.parentPid) }.map(\.pid))
  }
  return result
}

func requireUnlockedSession(locked: Bool, frontBundle: String?) throws {
  guard !locked, let frontBundle, frontBundle != "com.apple.loginwindow" else {
    throw ProbeError.message("desktop_locked_or_unavailable; no key posting or capture")
  }
}
