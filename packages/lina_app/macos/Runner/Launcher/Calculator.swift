// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Bounded, local arithmetic only. No scripting, variable assignment or I/O.
public struct CalculatorAnswer: Codable, Equatable {
    public let expression: String
    public let value: Double
    public let radix: Int?
    public var unformatted: String {
        if let radix { return String(Int64(value), radix: radix) }
        return String(format: "%.15g", locale: Locale(identifier: "en_US_POSIX"), value == 0 ? 0 : value).lowercased()
    }
    public func formatted(locale: Locale = .current) -> String {
        if radix != nil { return unformatted }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesSignificantDigits = true
        formatter.maximumSignificantDigits = 15
        return formatter.string(from: NSNumber(value: value == 0 ? 0 : value)) ?? unformatted
    }
}

public enum Calculator {
    public static func evaluate(_ expression: String) -> CalculatorAnswer? {
        guard expression.utf8.count <= 1024 else { return nil }
        var text = expression.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        var radix: Int?
        for (suffix, base) in [(" in hex", 16), (" in binary", 2), (" in octal", 8), (" in decimal", 10)] {
            if text.hasSuffix(suffix) { text.removeLast(suffix.count); radix = base; break }
        }
        for (word, symbol) in [("to the power of", "^"), ("multiplied by", "*"), ("divided by", "/"),
                               ("plus", "+"), ("minus", "-"), ("times", "*"), ("percent", "%")] {
            text = text.replacingOccurrences(of: "\\b" + word + "\\b", with: symbol, options: .regularExpression)
        }
        text = text.replacingOccurrences(of: "×", with: "*").replacingOccurrences(of: "÷", with: "/")
            .replacingOccurrences(of: "−", with: "-").replacingOccurrences(of: "π", with: "pi")
        do {
            let parser = try Parser(text)
            let value = try parser.expression()
            guard parser.atEnd, parser.calculated || radix != nil, value.isFinite else { return nil }
            // Radix conversion is exact only in the integral Double range.
            if radix != nil && (value.rounded() != value || abs(value) > 9_007_199_254_740_991) { return nil }
            return CalculatorAnswer(expression: expression, value: value, radix: radix)
        } catch { return nil } // Incomplete/invalid input clears the previous answer while typing.
    }
}

