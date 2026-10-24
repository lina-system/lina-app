// SPDX-License-Identifier: Apache-2.0
import AppKit
import XCTest
@testable import LinaLauncher

final class CalculatorContentTests: XCTestCase {
    @MainActor func testReturnRepeatGuardAcceptsNonKeyEvents() throws {
        let windowEvent = try XCTUnwrap(NSEvent.otherEvent(with: .appKitDefined, location: .zero,
            modifierFlags: [], timestamp: 1, windowNumber: 0, context: nil, subtype: 4, data1: 0, data2: 0))
        XCTAssertFalse(LauncherContent.isRepeatedKeyDown(windowEvent))
        XCTAssertFalse(LauncherContent.isRepeatedKeyDown(nil))
        for repeated in [false, true] {
            let key = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
                timestamp: 1, windowNumber: 0, context: nil, characters: "\r", charactersIgnoringModifiers: "\r",
                isARepeat: repeated, keyCode: 36))
            XCTAssertEqual(LauncherContent.isRepeatedKeyDown(key), repeated)
        }
    }

    @MainActor func testRequiredExpressionsProduceResultsWhileTyping() throws {
        _ = NSApplication.shared
        let content = LauncherContent(answer: NSViewController(), history: CalculatorHistory(defaults: nil), locale: Locale(identifier: "en_US"))
        _ = content.view
        for (expression, answer) in [("(3+4)*12%", "0.84"), ("2^10", "1,024")] {
            content.input.stringValue = expression
            content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: content.input))
            XCTAssertEqual(content.items.count, 1)
            XCTAssertTrue(content.items.first?.title.contains(answer) == true)
        }
        content.input.stringValue = "1234"
        content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: content.input))
        XCTAssertTrue(content.items.isEmpty)
    }
    @MainActor func testReturnRawShortcutHistoryAndStaleResult() throws {
        _ = NSApplication.shared
        let board = NSPasteboard.withUniqueName()
        defer { board.releaseGlobally() }
        let history = CalculatorHistory(defaults: nil)
        let content = LauncherContent(answer: NSViewController(), history: history, pasteboard: board, locale: Locale(identifier: "de_DE"))
        _ = content.view
        let editor = NSTextView()
        var submissions = 0
        content.onSubmit = { _, _ in submissions += 1 }
        func type(_ query: String) {
            content.input.stringValue = query
            content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: content.input))
        }
        type("1234567/100")
        XCTAssertTrue(history.entries.isEmpty)
        XCTAssertTrue(content.control(content.input, textView: editor, doCommandBy: #selector(NSResponder.insertNewline(_:))))
        XCTAssertEqual(board.string(forType: .string), "12.345,67")
        let menu = try XCTUnwrap(LauncherMenus.makeMainMenu().items.first(where: { $0.title == "Edit" })?.submenu)
        let copy = try XCTUnwrap(menu.items.first(where: { $0.action == #selector(LauncherContent.copyCalculatorUnformatted(_:)) }))
        copy.target = content
        let key = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [.command, .option],
            timestamp: 1, windowNumber: 0, context: nil, characters: "c", charactersIgnoringModifiers: "c", isARepeat: false, keyCode: 8))
        XCTAssertTrue(menu.performKeyEquivalent(with: key))
        XCTAssertEqual(board.string(forType: .string), "12345.67")
        XCTAssertEqual(history.entries.count, 1)
        XCTAssertEqual(submissions, 0)
        editor.setMarkedText("한", selectedRange: NSRange(location: 1, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        XCTAssertFalse(content.control(content.input, textView: editor, doCommandBy: #selector(NSResponder.insertNewline(_:))))
        editor.unmarkText()
        type("2+")
        XCTAssertTrue(content.items.isEmpty)
        type("")
        XCTAssertEqual(content.items.count, 1)
        XCTAssertTrue(content.items[0].title.contains("1234567/100"))
        content.results.onActivate?()
        XCTAssertEqual(board.string(forType: .string), "12.345,67")
        type("2^10")
        content.input.stringValue = "2+" // An undelivered edit cannot copy an old answer.
        content.copyCalculatorUnformatted(nil)
        XCTAssertEqual(board.string(forType: .string), "12.345,67")
    }

    @MainActor func testTinyAndHugeAnswersFitAndCopyThroughBothShortcuts() throws {
        _ = NSApplication.shared
        let board = NSPasteboard.withUniqueName()
        defer { board.releaseGlobally() }
        for locale in ["en_US", "de_DE"] {
            let content = LauncherContent(answer: NSViewController(), history: CalculatorHistory(defaults: nil),
                pasteboard: board, locale: Locale(identifier: locale))
            _ = content.view
            let editor = NSTextView()
            let menu = try XCTUnwrap(LauncherMenus.makeMainMenu().items.first(where: { $0.title == "Edit" })?.submenu)
            let copy = try XCTUnwrap(menu.items.first(where: { $0.action == #selector(LauncherContent.copyCalculatorUnformatted(_:)) }))
            copy.target = content
            let key = try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [.command, .option],
                timestamp: 1, windowNumber: 0, context: nil, characters: "c", charactersIgnoringModifiers: "c", isARepeat: false, keyCode: 8))
            for (query, raw, localized) in [
                ("1/1e300", "1e-300", "1e-300"),
                ("1.23456789012345e150*1e150", "1.23456789012345e+300", locale == "de_DE" ? "1,23456789012345e300" : "1.23456789012345e300"),
            ] {
                content.input.stringValue = query
                content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: content.input))
                content.view.layoutSubtreeIfNeeded()
                XCTAssertEqual(content.items.first?.title, localized)
                let label = try XCTUnwrap(content.results.view(atColumn: 0, row: 0, makeIfNecessary: true) as? NSTextField)
                XCTAssertLessThanOrEqual(label.intrinsicContentSize.width, content.results.tableColumns[0].width, query)
                XCTAssertTrue(content.control(content.input, textView: editor, doCommandBy: #selector(NSResponder.insertNewline(_:))))
                XCTAssertEqual(board.string(forType: .string), localized)
                XCTAssertTrue(menu.performKeyEquivalent(with: key))
                XCTAssertEqual(board.string(forType: .string), raw)
            }
            content.input.stringValue = ""
            content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: content.input))
            content.results.onActivate?()
            XCTAssertEqual(board.string(forType: .string), locale == "de_DE" ? "1,23456789012345e300" : "1.23456789012345e300")
        }
    }

    @MainActor func testCaptureCalculatorResultLayer() throws {
        guard let path = ProcessInfo.processInfo.environment["LINA_CALCULATOR_CAPTURE"] else { return }
        _ = NSApplication.shared
        let content = LauncherContent(answer: NSViewController(), history: CalculatorHistory(defaults: nil), locale: Locale(identifier: "en_US"))
        _ = content.view
        content.input.stringValue = ProcessInfo.processInfo.environment["LINA_CALCULATOR_EXPRESSION"] ?? "(3+4)*12%"
        content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification, object: content.input))
        content.view.layoutSubtreeIfNeeded()
        let rect = NSRect(x: 0, y: content.view.bounds.height - 235, width: content.view.bounds.width, height: 235)
        let bitmap = try XCTUnwrap(content.view.bitmapImageRepForCachingDisplay(in: rect))
        content.view.cacheDisplay(in: rect, to: bitmap)
        let data = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        try data.write(to: URL(fileURLWithPath: path))
    }
}
