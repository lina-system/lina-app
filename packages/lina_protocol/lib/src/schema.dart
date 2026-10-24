// SPDX-License-Identifier: Apache-2.0
import 'json.dart';

typedef JsonMap = Map<String, dynamic>;

class Schema {
  Schema(this.root);
  final JsonMap root;
  JsonMap definition(String name) => root[r'$defs'][name] as JsonMap;
  void validate(Object? value, {String? definition}) =>
      check(value, definition == null ? root : this.definition(definition));
  bool matches(Object? value, Object? schema) {
    try {
      check(value, schema);
      return true;
    } on FormatException {
      return false;
    }
  }

  Never bad(String path, String reason) =>
      throw FormatException('$path: $reason');
  void check(Object? value, Object? schema, [String path = r'$']) {
    if (schema == true) return;
    if (schema == false) bad(path, 'forbidden');
    final s = schema as JsonMap;
    if (s.containsKey(r'$ref'))
      check(value, definition((s[r'$ref'] as String).split('/').last), path);
    if (s.containsKey('const') && !equal(value, s['const'])) bad(path, 'const');
    if (s.containsKey('enum') &&
        !(s['enum'] as List).any((v) => equal(value, v)))
      bad(path, 'enum');
    if (s.containsKey('type')) {
      final types = s['type'] is List ? s['type'] as List : [s['type']];
      if (!types.any(
        (t) => switch (t) {
          'object' => value is Map<String, dynamic>,
          'array' => value is List,
          'string' => value is String,
          'boolean' => value is bool,
          'null' => value == null,
          'number' => value is ExactNumber || value is num,
          'integer' =>
            (value is ExactNumber && value.isInteger) || value is int,
          _ => false,
        },
      ))
        bad(path, 'type ${s['type']}');
    }
    if (value is Map<String, dynamic>) {
      for (final key in (s['required'] as List? ?? [])) {
        if (!value.containsKey(key)) bad(path, 'missing $key');
      }
      final props = s['properties'] as JsonMap? ?? {};
      for (final e in value.entries) {
        if (props.containsKey(e.key)) {
          check(e.value, props[e.key], '$path.${e.key}');
        } else if (s.containsKey('additionalProperties')) {
          check(e.value, s['additionalProperties'], '$path.${e.key}');
        }
      }
    }
    if (value is List) {
      if (s.containsKey('minItems') && value.length < _integer(s['minItems']))
        bad(path, 'minItems');
      if (s.containsKey('maxItems') && value.length > _integer(s['maxItems']))
        bad(path, 'maxItems');
      if (s.containsKey('items')) {
        for (final item in value) {
          check(item, s['items'], '$path[]');
        }
      }
    }
    if (value is String) {
      if (s.containsKey('minLength') &&
          value.runes.length < _integer(s['minLength']))
        bad(path, 'minLength');
      if (s.containsKey('maxLength') &&
          value.runes.length > _integer(s['maxLength']))
        bad(path, 'maxLength');
      if (s.containsKey('pattern') &&
          !RegExp(s['pattern'] as String, unicode: true).hasMatch(value))
        bad(path, 'pattern');
      if (s['format'] == 'date-time' && !_date(value)) bad(path, 'date-time');
      if (s['format'] == 'uri' && !(Uri.tryParse(value)?.hasScheme ?? false))
        bad(path, 'uri');
    }
    if (value is ExactNumber || value is num) {
      final n = ExactNumber.of(value);
      if (s.containsKey('minimum') &&
          n.compareTo(ExactNumber.of(s['minimum'])) < 0)
        bad(path, 'minimum');
      if (s.containsKey('maximum') &&
          n.compareTo(ExactNumber.of(s['maximum'])) > 0)
        bad(path, 'maximum');
    }
    for (final sub in (s['allOf'] as List? ?? [])) {
      check(value, sub, path);
    }
    if (s.containsKey('anyOf') &&
        !(s['anyOf'] as List).any((sub) => matches(value, sub)))
      bad(path, 'anyOf');
    if (s.containsKey('oneOf') &&
        (s['oneOf'] as List).where((sub) => matches(value, sub)).length != 1)
      bad(path, 'oneOf');
    if (s.containsKey('not') && matches(value, s['not'])) bad(path, 'not');
    if (s.containsKey('if')) {
      final branch = matches(value, s['if']) ? 'then' : 'else';
      if (s.containsKey(branch)) check(value, s[branch], path);
    }
  }