private enum ParseError: Error { case invalid }
private enum Token: Equatable { case number(Double), name(String), symbol(String) }
private final class Parser {
    var tokens: [Token] = []
    var index = 0
    var depth = 0
    var calculated = false
    var atEnd: Bool { index == tokens.count }
    private let small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                         "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    private let tens = ["twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90]
    init(_ text: String) throws {
        let regex = try NSRegularExpression(pattern: #"\s*(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?|[a-z]+|[+*/^%()\-])"#)
        let source = text as NSString
        var offset = 0
        while offset < source.length {
            let range = NSRange(location: offset, length: source.length - offset)
            guard let match = regex.firstMatch(in: text, options: .anchored, range: range) else {
                if source.substring(from: offset).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { break }
                throw ParseError.invalid
            }
            let word = source.substring(with: match.range(at: 1))
            if word.hasPrefix("0x") || word.hasPrefix("0b") || word.hasPrefix("0o") {
                let base = word.hasPrefix("0x") ? 16 : word.hasPrefix("0b") ? 2 : 8
                guard let integer = UInt64(word.dropFirst(2), radix: base), integer <= 9_007_199_254_740_991 else { throw ParseError.invalid }
                tokens.append(.number(Double(integer)))
            } else if let number = Double(word) { tokens.append(.number(number)) }
            else if word.first?.isLetter == true { tokens.append(.name(word)) }
            else { tokens.append(.symbol(word)) }
            offset = match.range.location + match.range.length
            guard tokens.count <= 256 else { throw ParseError.invalid }
        }
    }
    func take(_ symbol: String) -> Bool {
        guard index < tokens.count, tokens[index] == .symbol(symbol) else { return false }
        index += 1; return true
    }
    func expression() throws -> Double {
        depth += 1
        defer { depth -= 1 }
        guard depth <= 64 else { throw ParseError.invalid }
        var value = try product()
        while true {
            if take("+") { calculated = true; value += try product() }
            else if take("-") { calculated = true; value -= try product() }
            else { return value }
        }
    }
    func product() throws -> Double {
        var value = try unary()
        while true {
            if take("*") { calculated = true; value *= try unary() }
            else if take("/") {
                calculated = true
                let divisor = try unary()
                guard divisor != 0 else { throw ParseError.invalid }
                value /= divisor
            } else { return value }
        }
    }
    func unary() throws -> Double {
        depth += 1
        defer { depth -= 1 }
        guard depth <= 64 else { throw ParseError.invalid }
        if take("+") { return try unary() }
        if take("-") { return try -unary() }
        var value = try primary()
        while take("%") { calculated = true; value /= 100 }
        if take("^") { calculated = true; value = pow(value, try unary()) }
        return value
    }
    func primary() throws -> Double {
        if take("(") {
            let value = try expression()
            guard take(")") else { throw ParseError.invalid }
            return value
        }
        guard index < tokens.count else { throw ParseError.invalid }
        let token = tokens[index]; index += 1
        switch token {
        case .number(let value): return value
        case .name(let name):
            if name == "pi" { calculated = true; return .pi }
            if name == "e" { calculated = true; return exp(1) }
            if name == "tau" { calculated = true; return 2 * .pi }
            if small.contains(name) || tens[name] != nil {
                index -= 1
                return try words()
            }
            guard ["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "ln", "log"].contains(name), take("(") else { throw ParseError.invalid }
            calculated = true
            let value = try expression()
            guard take(")") else { throw ParseError.invalid }
            switch name {
            case "sin": return sin(value)
            case "cos": return cos(value)
            case "tan": return tan(value)
            case "asin": return asin(value)
            case "acos": return acos(value)
            case "atan": return atan(value)
            case "sqrt": return sqrt(value)
            case "abs": return abs(value)
            case "ln": return log(value)
            default: return log10(value)
            }
        default: throw ParseError.invalid
        }
    }
    func word() -> String? {
        guard index < tokens.count, case .name(let name) = tokens[index] else { return nil }
        return name
    }
    func belowHundred() throws -> Int {
        guard let name = word() else { throw ParseError.invalid }
        index += 1
        if let value = small.firstIndex(of: name) { return value }
        guard let value = tens[name] else { throw ParseError.invalid }
        if let next = word(), let unit = small.firstIndex(of: next), (1...9).contains(unit) { index += 1; return value + unit }
        return value
    }
    func words() throws -> Double {
        var value = try belowHundred()
        if word() == "hundred" {
            guard (1...9).contains(value) else { throw ParseError.invalid }
            index += 1; value *= 100
            if word() == "and" { index += 1; value += try belowHundred() }
            else if let next = word(), small.contains(next) || tens[next] != nil { value += try belowHundred() }
        }
        return Double(value)
    }
}

/// UserDefaults is local to this Mac; no ubiquitous/cloud store or Core path.
/// Only explicitly copied answers are retained, with a fixed capacity.
public final class CalculatorHistory {
    private let defaults: UserDefaults?
    private let key = "launcher.calculator.history.v1"
    public private(set) var entries: [CalculatorAnswer]
    public init(defaults: UserDefaults? = .standard) {
        self.defaults = defaults
        let data = defaults?.data(forKey: key)
        entries = data.flatMap { try? JSONDecoder().decode([CalculatorAnswer].self, from: $0) }?
            .prefix(50).compactMap { Calculator.evaluate($0.expression) } ?? []
    }
    public func record(_ answer: CalculatorAnswer) {
        entries.removeAll { $0.expression == answer.expression }
        entries.insert(answer, at: 0)
        entries = Array(entries.prefix(50))
        if let data = try? JSONEncoder().encode(entries) { defaults?.set(data, forKey: key) }
    }
}
