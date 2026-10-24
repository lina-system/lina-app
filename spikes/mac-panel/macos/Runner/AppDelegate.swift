// SPDX-License-Identifier: Apache-2.0
import Cocoa
import FlutterMacOS

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { application.run() }
    }
    private var host: PanelHost!
    private var shortcut: GlobalShortcut?
    private let clipboard = ClipboardWatcher()
    private var channel: FlutterMethodChannel!
    private var statusItem: NSStatusItem!
    private var observers: [NSObjectProtocol] = []
    private var ready = false
    private var measuring = false
    private var engine: FlutterEngine?
    private var visibleCapture: AnyObject?
    private var captureSequence = -1
    private var captureStarted = false
    private var timingFixture: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let flutter = FlutterViewController()
        RegisterGeneratedPlugins(registry: flutter)
        flutter.backgroundColor = .clear
        // System material belongs to AppKit; Flutter draws only local UI.
        let container = NSViewController()
        let material = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 680, height: 460))
        material.material = .hudWindow
        material.blendingMode = .behindWindow
        material.state = .active
        let capturing = ProcessInfo.processInfo.environment["LINA_PANEL_VISIBLE"] == "1"
        if capturing {
            let opaque = NSView(frame: material.frame)
            opaque.wantsLayer = true
            opaque.layer?.backgroundColor = NSColor.white.cgColor
            container.view = opaque
        } else { container.view = material }
        container.addChild(flutter)
        flutter.view.frame = material.bounds
        flutter.view.autoresizingMask = [.width, .height]
        container.view.addSubview(flutter.view)
        host = PanelHost(content: container, focusView: flutter.view)
        channel = FlutterMethodChannel(name: "org.lina.spike/mac_panel/v1", binaryMessenger: flutter.engine.binaryMessenger)
        channel.setMethodCallHandler { [weak self] call, result in self?.handle(call, result: result) }
        // FlutterViewController starts its engine in viewWillAppear. This panel
        // stays hidden until its first Dart frame, so start the engine explicitly.
        engine = flutter.engine
        guard flutter.engine.run(withEntrypoint: nil) else {
            fputs("Panel Flutter engine failed to start\n", stderr)
            NSApp.terminate(nil)
            return
        }
        clipboard.onChange = { [weak self] in self?.changed() }
        host.onChange = { [weak self] in self?.changed() }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "lina."
        let menu = NSMenu()
        menu.addItem(withTitle: "Open Panel Study", action: #selector(openPanel), keyEquivalent: "")
        menu.addItem(withTitle: "Quit Panel Study", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.items.first?.target = self
        statusItem.menu = menu
        observers.append(DistributedNotificationCenter.default().addObserver(
            forName: NSNotification.Name("com.apple.screenIsLocked"), object: nil, queue: .main
        ) { [weak self] _ in self?.clearSession() })
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.clearSession() })
    }

    @objc private func openPanel() { if ready { host.show() } }
    private func clearSession() {
        if #available(macOS 14.4, *), let capture = visibleCapture as? VisibleCapture {
            capture.cancel("Screen locked or login session resigned; no further GUI checks")
        }
        clipboard.setEnabled(false)
        host.hide()
    }
    private func changed() { if ready { channel.invokeMethod("stateChanged", arguments: state()) } }
    private func state() -> [String: Any] {
        let configured = shortcut?.current ?? .initial
        return ["captureSequence": captureSequence, "visible": host.panel.isVisible, "clipboardEnabled": clipboard.history.enabled,
                "history": clipboard.history.items,
                "shortcut": ["keyCode": configured.keyCode, "modifiers": configured.modifiers],
                "orderMs": host.lastOrderMs as Any? ?? NSNull(),
                "originalAppStayedActive": host.originalAppStayedActive as Any? ?? NSNull()]
    }

    private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        do {
            switch call.method {
            case "ready":
                ready = true
                if shortcut == nil {
                    let hotkey = try GlobalShortcut()
                    hotkey.onPress = { [weak self] time in
                        guard let self else { return }
                        if #available(macOS 14.4, *), let capture = self.visibleCapture as? VisibleCapture {
                            capture.shortcut(eventTime: time, source: self.shortcut?.lastInputSource ?? "none")
                        } else { self.host.toggle(startedAt: time) }
                    }
                    shortcut = hotkey
                }
                let saved = UserDefaults.standard.dictionary(forKey: "panelShortcut")
                let configuration = try Shortcut(keyCode: saved?["keyCode"] as? Int ?? 49,
                                                  modifiers: saved?["modifiers"] as? [String] ?? ["control", "option"])
                try shortcut?.register(configuration)
                if ProcessInfo.processInfo.environment["LINA_PANEL_VISIBLE"] == "1", visibleCapture == nil {
                    if #available(macOS 14.4, *) {
                        captureSequence = 0
                        visibleCapture = VisibleCapture(host: host) { [weak self] sequence in
                            self?.captureSequence = sequence
                            self?.changed()
                        }
                    } else {
                        result(FlutterError(code: "capture_unavailable", message: "Own-process capture needs macOS 14.4", details: nil))
                        NSApp.terminate(nil)
                        return
                    }
                }
                if ProcessInfo.processInfo.environment["LINA_PANEL_SMOKE"] == "1" {
                    print("LINA_PANEL_SMOKE ready")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { NSApp.terminate(nil) }
                }
                if !measuring && ProcessInfo.processInfo.environment["LINA_PANEL_MEASURE"] == "1" {
                    measuring = true
                    PanelMeasurement.run(host: host, flutterLoaded: true)
                }
            case "measurementReady":
                if !captureStarted, #available(macOS 14.4, *), let capture = visibleCapture as? VisibleCapture {
                    captureStarted = true
                    if ProcessInfo.processInfo.environment["LINA_PANEL_LOCAL_STIMULUS"] == "1" {
                        showTimingFixture()
                    }
                    capture.start()
                }
            case "state": break
            case "hide": host.hide()
            case "configureShortcut":
                guard let args = call.arguments as? [String: Any],
                      let code = args["keyCode"] as? Int,
                      let modifiers = args["modifiers"] as? [String] else { throw ShortcutError.invalid }
                let configuration = try Shortcut(keyCode: code, modifiers: modifiers)
                guard let shortcut else { throw ShortcutError.invalid }
                try shortcut.register(configuration)
                UserDefaults.standard.set(["keyCode": code, "modifiers": configuration.modifiers], forKey: "panelShortcut")
            case "setClipboardEnabled":
                guard let args = call.arguments as? [String: Any], let enabled = args["enabled"] as? Bool else {
                    throw ShortcutError.invalid
                }
                guard captureSequence < 0 else { throw ShortcutError.invalid }
                clipboard.setEnabled(enabled)
            default: result(FlutterMethodNotImplemented); return
            }
            result(state())
        } catch {
            result(FlutterError(code: "panel_configuration", message: "Invalid or unavailable shortcut/setting", details: nil))
        }
    }

    private func showTimingFixture() {
        let window = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 760, height: 540),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Panel timing fixture — foreground AppKit shortcut"
        window.isReleasedWhenClosed = false
        let label = NSTextField(labelWithString: "Synthetic foreground fixture\nControl+Option+Space opens the panel.\nNo editable input or clipboard access.")
        label.frame = NSRect(x: 40, y: 180, width: 680, height: 140)
        label.font = .systemFont(ofSize: 24)
        window.contentView?.addSubview(label)
        timingFixture = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
        clipboard.setEnabled(false)
        host?.hide()
        shortcut = nil
        engine?.shutDownEngine()
        for observer in observers {
            DistributedNotificationCenter.default().removeObserver(observer)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { false }
}
