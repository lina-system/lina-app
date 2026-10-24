// SPDX-License-Identifier: Apache-2.0
// LINA Probe: the one stable, signed executable that receives the macOS
// Accessibility and Screen Recording grants for the launcher baseline (#91).
// Launch it through run.sh so the app itself, not a shell or sshd, is the
// responsible process that TCC checks. Recorder commands belong in this
// target; do not wrap them in another app or sign them with another identity.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct Status: Codable {
  let command: String
  let accessibility: Bool
  let screenRecording: Bool
  let bundleID: String
  let executable: String
  let pid: Int32
  let checkedAt: String

  enum CodingKeys: String, CodingKey {
    case command, accessibility, pid, executable
    case screenRecording = "screen_recording"
    case bundleID = "bundle_id"
    case checkedAt = "checked_at"
  }
}

var exitFile: String?

func finish(_ code: Int32) -> Never {
  if let path = exitFile {
    try? "\(code)\n".write(toFile: path, atomically: true, encoding: .utf8)
  }
  exit(code)
}

func fail(_ message: String, _ code: Int32 = 64) -> Never {
  FileHandle.standardError.write(Data("lina-probe: \(message)\n".utf8))
  finish(code)
}

func supportDirectory() -> URL {
  let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
  return base.appendingPathComponent("LINA Probe", isDirectory: true)
}

func currentStatus(_ command: String) -> Status {
  let iso = ISO8601DateFormatter()
  iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return Status(
    command: command,
    accessibility: AXIsProcessTrusted(),
    screenRecording: CGPreflightScreenCaptureAccess(),
    bundleID: Bundle.main.bundleIdentifier ?? "",
    executable: Bundle.main.executablePath ?? CommandLine.arguments[0],
    pid: getpid(),
    checkedAt: iso.string(from: Date()))
}

func write(_ status: Status, to path: String?) {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  guard let data = try? encoder.encode(status) else { fail("cannot encode status", 70) }
  let url = path.map { URL(fileURLWithPath: $0) }
    ?? supportDirectory().appendingPathComponent("status.json")
  do {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: .atomic)
  } catch {
    fail("cannot write \(url.path): \(error)", 73)
  }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

let usage = """
  usage: LINA Probe [--exit-file PATH] status|request|panel-shortcut|manifest|snapshot|prepare|pilot [--out PATH] [--config PATH] [--launcher spotlight|raycast]
    status   write accessibility/screen_recording grant state; exit 0 when both are granted, 3 otherwise
    request  ask macOS for both grants (adds LINA Probe to both Privacy lists), then write status
  """

var args = Array(CommandLine.arguments.dropFirst())
if args.first == "--exit-file" {
  guard args.count >= 2 else { fail(usage) }
  exitFile = args[1]
  args.removeFirst(2)
}
// LaunchServices may add a process serial number argument on older systems.
args.removeAll { $0.hasPrefix("-psn_") }
let command = args.first ?? "status"
var out: String?
var configPath: String?
var launcher = "spotlight"
var rest = Array(args.dropFirst())
while !rest.isEmpty {
  let flag = rest.removeFirst()
  switch flag {
  case "--config":
    guard !rest.isEmpty else { fail(usage) }
    configPath = rest.removeFirst()
  case "--launcher":
    guard !rest.isEmpty else { fail(usage) }
    launcher = rest.removeFirst()
  case "--out":
    guard !rest.isEmpty else { fail(usage) }
    out = rest.removeFirst()
  default:
    fail("unknown option \(flag)\n\(usage)")
  }
}

if ["manifest", "snapshot", "prepare", "pilot"].contains(command) {
  let status = currentStatus(command)
  guard status.accessibility && status.screenRecording else { fail("both grants required", 3) }
  NSApplication.shared.setActivationPolicy(.prohibited)
  Task {
    do {
      switch command {
      case "pilot":
        guard let configPath else { throw ProbeError.message("pilot requires --config PATH") }
        try await runPilot(URL(fileURLWithPath: configPath))
      case "prepare": try await preparePilot(launcher)
      default:
        let dir = try privateAttempt(command)
        try sessionManifest(dir)
        if command == "snapshot" { try await screenshot(dir) }
        print("Private evidence: \(dir.path)")
      }
      finish(0)
    } catch { fail(String(describing: error), 1) }
  }
  dispatchMain()
}

switch command {
case "panel-shortcut":
  let control = PanelShortcutControl()
  withExtendedLifetime(control) { control.run() }
case "status":
  break
case "request":
  let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
  _ = AXIsProcessTrustedWithOptions(options)
  if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
  // Give tccd time to register the request before the process exits.
  Thread.sleep(forTimeInterval: 2)
case "-h", "--help", "help":
  print(usage)
  finish(0)
default:
  fail("unknown command \(command)\n\(usage)")
}

let status = currentStatus(command)
write(status, to: out)
finish(status.accessibility && status.screenRecording ? 0 : 3)
