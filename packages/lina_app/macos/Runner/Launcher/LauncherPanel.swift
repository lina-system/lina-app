// SPDX-License-Identifier: Apache-2.0
import AppKit

/// Sample accessibility on every open as well as on notifications. Never read
/// private preferences: NSGlassEffectView owns the system's Liquid Glass setting.
struct LauncherDisplaySettings {
    var reduceTransparency: Bool
    var increaseContrast: Bool

    static var current: Self {
        Self(reduceTransparency: NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency,
             increaseContrast: NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast)
    }
}

/// Keep the content (including the prewarmed answer view) attached throughout
/// appearance changes. Replacing its controller would lose first-frame readiness.
final class LauncherSurfaceView: NSView {
    let material: NSView
    let opaqueBacking = NSView()
    private let body = NSView()
    private let settings: () -> LauncherDisplaySettings

    init(content: NSView, settings: @escaping () -> LauncherDisplaySettings, useGlass: Bool) {
        self.settings = settings
        if #available(macOS 26.0, *), useGlass {
            let glass = NSGlassEffectView()
            glass.style = .regular
            // Fill the native titled panel: its system corner mask clips the
            // material and all children. Do not add a second, mismatched curve.
            glass.cornerRadius = 0
            // No tint or interactive glass: the system chooses the material,
            // and opening/closing remains static even under Reduce Motion.
            glass.contentView = body
            material = glass
        } else {
            // Public AppKit fallback on macOS 12–25 (also injectable in tests).
            let effect = NSVisualEffectView()
            effect.material = .hudWindow
            effect.blendingMode = .behindWindow
            effect.state = .active // a non-activating panel must not look inactive
            effect.addSubview(body)
            material = effect
        }
        super.init(frame: content.frame)
        for child in [material, body, opaqueBacking, content] {
            child.frame = bounds
            child.autoresizingMask = [.width, .height]
        }
        addSubview(material)
        body.addSubview(opaqueBacking)
        body.addSubview(content)
        opaqueBacking.wantsLayer = true
    }
    required init?(coder: NSCoder) { fatalError("Use init(content:settings:useGlass:)") }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateBacking()
    }

    func refresh() {
        let display = settings()
        // Keep appearance inherited. AppKit supplies accessibility appearances
        // when Increase Contrast changes; constructing a named accessibility
        // appearance is not a substitute for that system signal. Core's dynamic
        // Swift tokens select the corresponding 7:1 palette automatically.
        opaqueBacking.isHidden = !display.reduceTransparency && !display.increaseContrast
        updateBacking()
        // Dynamic NSColors remain dynamic. Invalidate existing native content,
        // rather than caching CGColors or a snapshot of the previous opening.
        func invalidate(_ view: NSView) {
            view.needsDisplay = true
            view.subviews.forEach(invalidate)
        }
        invalidate(self)
    }

    private func updateBacking() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            opaqueBacking.layer?.backgroundColor = LinaTokens.Color.canvas.cgColor
            opaqueBacking.layer?.borderColor = LinaTokens.Color.line.cgColor
        }
        opaqueBacking.layer?.borderWidth = settings().increaseContrast ? LinaAppTokens.borderWidth : 0
    }
}

public final class LauncherPanel: NSPanel {
    public override var canBecomeKey: Bool { true }
    public override var canBecomeMain: Bool { false }
    public var onDismiss: (() -> Void)?
    public var onSettings: (() -> Void)?
    let surface: LauncherSurfaceView
    private var displayObserver: NSObjectProtocol?
    private var colorObserver: NSObjectProtocol?

    public convenience init(content: NSViewController) {
        self.init(content: content, settings: { .current }, useGlass: true)
    }

    init(content: NSViewController, settings: @escaping () -> LauncherDisplaySettings, useGlass: Bool) {
        surface = LauncherSurfaceView(content: content.view, settings: settings, useGlass: useGlass)
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
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        animationBehavior = .none
        let wrapper = NSViewController()
        wrapper.addChild(content)
        wrapper.view = surface
        contentViewController = wrapper
        surface.refresh()
        displayObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.refreshSurface() }
        colorObserver = NotificationCenter.default.addObserver(
            forName: NSColor.systemColorsDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.refreshSurface() }
    }

    deinit {
        if let displayObserver { NSWorkspace.shared.notificationCenter.removeObserver(displayObserver) }
        if let colorObserver { NotificationCenter.default.removeObserver(colorObserver) }
    }

    private func refreshSurface() {
        surface.refresh()
        invalidateShadow()
    }

    public override func makeKeyAndOrderFront(_ sender: Any?) {
        // Finish native layout and invalidate display while still hidden, after
        // the Flutter readiness gate. AppKit draws in the ordering transaction;
        // do not reuse a snapshot or recreate the prewarmed answer surface.
        refreshSurface()
        surface.layoutSubtreeIfNeeded()
        surface.displayIfNeeded()
        super.makeKeyAndOrderFront(sender)
    }

    public override func setFrame(_ frameRect: NSRect, display flag: Bool) {
        super.setFrame(frameRect, display: flag)
        invalidateShadow()
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
