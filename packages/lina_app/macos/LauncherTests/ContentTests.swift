// SPDX-License-Identifier: Apache-2.0
import AppKit
import XCTest
@testable import LinaLauncher

final class ContentTests: XCTestCase {
    @MainActor func testNativeInputArrowsReturnEscapeAndComposition() {
        _ = NSApplication.shared
        let content = LauncherContent(answer: NSViewController())
        _ = content.view
        content.setResults([LauncherResult(id: "first", title: "First"), LauncherResult(id: "second", title: "Second")])
        let editor = NSTextView()
        var submits: [String?] = []
        var dismissals = 0
        content.onSubmit = { _, id in submits.append(id) }
        content.onDismiss = { dismissals += 1 }
        XCTAssertTrue(content.control(content.input, textView: editor, doCommandBy: #selector(NSResponder.moveDown(_:))))
        XCTAssertEqual(content.results.selectedRow, 1)
        XCTAssertTrue(content.control(content.input, textView: editor, doCommandBy: #selector(NSResponder.insertNewline(_:))))
        XCTAssertEqual(submits, ["second"])
        editor.setMarkedText("한", selectedRange: NSRange(location: 1, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        XCTAssertFalse(content.control(content.input, textView: editor, doCommandBy: #selector(NSResponder.insertNewline(_:))))
        XCTAssertFalse(content.control(content.input, textView: editor, doCommandBy: #selector(NSResponder.cancelOperation(_:))))
        XCTAssertEqual(submits.count, 1)
        XCTAssertEqual(dismissals, 0)
        editor.unmarkText()
        XCTAssertTrue(content.control(content.input, textView: editor, doCommandBy: #selector(NSResponder.cancelOperation(_:))))
        XCTAssertEqual(dismissals, 1)
        content.setResults([])
        XCTAssertEqual(content.results.selectedRow, -1)
    }
    @MainActor func testReturnRepeatGuardHandlesNonKeyboardEvents() throws {
        let system = try XCTUnwrap(NSEvent.otherEvent(with: .appKitDefined, location: .zero, modifierFlags: [],
            timestamp: 1, windowNumber: 0, context: nil, subtype: 4, data1: 0, data2: 0))
        XCTAssertFalse(LauncherContent.isRepeatedKeyDown(system))
        XCTAssertFalse(LauncherContent.isRepeatedKeyDown(nil))
        for repeating in [false, true] {
            let key = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
                timestamp: 1, windowNumber: 0, context: nil, characters: "\r", charactersIgnoringModifiers: "\r",
                isARepeat: repeating, keyCode: 36))
            XCTAssertEqual(LauncherContent.isRepeatedKeyDown(key), repeating)
        }
    }

    func testLoginItemCannotRegisterOrUnregisterDuringTests() {
        let service = SystemLoginItem(allowsChanges: false)
        XCTAssertEqual(service.state, "disabledInTests")
        XCTAssertThrowsError(try service.setEnabled(true))
        XCTAssertThrowsError(try service.setEnabled(false))
    }
    @MainActor func testPrewarmRequestsCannotShowAnUnpaintedPanel() {
        _ = NSApplication.shared
        let view = NSViewController()
        let host = LauncherPanelHost(content: view, focusView: view.view)
        host.show()
        XCTAssertTrue(host.showRequested)
        XCTAssertFalse(host.panel.isVisible)
        host.toggle()
        XCTAssertFalse(host.showRequested)
        host.markReady()
        XCTAssertTrue(host.ready)
        XCTAssertFalse(host.panel.isVisible)
    }
    func testPointerDisplayPlacementClampsRemovedOrResizedDisplayPosition() {
        let frame = NSRect(x: -1920, y: 24, width: 1920, height: 1056)
        let size = NSSize(width: 680, height: 460)
        XCTAssertEqual(PanelPlacement.origin(size: size, within: frame, saved: nil), NSPoint(x: -1300, y: 322))
        XCTAssertEqual(PanelPlacement.origin(size: size, within: frame, saved: NSPoint(x: 5000, y: -50)), NSPoint(x: -680, y: 24))
        let saved = NSPoint(x: -1400, y: 300)
        XCTAssertEqual(PanelPlacement.origin(size: size, within: frame, saved: saved), saved)
    }
}
