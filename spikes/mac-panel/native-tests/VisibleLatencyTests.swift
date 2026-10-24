// SPDX-License-Identifier: Apache-2.0
import XCTest
@testable import MacPanelPlatform

final class VisibleLatencyTests: XCTestCase {
    func testOrderingStaleHiddenAndUnpaintedFramesCannotCompleteATrial() throws {
        var trial = try VisibleLatencyTrial(shortcutTime: 100)
        XCTAssertNil(trial.observe(frameTime: 99.999, receivedTime: 100.020,
                                   onScreen: true, complete: true, markerMatches: true))
        XCTAssertNil(trial.observe(frameTime: 100.010, receivedTime: 100.020,
                                   onScreen: false, complete: true, markerMatches: true))
        XCTAssertNil(trial.observe(frameTime: 100.010, receivedTime: 100.020,
                                   onScreen: true, complete: false, markerMatches: true))
        XCTAssertNil(trial.observe(frameTime: 100.010, receivedTime: 100.020,
                                   onScreen: true, complete: true, markerMatches: false))
        let result = try XCTUnwrap(trial.observe(frameTime: 100.016, receivedTime: 100.019,
                                                onScreen: true, complete: true, markerMatches: true))
        XCTAssertEqual(result.frameLatencyMs, 16, accuracy: 0.0001)
        XCTAssertEqual(result.observationUpperBoundMs, 19, accuracy: 0.0001)
        XCTAssertNil(trial.observe(frameTime: 100.032, receivedTime: 100.035,
                                   onScreen: true, complete: true, markerMatches: true))
    }

    func testInvalidClocksCannotProduceMeasurements() throws {
        XCTAssertThrowsError(try VisibleLatencyTrial(shortcutTime: .nan))
        XCTAssertThrowsError(try VisibleLatencyTrial(shortcutTime: -1))
        var trial = try VisibleLatencyTrial(shortcutTime: 100)
        XCTAssertNil(trial.observe(frameTime: .nan, receivedTime: 100.020,
                                   onScreen: true, complete: true, markerMatches: true))
        XCTAssertNil(trial.observe(frameTime: 100.020, receivedTime: 100.010,
                                   onScreen: true, complete: true, markerMatches: true))
    }

    func testMarkerRequiresAllFourOpaqueColorsInOrder() {
        let colors: [(UInt8, UInt8, UInt8)] = [(235, 35, 55), (25, 190, 70), (30, 70, 235), (245, 200, 20)]
        XCTAssertTrue(VisibleFrameMarker.matches(colors))
        XCTAssertFalse(VisibleFrameMarker.matches(Array(colors.reversed())))
        XCTAssertFalse(VisibleFrameMarker.matches([(248, 249, 252), (248, 249, 252), (248, 249, 252), (248, 249, 252)]))
    }
}
