// SPDX-License-Identifier: Apache-2.0
import AppKit
import Darwin
import XCTest
@testable import LinaLauncher

final class TranslationTests: XCTestCase {
    @MainActor func testTranslationCommandStaysLocalBeforeLanguagesAreInstalled() {
        _ = NSApplication.shared
        let content = LauncherContent(answer: NSViewController())
        _ = content.view
        var forwarded = 0
        content.onQuery = { _ in forwarded += 1 }
        content.onSubmit = { _, _ in forwarded += 1 }
        content.input.stringValue = "tr good morning"
        content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
        _ = content.control(content.input, textView: NSTextView(), doCommandBy: #selector(NSResponder.insertNewline(_:)))
        XCTAssertEqual(forwarded, 0, "Translation must never fall through to the Core query/submit channel")
        XCTAssertTrue(content.status.stringValue.contains("Device translation"))
        content.input.stringValue = ""
        content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
    }
    @MainActor func testEmojiAndTranslationKeepSelectionAndActionsSeparate() {
        _ = NSApplication.shared
        let board = NSPasteboard.withUniqueName()
        defer { board.releaseGlobally() }
        let answer = NSViewController()
        let emoji = LauncherEmoji(defaults: nil)
        let translation = LauncherTranslation(service: TranslationFixture())
        let content = LauncherContent(answer: answer, history: CalculatorHistory(defaults: nil),
                                      pasteboard: board, emoji: emoji, translation: translation)
        _ = content.view
        content.onQuery = { _ in XCTFail("Local query forwarded") }
        content.onSubmit = { _, _ in XCTFail("Local action forwarded") }
        type("하트", into: content)
        content.results.onActivate?()
        XCTAssertEqual(board.string(forType: .string), "❤️")
        let ready = expectation(description: "translation after emoji")
        translation.onChange = { if translation.translated != nil { ready.fulfill() } }
        type("tr good morning", into: content)
        wait(for: [ready], timeout: 5)
        translation.onChange = nil
        XCTAssertEqual(content.items.first?.id, LauncherTranslation.resultID)
        XCTAssertTrue(emoji.view.isHidden)
        XCTAssertTrue(answer.view.isHidden, "A late translation row must keep the ordinary answer hidden")
        var drafts: [String] = []
        content.onConversationDraft = { text, done in drafts.append(text); done(true) }
        content.results.onActivate?()
        XCTAssertEqual(drafts.count, 1)
        XCTAssertEqual(board.string(forType: .string), "❤️")
        type("heart", into: content)
        XCTAssertTrue(translation.view.isHidden)
        XCTAssertFalse(emoji.view.isHidden)
        content.results.onActivate?()
        XCTAssertEqual(drafts.count, 1)
        type("", into: content)
        XCTAssertEqual(content.items.first?.id, "emoji.❤️")
    }

    func testCommandBoundariesAndExplicitPairs() {
        XCTAssertNil(TranslationCommand.parse("translate hello", defaultPair: .initial))
        XCTAssertNil(TranslationCommand.parse("trouble", defaultPair: .initial))
        XCTAssertEqual(TranslationCommand.parse(" TR good morning ", defaultPair: .initial)?.text, "good morning")
        XCTAssertEqual(TranslationCommand.parse("tr", defaultPair: .initial)?.text, "")
        XCTAssertEqual(TranslationCommand.parse("tr:ko:en 안녕하세요", defaultPair: .initial)?.pair, TranslationPair(source: "ko", target: "en"))
        XCTAssertEqual(TranslationCommand.parse("tr:zh-Hans:ko 早上好", defaultPair: .initial)?.pair.source, "zh-Hans")
        for query in ["tr:en", "tr:en:ko:ja text", "tr:en:en text", "tr:xx:ko text"] {
            XCTAssertFalse(TranslationCommand.parse(query, defaultPair: .initial)!.pair.valid)
        }
    }

    @MainActor func testInstalledLanguagesTranslateOfflineAndContinueAsDraft() {
        _ = NSApplication.shared
        if ProcessInfo.processInfo.environment["LINA_TRANSLATION_OFFLINE"] == "1" {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            if fd < 0 {
                XCTAssertTrue([EPERM, EACCES].contains(errno))
            } else {
                defer { close(fd) }
                var address = sockaddr_in()
                address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                address.sin_family = sa_family_t(AF_INET)
                address.sin_port = UInt16(9).bigEndian
                address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
                let result = withUnsafePointer(to: &address) { pointer in
                    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
                }
                let error = errno
                XCTAssertEqual(result, -1)
                XCTAssertTrue([EPERM, EACCES].contains(error), "Network must be denied, not merely disconnected: \(error)")
            }
        }
        let service = TranslationFixture()
        let translation = LauncherTranslation(service: service)
        let content = LauncherContent(answer: NSViewController(), translation: translation)
        _ = content.view
        content.onQuery = { _ in XCTFail("Local translation forwarded") }
        content.onSubmit = { _, _ in XCTFail("Local translation submitted") }
        let ready = expectation(description: "offline translation")
        translation.onChange = { if translation.translated != nil { ready.fulfill() } }
        type("tr good morning", into: content)
        wait(for: [ready], timeout: 5)
        translation.onChange = nil
        XCTAssertEqual(translation.text.string, "좋은 아침")
        XCTAssertEqual(service.calls.map(\.download), [false])
        XCTAssertEqual(service.calls.first?.pair, .initial)
        XCTAssertEqual(content.items.map(\.id), [LauncherTranslation.resultID])
        var drafts: [String] = []
        var finish: ((Bool) -> Void)?
        content.onConversationDraft = { value, completion in drafts.append(value); finish = completion }
        _ = content.control(content.input, textView: NSTextView(), doCommandBy: #selector(NSResponder.insertNewline(_:)))
        content.results.onActivate?() // A pending handoff cannot be delivered twice.
        XCTAssertEqual(drafts.count, 1)
        XCTAssertTrue(drafts[0].contains("good morning\n\n좋은 아침"))
        finish?(false)
        XCTAssertTrue(translation.text.string.contains("Could not add the draft"))
        content.results.onActivate?()
        XCTAssertEqual(drafts.count, 2)
        finish?(true)
    }

    @MainActor func testDownloadIsExplicitAndUnsupportedPairsNeverTranslate() {
        _ = NSApplication.shared
        let service = TranslationFixture()
        service.state = .downloadable
        let translation = LauncherTranslation(service: service)
        _ = translation.view
        let missing = expectation(description: "download guidance")
        translation.onChange = { if !translation.download.isHidden { missing.fulfill() } }
        translation.update(query: "tr good morning", composing: false)
        wait(for: [missing], timeout: 5)
        XCTAssertTrue(service.calls.isEmpty)
        XCTAssertNil(translation.translated)
        let ready = expectation(description: "explicit download then translation")
        translation.onChange = { if translation.translated != nil { ready.fulfill() } }
        translation.downloadLanguages()
        wait(for: [ready], timeout: 5)
        XCTAssertEqual(service.calls.map(\.download), [true])
        service.state = .unsupported
        let unsupported = expectation(description: "unsupported pair")
        translation.onChange = { if translation.text.string.contains("does not support") { unsupported.fulfill() } }
        translation.update(query: "tr:ja:ko text", composing: false)
        wait(for: [unsupported], timeout: 5)
        XCTAssertNil(translation.translated)
        XCTAssertEqual(service.calls.count, 1)
    }

    @MainActor func testSwapAndDefaultPersistOnlyLanguageCodes() {
        _ = NSApplication.shared
        let name = "org.lina.tests.translation." + UUID().uuidString
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let service = TranslationFixture()
        let translation = LauncherTranslation(service: service, defaults: defaults)
        let content = LauncherContent(answer: NSViewController(), translation: translation)
        _ = content.view
        let ready = expectation(description: "translation before swap")
        translation.onChange = { if translation.translated != nil { ready.fulfill() } }
        type("tr good morning", into: content)
        wait(for: [ready], timeout: 5)
        translation.onChange = nil
        translation.swapPair()
        XCTAssertEqual(content.input.stringValue, "tr:ko:en 좋은 아침")
        translation.saveDefault()
        XCTAssertEqual(translation.defaultPair, TranslationPair(source: "ko", target: "en"))
        XCTAssertEqual(defaults.persistentDomain(forName: name)?["launcher.translation.pair.v1"] as? [String], ["ko", "en"])
        XCTAssertEqual(defaults.persistentDomain(forName: name)?.count, 1)
        let restored = LauncherTranslation(service: TranslationFixture(), defaults: defaults)
        XCTAssertEqual(restored.defaultPair, translation.defaultPair)
        translation.source.selectItem(at: TranslationPair.languages.firstIndex(of: "ja")!)
        translation.changePair()
        XCTAssertEqual(content.input.stringValue, "tr:ja:en 좋은 아침")
        type("", into: content)
    }

    @MainActor func testCompositionAndStaleCompletionCannotReplaceAnotherProvider() {
        _ = NSApplication.shared
        let service = TranslationFixture()
        service.hold = true
        let translation = LauncherTranslation(service: service)
        let content = LauncherContent(answer: NSViewController(), translation: translation)
        _ = content.view
        let started = expectation(description: "old translation started")
        service.onStarted = { started.fulfill() }
        type("tr old text", into: content)
        wait(for: [started], timeout: 5)
        translation.update(query: "tr 새", composing: true)
        translation.swapPair()
        translation.saveDefault()
        translation.downloadLanguages()
        translation.activate(query: "tr 새")
        XCTAssertNil(translation.translated)
        XCTAssertEqual(service.calls.count, 1)
        type("2^10", into: content)
        service.pending?.resume(returning: "STALE")
        service.pending = nil
        let drained = expectation(description: "completion drained")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { drained.fulfill() }
        wait(for: [drained], timeout: 5)
        XCTAssertNil(translation.translated)
        XCTAssertTrue(translation.view.isHidden)
        XCTAssertEqual(content.items.first?.id, "calculator-0")
    }

    @MainActor func testErrorsCanRetryAndOlderOSIsExplicit() {
        _ = NSApplication.shared
        let service = TranslationFixture()
        service.fail = true
        let translation = LauncherTranslation(service: service)
        _ = translation.view
        let failed = expectation(description: "failure")
        translation.onChange = { if !translation.retry.isHidden { failed.fulfill() } }
        translation.update(query: "tr good morning", composing: false)
        wait(for: [failed], timeout: 5)
        XCTAssertNil(translation.translated)
        service.fail = false
        let ready = expectation(description: "retried")
        translation.onChange = { if translation.translated != nil { ready.fulfill() } }
        translation.retryTranslation()
        wait(for: [ready], timeout: 5)
        XCTAssertEqual(service.calls.map(\.download), [false, false])
        service.state = .unavailable
        let unavailable = expectation(description: "older OS")
        translation.onChange = { if translation.text.string.contains("requires macOS 15") { unavailable.fulfill() } }
        translation.update(query: "tr next", composing: false)
        wait(for: [unavailable], timeout: 5)
        XCTAssertNil(translation.translated)
        XCTAssertEqual(service.calls.count, 2)
    }

    @MainActor func testRecordsActualAppleLanguageAvailability() async throws {
        guard let directory = ProcessInfo.processInfo.environment["LINA_TRANSLATION_CAPTURES"] else { return }
        var observed = "requires-macOS-15"
        if #available(macOS 15.0, *) {
            let service = AppleTranslationService()
            switch await service.availability(for: .initial) {
            case .installed: observed = "installed"
            case .downloadable: observed = "download-required"
            case .unsupported: observed = "unsupported"
            case .unavailable: observed = "unavailable"
            }
            service.cancel()
        }
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        let record: [String: Any] = ["pair": "en-ko", "availability": observed,
            "physicalOfflineAcceptance": "unverified; tracked in #116",
            "os": ProcessInfo.processInfo.operatingSystemVersionString]
        try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys])
            .write(to: URL(fileURLWithPath: directory).appendingPathComponent("availability.json"))
    }

    @MainActor func testCapturesSyntheticTranslationAndDownloadViews() throws {
        guard let directory = ProcessInfo.processInfo.environment["LINA_TRANSLATION_CAPTURES"] else { return }
        _ = NSApplication.shared
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        for installed in [true, false] {
            let service = TranslationFixture()
            service.state = installed ? .installed : .downloadable
            let translation = LauncherTranslation(service: service)
            let content = LauncherContent(answer: NSViewController(), translation: translation)
            _ = content.view
            let background = TranslationCaptureBackground(frame: content.view.frame)
            background.addSubview(content.view)
            let window = NSWindow(contentRect: background.frame, styleMask: .borderless, backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.contentView = background
            defer { window.close() }
            content.setLoginState("disabledInTests")
            let ready = expectation(description: "capture")
            translation.onChange = {
                if installed ? translation.translated != nil : !translation.download.isHidden { ready.fulfill() }
            }
            type("tr good morning", into: content)
            wait(for: [ready], timeout: 5)
            content.view.layoutSubtreeIfNeeded()
            let bitmap = try XCTUnwrap(background.bitmapImageRepForCachingDisplay(in: background.bounds))
            background.cacheDisplay(in: background.bounds, to: bitmap)
            try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
                .write(to: URL(fileURLWithPath: directory).appendingPathComponent(installed ? "translation.png" : "download.png"))
        }
    }

    @MainActor private func type(_ query: String, into content: LauncherContent) {
        content.input.stringValue = query
        content.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
    }

}


@MainActor private final class TranslationFixture: DeviceTranslationService {
    var presentationView: NSView? { nil }
    var state: TranslationAvailability = .installed
    var calls: [(text: String, pair: TranslationPair, download: Bool)] = []
    var hold = false
    var fail = false
    var onStarted: (() -> Void)?
    var pending: CheckedContinuation<String, Error>?
    func availability(for pair: TranslationPair) async -> TranslationAvailability { state }
    func translate(_ text: String, pair: TranslationPair, download: Bool) async throws -> String {
        calls.append((text, pair, download))
        onStarted?()
        if fail { throw NSError(domain: "synthetic-translation", code: 1) }
        if hold { return try await withCheckedThrowingContinuation { pending = $0 } }
        return "좋은 아침"
    }
    func cancel() {} // Deliberately allow late completions to exercise the provider's generation guard.
}

private final class TranslationCaptureBackground: NSView {
    override func draw(_ dirtyRect: NSRect) { LinaTokens.Color.canvas.setFill(); dirtyRect.fill() }
}
