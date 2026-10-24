// SPDX-License-Identifier: Apache-2.0
import Foundation
import XCTest
@testable import LinaLauncher

final class CalculatorTests: XCTestCase {
    func testArithmeticFunctionsConstantsBasesAndWords() throws {
        let cases: [(String, Double)] = [
            ("(3+4)*12%", 0.84), ("2^10", 1024), ("2^3^2", 512), ("-2^2", -4),
            ("2^-2", 0.25), ("5-2*3", -1), ("1e3/4", 250), ("0.1+0.2", 0.3),
            ("sin(pi/2)", 1), ("cos(0)", 1), ("tan(0)", 0), ("atan(1)*4", .pi),
            ("asin(1)", .pi/2), ("acos(1)", 0), ("sqrt(81)", 9), ("ln(e)", 1),
            ("log(100)", 2), ("abs(-5)", 5), ("tau/2", .pi), ("π*2", 2 * .pi),
            ("0xff+0b1", 256), ("0o10*2", 16), ("two to the power of ten", 1024),
            ("twenty one plus three", 24), ("one hundred and five divided by five", 21),
            ("(three plus four) times twelve percent", 0.84), ("12 multiplied by 3", 36),
            ("3 × 4 ÷ 2", 6), ("8−3", 5),
        ]
        for (query, expected) in cases {
            XCTAssertEqual(try XCTUnwrap(Calculator.evaluate(query), query).value, expected, accuracy: 1e-12, query)
        }
        for (query, expected) in [("255 in hex", "ff"), ("10 in binary", "1010"), ("0xff in decimal", "255"), ("16 in octal", "20")] {
            XCTAssertEqual(Calculator.evaluate(query)?.unformatted, expected)
        }
    }
    func testBareNumbersMalformedExpressionsAndLimitsProduceNothing() {
        for query in ["", "42", "-42", "+42", "1.25", "1e3", "one", "0xff", "(42)", "2+", "(3+4", "sin(",
                      "1/0", "sqrt(-1)", "2^1024", "sin(1,2)", "2 apples", "one two plus 3", "0b2+1", "0xffg+1",
                      "1.2.3+4", "2**3", "system(1)", "x=2", "1.5 in hex", "1e20 in hex", "0x20000000000001+1",
                      String(repeating: "(", count: 80) + "1+2" + String(repeating: ")", count: 80),
                      String(repeating: "-", count: 80) + "1+2", String(repeating: "1+", count: 600)] {
            XCTAssertNil(Calculator.evaluate(query), query)
        }
    }
    func testLocalizedAndRawCopiesKeepUsefulPrecision() throws {
        let value = try XCTUnwrap(Calculator.evaluate("1234567/100"))
        XCTAssertEqual(value.formatted(locale: Locale(identifier: "en_US")), "12,345.67")
        XCTAssertEqual(value.formatted(locale: Locale(identifier: "de_DE")), "12.345,67")
        XCTAssertEqual(value.unformatted, "12345.67")
        XCTAssertEqual(Calculator.evaluate("0.1+0.2")?.unformatted, "0.3")
        XCTAssertEqual(Calculator.evaluate("1e-20*2")?.unformatted, "2e-20")
    }
    func testHistoryPersistsOnlyExplicitCopiesInTheInjectedLocalStore() throws {
        let name = "CalculatorTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let history = CalculatorHistory(defaults: defaults)
        _ = Calculator.evaluate("2^10")
        XCTAssertTrue(history.entries.isEmpty)
        for n in 0..<60 { history.record(try XCTUnwrap(Calculator.evaluate("\(n)+1"))) }
        XCTAssertEqual(history.entries.count, 50)
        history.record(try XCTUnwrap(Calculator.evaluate("59+1")))
        XCTAssertEqual(history.entries.count, 50)
        XCTAssertEqual(CalculatorHistory(defaults: defaults).entries, history.entries)
        XCTAssertTrue(CalculatorHistory(defaults: nil).entries.isEmpty)
    }

    func testLongDecimalAnswersKeepSignificantDigitsAndMagnitude() throws {
        let cases = [
            ("1/1e300", "1e-300", "1e-300"),
            ("1.23456789012345e150*1e150", "1.23456789012345e300", "1,23456789012345e300"),
            ("-1.23456789012345e-150/1e150", "-1.23456789012345e-300", "-1,23456789012345e-300"),
            ("-1e150*1e150", "-1e300", "-1e300"),
        ]
        for (query, english, german) in cases {
            let answer = try XCTUnwrap(Calculator.evaluate(query), query)
            XCTAssertEqual(answer.formatted(locale: Locale(identifier: "en_US")), english, query)
            XCTAssertEqual(answer.formatted(locale: Locale(identifier: "de_DE")), german, query)
            XCTAssertEqual(Double(answer.unformatted), Double(english), query)
        }
        for (query, expected) in [("1e-8*2", "0.00000002"), ("1e12*2", "2,000,000,000,000"), ("0*-1", "0")] {
            XCTAssertEqual(Calculator.evaluate(query)?.formatted(locale: Locale(identifier: "en_US")), expected)
        }
        // Subnormals have fewer meaningful digits; the compact copy must still
        // round-trip to the same nonzero Double rather than rounding to zero.
        for query in ["1e-320/2", "5e-324*1"] {
            let answer = try XCTUnwrap(Calculator.evaluate(query))
            let formatted = answer.formatted(locale: Locale(identifier: "en_US"))
            XCTAssertLessThanOrEqual(formatted.count, 24)
            XCTAssertNotEqual(answer.value, 0)
            XCTAssertEqual(Double(formatted), answer.value)
            XCTAssertEqual(Double(answer.unformatted), answer.value)
        }
    }
}
