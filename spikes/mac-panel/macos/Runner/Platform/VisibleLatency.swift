// SPDX-License-Identifier: Apache-2.0
import Foundation

public struct VisibleLatencyResult {
    public let frameLatencyMs: Double
    public let observationUpperBoundMs: Double
}

public struct VisibleLatencyTrial {
    public enum InvalidClock: Error { case shortcut }
    public let shortcutTime: Double
    private var completed = false

    public init(shortcutTime: Double) throws {
        guard shortcutTime.isFinite, shortcutTime >= 0 else { throw InvalidClock.shortcut }
        self.shortcutTime = shortcutTime
    }

    /// The endpoint is SCStreamFrameInfo.displayTime, not window ordering.
    /// A hidden/offscreen buffer or a frame from the previous invocation is not evidence.
    public mutating func observe(frameTime: Double, receivedTime: Double, onScreen: Bool,
                                 complete: Bool, markerMatches: Bool) -> VisibleLatencyResult? {
        guard !completed, onScreen, complete, markerMatches,
              frameTime.isFinite, receivedTime.isFinite,
              frameTime >= shortcutTime, receivedTime >= frameTime else { return nil }
        completed = true
        return VisibleLatencyResult(frameLatencyMs: (frameTime - shortcutTime) * 1_000,
                                    observationUpperBoundMs: (receivedTime - shortcutTime) * 1_000)
    }
}

public enum VisibleFrameMarker {
    public static func matches(_ colors: [(UInt8, UInt8, UInt8)], sequence: Int = 0) -> Bool {
        var expected: [(Int, Int, Int)] = [(235, 35, 55), (25, 190, 70), (30, 70, 235), (245, 200, 20)]
        if !sequence.isMultiple(of: 2) { expected.reverse() }
        guard colors.count == expected.count else { return false }
        return zip(colors, expected).allSatisfy { actual, target in
            abs(Int(actual.0) - target.0) <= 24 && abs(Int(actual.1) - target.1) <= 24 && abs(Int(actual.2) - target.2) <= 24
        }
    }
}
