// SPDX-License-Identifier: Apache-2.0
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lina_protocol/lina_protocol.dart';

void main() {
  ProtocolSnapshot snapshot() => ProtocolSnapshot.fromJson(
    (exactDecode(
          File('../../protocol/core/fixtures/client/1.0/normal/snapshot.json')
              .readAsStringSync(),
        ) as Map<String, dynamic>)['payload']
        as Map<String, dynamic>,
  );
  Map<String, dynamic> delta(
    Object seq,
    String text, {
    String epoch = '42',
    Object? revision,
  }) => {
    'text': text,
    'stream': {
      'topic': 'conversation:stream-fixture',
      'cursor': {'epoch': epoch, 'seq': seq},
      'key': 'reply',
      'revision': revision ?? seq,
    },
  };
  test(
    'snapshot replaces, deltas append once, completion replaces one key',
    () {
      final window = TopicWindow('conversation:stream-fixture');
      expect(window.apply('output_delta', delta(1, 'no baseline')), isFalse);
      expect(window.replace(snapshot()), isTrue);
      expect(window.apply('output_delta', delta(3, 'Hello')), isTrue);
      expect(window.apply('output_delta', delta(3, 'Hello')), isFalse);
      expect(window.apply('output_delta', delta(4, ' world')), isTrue);
      expect((window.items.last.payload as Map)['text'], 'Hello world');
      expect(window.apply('item_done', delta(5, 'Final')), isTrue);
      expect(window.items.last.kind, 'item_done');
      expect((window.items.last.payload as Map)['text'], 'Final');
      window.replace(
        ProtocolSnapshot.fromJson({
          ...snapshot().toJson(),
          'cursor': {'epoch': '42', 'seq': 6},
          'items': <Object?>[],
        }),
      );
      expect(window.items, isEmpty);
    },
  );
  test('a gap or epoch change suspends deltas until a new snapshot', () {
    final window = TopicWindow('conversation:stream-fixture')
      ..replace(snapshot());
    expect(window.apply('output_delta', delta(4, 'gap')), isFalse);
    expect(window.needsSnapshot, isTrue);
    expect(window.apply('output_delta', delta(3, 'late')), isFalse);
    window.replace(snapshot());
    expect(
      window.apply('output_delta', delta(3, 'new epoch', epoch: '43')),
      isFalse,
    );
    expect(window.needsSnapshot, isTrue);
  });
  test('foreign topics and old revisions cannot change this window', () {
    final window = TopicWindow('conversation:stream-fixture')
      ..replace(snapshot());
    expect(
      window.replace(
        ProtocolSnapshot.fromJson({
          ...snapshot().toJson(),
          'topic': 'conversation:other',
        }),
      ),
      isFalse,
    );
    expect(window.apply('output_delta', delta(3, 'new', revision: 9)), isTrue);
    expect(window.apply('item_done', delta(4, 'old', revision: 8)), isFalse);
    expect((window.items.last.payload as Map)['text'], 'new');
    expect(window.cursor!.seq, ExactNumber('4'));
  });
  test(
    'integer cursors retain uint64 precision and accept exponent notation',
    () {
      final window = TopicWindow('conversation:stream-fixture')
        ..replace(
          ProtocolSnapshot.fromJson({
            ...snapshot().toJson(),
            'cursor': {
              'epoch': '42',
              'seq': ExactNumber('18446744073709551614'),
            },
          }),
        );
      expect(
        window.apply(
          'output_delta',
          delta(ExactNumber('18446744073709551615'), 'last'),
        ),
        isTrue,
      );
      expect(ExactNumber('3e0').toBigInt(), BigInt.from(3));
      expect(ExactNumber('3.0').toBigInt(), BigInt.from(3));
      expect(() => ExactNumber('3.1').toBigInt(), throwsFormatException);
    },
  );
}
