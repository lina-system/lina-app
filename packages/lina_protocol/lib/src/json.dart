// SPDX-License-Identifier: Apache-2.0
import 'dart:convert';

/// Decimal JSON number. No path through binary floating point, including uint64.
class ExactNumber implements Comparable<ExactNumber> {
  ExactNumber(this.source) {
    if (!RegExp(r'^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$')
        .hasMatch(source)) {
      throw const FormatException('invalid JSON number');
    }
    final parts = source.toLowerCase().split('e');
    final decimal = parts.first.split('.');
    _coefficient = BigInt.parse(decimal.join());
    _exponent =
        (parts.length == 2 ? int.parse(parts.last) : 0) -
        (decimal.length == 2 ? decimal.last.length : 0);
    if (_exponent.abs() > 10000)
      throw const FormatException('number _exponent exceeds resource limit');
    while (_coefficient != BigInt.zero &&
        _coefficient % BigInt.from(10) == BigInt.zero) {
      _coefficient ~/= BigInt.from(10);
      _exponent++;
    }
    if (_coefficient == BigInt.zero) _exponent = 0;
  }
  factory ExactNumber.of(Object? value) =>
      value is ExactNumber ? value : ExactNumber(value.toString());
  final String source;
  late BigInt _coefficient;
  late int _exponent;
  bool get isInteger => _exponent >= 0;
  @override
  int compareTo(ExactNumber other) {
    final low = _exponent < other._exponent ? _exponent : other._exponent;
    return (_coefficient * BigInt.from(10).pow(_exponent - low)).compareTo(
      other._coefficient * BigInt.from(10).pow(other._exponent - low),
    );
  }

  @override
  bool operator ==(Object other) =>
      other is ExactNumber &&
      _coefficient == other._coefficient &&
      _exponent == other._exponent;
  @override
  int get hashCode => Object.hash(_coefficient, _exponent);
  @override
  String toString() => source;
}

Object? exactDecode(String text) => _Parser(text).decode();
String exactEncode(Object? value) => switch (value) {
  ExactNumber n => n.source,
  Map m =>
    '{${m.entries.map((e) => '${jsonEncode(e.key)}:${exactEncode(e.value)}').join(',')}}',
  List l => '[${l.map(exactEncode).join(',')}]',
  _ => jsonEncode(value),
};
Object? freezeJson(Object? value) => switch (value) {
  Map m => Map<String, dynamic>.unmodifiable(
    m.map((k, v) => MapEntry(k as String, freezeJson(v))),
  ),
  List l => List<Object?>.unmodifiable(l.map(freezeJson)),
  num n => ExactNumber.of(n),
  _ => value,
};

class _Parser {
  _Parser(this.text);
  final String text;
  int position = 0;
  void whitespace() {
    while (position < text.length && ' \n\r\t'.contains(text[position])) {
      position++;
    }
  }

  Object? decode() {
    final result = value(0);
    whitespace();
    if (position != text.length) fail();
    return result;
  }

  Never fail() => throw FormatException('invalid JSON', null, position);
  String string() {
    final start = position++;
    while (position < text.length) {
      final char = text[position++];
      if (char == '"')
        return jsonDecode(text.substring(start, position)) as String;
      if (char == '\\') position++;
    }
    fail();
  }

  Object? value(int depth) {
    if (depth > 128) throw const FormatException('JSON nesting exceeds limit');
    whitespace();
    if (position >= text.length) fail();
    final char = text[position];
    if (char == '"') return string();
    if (char == '{' || char == '[') {
      position++;
      whitespace();
      final object = <String, dynamic>{};
      final array = <Object?>[];
      final end = char == '{' ? '}' : ']';
      if (position < text.length && text[position] == end) {
        position++;
        return char == '{' ? object : array;
      }
      while (true) {
        if (char == '{') {
          whitespace();
          if (position >= text.length || text[position] != '"') fail();
          final key = string();
          whitespace();
          if (object.containsKey(key) ||
              position >= text.length ||
              text[position++] != ':')
            fail();
          object[key] = value(depth + 1);
        } else {
          array.add(value(depth + 1));
        }
        whitespace();
        if (position >= text.length) fail();
        final next = text[position++];
        if (next == end) break;
        if (next != ',') fail();
      }
      return char == '{' ? object : array;
    }
    for (final token in ['true', 'false', 'null']) {
      if (text.startsWith(token, position)) {
        position += token.length;
        return token == 'null' ? null : token == 'true';
      }
    }
    final match = RegExp(
      r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?',
    ).matchAsPrefix(text, position);
    if (match == null) fail();
    position = match.end;
    return ExactNumber(match.group(0)!);
  }
}
