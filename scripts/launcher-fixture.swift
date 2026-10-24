// SPDX-License-Identifier: Apache-2.0
// A disposable app for focus evidence; never opens user documents.
import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 800, height: 550),
                      styleMask: [.titled], backing: .buffered, defer: false)
window.title = "LINA synthetic focus fixture"
window.isReleasedWhenClosed = false
let label = NSTextField(labelWithString: "Synthetic fixture — no user documents\nThe launcher must leave this app frontmost.")
label.frame = NSRect(x: 40, y: 230, width: 720, height: 90)
label.font = .systemFont(ofSize: 24)
window.contentView?.addSubview(label)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
var observer: NSObjectProtocol?
DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
    guard app.isActive else { print("LINA_FIXTURE_FAILED inactive"); fflush(stdout); app.terminate(nil); return }
    observer = NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification,
                                                       object: app, queue: .main) { _ in
        print("LINA_FIXTURE_DEACTIVATED"); fflush(stdout)
    }
    print("LINA_FIXTURE_READY \(getpid())"); fflush(stdout)
}
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { app.terminate(nil) }
app.run()
