// SPDX-License-Identifier: Apache-2.0
import AppKit
import XCTest
@testable import LinaLauncher

final class EmojiTests: XCTestCase {
    @MainActor func testBilingualNamesSymbolsKeywordsAndToneSequences() throws {
        _ = NSApplication.shared
        let emoji = LauncherEmoji(defaults: nil)
        for query in ["heart", "하트", "HEART", "  하트  ", "하트".decomposedStringWithCanonicalMapping] {
            let rows = emoji.update(query: query, composing: false)
            XCTAssertEqual(rows.first?.id, "emoji.❤️")
        }
        XCTAssertTrue(emoji.update(query: "저작권", composing: false).contains { $0.id == "emoji.©️" })
        emoji.preferences.setKeywords(["우리 사랑", "my favorite"], for: "❤️")
        XCTAssertEqual(emoji.update(query: "우리 사랑", composing: false).first?.id, "emoji.❤️")
        emoji.preferences.tone = 3
        XCTAssertTrue(emoji.update(query: "thumbs up", composing: false).contains { $0.title.contains("👍🏽") })
        XCTAssertTrue(emoji.update(query: "woman technologist", composing: false).contains { $0.title.contains("👩🏽‍💻") })
        XCTAssertTrue(emoji.update(query: "red heart", composing: false).contains { $0.title.hasPrefix("❤️") })
        XCTAssertTrue(emoji.update(query: "", composing: false).isEmpty)
        XCTAssertTrue(emoji.update(query: "emoji", composing: false).count > 10)
        XCTAssertTrue(emoji.update(query: "1234", composing: false).isEmpty)
        XCTAssertEqual(emoji.update(query: "❤️", composing: false).first?.id, "emoji.❤️")
        emoji.preferences.tone = 5
        XCTAssertTrue(emoji.update(query: "👍🏽", composing: false).first?.title.hasPrefix("👍🏽") == true)
        XCTAssertTrue(emoji.update(query: "heart", composing: true).isEmpty)
    }

    func testPreferencesRoundTripRecentFirstPinsDeduplicatedAndBounded() {
        let name = "org.lina.emoji.tests." + UUID().uuidString
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let prefs = EmojiPreferences(defaults: defaults)
        prefs.togglePin("❤️")
        prefs.record("👍")
        prefs.record("❤️")
        prefs.record("👍")
        prefs.setKeywords(["내 하트", "favorite"], for: "❤️")
        prefs.tone = 5
        let restored = EmojiPreferences(defaults: defaults)
        XCTAssertEqual(restored.recent, ["👍", "❤️"])
        XCTAssertEqual(restored.pinned, ["❤️"])
        XCTAssertEqual(restored.keywords["❤️"], ["내 하트", "favorite"])
        XCTAssertEqual(restored.tone, 5)
        restored.togglePin("❤️")
        XCTAssertTrue(restored.pinned.isEmpty)
        for entry in EmojiCatalog.shared.entries.prefix(60) { restored.record(entry.glyph) }
        XCTAssertEqual(restored.recent.count, 50)
    }

