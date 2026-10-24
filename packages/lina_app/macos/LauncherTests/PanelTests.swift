// SPDX-License-Identifier: Apache-2.0
import AppKit
import XCTest
@testable import LinaLauncher

final class PanelTests: XCTestCase {
    @MainActor func testPanelNeverActivatesOrJoinsWindowSwitching() {
        _ = NSApplication.shared
        let panel = LauncherPanel(content: NSViewController())
        defer { panel.orderOut(nil) }
        XCTAssertTrue(panel.styleMask.contains(.nonactivatingPanel))
        XCTAssertTrue(panel.canBecomeKey)
        XCTAssertFalse(panel.canBecomeMain)
        XCTAssertEqual(panel.level, .floating)
        XCTAssertTrue(panel.isFloatingPanel)
        XCTAssertFalse(panel.hidesOnDeactivate)
        XCTAssertTrue(panel.collectionBehavior.contains(.canJoinAllSpaces))
        XCTAssertTrue(panel.collectionBehavior.contains(.fullScreenAuxiliary))
        XCTAssertTrue(panel.collectionBehavior.contains(.transient))
        XCTAssertTrue(panel.collectionBehavior.contains(.ignoresCycle))
        XCTAssertEqual(panel.tabbingMode, .disallowed)
    }
}
