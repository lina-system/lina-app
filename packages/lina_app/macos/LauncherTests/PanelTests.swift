// SPDX-License-Identifier: Apache-2.0
import AppKit
import XCTest
@testable import LinaLauncher

final class PanelTests: XCTestCase {
    @MainActor private func fixture() -> NSViewController {
        _ = NSApplication.shared
        let content = NSViewController()
        content.view = NSView(frame: NSRect(x: 0, y: 0, width: 680, height: 600))
        return content
    }

    @MainActor private func resolved(_ color: NSColor, in view: NSView) -> NSColor {
        var value: NSColor!
        view.effectiveAppearance.performAsCurrentDrawingAppearance {
            value = color.usingColorSpace(.sRGB)
        }
        return value
    }

    @MainActor func testGlassContainsTheOriginalControllerAndLeavesShapeAndTintToAppKit() throws {
        let content = fixture()
        let panel = LauncherPanel(content: content)
        defer { panel.close() }
        XCTAssertTrue(content.parent === panel.contentViewController)
        if #available(macOS 26.0, *) {
            let glass = try XCTUnwrap(panel.surface.material as? NSGlassEffectView)
            XCTAssertEqual(glass.style, .regular)
            XCTAssertNil(glass.tintColor)
            XCTAssertEqual(glass.cornerRadius, 0, "The titled window supplies the outer corner mask")
            XCTAssertTrue(content.view.superview === glass.contentView)
        } else {
            XCTAssertTrue(panel.surface.material is NSVisualEffectView)
        }
        panel.setContentSize(NSSize(width: 720, height: 740))
        panel.contentView?.layoutSubtreeIfNeeded()
        XCTAssertEqual(content.view.bounds.size, panel.contentView?.bounds.size)
        XCTAssertEqual(panel.surface.material.bounds.size, panel.contentView?.bounds.size)
        XCTAssertTrue(panel.hasShadow)
    }

    @MainActor func testLegacyMaterialStaysActiveBehindTheWindow() throws {
        let content = fixture()
        let panel = LauncherPanel(content: content, settings: {
            LauncherDisplaySettings(reduceTransparency: false, increaseContrast: false)
        }, useGlass: false)
        defer { panel.close() }
        let effect = try XCTUnwrap(panel.surface.material as? NSVisualEffectView)
        XCTAssertEqual(effect.material, .hudWindow)
        XCTAssertEqual(effect.blendingMode, .behindWindow)
        XCTAssertEqual(effect.state, .active)
        XCTAssertTrue(panel.surface.opaqueBacking.isHidden)
        XCTAssertTrue(content.view.window === panel)
    }

    @MainActor func testHiddenSettingsAreResampledBeforeEveryOpeningWithoutReplacingContent() {
        let content = fixture()
        var settings = LauncherDisplaySettings(reduceTransparency: false, increaseContrast: false)
        let panel = LauncherPanel(content: content, settings: { settings }, useGlass: true)
        defer { panel.close() }
        let parent = content.view.superview
        let material = panel.surface.material
        for reduce in [true, false, true, false] {
            settings.reduceTransparency = reduce
            // Deliberately omit a notification: a hidden app may miss one.
            panel.makeKeyAndOrderFront(nil)
            XCTAssertEqual(panel.surface.opaqueBacking.isHidden, !reduce)
            XCTAssertEqual(panel.animationBehavior, .none)
            XCTAssertTrue(content.view.superview === parent)
            XCTAssertTrue(panel.surface.material === material)
            XCTAssertTrue(content.view.window === panel)
            panel.orderOut(nil)
        }
    }

    @MainActor func testOpeningLaysOutCurrentNativeContentWhileHiddenAndStillHonorsReadiness() {
        let content = fixture()
        let painted = LayoutObservationView(frame: content.view.bounds)
        content.view = painted
        let host = LauncherPanelHost(content: content, focusView: painted)
        defer { host.hide(); host.panel.close() }
        painted.laidOutValues.removeAll()
        painted.visibleAtLayout.removeAll()
        painted.needsLayout = true
        host.show()
        XCTAssertFalse(host.panel.isVisible)
        XCTAssertTrue(painted.laidOutValues.isEmpty)
        host.markReady()
        XCTAssertTrue(painted.laidOutValues.contains(0))
        host.hide()
        painted.laidOutValues.removeAll()
        painted.visibleAtLayout.removeAll()
        painted.value = 1
        painted.needsLayout = true
        host.show()
        XCTAssertEqual(painted.laidOutValues.first, 1)
        XCTAssertEqual(painted.visibleAtLayout.first, false, "Refresh must precede ordering the window")
    }

    @MainActor func testAccessibilityNotificationsApplyTokenBackingAndPreserveAppearanceInheritance() {
        let content = fixture()
        let label = NSTextField(labelWithString: "Synthetic launcher text")
        label.textColor = LinaTokens.Color.text
        content.view.addSubview(label)
        var settings = LauncherDisplaySettings(reduceTransparency: false, increaseContrast: false)
        let panel = LauncherPanel(content: content, settings: { settings }, useGlass: true)
        defer { panel.close() }
        panel.appearance = NSAppearance(named: .aqua)
        let light = resolved(LinaTokens.Color.text, in: label)
        panel.appearance = NSAppearance(named: .darkAqua)
        let dark = resolved(LinaTokens.Color.text, in: label)
        XCTAssertNotEqual(light, dark)
        settings.increaseContrast = true
        NSWorkspace.shared.notificationCenter.post(
            name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
        XCTAssertFalse(panel.surface.opaqueBacking.isHidden)
        XCTAssertNil(panel.surface.appearance, "System appearance must stay inherited, including high contrast")
        XCTAssertEqual(panel.surface.opaqueBacking.layer?.borderWidth, LinaAppTokens.borderWidth)
        XCTAssertEqual(NSColor(cgColor: panel.surface.opaqueBacking.layer!.backgroundColor!)?.usingColorSpace(.sRGB),
                       resolved(LinaTokens.Color.canvas, in: label))
        XCTAssertEqual(NSColor(cgColor: panel.surface.opaqueBacking.layer!.borderColor!)?.usingColorSpace(.sRGB),
                       resolved(LinaTokens.Color.line, in: label))
        settings.increaseContrast = false
        NotificationCenter.default.post(name: NSColor.systemColorsDidChangeNotification, object: nil)
        XCTAssertNil(panel.surface.appearance)
        XCTAssertTrue(panel.surface.opaqueBacking.isHidden)
        XCTAssertEqual(panel.surface.opaqueBacking.layer?.borderWidth, 0)
        XCTAssertEqual(resolved(LinaTokens.Color.text, in: label), dark)
        panel.appearance = NSAppearance(named: .aqua)
        XCTAssertEqual(resolved(LinaTokens.Color.text, in: label), light)
    }

    @MainActor func testPanelUsesSystemMaterialWithoutAnOpaqueWindowOrOpenAnimation() {
        _ = NSApplication.shared
        let content = NSViewController()
        let panel = LauncherPanel(content: content)
        defer { panel.close() }
        XCTAssertFalse(panel.isOpaque)
        XCTAssertEqual(panel.backgroundColor, .clear)
        XCTAssertTrue(panel.hasShadow)
        XCTAssertEqual(panel.animationBehavior, .none)
        XCTAssertTrue(panel.styleMask.contains(.titled), "AppKit owns the window corner mask")
        func hasMaterial(_ view: NSView) -> Bool {
            if #available(macOS 26.0, *), view is NSGlassEffectView { return true }
            if view is NSVisualEffectView { return true }
            return view.subviews.contains(where: hasMaterial)
        }
        XCTAssertTrue(panel.contentView.map(hasMaterial) ?? false)
        XCTAssertTrue(content.view.window === panel)
    }

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

private final class LayoutObservationView: NSView {
    var value = 0
    var laidOutValues: [Int] = []
    var visibleAtLayout: [Bool] = []
    override func layout() {
        super.layout()
        laidOutValues.append(value)
        visibleAtLayout.append(window?.isVisible ?? false)
    }
}
