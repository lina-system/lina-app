// SPDX-License-Identifier: Apache-2.0
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/memory_controller.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'support/conversation_core.dart';
import 'support/memory_core.dart';

Future<void> tick() => Future<void>.delayed(Duration.zero);

void main() {
  late MemoryCore core;
  late MemoryController memory;
  setUp(() async {
    core = MemoryCore();
    memory = MemoryController(core, 'lina');
    await tick();
  });
  tearDown(() async {
    memory.dispose();
    await core.dispose();
  });

  test(
    'memory is offered separately; scoped pages never reveal another holder',
    () async {
      expect(
        CoreConnection.capabilities,
        contains(equals({'name': 'memory', 'version': '1.0'})),
      );
      expect(memory.items.map((i) => i.itemId), ['personal', 'shared']);
      expect(core.requests.single.payload.json, {
        'operation': 'list',
        'agent_id': 'lina',
      });
      core.next = 'page-two';
      await memory.refresh();
      core.items = [memoryItem('more', 'all', 'Another shared item')];
      core.next = null;
      await memory.loadMore();
      expect(core.requests.last.payload.json['after'], 'page-two');
      expect(memory.items.map((i) => i.itemId), ['personal', 'shared', 'more']);
      expect(memory.next, isNull);
    },
  );

  test(
    'remember waits for applied receipt then reads authoritative state',
    () async {
      final original = memory.items;
      final writing = memory.remember('New statement', 'all', 'private');
      await tick();
      expect(memory.writing, isTrue);
      expect(memory.items, original);
      expect(core.writes.single.request.json, {
        'operation': 'remember',
        'agent_id': 'lina',
        'text': 'New statement',
        'holder': 'all',
        'scope': 'private',
      });
      expect(await memory.remember('Duplicate', 'all', 'local'), isFalse);
      core.items = [memoryItem('new', 'all', 'Core canonical statement')];
      core.writes.single.reply.complete(
        event('memory_result', {
          'operation': 'remember',
          'item_id': 'new',
        }, effect: 'applied'),
      );
      expect(await writing, isTrue);
      expect(memory.items.single.content, 'Core canonical statement');
      expect(memory.feedback, 'Core confirmed remembering.');
    },
  );

  test('correction retains layer and scope through Core, forget leaves turns alone', () async {
    final item = memory.items.first;
    final correcting = memory.correct(item, 'Corrected statement');
    expect(core.writes.single.request.json, {
      'operation': 'correct',
      'agent_id': 'lina',
      'item_id': item.itemId,
      'text': 'Corrected statement',
    });
    core.items = [memoryItem('replacement', 'lina', 'Corrected statement')];
    core.writes.single.reply.complete(
      event('memory_result', {
        'operation': 'correct',
        'item_id': 'replacement',
      }, effect: 'applied'),
    );
    expect(await correcting, isTrue);
    final forgetting = memory.forget(memory.items.single);
    expect(memory.items, hasLength(1));
    expect(core.writes.last.request.json, {
      'operation': 'forget',
      'agent_id': 'lina',
      'item_id': 'replacement',
    });
    core.items = [];
    core.writes.last.reply.complete(
      event('memory_result', {
        'operation': 'forget',
        'item_id': 'replacement',
      }, effect: 'applied'),
    );
    expect(await forgetting, isTrue);
    expect(memory.items, isEmpty);
    expect(memory.feedback, contains('Conversation turns are retained'));
    expect(core.requests.every((r) => r.kind == 'memory_request'), isTrue);
  });

  test(
    'refusal and incomplete receipts never claim success or resend',
    () async {
      for (final receipt in [
        event(
          'memory_result',
          {'operation': 'remember'},
          effect: 'refused',
          error: {'code': 'not_authorized', 'detail': 'Synthetic refusal.'},
        ),
        event('memory_result', {'operation': 'remember', 'item_id': 'x'}),
        event('memory_result', {
          'operation': 'forget',
          'item_id': 'x',
        }, effect: 'applied'),
        event('memory_result', {'operation': 'remember'}, effect: 'applied'),
      ]) {
        await memory.refresh();
        final writing = memory.remember('Statement', 'lina', 'local');
        final count = core.writes.length;
        core.writes.last.reply.complete(receipt);
        expect(await writing, isFalse);
        expect(memory.feedback, isNot(contains('Core confirmed')));
        expect(core.writes.length, count);
      }
    },
  );

  test(
    'dropped write hides data and ignores its late receipt after reconnect',
    () async {
      final writing = memory.forget(memory.items.first);
      core.drop();
      expect(memory.items, isEmpty);
      expect(memory.canWrite, isFalse);
      expect(memory.feedback, contains('Outcome unknown'));
      core.items = [];
      core.live(epoch: '43');
      core.enableMemory();
      await tick();
      core.writes.single.reply.complete(
        event('memory_result', {
          'operation': 'forget',
          'item_id': 'personal',
        }, effect: 'applied'),
      );
      expect(await writing, isFalse);
      expect(memory.items, isEmpty);
      expect(memory.feedback, isNot(contains('Core confirmed')));
      expect(core.writes, hasLength(1));
    },
  );

  test(
    'transport exception and wrong forget id leave outcome unknown',
    () async {
      final writing = memory.remember('Statement', 'lina', 'private');
      core.writes.last.reply.completeError(const ConnectionLost());
      expect(await writing, isFalse);
      expect(memory.items, isEmpty);
      expect(memory.canWrite, isFalse);
      await memory.refresh();
      final forgetting = memory.forget(memory.items.first);
      core.writes.last.reply.complete(
        event('memory_result', {
          'operation': 'forget',
          'item_id': 'other',
        }, effect: 'applied'),
      );
      expect(await forgetting, isFalse);
      expect(memory.items, isEmpty);
    },
  );

  test('obsolete reads cannot overwrite a refreshed snapshot', () async {
    core.holdReads = true;
    final first = memory.refresh();
    final second = memory.refresh();
    core.items = [];
    core.reads.last.complete(core.listing());
    await second;
    core.items = [memoryItem('obsolete', 'lina', 'Obsolete content')];
    core.reads.first.complete(core.listing());
    await first;
    expect(memory.items, isEmpty);
    expect(memory.observed, isTrue);
  });

  test(
    'revocation invalidates cached content before replacement arrives',
    () async {
      core.holdReads = true;
      core.emit(
        event('snapshot', {
          'topic': 'conversation:lina-main',
          'cursor': {'epoch': '42', 'seq': 1},
          'revocation_epoch': '1',
          'items': [],
        }),
      );
      expect(memory.items, isEmpty);
      expect(memory.canWrite, isFalse);
      core.items = [];
      core.reads.single.complete(core.listing());
      await tick();
      expect(memory.items, isEmpty);
      expect(memory.observed, isTrue);
    },
  );

  test(
    'partial pages and invalid cursors are not a complete empty list',
    () async {
      core.next = 'repeat';
      await memory.refresh();
      expect(memory.next, 'repeat');
      await memory.loadMore();
      expect(memory.observed, isFalse);
      expect(memory.canWrite, isFalse);
      expect(memory.feedback, contains('unobserved'));
      core.holdReads = true;
      final refreshing = memory.refresh();
      core.reads.single.complete(event('memory_result', {'operation': 'list'}));
      await refreshing;
      expect(memory.observed, isFalse);
    },
  );

  test('restart and foreground read again; unsupported and removed agents cannot write', () async {
    memory.suspend();
    expect(memory.items, isEmpty);
    core.items = [];
    await memory.resume();
    expect(memory.items, isEmpty);
    memory.dispose();
    memory = MemoryController(core, 'lina');
    await tick();
    expect(memory.items, isEmpty);
    core.live(); // No memory capability.
    expect(memory.available, isFalse);
    expect(await memory.remember('No grant', 'lina', 'local'), isFalse);
    core.live(
      agents: [
        {'agent_id': 'sion', 'name': 'Sion', 'preset': 'dev'},
      ],
    );
    core.enableMemory();
    expect(memory.available, isFalse);
    expect(await memory.remember('Removed', 'lina', 'local'), isFalse);
    expect(core.writes, isEmpty);
  });

  test('foreign holders and items cannot be written or forgotten', () async {
    expect(await memory.remember('Foreign', 'sion', 'local'), isFalse);
    expect(
      await memory.forget(
        ProtocolMemorySummary.fromJson(memoryItem('other', 'sion', 'Hidden')),
      ),
      isFalse,
    );
    expect(core.writes, isEmpty);
  });

  test(
    'uncertain Core errors invalidate the snapshot and cannot be retried',
    () async {
      final writing = memory.remember('Uncertain statement', 'lina', 'local');
      core.writes.single.reply.complete(
        event(
          'memory_result',
          {'operation': 'remember'},
          effect: 'unknown',
          error: {'code': 'unavailable', 'detail': 'Uncertain'},
        ),
      );
      expect(await writing, isFalse);
      expect(memory.items, isEmpty);
      expect(memory.canWrite, isFalse);
      expect(memory.feedback, contains('Outcome unknown'));
    },
  );
}
