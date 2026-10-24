// SPDX-License-Identifier: Apache-2.0
import Carbon
import Foundation
import AppKit

public enum ShortcutError: Error { case invalid, registration(OSStatus) }

public struct Shortcut: Equatable {
    public let keyCode: UInt32
    public let modifiers: [String]
    public var carbonModifiers: UInt32 {
        modifiers.reduce(0) { value, name in
            value | ["command": UInt32(cmdKey), "control": UInt32(controlKey),
                     "option": UInt32(optionKey), "shift": UInt32(shiftKey)][name, default: 0]
        }
    }
    public init(keyCode: Int, modifiers: [String]) throws {
        let names = Set(modifiers)
        guard (0...127).contains(keyCode), !names.isDisjoint(with: ["command", "control", "option"]),
              names.isSubset(of: ["command", "control", "option", "shift"]),
              names.count == modifiers.count else { throw ShortcutError.invalid }
        self.keyCode = UInt32(keyCode)
        self.modifiers = modifiers.sorted()
    }
    public static let initial = try! Shortcut(keyCode: 49, modifiers: ["control", "option"])

    public func matchesLocalKey(_ event: NSEvent) -> Bool {
        let flags: [String: NSEvent.ModifierFlags] = [
            "command": .command, "control": .control, "option": .option, "shift": .shift,
        ]
        let expected = modifiers.reduce(NSEvent.ModifierFlags()) { $0.union(flags[$1] ?? []) }
        return event.type == .keyDown && !event.isARepeat && UInt32(event.keyCode) == keyCode &&
            event.modifierFlags.intersection([.command, .control, .option, .shift]) == expected
    }
}

public final class GlobalShortcut {
    private var reference: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var localMonitor: Any?
    private var lastEventTime: TimeInterval?
    public private(set) var current: Shortcut?
    public private(set) var lastInputSource = "none"
    public var onPress: ((TimeInterval) -> Void)?

    public init() throws {
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let context, let event else { return OSStatus(eventNotHandledErr) }
            var identifier = EventHotKeyID()
            let parameterStatus = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                                   nil, MemoryLayout<EventHotKeyID>.size, nil, &identifier)
            if ProcessInfo.processInfo.environment["LINA_PANEL_VISIBLE"] == "1" {
                print("LINA_VISIBLE_HOTKEY status=\(parameterStatus) signature=\(identifier.signature) id=\(identifier.id)")
                fflush(stdout)
            }
            guard parameterStatus == noErr, identifier.signature == 0x4C494E41, identifier.id == 1 else {
                return OSStatus(eventNotHandledErr)
            }
            let owner = Unmanaged<GlobalShortcut>.fromOpaque(context).takeUnretainedValue()
            owner.dispatch(time: GetEventTime(event), source: "carbon-global-hotkey")
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), &handler)
        guard status == noErr else { throw ShortcutError.registration(status) }
        // Native foreground shortcuts also work for app-directed key events.
        // Carbon remains the background/global route. No keyboard event tap or
        // Accessibility grant is required for events already sent to this app.
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, NSApp.isActive, self.current?.matchesLocalKey(event) == true else { return event }
            self.dispatch(time: event.timestamp, source: "appkit-local-keyDown")
            return nil
        }
    }

    private func dispatch(time: TimeInterval, source: String) {
        // If the same native event reaches both routes, toggle only once.
        if let lastEventTime, abs(time - lastEventTime) < 0.001 { return }
        lastEventTime = time
        lastInputSource = source
        onPress?(time)
    }

    public func register(_ shortcut: Shortcut) throws {
        if current == shortcut { return }
        var replacement: EventHotKeyRef?
        let status = RegisterEventHotKey(shortcut.keyCode, shortcut.carbonModifiers,
                                        EventHotKeyID(signature: 0x4C494E41, id: 1),
                                        GetApplicationEventTarget(), 0, &replacement)
        guard status == noErr else { throw ShortcutError.registration(status) }
        // A conflict leaves the working shortcut registered.
        if let reference { UnregisterEventHotKey(reference) }
        reference = replacement
        current = shortcut
    }

    deinit {
        if let reference { UnregisterEventHotKey(reference) }
        if let handler { RemoveEventHandler(handler) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
    }
}
