// SPDX-License-Identifier: Apache-2.0
import AppKit
import ApplicationServices
import MacPanelPlatform

// Synthetic native-only harness; it never enables the general clipboard.
// --measure opens only this panel, for eight seconds, then terminates.
// --self-test is headless and uses a private pasteboard.
func require(_ value: @autoclosure () -> Bool, _ message: String) {
    if !value() { fputs("FAIL: \(message)\n", stderr); exit(1) }
}
if CommandLine.arguments.contains("--preflight") {
    // Read-only checks: never trigger a TCC prompt or request a grant.
    let result: [String: Any] = [
        "screenRecordingAllowed": CGPreflightScreenCaptureAccess(),
        "accessibilityTrusted": AXIsProcessTrusted(),
        "requestedPermissions": false,
        "capturedFrames": 0,
    ]
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}
if CommandLine.arguments.contains("--self-test") {
    let history = ClipboardHistory(capacity: 2)
    history.setEnabled(true, changeCount: 0)
    for (count, marker) in ClipboardHistory.ignoredTypes.sorted().enumerated() {
        history.observe(changeCount: count + 1, types: [marker], source: nil) {
            fputs("FAIL: concealed content read\n", stderr); exit(1)
        }
    }
    require(history.items.isEmpty, "concealed items excluded")
    let board = NSPasteboard.withUniqueName()
    let watcher = ClipboardWatcher(pasteboard: board)
    watcher.setEnabled(true)
    board.clearContents()
    board.setString("synthetic clipboard", forType: .string)
    watcher.poll()
    require(watcher.history.items == ["synthetic clipboard"], "private clipboard recorded")
    watcher.setEnabled(false)
    require(watcher.history.items.isEmpty, "disable clears history")
    board.releaseGlobally()
    print("PASS: five concealed/transient markers rejected before text read; private pasteboard recorded; disable cleared history")
    exit(0)
}
guard CommandLine.arguments.contains("--measure") else {
    print("Usage: mac-panel-native --self-test | --preflight | --measure"); exit(2)
}
// No permission request, unlock, focus injection or input-method change.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = NSViewController()
let view = NSView(frame: NSRect(x: 0, y: 0, width: 680, height: 460))
view.wantsLayer = true
view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
let label = NSTextField(labelWithString: "LINA · Native panel measurement\nSynthetic content · Clipboard disabled\nThis panel closes automatically.")
label.frame = NSRect(x: 40, y: 170, width: 600, height: 120)
label.font = .systemFont(ofSize: 23)
view.addSubview(label)
controller.view = view
let host = PanelHost(content: controller)
let shortcut = try GlobalShortcut()
try shortcut.register(.initial)
shortcut.onPress = { time in host.toggle(startedAt: time) }
PanelMeasurement.run(host: host, flutterLoaded: false)
app.run()
