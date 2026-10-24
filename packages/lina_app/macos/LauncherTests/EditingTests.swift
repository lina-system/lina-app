// SPDX-License-Identifier: Apache-2.0
import AppKit
import XCTest
@testable import LinaLauncher

final class EditingTests: XCTestCase {
    @MainActor func testStandardEditMenuDispatchesToTheNativeEditor() throws {
        _ = NSApplication.shared
        let menu = LauncherMenus.makeMainMenu()
        let edit = try XCTUnwrap(menu.items.first(where: { $0.title == "Edit" })?.submenu)
        let editor = NSTextView()
        editor.string = "synthetic query"
        editor.setSelectedRange(NSRange(location: 0, length: 0))
        // A concrete target exercises Cocoa menu dispatch without ordering a window.
        // Production items intentionally retain nil targets for the responder chain.
        for item in edit.items where !item.isSeparatorItem {
            XCTAssertNil(item.target)
            item.target = editor
        }
        let selectAll = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command,
                                        timestamp: 1, windowNumber: 0, context: nil, characters: "a",
                                        charactersIgnoringModifiers: "a", isARepeat: false, keyCode: 0)!
        XCTAssertTrue(edit.performKeyEquivalent(with: selectAll))
        XCTAssertEqual(editor.selectedRange(), NSRange(location: 0, length: 15))
        for (key, action) in [("x", "cut:"), ("c", "copy:"), ("v", "paste:"), ("z", "undo:")] {
            XCTAssertEqual(edit.items.first(where: { $0.keyEquivalent == key })?.action, NSSelectorFromString(action))
        }
    }
}
