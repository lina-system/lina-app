// SPDX-License-Identifier: Apache-2.0
import AppKit
import ApplicationServices
import CoreGraphics

/// Manual, narrowly-scoped stimulus for the mac-panel timing study.
/// Clicking the control posts exactly one PanelMeasurementChord through the
/// existing authorized probe. The panel registers that same shared chord in
/// measurement mode. It never requests a permission or types text.
final class PanelShortcutControl: NSObject {
  private let window = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 620, height: 300),
                                styleMask: [.titled, .closable], backing: .buffered, defer: false)
  private var count = 0
  private let label = NSTextField(labelWithString: "No shortcuts sent")

  func run() {
    guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
      fail("panel-shortcut needs the probe's existing Accessibility grant; no grant requested", 3)
    }
    guard unlocked() else { fail("panel-shortcut refused: screen locked or state unknown", 3) }
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    window.title = "LINA Probe — panel shortcut stimulus"
    window.isReleasedWhenClosed = false
    let text = NSTextField(labelWithString: "Synthetic foreground fixture\nSend one \(PanelMeasurementChord.name) chord per recorder-ready event.")
    text.frame = NSRect(x: 30, y: 175, width: 560, height: 80)
    let button = NSButton(title: "Send panel shortcut", target: self, action: #selector(send))
    button.frame = NSRect(x: 30, y: 110, width: 250, height: 40)
    label.frame = NSRect(x: 30, y: 65, width: 540, height: 30)
    for view in [text, button, label] { window.contentView?.addSubview(view) }
    window.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps: true)
    _ = Timer.scheduledTimer(withTimeInterval: 180, repeats: false) { _ in finish(0) }
    print("LINA_PROBE_SHORTCUT_READY")
    fflush(stdout)
    app.run()
    finish(0)
  }

  private func unlocked() -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/ioreg")
    process.arguments = ["-l", "-d", "1"]
    let pipe = Pipe()
    process.standardOutput = pipe
    do {
      try process.run()
      let data = pipe.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()
      return process.terminationStatus == 0 && String(data: data, encoding: .utf8)?.contains("\"IOConsoleLocked\" = No") == true
    } catch { return false }
  }

  @objc private func send() {
    guard count < 10, unlocked(), AXIsProcessTrusted(), CGPreflightPostEventAccess(),
          NSWorkspace.shared.runningApplications.contains(where: { $0.bundleIdentifier == "org.lina.spike.macPanel" }) else {
      label.stringValue = "Refused: recorder absent, locked session, missing access, or ten sent"
      return
    }
    let key = CGKeyCode(PanelMeasurementChord.keyCode)
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false) else { return }
    down.flags = PanelMeasurementChord.cgEventFlags
    up.flags = PanelMeasurementChord.cgEventFlags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
    count += 1
    label.stringValue = "Sent \(count) of 10 \(PanelMeasurementChord.name) chords"
    print("LINA_PROBE_SHORTCUT_SENT \(count)")
    fflush(stdout)
    if count == 10 { DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish(0) } }
  }
}
