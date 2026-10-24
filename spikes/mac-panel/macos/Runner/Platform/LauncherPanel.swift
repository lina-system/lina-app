// SPDX-License-Identifier: Apache-2.0
import AppKit
import QuartzCore

public final class LauncherPanel: NSPanel {
    public override var canBecomeKey: Bool { true }
    public override var canBecomeMain: Bool { false }
    public var onDismiss: (() -> Void)?

    public init(content: NSViewController) {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 680, height: 460),
                   styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        title = "LINA Panel Spike"
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            standardWindowButton(button)?.isHidden = true
        }
        isReleasedWhenClosed = false
        isFloatingPanel = true
        becomesKeyOnlyIfNeeded = false
        hidesOnDeactivate = false
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isOpaque = false
        backgroundColor = .clear
        contentViewController = content
    }

    public override func cancelOperation(_ sender: Any?) { onDismiss?() }
}

public final class PanelHost {
    public let panel: LauncherPanel
    public var onChange: (() -> Void)?
    public private(set) var lastOrderMs: Double?
    public private(set) var originalAppStayedActive: Bool?
    public private(set) var originalAppWasExternal: Bool?
    private var outsideMonitor: Any?
    private var localMonitor: Any?
    private var originalPID: pid_t?
    private weak var focusView: NSView?

    public init(content: NSViewController, focusView: NSView? = nil) {
        panel = LauncherPanel(content: content)
        self.focusView = focusView ?? content.view
        panel.onDismiss = { [weak self] in self?.hide() }
    }
    deinit {
        if let outsideMonitor { NSEvent.removeMonitor(outsideMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
    }

    /// Timestamp starts at the Carbon event when called from the shortcut.
    /// This measures ordering, NOT photons/display presentation.
    public func toggle(startedAt: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        if panel.isVisible { hide() } else { show(startedAt: startedAt) }
    }

    public func show(startedAt: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        guard !panel.isVisible else { return }
        originalPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        originalAppWasExternal = originalPID.map { $0 != ProcessInfo.processInfo.processIdentifier }
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        if let frame = screen?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: frame.midX - panel.frame.width / 2,
                                         y: frame.midY - panel.frame.height / 2))
        }
        // Never activate NSApp or reactivate a previous application on dismissal.
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(focusView)
        lastOrderMs = (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000
        originalAppStayedActive = NSWorkspace.shared.frontmostApplication?.processIdentifier == originalPID
        outsideMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) {
            [weak self] _ in self?.hide()
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) {
            [weak self] event in
            if let self, event.window !== self.panel { self.hide() }
            return event
        }
        onChange?()
    }

    public func hide() {
        panel.orderOut(nil)
        if let outsideMonitor { NSEvent.removeMonitor(outsideMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        outsideMonitor = nil
        localMonitor = nil
        onChange?()
    }
}

/// In-process ordering proxy, deliberately separate from visible-frame latency.
/// No keyboard injection, clipboard access, or other app activation.
public enum PanelMeasurement {
    public static func run(host: PanelHost, flutterLoaded: Bool) {
        var samples: [Double] = []
        var retained: [Bool] = []
        var keyed: [Bool] = []
        var iteration = 0
        let originalPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        _ = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { timer in
            if iteration == 20 {
                timer.invalidate()
                host.hide()
                var info = mach_task_basic_info()
                var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
                let status = withUnsafeMutablePointer(to: &info) { pointer in
                    pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
                    }
                }
                let result: [String: Any] = [
                    "kind": flutterLoaded ? "flutter-panel-ordering-proxy" : "native-only-ordering-proxy",
                    "samplesMs": samples, "frontmostUnchanged": retained.allSatisfy { $0 },
                    "originalAppWasExternal": originalPID != ProcessInfo.processInfo.processIdentifier,
                    "panelBecameKey": keyed.allSatisfy { $0 },
                    "frontmostUnchangedAfterHide": NSWorkspace.shared.frontmostApplication?.processIdentifier == originalPID,
                    "rssBytes": status == KERN_SUCCESS ? info.resident_size : 0,
                    "rssStatus": status == KERN_SUCCESS ? "measured" : "unverified",
                    "hotkeyRegistration": "passed", "physicalShortcut": "unverified",
                    "visiblePresentationLatency": "unverified", "flutterEngineLoaded": flutterLoaded,
                    "os": ProcessInfo.processInfo.operatingSystemVersionString,
                ]
                do {
                    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                    print("LINA_PANEL_METRICS " + String(data: data, encoding: .utf8)!)
                } catch { fputs("Measurement output failed: \(error)\n", stderr) }
                NSApp.terminate(nil)
                return
            }
            if iteration.isMultiple(of: 2) {
                host.show()
                samples.append(host.lastOrderMs!)
                retained.append(host.originalAppStayedActive == true)
                keyed.append(host.panel.isKeyWindow)
            } else { host.hide() }
            iteration += 1
        }
    }
}
