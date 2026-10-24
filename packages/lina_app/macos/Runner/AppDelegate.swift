// SPDX-License-Identifier: Apache-2.0
import Cocoa
import Carbon
import CoreText
import FlutterMacOS
import ScreenCaptureKit

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { application.run() }
    }
    private var host: LauncherPanelHost!
    private var content: LauncherContent!
    private var flutter: FlutterViewController!
    private var channel: FlutterMethodChannel!
    private var mainChannel: FlutterMethodChannel?
    private var mainWindow: NSWindow?
    private var draftReady = false
    private var pendingDraft: (id: UUID, text: String, completion: (Bool) -> Void)?
    private var statusItem: StatusItemController!
    private var statusChannel: StatusItemChannel?
    private var menuBarGuidance: MenuBarGuidance!
    private var shortcut: GlobalShortcut?
    private var loginItem: SystemLoginItem!
    private var calculatorPasteboard: NSPasteboard?
    private var startupError: String?
    private let arguments = ProcessInfo.processInfo.arguments
    private var testMode: Bool {
        arguments.contains("--calculator-smoke") || arguments.contains("--status-item-smoke") ||
        arguments.contains("--launcher-smoke") || arguments.contains("--launcher-evidence") ||
        arguments.contains("--launcher-acceptance") ||
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
        ProcessInfo.processInfo.environment["LINA_MEASURE_STARTUP"] == "1"
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = LauncherMenus.makeMainMenu()
        // Loading fonts for AppKit uses the same already-bundled design assets.
        if let assets = Bundle.main.privateFrameworksURL?.appendingPathComponent("App.framework/Resources/flutter_assets/packages/lina_design/assets/fonts") {
            for file in ["Pretendard-Regular.otf", "Pretendard-Bold.otf"] {
                CTFontManagerRegisterFontsForURL(assets.appendingPathComponent(file) as CFURL, .process, nil)
            }
        }
        loginItem = SystemLoginItem(allowsChanges: !testMode)
        flutter = FlutterViewController()
        RegisterGeneratedPlugins(registry: flutter)
        flutter.backgroundColor = LinaTokens.Color.canvas
        if arguments.contains("--calculator-smoke") { calculatorPasteboard = NSPasteboard.withUniqueName() }
        content = LauncherContent(answer: flutter, history: CalculatorHistory(defaults: testMode ? nil : .standard),
                                  pasteboard: calculatorPasteboard ?? .general,
                                  locale: arguments.contains("--calculator-smoke") ? Locale(identifier: "en_US") : .current,
                                  emoji: LauncherEmoji(defaults: testMode ? nil : .standard),
                                  translation: LauncherTranslation(defaults: testMode ? nil : .standard))
        _ = content.view
        host = LauncherPanelHost(content: content, focusView: content.input, defaults: testMode ? nil : .standard)
        statusItem = StatusItemController(openLauncher: { [weak self] in self?.host.show() },
                                          openConversation: { [weak self] in self?.openMainApp() })
        menuBarGuidance = MenuBarGuidance(defaults: testMode ? nil : .standard)
        prepareMainApp()
        content.onDismiss = { [weak self] in self?.host.hide() }
        content.onOpenApp = { [weak self] in self?.openMainApp() }
        content.onConversationDraft = { [weak self] text, completion in
            guard let self, self.pendingDraft == nil else { completion(false); return }
            let id = UUID()
            self.pendingDraft = (id, text, completion)
            self.prepareMainApp()
            self.deliverDraft()
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                guard let self, self.pendingDraft?.id == id else { return }
                self.pendingDraft = nil
                completion(false)
            }
        }
        content.onQuery = { [weak self] text in self?.channel.invokeMethod("queryChanged", arguments: ["query": text]) }
        content.onSubmit = { [weak self] text, id in
            self?.channel.invokeMethod("submit", arguments: ["query": text, "resultID": id as Any? ?? NSNull()])
        }
        content.onLoginChange = { [weak self] enabled in
            guard let self else { return }
            do { try self.loginItem.setEnabled(enabled); self.content.setLoginState(self.loginItem.state) }
            catch { self.content.setLoginState(self.loginItem.state); self.content.showLoginError() }
        }
        content.setLoginState(loginItem.state)
        host.panel.onSettings = { [weak self] in
            guard let self else { return }
            self.host.panel.makeFirstResponder(self.content.loginButton)
        }
        host.onChange = { [weak self] in
            guard let self, self.host.ready else { return }
            self.channel.invokeMethod("stateChanged", arguments: self.state())
        }
        channel = FlutterMethodChannel(name: "org.lina.app/launcher/v1", binaryMessenger: flutter.engine.binaryMessenger)
        channel.setMethodCallHandler { [weak self] call, result in self?.handle(call, result: result) }
        // viewWillAppear never fires for a hidden prewarm; explicitly start it.
        guard flutter.engine.run(withEntrypoint: "launcherMain") else {
            fputs("LINA launcher engine failed to start\n", stderr)
            NSApp.terminate(nil); return
        }
        let launchedAtLogin = NSAppleEventManager.shared().currentAppleEvent?
            .paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
        if !testMode && !launchedAtLogin { host.show() }
        // A missing Dart first frame must not strand a user with an invisible app.
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self, !self.host.ready, !self.testMode else { return }
            self.openMainApp()
        }
    }
    private func state() -> [String: Any] {
        ["ready": host.ready, "visible": host.panel.isVisible, "loginItem": loginItem.state,
         "activationPolicy": NSApp.activationPolicy().rawValue,
         "uiElement": Bundle.main.object(forInfoDictionaryKey: "LSUIElement") as? Bool ?? false,
         "shortcut": "Control+Option+Space", "error": startupError as Any? ?? NSNull()]
    }
    private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "ready":
            if !host.ready {
                if !testMode || arguments.contains("--launcher-acceptance") {
                    do {
                        let key = try GlobalShortcut()
                        try key.register(.initial)
                        key.onPress = { [weak self] _ in self?.host.toggle() }
                        shortcut = key
                    } catch {
                        startupError = "Control+Option+Space is unavailable. Open LINA again to open the launcher."
                        content.status.stringValue = startupError!
                    }
                }
                host.markReady()
                if testMode {
                    print("LINA_LAUNCHER_READY " + json(state()))
                    if ProcessInfo.processInfo.environment["LINA_MEASURE_STARTUP"] == "1" { print("LINA_FIRST_FRAME") }
                    fflush(stdout)
                }
                if arguments.contains("--launcher-smoke") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { NSApp.terminate(nil) }
                }
                if arguments.contains("--launcher-evidence") { runEvidence() }
                if arguments.contains("--calculator-smoke") { runCalculatorSmoke() }
            }
        case "state": break
        case "show": host.show()
        case "hide": host.hide()
        default: result(FlutterMethodNotImplemented); return
        }
        result(state())
    }
    private func json(_ value: [String: Any]) -> String {
        String(data: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!
    }
    private func prepareMainApp() {
        if mainWindow == nil {
            let view = FlutterViewController()
            RegisterGeneratedPlugins(registry: view)
            statusChannel = StatusItemChannel(messenger: view.engine.binaryMessenger, controller: statusItem)
            mainChannel = FlutterMethodChannel(name: "org.lina.app/launcher/v1", binaryMessenger: view.engine.binaryMessenger)
            mainChannel?.setMethodCallHandler { [weak self] call, result in
                guard let self else { return }
                switch call.method {
                case "draftReady": self.draftReady = true; self.deliverDraft(); result(nil)
                case "show": self.host.show(); result(nil)
                case "hide": self.host.hide(); result(nil)
                default: result(FlutterMethodNotImplemented)
                }
            }
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: LinaAppTokens.layoutReadingWidth,
                                                     height: LinaAppTokens.launcherHeight),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "LINA"
            window.isReleasedWhenClosed = false
            window.contentViewController = view
            window.center()
            mainWindow = window
            // Keep the single conversation/Core engine alive while its window is hidden.
            if !view.engine.run(withEntrypoint: nil) {
                fputs("LINA conversation engine failed to start\n", stderr)
                NSApp.terminate(nil)
            }
        }
    }
    private func deliverDraft() {
        guard draftReady, let draft = pendingDraft else { return }
        // Clear before invoking: readiness notifications cannot deliver twice.
        pendingDraft = nil
        mainChannel?.invokeMethod("appendDraft", arguments: ["text": draft.text]) { [weak self] response in
            let accepted = (response as? Bool) == true
            if accepted { self?.openMainApp() }
            draft.completion(accepted)
        }
    }
    private func openMainApp() {
        host.hide()
        prepareMainApp()
        // This explicit Open LINA action opens the full app; panel show never activates.
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
        if let mainWindow { menuBarGuidance.present(on: mainWindow) }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        host?.show(); return false
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) {
        host?.hide()
        calculatorPasteboard?.releaseGlobally()
        shortcut = nil
        statusChannel?.dispose()
        statusItem?.remove()
        (mainWindow?.contentViewController as? FlutterViewController)?.engine.shutDownEngine()
        flutter?.engine.shutDownEngine()
    }
    private func runCalculatorSmoke(attempt: Int = 0) {
        // Wait for the real main-engine handshake; arithmetic must add no requests.
        guard statusItem.menu.items.contains(where: { $0.title == "Core: 연결됨" }) else {
            guard attempt < 100 else { print("LINA_CALCULATOR failed: Core not ready"); fflush(stdout); NSApp.terminate(nil); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.runCalculatorSmoke(attempt: attempt + 1) }
            return
        }
        print("LINA_CALCULATOR_BEGIN")
        var samples: [[String: Any]] = []
        let editor = NSTextView()
        for query in ["(3+4)*12%", "2^10", "1234567/100", "1234", "2+"] {
            for length in 1...query.count {
                content.input.stringValue = String(query.prefix(length))
                content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: content.input))
            }
            var sample: [String: Any] = ["query": query, "rows": content.items.map(\.title)]
            if !content.items.isEmpty {
                _ = content.control(content.input, textView: editor, doCommandBy: #selector(NSResponder.insertNewline(_:)))
                sample["formattedCopy"] = calculatorPasteboard?.string(forType: .string)
                content.copyCalculatorUnformatted(nil)
                sample["rawCopy"] = calculatorPasteboard?.string(forType: .string)
            }
            samples.append(sample)
        }
        content.input.stringValue = ""
        content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: content.input))
        let evidence: [String: Any] = ["samples": samples, "historyRows": content.items.count,
                                      "route": "production NSTextField delegate, Return and copy action; isolated pasteboard and in-memory history"]
        // Include asynchronous channel work in the observed request-log interval.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [self] in
            print("LINA_CALCULATOR " + json(evidence)); fflush(stdout); NSApp.terminate(nil)
        }
    }
    private func capturePanel(completion: @escaping (String?) -> Void) {
        guard #available(macOS 14.4, *) else { completion(nil); return }
        Task { @MainActor in
            do {
                let available = try await SCShareableContent.currentProcess
                guard let window = available.windows.first(where: { $0.windowID == CGWindowID(host.panel.windowNumber) }) else {
                    completion(nil); return
                }
                let configuration = SCStreamConfiguration()
                configuration.width = Int(host.panel.frame.width * (host.panel.backingScaleFactor))
                configuration.height = Int(host.panel.frame.height * (host.panel.backingScaleFactor))
                configuration.showsCursor = false
                let image = try await SCScreenshotManager.captureImage(
                    contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration)
                let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
                completion(data?.base64EncodedString())
            } catch { completion(nil) }
        }
    }
    private func runEvidence() {
        // Own-process AppKit key delivery; the external fixture is never typed into.
        let original = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let expected = ProcessInfo.processInfo.environment["LINA_FIXTURE_PID"].flatMap(Int32.init)
        guard original == expected, original != ProcessInfo.processInfo.processIdentifier else {
            print("LINA_EVIDENCE failed: fixture is not frontmost"); fflush(stdout); NSApp.terminate(nil); return
        }
        var samples: [[String: Any]] = []
        func record(_ phase: String) {
            samples.append(["phase": phase, "frontmostPID": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1,
                            "fixturePID": expected!, "fixtureActive": NSRunningApplication(processIdentifier: expected!)?.isActive ?? false,
                            "appActive": NSApp.isActive, "panelKey": host.panel.isKeyWindow,
                            "visible": host.panel.isVisible, "query": content.input.stringValue])
        }
        record("hidden-ready")
        host.show()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [self] in
            record("show")
            for character in "abc" {
                if let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
                                               timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: host.panel.windowNumber, context: nil,
                                               characters: String(character), charactersIgnoringModifiers: String(character),
                                               isARepeat: false, keyCode: 0) {
                    NSApp.sendEvent(event)
                }
            }
            record("type")
            capturePanel { [self] capture in
                if let capture { print("LINA_CAPTURE " + capture) }
            if let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
                                           timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: host.panel.windowNumber, context: nil,
                                           characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}", isARepeat: false, keyCode: 53) {
                NSApp.sendEvent(event)
            }
            record("escape")
            print("LINA_EVIDENCE " + json(["samples": samples, "firstFrameReady": host.ready,
                                          "inputRoute": "AppKit sendEvent to own panel", "loginItem": loginItem.state]))
            fflush(stdout)
            NSApp.terminate(nil)
            }

        }
    }
}
