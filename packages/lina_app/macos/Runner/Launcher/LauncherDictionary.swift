// SPDX-License-Identifier: Apache-2.0
import AppKit
import CoreServices

/// Public Dictionary Services only: nil selects the person's active local dictionaries.
/// No dictionary download, preference mutation, web fallback or Core request.
public enum DeviceDictionary {
    public static func word(in query: String) -> String? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = trimmed.split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
        guard parts.first?.lowercased() == "define" else { return nil }
        return parts.count == 1 ? "" : String(parts[1]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func definition(for word: String) -> String? {
        guard !word.isEmpty else { return nil }
        let range = CFRange(location: 0, length: word.utf16.count)
        guard let value = DCSCopyTextDefinition(nil, word as CFString, range)?.takeRetainedValue() else { return nil }
        let definition = (value as String).trimmingCharacters(in: .whitespacesAndNewlines)
        return definition.isEmpty ? nil : definition
    }

    public static func entryURL(for word: String) -> URL? {
        // Encode the entire term as one path component, including URL delimiters.
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#%")
        guard !word.isEmpty, let term = word.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        return URL(string: "dict:///" + term)
    }

    public static func open(_ word: String, completion: @escaping (Bool) -> Void) {
        guard let url = entryURL(for: word),
              let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Dictionary") else {
            completion(false); return
        }
        // Explicitly target Dictionary.app; do not delegate to an arbitrary URL handler.
        NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            DispatchQueue.main.async { completion(error == nil) }
        }
    }
}

/// Owns dictionary presentation and work; the shared result list only hosts its row.
public final class LauncherDictionary: NSViewController {
    static let resultID = "dictionary.entry"
    public let text = NSTextView()
    private(set) var active = false
    private(set) var entry: String?
    var onResults: (([LauncherResult]) -> Void)?
    var onOpened: (() -> Void)?
    var onChange: (() -> Void)?
    private let lookup: (String) -> String?
    private let openEntry: (String, @escaping (Bool) -> Void) -> Void
    private let queue = DispatchQueue(label: "org.lina.app.dictionary", qos: .userInitiated)
    private var pending: DispatchWorkItem?
    private var generation: UInt = 0
    private var opening = false

    public init(lookup: @escaping (String) -> String? = DeviceDictionary.definition,
                open: @escaping (String, @escaping (Bool) -> Void) -> Void = DeviceDictionary.open) {
        self.lookup = lookup
        self.openEntry = open
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(lookup:open:)") }

    public override func loadView() {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        text.isEditable = false
        text.isSelectable = true
        text.isRichText = false
        text.drawsBackground = false
        text.font = NSFont(name: LinaAppTokens.typeBody, size: LinaAppTokens.typeSize)
            ?? .systemFont(ofSize: LinaAppTokens.typeSize)
        text.textColor = LinaTokens.Color.text
        text.textContainerInset = NSSize(width: LinaTokens.Space.inline, height: LinaTokens.Space.inline)
        text.isVerticallyResizable = true
        text.isHorizontallyResizable = false
        text.autoresizingMask = [.width]
        text.textContainer?.widthTracksTextView = true
        text.setAccessibilityLabel("Device dictionary definition")
        scroll.documentView = text
        view = scroll
        view.isHidden = true
    }

    @discardableResult func update(query: String, composing: Bool) -> Bool {
        generation &+= 1
        let current = generation
        pending?.cancel()
        pending = nil
        entry = nil
        opening = false
        let wasActive = active
        let word = DeviceDictionary.word(in: query)
        active = word != nil
        if wasActive || active { onResults?([]) }
        guard let word else { return false }
        if composing { display("Finish typing to look up a word."); return true }
        guard !word.isEmpty else { display("Type a word after define."); return true }
        display("Looking up “\(word)” in device dictionaries…")
        let lookup = self.lookup
        let work = DispatchWorkItem { [weak self] in
            let definition = lookup(word)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.generation == current, self.active else { return }
                if let definition, !definition.isEmpty {
                    self.entry = word
                    self.onResults?([LauncherResult(id: Self.resultID, title: "\(word) — Open in Dictionary ↩")])
                    self.display(definition)
                } else {
                    self.display("No definition for “\(word)” in your active device dictionaries. Enable an English or Korean dictionary in the Dictionary app’s settings if needed. No online lookup was made.")
                }
            }
        }
        pending = work
        queue.async(execute: work)
        return true
    }

    func activate(query: String) {
        guard active, !opening, let word = entry, DeviceDictionary.word(in: query) == word else { return }
        opening = true
        let current = generation
        openEntry(word) { [weak self] success in
            guard let self, self.generation == current else { return }
            self.opening = false
            if success { self.onOpened?() }
            else { self.display("Could not open Dictionary. Try again.\n\n" + self.text.string) }
        }
    }

    private func display(_ value: String) {
        text.string = value
        text.scrollToBeginningOfDocument(nil)
        onChange?()
    }
}
