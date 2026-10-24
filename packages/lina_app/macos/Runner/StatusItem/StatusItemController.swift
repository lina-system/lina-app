// SPDX-License-Identifier: Apache-2.0
import AppKit

struct StatusItemSnapshot: Equatable {
    enum Phase: String { case disconnected, connecting, connected, rejected }
    var phase: Phase = .disconnected
    var agentName: String?

    init(phase: Phase = .disconnected, agentName: String? = nil) {
        self.phase = phase
        self.agentName = agentName
    }

    init?(arguments: Any?) {
        guard let values = arguments as? [String: Any],
              Set(values.keys) == ["phase", "agentName"],
              let raw = values["phase"] as? String, let phase = Phase(rawValue: raw),
              values["agentName"] is String || values["agentName"] is NSNull else { return nil }
        self.init(phase: phase, agentName: values["agentName"] as? String)
    }

    var agentLabel: String { "현재 에이전트: " + (agentName.flatMap { $0.isEmpty ? nil : $0 } ?? "선택 안 됨") }
    var connectionLabel: String {
        switch phase {
        case .disconnected: return "연결 끊김"
        case .connecting: return "연결 중"
        case .connected: return "연결됨"
        case .rejected: return "연결 거부됨"
        }
    }
}

/// Native presentation only. The main Dart engine owns Core and agent selection.
final class StatusItemController: NSObject {
    let item: NSStatusItem
    let menu = NSMenu(title: "LINA")
    private let agent = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let connection = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let openLauncher: () -> Void
    private let openConversation: () -> Void
    private var removed = false

    init(openLauncher: @escaping () -> Void, openConversation: @escaping () -> Void) {
        self.openLauncher = openLauncher
        self.openConversation = openConversation
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        item.autosaveName = "LINA.StatusItem"
        // A canonical wordmark, drawn by AppKit in the system menu style.
        item.button?.title = "lina."
        menu.autoenablesItems = false
        agent.isEnabled = false
        connection.isEnabled = false
        menu.addItem(agent)
        menu.addItem(connection)
        menu.addItem(.separator())
        addAction("런처 열기", #selector(showLauncher))
        addAction("대화 열기", #selector(showConversation))
        item.menu = menu
        update(StatusItemSnapshot())
    }

    private func addAction(_ title: String, _ action: Selector) {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
        entry.target = self
        menu.addItem(entry)
    }

    func update(_ snapshot: StatusItemSnapshot) {
        agent.title = snapshot.agentLabel
        connection.title = "Core: " + snapshot.connectionLabel
        let description = "LINA · \(agent.title) · \(connection.title)"
        item.button?.toolTip = description
        item.button?.setAccessibilityLabel(description)
        menu.update()
    }

    @objc private func showLauncher() { openLauncher() }
    @objc private func showConversation() { openConversation() }

    func remove() {
        guard !removed else { return }
        removed = true
        item.menu = nil
        NSStatusBar.system.removeStatusItem(item)
    }
}
