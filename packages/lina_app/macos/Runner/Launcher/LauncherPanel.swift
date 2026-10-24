// SPDX-License-Identifier: Apache-2.0
import AppKit

public final class LauncherPanel: NSPanel {
    public override var canBecomeKey: Bool { true }
    public override var canBecomeMain: Bool { false }
    public var onDismiss: (() -> Void)?
    public var onSettings: (() -> Void)?

    public init(content: NSViewController) {
        super.init(contentRect: NSRect(x: 0, y: 0, width: LinaAppTokens.launcherWidth,
                                      height: LinaAppTokens.launcherHeight),
                   styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        title = "LINA Launcher"
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
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        tabbingMode = .disallowed
        isMovableByWindowBackground = true
        isExcludedFromWindowsMenu = true
        // Opaque token surface until the system-material work in #32.
        isOpaque = true
        backgroundColor = LinaTokens.Color.canvas
        contentViewController = content
    }

    public override func cancelOperation(_ sender: Any?) { onDismiss?() }
    public override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.intersection([.command, .control, .option, .shift]) == .command {
            if event.charactersIgnoringModifiers == "," { onSettings?(); return true }
            if event.charactersIgnoringModifiers == "q" { NSApp.terminate(nil); return true }
        }
        return super.performKeyEquivalent(with: event)
    }
}

public enum PanelPlacement {
    public static func origin(size: NSSize, within frame: NSRect, saved: NSPoint?) -> NSPoint {
        let point = saved ?? NSPoint(x: frame.midX - size.width / 2, y: frame.midY - size.height / 2)
        return NSPoint(x: max(frame.minX, min(point.x, frame.maxX - size.width)),
                       y: max(frame.minY, min(point.y, frame.maxY - size.height)))
    }
}

public final class LauncherPanelHost: NSObject, NSWindowDelegate {
    public let panel: LauncherPanel
    public private(set) var ready = false
    public private(set) var showRequested = false
    public var onChange: (() -> Void)?
    private let focusView: NSView
    private let defaults: UserDefaults?
    private var displayKey: String?
    private var monitors: [Any] = []
    private var observers: [NSObjectProtocol] = []
    private var positioning = false

    public init(content: NSViewController, focusView: NSView, defaults: UserDefaults? = nil) {
        self.focusView = focusView
        self.defaults = defaults
        panel = LauncherPanel(content: content)
        super.init()
        panel.delegate = self
        panel.onDismiss = { [weak self] in self?.hide() }
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.hide() })
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.hide() })
        observers.append(DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main
        ) { [weak self] _ in self?.hide() })
    }
    deinit {
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        for observer in observers {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
            DistributedNotificationCenter.default().removeObserver(observer)
        }
    }
    public func markReady() {
        guard !ready else { return }
        ready = true
        if showRequested { show() }
        onChange?()
    }
    public func toggle() { if panel.isVisible || showRequested { hide() } else { show() } }
    public func show() {
        showRequested = true
        guard ready, !panel.isVisible else { return }
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        if let screen {
            displayKey = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)
                .map { "launcher.position.\($0)" }
            let saved = displayKey.flatMap { defaults?.string(forKey: $0) }.map(NSPointFromString)
            positioning = true
            panel.setFrameOrigin(PanelPlacement.origin(size: panel.frame.size, within: screen.visibleFrame, saved: saved))
            positioning = false
        }
        // The key panel takes keyboard focus without activating its application.
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(focusView)
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown], handler: { [weak self] _ in self?.hide() }) {
            monitors.append(global)
        }
        if let local = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown], handler: { [weak self] event in
            if let self, event.window !== self.panel { self.hide() }
            return event
        }) { monitors.append(local) }
        onChange?()
    }
    public func hide() {
        showRequested = false
        panel.orderOut(nil)
        for monitor in monitors { NSEvent.removeMonitor(monitor) }
        monitors.removeAll()
        // Never reactivate the former app: an outside click may choose a new one.
        onChange?()
    }
    public func windowDidResignKey(_ notification: Notification) { hide() }
    public func windowDidMove(_ notification: Notification) {
        guard !positioning, panel.isVisible, let displayKey else { return }
        defaults?.set(NSStringFromPoint(panel.frame.origin), forKey: displayKey)
    }
}
