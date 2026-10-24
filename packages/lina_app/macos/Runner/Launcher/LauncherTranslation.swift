// SPDX-License-Identifier: Apache-2.0
import AppKit
import SwiftUI
import Translation

public struct TranslationPair: Equatable {
    public let source: String
    public let target: String
    public init(source: String, target: String) { self.source = source; self.target = target }
    static let initial = TranslationPair(source: "en", target: "ko")
    static let languages = ["en", "ko", "ja", "zh-Hans", "zh-Hant", "fr", "de", "es", "it", "pt", "ru", "ar"]
    var valid: Bool { Self.languages.contains(source) && Self.languages.contains(target) && source != target }
    var reversed: Self { Self(source: target, target: source) }
    var command: String { "tr:\(source):\(target)" }
    var label: String { "\(Self.name(source)) → \(Self.name(target))" }
    static func name(_ code: String) -> String { Locale.current.localizedString(forIdentifier: code) ?? code }
}

struct TranslationCommand: Equatable {
    let pair: TranslationPair
    let text: String
    static func parse(_ query: String, defaultPair: TranslationPair) -> Self? {
        let parts = query.trimmingCharacters(in: .whitespacesAndNewlines).split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
        guard let head = parts.first else { return nil }
        let command = String(head)
        guard command.lowercased() == "tr" || command.lowercased().hasPrefix("tr:") else { return nil }
        let codes = command.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        let pair = codes.count == 1 ? defaultPair : TranslationPair(source: codes.count == 3 ? codes[1] : "", target: codes.count == 3 ? codes[2] : "")
        return Self(pair: pair, text: parts.count == 2 ? String(parts[1]) : "")
    }
}

enum TranslationAvailability { case installed, downloadable, unsupported, unavailable }

/// The seam covers the same availability/download/translate path used by Apple Translation.
/// Implementations may download packs only when download is explicitly true.
@MainActor protocol DeviceTranslationService: AnyObject {
    var presentationView: NSView? { get }
    func availability(for pair: TranslationPair) async -> TranslationAvailability
    func translate(_ text: String, pair: TranslationPair, download: Bool) async throws -> String
    func cancel()
}

@MainActor private final class UnavailableTranslationService: DeviceTranslationService {
    var presentationView: NSView? { nil }
    func availability(for pair: TranslationPair) async -> TranslationAvailability { .unavailable }
    func translate(_ text: String, pair: TranslationPair, download: Bool) async throws -> String { throw CancellationError() }
    func cancel() {}
}

@available(macOS 15.0, *)
@MainActor final class AppleTranslationService: DeviceTranslationService {
    private let host = NSHostingView(rootView: AppleTranslationTask(job: nil))
    private var pending: TranslationJob?
    var presentationView: NSView? { host }

    func availability(for pair: TranslationPair) async -> TranslationAvailability {
        switch await LanguageAvailability().status(from: Locale.Language(identifier: pair.source), to: Locale.Language(identifier: pair.target)) {
        case .installed: return .installed
        case .supported: return .downloadable
        case .unsupported: return .unsupported
        @unknown default: return .unavailable
        }
    }
    func translate(_ text: String, pair: TranslationPair, download: Bool) async throws -> String {
        cancel()
        return try await withCheckedThrowingContinuation { continuation in
            let job = TranslationJob(text: text, pair: pair, download: download, continuation: continuation)
            pending = job
            host.rootView = AppleTranslationTask(job: job)
        }
    }
    func cancel() {
        pending?.finish(.failure(CancellationError()))
        pending = nil
        host.rootView = AppleTranslationTask(job: nil)
    }
}

@available(macOS 15.0, *)
@MainActor private final class TranslationJob: Identifiable {
    let id = UUID()
    let text: String
    let pair: TranslationPair
    let download: Bool
    private var continuation: CheckedContinuation<String, Error>?
    init(text: String, pair: TranslationPair, download: Bool, continuation: CheckedContinuation<String, Error>) {
        self.text = text; self.pair = pair; self.download = download; self.continuation = continuation
    }
    func finish(_ result: Result<String, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }
}

@available(macOS 15.0, *)
private struct AppleTranslationTask: View {
    let job: TranslationJob?
    var body: some View {
        if let job {
            Color.clear.translationTask(TranslationSession.Configuration(
                source: Locale.Language(identifier: job.pair.source), target: Locale.Language(identifier: job.pair.target)
            )) { session in
                do {
                    if job.download { try await session.prepareTranslation() }
                    // Recheck immediately before translation: no implicit download on a typing path.
                    let status = await LanguageAvailability().status(from: Locale.Language(identifier: job.pair.source), to: Locale.Language(identifier: job.pair.target))
                    guard status == .installed else { throw TranslationFailure.languagesMissing }
                    try Task.checkCancellation()
                    let response = try await session.translate(job.text)
                    job.finish(.success(response.targetText))
                } catch { job.finish(.failure(error)) }
            }.id(job.id)
        } else { Color.clear }
    }
}

