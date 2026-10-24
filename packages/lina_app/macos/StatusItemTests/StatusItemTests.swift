// SPDX-License-Identifier: Apache-2.0
import AppKit
import XCTest
@testable import LinaStatusItem

final class StatusItemTests: XCTestCase {
    @MainActor func testStateLabelsAccessibilityAndActions() {
        _ = NSApplication.shared
        var launcher = 0
        var conversation = 0
        let controller = StatusItemController(openLauncher: { launcher += 1 }, openConversation: { conversation += 1 })
        defer { controller.remove() }
        XCTAssertEqual(controller.item.button?.title, "lina.")
        XCTAssertEqual(controller.menu.items[0].title, "현재 에이전트: 선택 안 됨")
        XCTAssertEqual(controller.menu.items[1].title, "Core: 연결 끊김")
        for (phase, label) in [(StatusItemSnapshot.Phase.connected, "연결됨"), (.connecting, "연결 중"),
                               (.rejected, "연결 거부됨"), (.disconnected, "연결 끊김")] {
            controller.update(StatusItemSnapshot(phase: phase, agentName: "테스트 에이전트"))
            XCTAssertEqual(controller.menu.items[0].title, "현재 에이전트: 테스트 에이전트")
            XCTAssertEqual(controller.menu.items[1].title, "Core: " + label)
            XCTAssertTrue(controller.item.button?.accessibilityLabel()?.contains(label) == true)
        }
        XCTAssertFalse(controller.menu.items[0].isEnabled)
        XCTAssertFalse(controller.menu.items[1].isEnabled)
        controller.menu.performActionForItem(at: 3)
        XCTAssertEqual(launcher, 1)
        XCTAssertEqual(conversation, 0)
        controller.menu.performActionForItem(at: 4)
        XCTAssertEqual(conversation, 1)
        controller.remove()
        controller.remove()
        XCTAssertNil(controller.item.menu)
    }

    func testChannelSchemaRejectsInvalidOrUnknownState() {
        XCTAssertEqual(StatusItemSnapshot(arguments: ["phase": "connected", "agentName": "가"]),
                       StatusItemSnapshot(phase: .connected, agentName: "가"))
        XCTAssertEqual(StatusItemSnapshot(arguments: ["phase": "disconnected", "agentName": NSNull()]), StatusItemSnapshot())
        for value: Any in [NSNull(), ["phase": "connected"], ["phase": "invented", "agentName": NSNull()],
                           ["phase": "connected", "agentName": 42], ["phase": "connected", "agentName": "a", "endpoint": "secret"]] {
            XCTAssertNil(StatusItemSnapshot(arguments: value))
        }
    }

    @MainActor func testGuidanceIsOncePerInstallOn26AndLaterAndNeverInTestsOrHiddenWindow() {
        _ = NSApplication.shared
        let suite = "LINA.StatusItemTests." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertFalse(MenuBarGuidance(defaults: defaults, majorVersion: 25).shouldPresent)
        XCTAssertFalse(MenuBarGuidance(defaults: nil, majorVersion: 26).shouldPresent)
        let guidance = MenuBarGuidance(defaults: defaults, majorVersion: 26)
        XCTAssertTrue(guidance.shouldPresent)
        let window = NSWindow()
        guidance.present(on: window)
        XCTAssertTrue(guidance.shouldPresent, "prewarming must not consume the notice")
        let alert = guidance.makeAlert()
        XCTAssertEqual(alert.messageText, "메뉴 막대에 허용")
        XCTAssertTrue(alert.informativeText.contains("시스템 설정 → 메뉴 막대"))
        if let path = ProcessInfo.processInfo.environment["LINA_STATUS_CAPTURE"] {
            alert.window.appearance = NSAppearance(named: .aqua)
            if let icon = ProcessInfo.processInfo.environment["LINA_STATUS_CAPTURE_ICON"] {
                alert.icon = NSImage(contentsOfFile: icon)
            }
            alert.layout()
            alert.window.orderFront(nil)
            defer { alert.window.orderOut(nil) }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            let view = try! XCTUnwrap(alert.window.contentView)
            let bitmap = try! XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
            view.cacheDisplay(in: view.bounds, to: bitmap)
            // cacheDisplay omits the compositor's background. Flatten this own-view
            // capture onto the native window color; it is not a screen capture.
            let flattened = NSImage(size: view.bounds.size)
            NSAppearance(named: .aqua)!.performAsCurrentDrawingAppearance {
                flattened.lockFocus()
                NSColor.windowBackgroundColor.setFill()
                view.bounds.fill()
                NSImage(cgImage: bitmap.cgImage!, size: view.bounds.size).draw(in: view.bounds)
                flattened.unlockFocus()
            }
            let image = NSBitmapImageRep(data: flattened.tiffRepresentation!)!
            let png = try! XCTUnwrap(image.representation(using: .png, properties: [:]))
            try! png.write(to: URL(fileURLWithPath: path))
        }
        guidance.markPresented()
        XCTAssertFalse(MenuBarGuidance(defaults: defaults, majorVersion: 27).shouldPresent)
    }
}
