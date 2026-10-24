// SPDX-License-Identifier: Apache-2.0
import XCTest
@testable import MacPanelPlatform

final class ShortcutTests: XCTestCase {
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
