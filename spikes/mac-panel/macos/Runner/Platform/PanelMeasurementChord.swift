// SPDX-License-Identifier: Apache-2.0
import CoreGraphics

/// The one chord the visible-latency study measures. The panel registers it in
/// measurement mode instead of the saved preference, and the LINA Probe
/// stimulus posts it; both builds compile this file, so the stimulus and the
/// collector cannot drift apart. Never copy these values elsewhere.
public enum PanelMeasurementChord {
    public static let keyCode = 49
    public static let modifiers = ["control", "option"]
    public static let name = "Control+Option+Space"
    public static var cgEventFlags: CGEventFlags {
        modifiers.reduce(into: CGEventFlags()) { flags, modifier in
            switch modifier {
            case "command": flags.insert(.maskCommand)
            case "control": flags.insert(.maskControl)
            case "option": flags.insert(.maskAlternate)
            case "shift": flags.insert(.maskShift)
            default: break
            }
        }
    }
}