    @MainActor func testReturnRowReturnRecentsAndLocalProviderSwitching() throws {
        _ = NSApplication.shared
        let board = NSPasteboard.withUniqueName()
        defer { board.releaseGlobally() }
        let emoji = LauncherEmoji(defaults: nil)
        emoji.preferences.togglePin("👍")
        let content = LauncherContent(answer: NSViewController(), history: CalculatorHistory(defaults: nil),
                                      pasteboard: board, locale: Locale(identifier: "en_US"), emoji: emoji)
        _ = content.view
        var forwarded = 0
        content.onQuery = { _ in forwarded += 1 }
        content.onSubmit = { _, _ in forwarded += 1 }
        func type(_ query: String) {
            content.input.stringValue = query
            content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
        }
        type("하트")
        XCTAssertEqual(content.items.first?.id, "emoji.❤️")
        XCTAssertTrue(content.control(content.input, textView: NSTextView(), doCommandBy: #selector(NSResponder.insertNewline(_:))))
        XCTAssertEqual(board.string(forType: .string), "❤️")
        type("")
        XCTAssertEqual(content.items.prefix(2).map(\.id), ["emoji.❤️", "emoji.👍"])
        content.results.selectRowIndexes(IndexSet(integer: 1), byExtendingSelection: false)
        content.results.onActivate?()
        XCTAssertEqual(content.items.first?.id, "emoji.👍", "Copying from empty search moves that recent entry first immediately")
        type("thumbs up")
        emoji.toneButton.selectItem(at: 3)
        emoji.changeTone(nil)
        XCTAssertTrue(content.items.first?.title.contains("👍🏽") == true)
        content.results.onActivate?()
        XCTAssertEqual(board.string(forType: .string), "👍🏽")
        type("2^10")
        XCTAssertTrue(emoji.view.isHidden)
        content.results.onActivate?()
        XCTAssertEqual(board.string(forType: .string), "1,024")
        type("")
        XCTAssertEqual(content.items.first?.id, "emoji.👍")
        XCTAssertEqual(content.items.last?.id, "calculator-0")
        XCTAssertEqual(forwarded, 0)
        type("no-match-for-this-query")
        XCTAssertEqual(forwarded, 1)
        type("emoji no-match-for-this-query")
        content.results.onActivate?()
        XCTAssertEqual(forwarded, 1)
    }

    @MainActor func testStaleCompositionFailedCopyAndPreferenceControls() throws {
        _ = NSApplication.shared
        let emoji = LauncherEmoji(defaults: nil)
        _ = emoji.view
        _ = emoji.update(query: "red heart", composing: false)
        emoji.select(id: "emoji.❤️")
        emoji.togglePin(nil)
        XCTAssertEqual(emoji.preferences.pinned, ["❤️"])
        emoji.keywordInput.stringValue = "sweetheart, 내 마음"
        emoji.saveKeywords(nil)
        XCTAssertEqual(emoji.preferences.keywords["❤️"], ["sweetheart", "내 마음"])
        var copied: [String] = []
        XCTAssertTrue(emoji.copy(id: "emoji.❤️", query: "old draft", composing: false) { copied.append($0); return true })
        XCTAssertTrue(emoji.copy(id: "emoji.❤️", query: "red heart", composing: true) { copied.append($0); return true })
        XCTAssertTrue(copied.isEmpty)
        XCTAssertTrue(emoji.copy(id: "emoji.❤️", query: "red heart", composing: false) { _ in false })
        XCTAssertTrue(emoji.preferences.recent.isEmpty)
        XCTAssertTrue(emoji.message.contains("Could not copy"))
        _ = emoji.update(query: "sweetheart", composing: false)
        XCTAssertTrue(emoji.copy(id: "emoji.❤️", query: "sweetheart", composing: false) { copied.append($0); return true })
        XCTAssertEqual(copied, ["❤️"])
        XCTAssertEqual(emoji.preferences.recent, ["❤️"])
    }

    func testReleaseAppBundlesTheSameBilingualCatalog() throws {
        guard let path = ProcessInfo.processInfo.environment["LINA_EMOJI_APP_RESOURCE"] else { return }
        struct Catalog: Decodable { let entries: [EmojiEntry] }
        let app = try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        XCTAssertEqual(app.entries.map(\.glyph), EmojiCatalog.shared.entries.map(\.glyph))
        XCTAssertEqual(app.entries.first(where: { $0.glyph == "❤️" })?.en, "red heart")
    }

    @MainActor func testCaptureNativeEmojiSearchAndPreferences() throws {
        guard let directory = ProcessInfo.processInfo.environment["LINA_EMOJI_CAPTURES"] else { return }
        _ = NSApplication.shared
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        let emoji = LauncherEmoji(defaults: nil)
        let content = LauncherContent(answer: NSViewController(), history: CalculatorHistory(defaults: nil), emoji: emoji)
        _ = content.view
        let background = EmojiCaptureBackground(frame: content.view.frame)
        background.addSubview(content.view)
        let window = NSWindow(contentRect: background.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = background
        defer { window.close() }
        content.setLoginState("disabledInTests")
        emoji.preferences.tone = 3
        emoji.preferences.togglePin("👍")
        emoji.preferences.record("❤️")
        for (name, query) in [("korean", "하트"), ("english", "heart"), ("skin-tone", "thumbs up"), ("recents", "")] {
            content.input.stringValue = query
            content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
            content.view.layoutSubtreeIfNeeded()
            let bitmap = try XCTUnwrap(background.bitmapImageRepForCachingDisplay(in: background.bounds))
            background.cacheDisplay(in: background.bounds, to: bitmap)
            try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
                .write(to: URL(fileURLWithPath: directory).appendingPathComponent(name + ".png"))
        }
    }
}

private final class EmojiCaptureBackground: NSView {
    override func draw(_ dirtyRect: NSRect) {
        LinaTokens.Color.canvas.setFill()
        dirtyRect.fill()
    }
}
