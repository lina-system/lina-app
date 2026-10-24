// SPDX-License-Identifier: Apache-2.0
import Foundation

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
  if !condition() { fatalError(message) }
}
let clock = HostClock(numerator: 125, denominator: 3)
check(clock.nanoseconds(3) == 125, "mach ticks must use numerator / denominator")
check(clock.nanoseconds(24_000_000_000) == 1_000_000_000_000, "large uptime precision")
check(clock.milliseconds(from: 240, to: 240_240) == 10, "relative clock conversion")
check(clock.nanoseconds(1) == 41, "integer rounding")
let key = PostedKey(code: 49, down: true, flags: 1_048_576, before: 240, after: 241)
let frame = RecordedFrame(index: 0, displayTicks: 242, status: 0, width: 4, height: 2,
                          bytesPerRow: 16, file: "frames/000000.bgra")
var trial = TrialRecord(id: "fixture", launcher: "spotlight", layout: "abc", gapMS: 30,
                        clock: clock)
trial.keys = [key]
trial.frames = [frame]
trial.faults = ["real_input"]
let data = try JSONEncoder.probe.encode(trial)
let decoded = try JSONDecoder.probe.decode(TrialRecord.self, from: data)
check(decoded.keys[0].before == 240, "posting instant survives trial JSON")
check(decoded.frames[0].displayTicks == 242, "raw frame timestamp survives trial JSON")
check(decoded.faults == ["real_input"], "failures are retained")
check(decoded.rss == nil, "missing RSS stays unknown")
check(String(data: data, encoding: .utf8)!.contains("display_ticks"), "portable snake_case schema")
print("Recorder model: 9 checks passed")

let processSet = [
  ProcessIdentity(pid: 1, parentPid: 0, executable: "/sbin/launchd"),
  ProcessIdentity(pid: 100, parentPid: 1, executable: "/Applications/Raycast.app/Contents/MacOS/Raycast"),
  ProcessIdentity(pid: 102, parentPid: 1, executable: "/Applications/Raycast.app/Contents/Frameworks/Helper"),
  ProcessIdentity(pid: 103, parentPid: 100, executable: "/usr/local/bin/node"),
  ProcessIdentity(pid: 104, parentPid: 103, executable: "/usr/local/bin/worker"),
  ProcessIdentity(pid: 105, parentPid: 1, executable: "/Applications/Raycast.app.other/Contents/Fake"),
]
check(attributedPIDs(processSet, bundlePath: "/Applications/Raycast.app", mainPIDs: [100]) == [100, 102, 103, 104],
      "reparented bundle helpers and recursive children, but not lookalike paths")
for state in [(true, "com.apple.finder" as String?), (false, "com.apple.loginwindow"), (false, nil)] {
  do {
    try requireUnlockedSession(locked: state.0, frontBundle: state.1)
    fatalError("unsafe session must be rejected")
  } catch {}
}
try requireUnlockedSession(locked: false, frontBundle: "com.apple.finder")
print("Process attribution and locked-session guard: 5 checks passed")

let config = PilotConfig(launcher: "spotlight", layout: "abc", gapMs: 30,
  sourceRect: [0, 0, 100, 100], fieldRect: [0, 0, 50, 10], resultRect: [0, 10, 50, 20],
  panelRect: [0, 0, 100, 100], expectedResult: "Safari", inputSourceId: "com.apple.keylayout.ABC",
  neutralBundleId: "com.apple.finder", shortcutOwnership: "synthetic fixture", refreshHz: 60,
  pixelDelta: 20, changedFraction: 0.02)
try config.validate()
for invalidRect in [[], [0, 0, 1], [0, 0, 0, 1], [0, 0, Double.nan, 1], [-1, 0, 1, 1]] {
  var invalid = config
  invalid.fieldRect = invalidRect
  do { try invalid.validate(); fatalError("invalid rectangle accepted") } catch {}
}
print("Frozen rectangle validation: 6 checks passed")

let approvedRegion: [Double] = [100, 200, 300, 50]
check(queryFieldIsApproved(["x": "100", "y": "200", "width": "300", "height": "50"], region: approvedRegion),
      "calibrated query field is approved")
check(!queryFieldIsApproved(["x": "800", "y": "200", "width": "300", "height": "50"], region: approvedRegion),
      "a rejected preference/onboarding field must never receive cleanup")
check(!queryFieldIsApproved(["x": "100", "y": "200", "width": "300", "height": "50"], region: nil),
      "uncalibrated attempts cannot clean up")
check(!queryFieldIsApproved(["x": "nan", "y": "200", "width": "300", "height": "50"], region: approvedRegion),
      "nonfinite geometry fails closed")
check(!queryFieldIsApproved(["x": "100", "y": "200", "width": "0", "height": "50"], region: approvedRegion),
      "empty geometry fails closed")
print("Query field approval: 5 checks passed")
