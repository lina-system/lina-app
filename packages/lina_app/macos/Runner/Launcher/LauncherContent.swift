// SPDX-License-Identifier: Apache-2.0
import AppKit

public struct LauncherResult: Equatable {
    public let id: String
    public let title: String
    public init(id: String, title: String) { self.id = id; self.title = title }
}

public final class LauncherContent: NSViewController, NSTextFieldDelegate, NSTableViewDataSource, NSTableViewDelegate {
    public let input = NSTextField()
    public let results = LauncherResultsTable()
    public let loginButton = NSButton(checkboxWithTitle: "Open at login", target: nil, action: nil)
    public let status = NSTextField(labelWithString: "Type define <word> or tr <text> for device lookup")
    public var onQuery: ((String) -> Void)?
    public var onSubmit: ((String, String?) -> Void)?
    public var onDismiss: (() -> Void)?
    public var onOpenApp: (() -> Void)?
    public var onConversationDraft: ((String, @escaping (Bool) -> Void) -> Void)?
    public var onLoginChange: ((Bool) -> Void)?
    public private(set) var items: [LauncherResult] = []
    private let history: CalculatorHistory
    private let pasteboard: NSPasteboard
    private let locale: Locale
    private var calculatorItems: [String: CalculatorAnswer] = [:]
    private let answer: NSViewController
    private let dictionary: LauncherDictionary
    private let emoji: LauncherEmoji
    private let translation: LauncherTranslation
    private let loginStatus = NSTextField(labelWithString: "")

