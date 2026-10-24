// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Chooses the chord the panel registers at launch. A normal launch restores
/// what the user saved in the study UI. A measurement run registers
/// `PanelMeasurementChord`, the chord the LINA Probe stimulus posts, and reads
/// the saved preference no further: the user's choice must survive the run.
public enum PanelShortcutPreference {
    public static func configuration(measurement: Bool, saved: [String: Any]?) throws -> Shortcut {
        if measurement { return try Shortcut(keyCode: PanelMeasurementChord.keyCode,
                                             modifiers: PanelMeasurementChord.modifiers) }
        return try Shortcut(keyCode: saved?["keyCode"] as? Int ?? Int(Shortcut.initial.keyCode),
                            modifiers: saved?["modifiers"] as? [String] ?? Shortcut.initial.modifiers)
    }
}
