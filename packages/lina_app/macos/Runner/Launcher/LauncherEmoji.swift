// SPDX-License-Identifier: Apache-2.0
import AppKit

struct EmojiEntry: Decodable {
    let glyph: String
    let en: String
    let ko: String
    let keywords: [String]
    let tones: [String]

    func display(tone: Int) -> String {
        (1...5).contains(tone) && tones.count == 5 ? tones[tone - 1] : glyph
    }
}

final class EmojiCatalog {
    static let shared = EmojiCatalog()
    let entries: [EmojiEntry]
    let byGlyph: [String: EmojiEntry]
    private let searchable: [String: String]

    private init() {
        struct Catalog: Decodable { let entries: [EmojiEntry] }
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        if let url = bundle.url(forResource: "emoji", withExtension: "json"),
           let data = try? Data(contentsOf: url), let catalog = try? JSONDecoder().decode(Catalog.self, from: data) {
            entries = catalog.entries
        } else { entries = [] }
        byGlyph = Dictionary(uniqueKeysWithValues: entries.map { ($0.glyph, $0) })
        searchable = Dictionary(uniqueKeysWithValues: entries.map {
            ($0.glyph, Self.normalize(([$0.en, $0.ko] + $0.keywords).joined(separator: " ")))
        })
    }

    static func normalize(_ value: String) -> String {
        value.precomposedStringWithCanonicalMapping
            .folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func term(_ query: String) -> (text: String, explicit: Bool) {
        let text = normalize(query)
        let parts = text.split(maxSplits: 1, whereSeparator: { $0.isWhitespace })
        if let first = parts.first, ["emoji", "이모지", "symbols", "기호"].contains(String(first)) {
            return (parts.count > 1 ? String(parts[1]) : "", true)
        }
        return (text, false)
    }

    func search(_ query: String, preferences: EmojiPreferences) -> [EmojiEntry] {
        let term = Self.term(query)
        if term.text.isEmpty && !term.explicit {
            var seen = Set<String>()
            return (preferences.recent + preferences.pinned).compactMap {
                seen.insert($0).inserted ? byGlyph[$0] : nil
            }
        }
        // Preserve the calculator's bare-number boundary; explicit emoji mode can find keycaps.
        if !term.explicit && !term.text.isEmpty && term.text.unicodeScalars.allSatisfy({ CharacterSet.decimalDigits.contains($0) }) {
            return []
        }
        let words = term.text.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        let ranked: [(EmojiEntry, Int)] = entries.compactMap { entry in
            let aliases = (preferences.keywords[entry.glyph] ?? []).map(Self.normalize)
            let names = [Self.normalize(entry.en), Self.normalize(entry.ko)]
            let glyphMatch = ([entry.glyph] + entry.tones).contains(term.text)
            let haystack = (searchable[entry.glyph] ?? "") + " " + aliases.joined(separator: " ")
            guard glyphMatch || words.allSatisfy({ haystack.contains($0) }) else { return nil }
            let rank: Int
            // These common heart names should copy the red-heart sequence, not the card suit.
            if entry.glyph == "❤️" && ["heart", "하트"].contains(term.text) { rank = -1 }
            else if glyphMatch || aliases.contains(term.text) || names.contains(term.text) { rank = 0 }
            else if entry.keywords.contains(where: { Self.normalize($0) == term.text }) { rank = 1 }
            else { rank = 2 }
            return (entry, rank)
        }
        return ranked.sorted {
            if $0.1 != $1.1 { return $0.1 < $1.1 }
            if $0.0.en.count != $1.0.en.count { return $0.0.en.count < $1.0.en.count }
            return $0.0.en < $1.0.en
        }.prefix(80).map { $0.0 }
    }
}

/// Only explicit preferences and successful copies are saved, locally on this Mac.
final class EmojiPreferences {
    private struct State: Codable {
        var recent: [String] = []
        var pinned: [String] = []
        var keywords: [String: [String]] = [:]
        var tone = 0
    }
    private var state: State
    private let defaults: UserDefaults?
    private let key = "launcher.emoji.preferences.v1"
    var recent: [String] { state.recent }
    var pinned: [String] { state.pinned }
    var keywords: [String: [String]] { state.keywords }
    var tone: Int {
        get { state.tone }
        set { state.tone = (0...5).contains(newValue) ? newValue : 0; save() }
    }
    init(defaults: UserDefaults?) {
        self.defaults = defaults
        state = defaults?.data(forKey: key).flatMap { try? JSONDecoder().decode(State.self, from: $0) } ?? State()
        if !(0...5).contains(state.tone) { state.tone = 0 }
        state.recent = Array(state.recent.prefix(50))
    }
    func record(_ glyph: String) {
        state.recent.removeAll { $0 == glyph }
        state.recent.insert(glyph, at: 0)
        state.recent = Array(state.recent.prefix(50))
        save()
    }
    func togglePin(_ glyph: String) {
        if state.pinned.contains(glyph) { state.pinned.removeAll { $0 == glyph } }
        else { state.pinned.append(glyph) }
        save()
    }
    func setKeywords(_ values: [String], for glyph: String) {
        state.keywords[glyph] = values.prefix(20).map {
            String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
        }.filter { !$0.isEmpty }
        save()
    }
    private func save() {
        if let data = try? JSONEncoder().encode(state) { defaults?.set(data, forKey: key) }
    }
}

/// Owns emoji search, copy and preference controls; shares only the launcher's rows.
public final class LauncherEmoji: NSViewController {
    let preferences: EmojiPreferences
    let toneButton = NSPopUpButton()
    let keywordInput = NSTextField()
    private let pinButton = NSButton(title: "Pin", target: nil, action: nil)
    private let saveButton = NSButton(title: "Save keywords", target: nil, action: nil)
    private let selectionLabel = NSTextField(labelWithString: "Select an emoji to pin or add keywords")
    private var selected: EmojiEntry?
    private var matches: [String: EmojiEntry] = [:]
    private var query = ""
    private var composing = false
    private(set) var active = false
    private(set) var message = ""
    var onChange: (() -> Void)?

