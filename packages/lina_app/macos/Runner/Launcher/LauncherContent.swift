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
    public let status = NSTextField(labelWithString: "Type define <word> for the device dictionary")
    public var onQuery: ((String) -> Void)?
    public var onSubmit: ((String, String?) -> Void)?
    public var onDismiss: (() -> Void)?
    public var onOpenApp: (() -> Void)?
    public var onLoginChange: ((Bool) -> Void)?
    public private(set) var items: [LauncherResult] = []
    private let answer: NSViewController
    private let dictionary: LauncherDictionary
    private let loginStatus = NSTextField(labelWithString: "")

    public init(answer: NSViewController, dictionary: LauncherDictionary? = nil) {
        self.answer = answer
        self.dictionary = dictionary ?? LauncherDictionary()
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
        dictionary.onResults = { [weak self] in self?.setResults($0) }
        dictionary.onOpened = { [weak self] in self?.onDismiss?() }
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
    }
    public func setResults(_ items: [LauncherResult]) {
        self.items = items
        results.reloadData()
        if items.isEmpty { results.deselectAll(nil) }
        else { results.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false) }
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
        let composing = (input.currentEditor() as? NSTextView)?.hasMarkedText() ?? false
        let local = dictionary.update(query: input.stringValue, composing: composing)
        dictionary.view.isHidden = !local
        answer.view.isHidden = local
        if !local { onQuery?(input.stringValue) }
    }
    private func submitSelection(id: String?) {
        if dictionary.active { dictionary.activate(query: input.stringValue) }
        else { onSubmit?(input.stringValue, id) }
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
            guard NSApp.currentEvent?.isARepeat != true else { return true }
            let id = items.indices.contains(results.selectedRow) ? items[results.selectedRow].id : nil
            submitSelection(id: id)
            return true
        default: return false
        }
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