private enum TranslationFailure: Error { case languagesMissing }

/// AppKit owns controls and selectable text. SwiftUI only hosts Apple's translation task
/// and its system download permission UI; neither Core nor a web service is involved.
@MainActor public final class LauncherTranslation: NSViewController {
    static let resultID = "translation.conversation"
    public let text = NSTextView()
    let source = NSPopUpButton()
    let target = NSPopUpButton()
    let swap = NSButton(title: "Swap", target: nil, action: nil)
    let useDefault = NSButton(title: "Use as default", target: nil, action: nil)
    let download = NSButton(title: "Download languages", target: nil, action: nil)
    let retry = NSButton(title: "Retry", target: nil, action: nil)
    let commandLabel = NSTextField(labelWithString: "")
    private(set) var active = false
    private(set) var translated: String?
    private(set) var defaultPair: TranslationPair
    var onResults: (([LauncherResult]) -> Void)?
    var onChange: (() -> Void)?
    var onReplaceQuery: ((String) -> Void)?
    var onContinue: ((String, @escaping (Bool) -> Void) -> Void)?
    var canAct: (() -> Bool)?
    private let service: DeviceTranslationService
    private let defaults: UserDefaults?
    private var command: TranslationCommand?
    private var task: Task<Void, Never>?
    private var generation: UInt = 0
    private var handingOff = false
    private var composing = false
    private static let preferenceKey = "launcher.translation.pair.v1"