    public init(defaults: UserDefaults? = .standard) {
        preferences = EmojiPreferences(defaults: defaults)
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(defaults:)") }

    public override func loadView() {
        view = NSView()
        toneButton.addItems(withTitles: ["Skin tone: Default", "Skin tone: Light", "Skin tone: Medium-light",
                                        "Skin tone: Medium", "Skin tone: Medium-dark", "Skin tone: Dark"])
        toneButton.selectItem(at: preferences.tone)
        toneButton.setAccessibilityLabel("Preferred emoji skin tone")
        toneButton.target = self
        toneButton.action = #selector(changeTone)
        pinButton.target = self
        pinButton.action = #selector(togglePin)
        keywordInput.placeholderString = "Your keywords, separated by commas"
        keywordInput.setAccessibilityLabel("Keywords for selected emoji, separated by commas")
        saveButton.target = self
        saveButton.action = #selector(saveKeywords)
        selectionLabel.textColor = LinaTokens.Color.text
        selectionLabel.font = .systemFont(ofSize: LinaAppTokens.typeLabelSize)
        selectionLabel.lineBreakMode = .byTruncatingTail
        let controls = NSStackView(views: [pinButton, toneButton])
        let keywords = NSStackView(views: [keywordInput, saveButton])
        for row in [controls, keywords] { row.orientation = .horizontal; row.spacing = LinaTokens.Space.inline }
        keywordInput.setContentHuggingPriority(.defaultLow, for: .horizontal)
        keywordInput.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let stack = NSStackView(views: [selectionLabel, controls, keywords])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = LinaTokens.Space.inline
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: view.topAnchor),
            keywords.widthAnchor.constraint(equalTo: stack.widthAnchor),
            selectionLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        view.isHidden = true
        select(id: nil)
    }

    func update(query: String, composing: Bool) -> [LauncherResult] {
        self.query = query
        self.composing = composing
        let entries = composing ? [] : EmojiCatalog.shared.search(query, preferences: preferences)
        matches = Dictionary(uniqueKeysWithValues: entries.map { ("emoji." + $0.glyph, $0) })
        active = !composing && (!entries.isEmpty || EmojiCatalog.term(query).explicit)
        message = EmojiCatalog.shared.entries.isEmpty ? "Emoji catalog unavailable" :
            entries.isEmpty ? "No emoji found · Try a Korean or English name" : "Emoji & symbols · ↩ Copy · Recents and pins stay on this Mac"
        return entries.map { entry in
            let pinned = preferences.pinned.contains(entry.glyph) ? " · Pinned" : ""
            let recent = preferences.recent.contains(entry.glyph) ? " · Recent" : ""
            return LauncherResult(id: "emoji." + entry.glyph, title: "\(display(entry))  \(entry.ko) · \(entry.en)\(pinned)\(recent)")
        }
    }

    func select(id: String?) {
        selected = id.flatMap { matches[$0] }
        view.isHidden = !active
        toneButton.selectItem(at: preferences.tone)
        pinButton.isEnabled = selected != nil
        keywordInput.isEnabled = selected != nil
        saveButton.isEnabled = selected != nil
        if let selected {
            selectionLabel.stringValue = "\(display(selected))  \(selected.ko) · \(selected.en)"
            pinButton.title = preferences.pinned.contains(selected.glyph) ? "Unpin" : "Pin"
            keywordInput.stringValue = (preferences.keywords[selected.glyph] ?? []).joined(separator: ", ")
        } else {
            selectionLabel.stringValue = "Select an emoji to pin or add keywords"
            keywordInput.stringValue = ""
        }
    }

    @objc func changeTone(_ sender: Any?) {
        preferences.tone = toneButton.indexOfSelectedItem
        onChange?()
    }
    @objc func togglePin(_ sender: Any?) {
        guard let selected else { return }
        preferences.togglePin(selected.glyph)
        onChange?()
    }
    @objc func saveKeywords(_ sender: Any?) {
        guard let selected, (keywordInput.currentEditor() as? NSTextView)?.hasMarkedText() != true else { return }
        preferences.setKeywords(keywordInput.stringValue.components(separatedBy: ","), for: selected.glyph)
        onChange?()
    }
    private func display(_ entry: EmojiEntry) -> String {
        let term = EmojiCatalog.term(query).text
        return entry.tones.contains(term) ? term : entry.display(tone: preferences.tone)
    }

    /// Consume stale/marked emoji actions without forwarding them or recording recents.
    func copy(id: String?, query: String, composing: Bool, write: (String) -> Bool) -> Bool {
        guard let id, id.hasPrefix("emoji.") else { return id == nil && active }
        guard !composing, !self.composing, self.query == query, let entry = matches[id] else { return true }
        guard write(display(entry)) else { message = "Could not copy emoji. Try again."; return true }
        preferences.record(entry.glyph)
        onChange?()
        message = "Copied · Recents stay on this Mac"
        return true
    }
}
