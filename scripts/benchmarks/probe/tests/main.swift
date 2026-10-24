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
