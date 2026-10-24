// SPDX-License-Identifier: Apache-2.0
import XCTest
@testable import MacPanelPlatform

final class PanelShortcutPreferenceTests: XCTestCase {
    private let saved: [String: Any] = ["keyCode": 49, "modifiers": ["command", "shift"]]

    func testMeasurementRegistersTheProbeChordEvenWhenAnotherShortcutWasSaved() throws {
        let configuration = try PanelShortcutPreference.configuration(measurement: true, saved: saved)
        XCTAssertEqual(configuration, try Shortcut(keyCode: PanelMeasurementChord.keyCode,
                                                   modifiers: PanelMeasurementChord.modifiers))
        XCTAssertNotEqual(configuration, try Shortcut(keyCode: 49, modifiers: ["command", "shift"]))
    }

    func testNormalLaunchRestoresTheSavedShortcut() throws {
        let configuration = try PanelShortcutPreference.configuration(measurement: false, saved: saved)
        XCTAssertEqual(configuration, try Shortcut(keyCode: 49, modifiers: ["command", "shift"]))
    }

    func testNormalLaunchWithoutAPreferenceUsesTheInitialShortcut() throws {
        let configuration = try PanelShortcutPreference.configuration(measurement: false, saved: nil)
        XCTAssertEqual(configuration, Shortcut.initial)
    }

    /// The probe stimulus compiles PanelMeasurementChord too, so pinning the
    /// chord here pins the chord the panel registers and the probe posts.
    func testTheStudyChordIsTheProbesFixedChord() {
        XCTAssertEqual(PanelMeasurementChord.keyCode, 49)
        XCTAssertEqual(PanelMeasurementChord.modifiers, ["control", "option"])
        XCTAssertEqual(PanelMeasurementChord.cgEventFlags, [.maskControl, .maskAlternate])
        XCTAssertEqual(PanelMeasurementChord.name, "Control+Option+Space")
    }
}