    public init(answer: NSViewController, history: CalculatorHistory = CalculatorHistory(),
                pasteboard: NSPasteboard = .general, locale: Locale = .current,
                dictionary: LauncherDictionary? = nil, emoji: LauncherEmoji? = nil,
                translation: LauncherTranslation? = nil) {
        self.answer = answer; self.history = history; self.pasteboard = pasteboard; self.locale = locale
        self.dictionary = dictionary ?? LauncherDictionary()
        self.emoji = emoji ?? LauncherEmoji()
        self.translation = translation ?? LauncherTranslation()
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(answer:)") }
    public override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: LinaAppTokens.launcherWidth, height: LinaAppTokens.launcherHeight))
        let title = NSTextField(labelWithString: "lina.")
        title.font = NSFont(name: LinaAppTokens.typeBody, size: LinaAppTokens.typeTitleSize)
            ?? .systemFont(ofSize: LinaAppTokens.typeTitleSize, weight: .bold)
        title.textColor = LinaTokens.Color.text
        input.placeholderString = "Search or ask LINA"
        input.font = NSFont(name: LinaAppTokens.typeBody, size: LinaAppTokens.typeSize)
            ?? .systemFont(ofSize: LinaAppTokens.typeSize)
        input.textColor = LinaTokens.Color.text
        input.backgroundColor = LinaTokens.Color.surface
        input.delegate = self
        input.setAccessibilityLabel("Search or ask LINA")
        input.isAutomaticTextCompletionEnabled = false
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("result"))
        results.addTableColumn(column)
        results.headerView = nil
        results.rowHeight = LinaAppTokens.controlMinimum
        results.backgroundColor = LinaTokens.Color.canvas
        results.dataSource = self
        results.delegate = self
        results.target = self
        results.doubleAction = #selector(activateSelection)
        results.onActivate = { [weak self] in self?.activateSelection() }
        results.setAccessibilityLabel("Launcher results")
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.documentView = results
        status.textColor = LinaTokens.Color.muted
        status.font = .systemFont(ofSize: LinaAppTokens.typeLabelSize)
        let open = NSButton(title: "Open LINA", target: self, action: #selector(openApp))
        let quit = NSButton(title: "Quit", target: NSApp, action: #selector(NSApplication.terminate(_:)))
        loginButton.target = self
        loginButton.action = #selector(changeLogin)
        loginStatus.textColor = LinaTokens.Color.muted
        loginStatus.font = .systemFont(ofSize: LinaAppTokens.typeLabelSize)
        let footer = NSStackView(views: [open, loginButton, quit])
        footer.orientation = .horizontal
        footer.spacing = LinaTokens.Space.inline
        addChild(answer)
        for child in [title, input, status, scroll, answer.view, footer, loginStatus] {
            child.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child)
        }
        addChild(dictionary)
        dictionary.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(dictionary.view)
        NSLayoutConstraint.activate([
            dictionary.view.leadingAnchor.constraint(equalTo: answer.view.leadingAnchor),
            dictionary.view.trailingAnchor.constraint(equalTo: answer.view.trailingAnchor),
            dictionary.view.topAnchor.constraint(equalTo: answer.view.topAnchor),
            dictionary.view.bottomAnchor.constraint(equalTo: answer.view.bottomAnchor),
        ])
        addChild(emoji)
        emoji.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(emoji.view)
        NSLayoutConstraint.activate([
            emoji.view.leadingAnchor.constraint(equalTo: answer.view.leadingAnchor),
            emoji.view.trailingAnchor.constraint(equalTo: answer.view.trailingAnchor),
            emoji.view.topAnchor.constraint(equalTo: answer.view.topAnchor),
            emoji.view.bottomAnchor.constraint(equalTo: answer.view.bottomAnchor),
        ])
        emoji.onChange = { [weak self] in
            guard let self else { return }
            let selected = self.items.indices.contains(self.results.selectedRow) ? self.items[self.results.selectedRow].id : nil
            self.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
            if let index = self.items.firstIndex(where: { $0.id == selected }) {
                self.results.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
            }
        }
        dictionary.onResults = { [weak self] in self?.setResults($0) }
        dictionary.onOpened = { [weak self] in self?.onDismiss?() }
        addChild(translation)
        translation.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(translation.view)
        NSLayoutConstraint.activate([
            translation.view.leadingAnchor.constraint(equalTo: answer.view.leadingAnchor),
            translation.view.trailingAnchor.constraint(equalTo: answer.view.trailingAnchor),
            translation.view.topAnchor.constraint(equalTo: answer.view.topAnchor),
            translation.view.bottomAnchor.constraint(equalTo: answer.view.bottomAnchor),
        ])
        translation.onResults = { [weak self] in self?.setResults($0) }
        translation.canAct = { [weak self] in
            guard let self else { return false }
            return (self.input.currentEditor() as? NSTextView)?.hasMarkedText() != true
        }
        translation.onReplaceQuery = { [weak self] query in
            guard let self else { return }
            self.input.stringValue = query
            self.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
        }
        translation.onContinue = { [weak self] text, completion in
            guard let handler = self?.onConversationDraft else { completion(false); return }
            handler(text, completion)
        }
        let gap = LinaTokens.Space.inline
        let inset = LinaTokens.Space.gutter
        for child in [title, input, status, scroll, answer.view, footer, loginStatus] {
            NSLayoutConstraint.activate([
                child.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: inset),
                child.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -inset),
            ])
        }
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: view.topAnchor, constant: inset),
            input.topAnchor.constraint(equalTo: title.bottomAnchor, constant: gap),
            input.heightAnchor.constraint(equalToConstant: LinaAppTokens.controlMinimum),
            status.topAnchor.constraint(equalTo: input.bottomAnchor, constant: gap),
            scroll.topAnchor.constraint(equalTo: status.bottomAnchor, constant: gap),
            scroll.heightAnchor.constraint(equalToConstant: LinaAppTokens.launcherResultsHeight),
            answer.view.topAnchor.constraint(equalTo: scroll.bottomAnchor, constant: gap),
            answer.view.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -gap),
            footer.bottomAnchor.constraint(equalTo: loginStatus.topAnchor, constant: -gap),
            loginStatus.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -inset),
        ])
        controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
    }
    public func setResults(_ items: [LauncherResult]) {
        self.items = items
        results.reloadData()
        if items.isEmpty { results.deselectAll(nil) }
        else { results.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false) }
        updateEmojiSelection()
    }
    public func tableViewSelectionDidChange(_ notification: Notification) { updateEmojiSelection() }
    private func updateEmojiSelection() {
        let id = items.indices.contains(results.selectedRow) ? items[results.selectedRow].id : nil
        emoji.select(id: id)
        answer.view.isHidden = dictionary.active || translation.active || emoji.active
    }
    public func setLoginState(_ state: String) {
        loginButton.state = state == "enabled" || state == "requiresApproval" ? .on : .off
        loginButton.isEnabled = !["disabledInTests", "unsupported", "notFound"].contains(state)
        loginStatus.stringValue = state == "requiresApproval" ? "Allow LINA in System Settings → Login Items" : ""
    }
    public func showLoginError() { loginStatus.stringValue = "Could not change Open at login. Try again." }
    @objc private func changeLogin() { onLoginChange?(loginButton.state == .on) }
    @objc private func openApp() { onOpenApp?() }
    @objc private func activateSelection() {
        guard results.selectedRow >= 0, results.selectedRow < items.count else { return }
        submitSelection(id: items[results.selectedRow].id)
    }
    public func numberOfRows(in tableView: NSTableView) -> Int { items.count }
    public func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let label = NSTextField(labelWithString: items[row].title)
        label.font = .systemFont(ofSize: LinaAppTokens.typeSize)
        label.textColor = LinaTokens.Color.text
        return label
    }
    public func controlTextDidChange(_ obj: Notification) {
        calculatorItems.removeAll()
        _ = emoji.update(query: "", composing: true)
        emoji.view.isHidden = true
        let composing = (input.currentEditor() as? NSTextView)?.hasMarkedText() ?? false
        let local = dictionary.update(query: input.stringValue, composing: composing)
        dictionary.view.isHidden = !local
        let translating = translation.update(query: input.stringValue, composing: composing)
        translation.view.isHidden = !translating
        answer.view.isHidden = local || translating
        if translating {
            status.stringValue = "Device translation · ↩ Continue in conversation"
            return
        }
        if local {
            status.stringValue = "Device dictionary · ↩ Open in Dictionary"
            return
        }
        if composing {
            setResults([])
            return
        }
        let query = input.stringValue
        let answers: [CalculatorAnswer]
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { answers = history.entries }
        else { answers = Calculator.evaluate(query).map { [$0] } ?? [] }
        let rows = answers.enumerated().map { index, answer -> LauncherResult in
            let id = "calculator-\(index)"
            calculatorItems[id] = answer
            let title = query.isEmpty ? "\(answer.expression) = \(answer.formatted(locale: locale))" : answer.formatted(locale: locale)
            return LauncherResult(id: id, title: title)
        }
        let emojiRows = rows.isEmpty || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? emoji.update(query: query, composing: false) : []
        setResults(emojiRows + rows)
        if emoji.active {
            status.stringValue = emoji.message
            return
        }
        status.stringValue = rows.isEmpty ? "Search is not connected yet" : "Calculator · ↩ Copy · ⌥⌘C Copy unformatted · History on this Mac"
        if rows.isEmpty { onQuery?(query) }
    }
    private func submitSelection(id: String?) {
        if translation.active { translation.activate(query: input.stringValue) }
        else if dictionary.active { dictionary.activate(query: input.stringValue) }
        else if emoji.copy(id: id, query: input.stringValue,
                           composing: (input.currentEditor() as? NSTextView)?.hasMarkedText() == true,
                           write: { [pasteboard] value in
                               pasteboard.clearContents()
                               return pasteboard.setString(value, forType: .string)
                           }) { status.stringValue = emoji.message }
        else if !copyCalculator(unformatted: false) { onSubmit?(input.stringValue, id) }
    }
    @objc public func copyCalculatorUnformatted(_ sender: Any?) { _ = copyCalculator(unformatted: true) }
    @discardableResult private func copyCalculator(unformatted: Bool) -> Bool {
        guard (input.currentEditor() as? NSTextView)?.hasMarkedText() != true,
              items.indices.contains(results.selectedRow),
              let answer = calculatorItems[items[results.selectedRow].id] else { return false }
        // Re-evaluate the current draft so an old row can never copy a stale answer.
        guard input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
              Calculator.evaluate(input.stringValue) == answer else { return false }
        pasteboard.clearContents()
        guard pasteboard.setString(unformatted ? answer.unformatted : answer.formatted(locale: locale), forType: .string) else { return true }
        history.record(answer)
        status.stringValue = "Copied · History stays on this Mac"
        return true
    }
    public func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        // AppKit/IME consumes marked-text commands before our navigation actions.
        guard !textView.hasMarkedText() else { return false }
        switch commandSelector {
        case #selector(NSResponder.cancelOperation(_:)): onDismiss?(); return true
        case #selector(NSResponder.moveDown(_:)), #selector(NSResponder.moveUp(_:)):
            guard !items.isEmpty else { return true }
            let delta = commandSelector == #selector(NSResponder.moveDown(_:)) ? 1 : -1
            let row = min(items.count - 1, max(0, results.selectedRow + delta))
            results.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
            results.scrollRowToVisible(row)
            return true
        case #selector(NSResponder.insertNewline(_:)):
            guard !Self.isRepeatedKeyDown(NSApp.currentEvent) else { return true }
            let id = items.indices.contains(results.selectedRow) ? items[results.selectedRow].id : nil
            submitSelection(id: id)
            return true
        default: return false
        }
    }
    static func isRepeatedKeyDown(_ event: NSEvent?) -> Bool {
        // Delegate actions can run during a window event; isARepeat is key-only.
        event?.type == .keyDown && event?.isARepeat == true
    }
}

/// AppKit keeps arrows/selection native even after a row click takes key focus.
public final class LauncherResultsTable: NSTableView {
    public var onActivate: (() -> Void)?
    public override func keyDown(with event: NSEvent) {
        if event.keyCode == 36, event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty {
            if !event.isARepeat { onActivate?() }
            return
        }
        super.keyDown(with: event)
    }
}
