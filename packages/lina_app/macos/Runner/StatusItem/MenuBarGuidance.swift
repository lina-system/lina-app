// SPDX-License-Identifier: Apache-2.0
import AppKit

/// Shown on the first explicit conversation-window open, never at login/prewarm.
/// This is guidance, not a permission prompt or a claim that permission is granted.
final class MenuBarGuidance {
    private let defaults: UserDefaults?
    private let majorVersion: Int
    private let key = "LINA.menuBarGuidance.v1"

    init(defaults: UserDefaults?, majorVersion: Int = ProcessInfo.processInfo.operatingSystemVersion.majorVersion) {
        self.defaults = defaults
        self.majorVersion = majorVersion
    }

    var shouldPresent: Bool { majorVersion >= 26 && defaults != nil && defaults?.bool(forKey: key) != true }

    func makeAlert() -> NSAlert {
        let alert = NSAlert()
        alert.messageText = "메뉴 막대에 허용"
        alert.informativeText = "메뉴 막대에 lina.가 보이지 않으면 시스템 설정 → 메뉴 막대에서 LINA의 ‘메뉴 막대에 허용’을 켜 주세요. 메뉴에서 현재 에이전트와 Core 연결 상태를 보고 런처와 대화를 열 수 있어요."
        alert.addButton(withTitle: "확인")
        return alert
    }

    func present(on window: NSWindow) {
        guard shouldPresent, window.isVisible, window.attachedSheet == nil else { return }
        makeAlert().beginSheetModal(for: window)
        markPresented()
    }

    func markPresented() { defaults?.set(true, forKey: key) }
}