  static int _integer(Object? n) => int.parse(n.toString());
  static bool equal(Object? a, Object? b) {
    if (a is Map && b is Map)
      return a.length == b.length &&
          a.keys.every((k) => b.containsKey(k) && equal(a[k], b[k]));
    if (a is List && b is List)
      return a.length == b.length &&
          List.generate(a.length, (i) => equal(a[i], b[i])).every((v) => v);
    if ((a is ExactNumber || a is num) && (b is ExactNumber || b is num))
      return ExactNumber.of(a) == ExactNumber.of(b);
    return a == b;
  }

  static bool _date(String text) {
    final date = DateTime.tryParse(text);
    if (date == null) return false;
    final parts = RegExp(r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})')
        .firstMatch(text);
    if (parts == null) return false;
    return date.year == int.parse(parts[1]!) &&
        date.month == int.parse(parts[2]!) &&
        date.day == int.parse(parts[3]!) &&
        int.parse(parts[4]!) < 24 &&
        int.parse(parts[5]!) < 60 &&
        int.parse(parts[6]!) < 60;
  }

  /// Remove only additive payload fields; maps declared by the schema stay maps.
  Object? project(Object? value, Object? schema) {
    if (schema is! JsonMap) return value;
    final s = schema;
    if (s[r'$ref'] == '#/' + r'$defs/stream_item' && value is JsonMap) {
      final item = definition('stream_item');
      final known = (item['properties']['kind']['enum'] as List).contains(
        value['kind'],
      );
      if (!known) {
        check(value, {
          ...item,
          'properties': {
            ...item['properties'] as JsonMap,
            'kind': {'type': 'string', 'minLength': 1},
            'payload': {'type': 'object'},
          },
          'allOf': <Object?>[],
        });
        return _omitted;
      }
    }
    if (s.containsKey(r'$ref'))
      return project(value, definition((s[r'$ref'] as String).split('/').last));
    for (final union in ['anyOf', 'oneOf']) {
      if (s.containsKey(union)) {
        for (final branch in s[union] as List) {
          final projected = project(value, branch);
          if (matches(projected, branch)) return projected;
        }
        return value;
      }
    }
    final constraints = <JsonMap>[];
    void collect(JsonMap node) {
      constraints.add(node);
      for (final sub in node['allOf'] as List? ?? []) {
        collect(sub as JsonMap);
      }
      if (node.containsKey('if')) {
        final branch = matches(value, node['if']) ? 'then' : 'else';
        if (node[branch] is JsonMap) collect(node[branch] as JsonMap);
      }
    }

    collect(s);
    if (value is JsonMap) {
      var result = JsonMap.from(value);
      for (final constraint in constraints) {
        if (constraint.containsKey(r'$ref')) {
          result = project(result, constraint) as JsonMap;
          continue;
        }
        final props = constraint['properties'] as JsonMap? ?? {};
        result = {
          for (final e in result.entries)
            if (props.containsKey(e.key))
              e.key: project(e.value, props[e.key])
            else if (constraint['additionalProperties'] != false)
              e.key: constraint['additionalProperties'] is JsonMap
                  ? project(e.value, constraint['additionalProperties'])
                  : e.value,
        };
      }
      return result;
    }
    if (value is List && s.containsKey('items'))
      return [
        for (final v in value.map((v) => project(v, s['items'])))
          if (!identical(v, _omitted)) v,
      ];
    return value;
  }
}

final _omitted = Object();
