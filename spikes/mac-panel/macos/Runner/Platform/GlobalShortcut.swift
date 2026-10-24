// SPDX-License-Identifier: Apache-2.0
import Carbon
import Foundation

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
}

public final class GlobalShortcut {
    private var reference: EventHotKeyRef?
    private var handler: EventHandlerRef?
    public private(set) var current: Shortcut?
    public var onPress: ((TimeInterval) -> Void)?

    public init() throws {
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let context, let event else { return OSStatus(eventNotHandledErr) }
            let owner = Unmanaged<GlobalShortcut>.fromOpaque(context).takeUnretainedValue()
            owner.onPress?(GetEventTime(event))
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), &handler)
        guard status == noErr else { throw ShortcutError.registration(status) }
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
    }
}