    public convenience init(defaults: UserDefaults? = .standard) {
        if #available(macOS 15.0, *) { self.init(service: AppleTranslationService(), defaults: defaults) }
        else { self.init(service: UnavailableTranslationService(), defaults: defaults) }
    }
    init(service: DeviceTranslationService, defaults: UserDefaults? = nil) {
        self.service = service; self.defaults = defaults
        let saved = defaults?.stringArray(forKey: Self.preferenceKey) ?? []
        let pair = saved.count == 2 ? TranslationPair(source: saved[0], target: saved[1]) : .initial
        defaultPair = pair.valid ? pair : .initial
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(defaults:)") }
    public override func loadView() {
        view = NSView()
        if let bridge = service.presentationView {
            bridge.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(bridge)
            NSLayoutConstraint.activate([
                bridge.leadingAnchor.constraint(equalTo: view.leadingAnchor), bridge.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                bridge.topAnchor.constraint(equalTo: view.topAnchor), bridge.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            ])
        }
        for popup in [source, target] {
            popup.addItems(withTitles: TranslationPair.languages.map(TranslationPair.name))
            popup.target = self; popup.action = #selector(changePair)
        }
        source.setAccessibilityLabel("Translate from")
        target.setAccessibilityLabel("Translate to")
        for (button, action) in [(swap, #selector(swapPair)), (useDefault, #selector(saveDefault)),
                                  (download, #selector(downloadLanguages)), (retry, #selector(retryTranslation))] {
            button.target = self; button.action = action
        }
        let controls = NSStackView(views: [source, swap, target, useDefault])
        controls.orientation = .horizontal; controls.spacing = LinaTokens.Space.inline
        let actions = NSStackView(views: [download, retry])
        actions.orientation = .horizontal; actions.spacing = LinaTokens.Space.inline
        commandLabel.font = .systemFont(ofSize: LinaAppTokens.typeLabelSize)
        commandLabel.textColor = LinaTokens.Color.muted
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true; scroll.drawsBackground = false
        text.isEditable = false; text.isSelectable = true; text.isRichText = false; text.drawsBackground = false
        text.font = NSFont(name: LinaAppTokens.typeBody, size: LinaAppTokens.typeSize) ?? .systemFont(ofSize: LinaAppTokens.typeSize)
        text.textColor = LinaTokens.Color.text
        text.textContainerInset = NSSize(width: LinaTokens.Space.inline, height: LinaTokens.Space.inline)
        text.isVerticallyResizable = true; text.isHorizontallyResizable = false; text.autoresizingMask = [.width]
        text.textContainer?.widthTracksTextView = true
        text.setAccessibilityLabel("Device translation result")
        scroll.documentView = text
        for child in [controls, commandLabel, scroll, actions] {
            child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child)
            NSLayoutConstraint.activate([child.leadingAnchor.constraint(equalTo: view.leadingAnchor), child.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        }
        NSLayoutConstraint.activate([
            controls.topAnchor.constraint(equalTo: view.topAnchor),
            commandLabel.topAnchor.constraint(equalTo: controls.bottomAnchor, constant: LinaTokens.Space.inline),
            scroll.topAnchor.constraint(equalTo: commandLabel.bottomAnchor, constant: LinaTokens.Space.inline),
            scroll.bottomAnchor.constraint(equalTo: actions.topAnchor, constant: -LinaTokens.Space.inline),
            actions.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        view.isHidden = true
    }

    @discardableResult func update(query: String, composing: Bool) -> Bool {
        generation &+= 1; task?.cancel(); service.cancel()
        let wasActive = active
        command = TranslationCommand.parse(query, defaultPair: defaultPair)
        active = command != nil; self.composing = composing
        translated = nil; handingOff = false
        if wasActive || active { onResults?([]) }
        guard let command else { return false }
        download.isHidden = true; retry.isHidden = true
        for control in [source, target, swap, useDefault] as [NSControl] { control.isEnabled = !composing }
        guard command.pair.valid else { display("Choose two different languages. Use tr:en:ko <text> for English → Korean."); return true }
        source.selectItem(at: TranslationPair.languages.firstIndex(of: command.pair.source)!)
        target.selectItem(at: TranslationPair.languages.firstIndex(of: command.pair.target)!)
        commandLabel.stringValue = "\(command.pair.command) <text> · Default: \(defaultPair.label)"
        if composing { display("Finish typing to translate."); return true }
        guard !command.text.isEmpty else { display("Type text after tr, or use \(command.pair.command) <text>."); return true }
        start(command, download: false)
        return true
    }

    private func start(_ command: TranslationCommand, download allowDownload: Bool) {
        let current = generation
        translated = nil; onResults?([])
        download.isHidden = true; retry.isHidden = true
        display(allowDownload ? "Preparing languages for offline translation…" : "Translating on this Mac…")
        task = Task { [weak self] in
            guard let self else { return }
            // Typing invalidates the previous request; a brief debounce avoids starting a session per key.
            do {
                try await Task.sleep(nanoseconds: 150_000_000)
                let availability = await self.service.availability(for: command.pair)
                guard self.generation == current, !Task.isCancelled else { return }
                switch availability {
                case .unavailable: self.display("Device translation requires macOS 15 or later."); return
                case .unsupported: self.display("Apple Translation does not support this language pair. Choose another pair."); return
                case .downloadable where !allowDownload:
                    self.download.isHidden = false
                    self.display("Download \(command.pair.label) languages once to translate offline. An internet connection is needed only for the download.")
                    return
                default: break
                }
                let result = try await self.service.translate(command.text, pair: command.pair, download: allowDownload)
                guard self.generation == current, !Task.isCancelled else { return }
                guard !result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw TranslationFailure.languagesMissing }
                self.translated = result
                self.onResults?([LauncherResult(id: Self.resultID, title: "Continue in conversation · 대화로 이어 가기 ↩")])
                self.display(result)
            } catch {
                guard self.generation == current, !Task.isCancelled else { return }
                self.retry.isHidden = false
                self.display("Could not translate. If languages are not installed, download them while online, then retry. No message was sent.")
            }
        }
    }
    func activate(query: String) {
        guard !composing, canAct?() != false, !handingOff, let command, let translated,
              TranslationCommand.parse(query, defaultPair: defaultPair) == command else { return }
        guard let onContinue else { return }
        handingOff = true
        let current = generation
        let draft = "Translation (\(command.pair.label))\n\(command.text)\n\n\(translated)"
        onContinue(draft) { [weak self] accepted in
            guard let self, self.generation == current else { return }
            self.handingOff = false
            if !accepted { self.display("Could not add the draft. Finish any text composition in LINA, then try Continue in conversation again.\n\n" + translated) }
        }
    }
    @objc func changePair() {
        guard !composing, canAct?() != false else { return }
        let pair = TranslationPair(source: TranslationPair.languages[source.indexOfSelectedItem], target: TranslationPair.languages[target.indexOfSelectedItem])
        onReplaceQuery?(pair.command + " " + (command?.text ?? ""))
    }
    @objc func swapPair() {
        guard !composing, canAct?() != false, let command, command.pair.valid else { return }
        onReplaceQuery?(command.pair.reversed.command + " " + (translated ?? command.text))
    }
    @objc func saveDefault() {
        guard !composing, canAct?() != false, let pair = command?.pair, pair.valid else { return }
        defaultPair = pair
        defaults?.set([pair.source, pair.target], forKey: Self.preferenceKey)
        commandLabel.stringValue = "\(pair.command) <text> · Default: \(pair.label)"
    }
    @objc func downloadLanguages() {
        guard !composing, canAct?() != false, !download.isHidden, let command else { return }
        start(command, download: true)
    }
    @objc func retryTranslation() {
        guard !composing, canAct?() != false, !retry.isHidden, let command else { return }
        start(command, download: false)
    }
    private func display(_ value: String) { text.string = value; text.scrollToBeginningOfDocument(nil); onChange?() }
}
