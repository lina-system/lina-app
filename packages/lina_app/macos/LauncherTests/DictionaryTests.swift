// SPDX-License-Identifier: Apache-2.0
import AppKit
import XCTest
@testable import LinaLauncher

final class DictionaryTests: XCTestCase {
    func testCommandBoundaryAndUnicodeURL() throws {
        XCTAssertNil(DeviceDictionary.word(in: "serendipity"))
        XCTAssertNil(DeviceDictionary.word(in: "defined apple"))
        XCTAssertEqual(DeviceDictionary.word(in: "define"), "")
        XCTAssertEqual(DeviceDictionary.word(in: " DEFINE\t 사과 \n"), "사과")
        for word in ["serendipity", "사과", "a/b?#%", "ice cream", "🍎"] {
            let url = try XCTUnwrap(DeviceDictionary.entryURL(for: word))
            XCTAssertEqual(url.scheme, "dict")
            XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath.removingPercentEncoding, "/" + word)
            XCTAssertNil(url.query)
            XCTAssertNil(url.fragment)
        }
    }

    @MainActor func testDefinitionReturnAndRowActivationStayLocal() {
        _ = NSApplication.shared
        let ready = expectation(description: "Korean definition")
        var opened: [String] = []
        let dictionary = LauncherDictionary(lookup: { word in
            XCTAssertEqual(word, "사과")
            return "사과: 과일의 한 종류. (Synthetic fixture)"
        }, open: { word, done in opened.append(word); done(true) })
        let content = LauncherContent(answer: NSViewController(), dictionary: dictionary)
        _ = content.view
        var forwarded = 0, dismissed = 0
        content.onQuery = { _ in forwarded += 1 }
        content.onSubmit = { _, _ in forwarded += 1 }
        content.onDismiss = { dismissed += 1 }
        dictionary.onChange = { if dictionary.entry != nil { ready.fulfill() } }
        content.input.stringValue = "define 사과"
        content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
        wait(for: [ready], timeout: 5)
        XCTAssertEqual(content.items.map(\.id), [LauncherDictionary.resultID])
        XCTAssertTrue(dictionary.text.string.contains("과일"))
        XCTAssertTrue(content.control(content.input, textView: NSTextView(), doCommandBy: #selector(NSResponder.insertNewline(_:))))
        content.results.onActivate?()
        XCTAssertEqual(opened, ["사과", "사과"])
        XCTAssertEqual(dismissed, 2)
        XCTAssertEqual(forwarded, 0)
        content.input.stringValue = "ordinary query"
        content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
        XCTAssertTrue(content.items.isEmpty)
        XCTAssertTrue(dictionary.view.isHidden)
        XCTAssertEqual(forwarded, 1)
    }

    @MainActor func testMissingEntryAndOpenFailureAreHonest() {
        _ = NSApplication.shared
        let missing = expectation(description: "missing entry")
        let dictionary = LauncherDictionary(lookup: { _ in nil }, open: { _, _ in XCTFail("No entry to open") })
        _ = dictionary.view
        dictionary.onChange = { if dictionary.text.string.contains("No definition") { missing.fulfill() } }
        XCTAssertTrue(dictionary.update(query: "define missing", composing: false))
        wait(for: [missing], timeout: 5)
        XCTAssertNil(dictionary.entry)
        dictionary.activate(query: "define missing")
        XCTAssertTrue(dictionary.text.string.contains("Dictionary app"))

        let ready = expectation(description: "entry")
        let failed = LauncherDictionary(lookup: { _ in "Definition" }, open: { _, done in done(false) })
        _ = failed.view
        failed.onChange = { if failed.entry != nil { ready.fulfill() } }
        failed.onOpened = { XCTFail("Failed open must not dismiss") }
        _ = failed.update(query: "define word", composing: false)
        wait(for: [ready], timeout: 5)
        failed.onChange = nil
        failed.activate(query: "define word")
        XCTAssertTrue(failed.text.string.contains("Could not open"))
    }

    @MainActor func testCompositionAndLateLookupCannotActivateStaleWord() {
        _ = NSApplication.shared
        let started = expectation(description: "slow lookup started")
        let finished = expectation(description: "slow lookup returned")
        let release = DispatchSemaphore(value: 0)
        let dictionary = LauncherDictionary(lookup: { _ in
            started.fulfill()
            _ = release.wait(timeout: .now() + 5)
            finished.fulfill()
            return "Stale definition"
        }, open: { _, _ in XCTFail("Stale entry opened") })
        _ = dictionary.view
        _ = dictionary.update(query: "define old", composing: false)
        wait(for: [started], timeout: 5)
        XCTAssertTrue(dictionary.update(query: "define 사", composing: true))
        XCTAssertNil(dictionary.entry)
        dictionary.activate(query: "define 사")
        XCTAssertFalse(dictionary.update(query: "ordinary query", composing: false))
        release.signal()
        wait(for: [finished], timeout: 5)
        let drained = expectation(description: "main queue drained")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { drained.fulfill() }
        wait(for: [drained], timeout: 5)
        XCTAssertNil(dictionary.entry)
        XCTAssertFalse(dictionary.active)
    }

    @MainActor func testSwitchingBetweenCalculatorAndDictionaryKeepsActionsSeparate() {
        _ = NSApplication.shared
        let ready = expectation(description: "dictionary result")
        let board = NSPasteboard.withUniqueName()
        defer { board.releaseGlobally() }
        let history = CalculatorHistory(defaults: nil)
        var opened: [String] = []
        let dictionary = LauncherDictionary(lookup: { _ in "Synthetic definition" },
                                            open: { word, done in opened.append(word); done(true) })
        let content = LauncherContent(answer: NSViewController(), history: history, pasteboard: board,
                                      locale: Locale(identifier: "en_US"), dictionary: dictionary)
        _ = content.view
        content.onQuery = { _ in XCTFail("Local query forwarded") }
        content.onSubmit = { _, _ in XCTFail("Local action forwarded") }
        func type(_ query: String) {
            content.input.stringValue = query
            content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
        }
        type("2^10")
        content.results.onActivate?()
        XCTAssertEqual(board.string(forType: .string), "1,024")
        dictionary.onChange = { if dictionary.entry != nil { ready.fulfill() } }
        type("define serendipity")
        wait(for: [ready], timeout: 5)
        XCTAssertEqual(content.items.first?.id, LauncherDictionary.resultID)
        content.copyCalculatorUnformatted(nil)
        XCTAssertEqual(board.string(forType: .string), "1,024")
        content.results.onActivate?()
        XCTAssertEqual(opened, ["serendipity"])
        XCTAssertEqual(history.entries.count, 1)
        type("(3+4)*12%")
        XCTAssertTrue(dictionary.view.isHidden)
        XCTAssertTrue(content.control(content.input, textView: NSTextView(), doCommandBy: #selector(NSResponder.insertNewline(_:))))
        XCTAssertEqual(board.string(forType: .string), "0.84")
        XCTAssertEqual(opened, ["serendipity"])
        XCTAssertEqual(history.entries.count, 2)
    }

    @MainActor func testCapturesSyntheticEnglishAndKoreanDefinitionViews() throws {
        guard let directory = ProcessInfo.processInfo.environment["LINA_DICTIONARY_CAPTURES"] else { return }
        _ = NSApplication.shared
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        for (word, meaning) in [("serendipity", "The chance discovery of something valuable.\nSynthetic English test definition."),
                                ("사과", "사과: 사과나무의 열매.\nSynthetic Korean test definition.")] {
            let ready = expectation(description: word)
            let dictionary = LauncherDictionary(lookup: { _ in meaning }, open: { _, _ in XCTFail("Capture must not launch apps") })
            let content = LauncherContent(answer: NSViewController(), dictionary: dictionary)
            _ = content.view
            // An unordered fixture window gives native controls a drawing context.
            // Paint the token canvas so the PNG is opaque and readable by itself.
            let background = DictionaryCaptureBackground(frame: content.view.frame)
            background.addSubview(content.view)
            let window = NSWindow(contentRect: background.frame, styleMask: .borderless, backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = background
            defer { window.close() }
            content.setLoginState("disabledInTests")
            dictionary.onChange = { if dictionary.entry != nil { ready.fulfill() } }
            content.input.stringValue = "define " + word
            content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
            wait(for: [ready], timeout: 5)
            content.view.layoutSubtreeIfNeeded()
            let bitmap = try XCTUnwrap(background.bitmapImageRepForCachingDisplay(in: background.bounds))
            background.cacheDisplay(in: background.bounds, to: bitmap)
            try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
                .write(to: URL(fileURLWithPath: directory).appendingPathComponent(word == "사과" ? "korean.png" : "english.png"))
        }
    }
}

private final class DictionaryCaptureBackground: NSView {
    override func draw(_ dirtyRect: NSRect) {
        LinaTokens.Color.canvas.setFill()
        dirtyRect.fill()
    }
}
