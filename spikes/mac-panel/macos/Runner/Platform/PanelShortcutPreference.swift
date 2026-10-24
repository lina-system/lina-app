// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Chooses the chord the panel registers at launch. A normal launch restores
/// what the user saved in the study UI. The saved preference is only ever read
/// here; only an explicit `configureShortcut` call writes it.
public enum PanelShortcutPreference {
    public static func configuration(measurement: Bool, saved: [String: Any]?) throws -> Shortcut {
        try Shortcut(keyCode: saved?["keyCode"] as? Int ?? Int(Shortcut.initial.keyCode),
                     modifiers: saved?["modifiers"] as? [String] ?? Shortcut.initial.modifiers)
    }
}
