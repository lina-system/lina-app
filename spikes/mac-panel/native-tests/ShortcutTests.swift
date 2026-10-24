// SPDX-License-Identifier: Apache-2.0
import XCTest
import Carbon
import AppKit
@testable import MacPanelPlatform

final class ShortcutTests: XCTestCase {
    func testConfiguredShortcutMatchesNativeKeyDownWithoutRepeatsOrExtraModifiers() throws {
        let shortcut = try Shortcut(keyCode: 49, modifiers: ["control", "option"])
        func event(_ code: UInt16 = 49, _ flags: NSEvent.ModifierFlags = [.control, .option], repeat repeated: Bool = false) -> NSEvent {
            NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 100,
                            windowNumber: 0, context: nil, characters: " ", charactersIgnoringModifiers: " ",
                            isARepeat: repeated, keyCode: code)!
        }
        XCTAssertTrue(shortcut.matchesLocalKey(event()))
        XCTAssertTrue(shortcut.matchesLocalKey(event(49, [.control, .option, .capsLock])))
        XCTAssertFalse(shortcut.matchesLocalKey(event(49, [.control])))
        XCTAssertFalse(shortcut.matchesLocalKey(event(49, [.control, .option, .command])))
        XCTAssertFalse(shortcut.matchesLocalKey(event(48)))
        XCTAssertFalse(shortcut.matchesLocalKey(event(repeat: true)))
    }

    func testUnrelatedCarbonHotkeyCannotStartPanelTiming() throws {
        let shortcut = try GlobalShortcut()
        var calls = 0
        shortcut.onPress = { _ in calls += 1 }
        var event: EventRef?
        XCTAssertEqual(CreateEvent(nil, OSType(kEventClassKeyboard), UInt32(kEventHotKeyPressed),
                                   GetCurrentEventTime(), 0, &event), noErr)
        let created = try XCTUnwrap(event)
        defer { ReleaseEvent(created) }
        var otherID = EventHotKeyID(signature: 0x4F544852, id: 99)
        XCTAssertEqual(SetEventParameter(created, EventParamName(kEventParamDirectObject),
                                         EventParamType(typeEventHotKeyID), MemoryLayout<EventHotKeyID>.size, &otherID), noErr)
        _ = SendEventToEventTarget(created, GetApplicationEventTarget())
        XCTAssertEqual(calls, 0)
    }

    func testShortcutRequiresRealModifierAndKnownPhysicalKey() throws {
        XCTAssertThrowsError(try Shortcut(keyCode: 49, modifiers: []))
        XCTAssertThrowsError(try Shortcut(keyCode: 49, modifiers: ["shift"]))
        XCTAssertThrowsError(try Shortcut(keyCode: 999, modifiers: ["command"]))
        XCTAssertThrowsError(try Shortcut(keyCode: 49, modifiers: ["unknown"]))
        let shortcut = try Shortcut(keyCode: 49, modifiers: ["control", "option"])
        XCTAssertEqual(shortcut.keyCode, 49)
        XCTAssertNotEqual(shortcut.carbonModifiers, 0)
    }
}
