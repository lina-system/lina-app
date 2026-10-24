// SPDX-License-Identifier: Apache-2.0
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lina_protocol/lina_protocol.dart';

void main() {
  final root = Directory('../../protocol/core/fixtures/client');
  test('every positive envelope round-trips without numeric loss', () {
    final files = root
        .listSync(recursive: true)
        .whereType<File>()
        .where(
          (f) =>
              f.path.endsWith('.json') &&
              !RegExp(r'/(cases|invalid|application)/').hasMatch(f.uri.path),
        );
    expect(files.length, greaterThan(200));
    for (final file in files) {
      final source = file.readAsStringSync();
      final envelope = Envelope.decode(source);
      expect(
        exactDecode(envelope.encode()),
        exactDecode(source),
        reason: file.path,
      );
      expect(envelope.typedPayload, isNotNull, reason: file.path);
    }
  });
  test('client and server conformance cases enforce their own outcomes', () {
    final cases = root
        .listSync(recursive: true)
        .whereType<File>()
        .where(
          (f) => f.uri.path.contains('/cases/') && f.path.endsWith('.json'),
        );
    expect(cases.length, greaterThan(40));
    for (final file in cases) {
      final spec = exactDecode(file.readAsStringSync()) as Map;
      final receiver = ProtocolReceiver(tolerant: spec['side'] == 'client');
      final base = file.parent.parent;
      final admitted = <Object?>[];
      final errors = <String>[];
      for (final path in spec['input'] as List) {
        try {
          final result = receiver.receive(
            File('${base.path}/$path').readAsStringSync(),
          );
          if (result != null) admitted.add(result.toJson());
          errors.add('');
        } on FormatException {
          errors.add('malformed');
        }
      }
      expect(errors, spec['errors'], reason: file.path);
      expect(admitted, [
        for (final path in spec['output'] as List)
          exactDecode(File('${base.path}/$path').readAsStringSync()),
      ], reason: file.path);
      expect(
        exactDecode(exactEncode(receiver.counters)),
        spec['outcome'],
        reason: file.path,
      );
    }
  });
  test('unknown kinds still enforce common effect and error constraints', () {
    final value = exactDecode(
      File('../../protocol/core/fixtures/client/1.0/invalid/unknown_kind.json')
          .readAsStringSync(),
    ) as Map<String, dynamic>;
    value['effect_state'] = 'failed';
    value['error'] = null;
    final receiver = ProtocolReceiver();
    expect(() => receiver.receive(exactEncode(value)), throwsFormatException);
    expect(receiver.malformed, 1);
    expect(receiver.unknownKinds, 0);
  });
  test('offset timestamps validate their original civil date', () {
    final date = {'type': 'string', 'format': 'date-time'};
    for (final value in [
      '2026-01-01T00:00:00+09:00',
      '2026-01-01T23:30:00-08:00',
      '2024-02-29T12:00:00Z',
    ]) {
      expect(() => protocolSchema.check(value, date), returnsNormally);
    }
    for (final value in [
      '2026-02-30T00:00:00+09:00',
      '2026-01-01T24:00:00Z',
      '2026-01-01T12:00:00+99:00',
    ]) {
      expect(() => protocolSchema.check(value, date), throwsFormatException);
    }
  });
  test(
    'exact numeric comparison distinguishes uint64 overflow and fractions',
    () {
      expect(
        ExactNumber('18446744073709551615')
            .compareTo(ExactNumber('18446744073709551616')),
        lessThan(0),
      );
      expect(
        ExactNumber('9007199254740993.125').toString(),
        '9007199254740993.125',
      );
      expect(exactDecode('{"n":1e3}'), exactDecode('{"n":1000.0}'));
      expect(() => exactDecode('{"n":01}'), throwsFormatException);
      expect(() => exactDecode('{"n":1,"n":2}'), throwsFormatException);
    },
  );
}
