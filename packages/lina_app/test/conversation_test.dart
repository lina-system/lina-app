// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/core_screen.dart';
import 'package:lina_app/lina_app.dart';
import 'package:lina_design/lina_design.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'support/conversation_core.dart';

Future<void> mount(WidgetTester tester, ConversationCore core) async {
  tester.view.physicalSize = const Size(1200, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(core.dispose);
  final p = DisplayPreferences();
  addTearDown(p.dispose);
  await tester.pumpWidget(
    LinaApp(
      preferences: p,
      home: CoreScreen(connection: core, preferences: p),
    ),
  );
  await tester.pumpAndSettle();
}

final composer = find.byKey(const ValueKey('composer'));
Future<void> choose(WidgetTester tester, String name) async {
  await tester.tap(find.byType(DropdownButtonFormField<String>));
  await tester.pumpAndSettle();
  await tester.tap(find.text(name).last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('opens the Core-selected main conversation without setup', (
    tester,
  ) async {
    final core = ConversationCore();
    await mount(tester, core);
    expect(core.requests.where((r) => r.kind == 'history_get'), hasLength(1));
    expect(
      find.byWidgetPredicate((w) => w is LinaText && w.data == '나를 기다리는 것'),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate((w) => w is LinaText && w.data == '오늘'),
      findsOneWidget,
    );
  });
  testWidgets('drafts stay with each agent across switch and navigation', (
    tester,
  ) async {
    final core = ConversationCore();
    await mount(tester, core);
    await choose(tester, 'Lina');
    await tester.enterText(composer, 'Lina draft');
    await choose(tester, 'Sion');
    expect(tester.widget<TextField>(composer).controller!.text, isEmpty);
    await tester.enterText(composer, 'Sion draft');
    await choose(tester, 'Lina');
    expect(tester.widget<TextField>(composer).controller!.text, 'Lina draft');
    await tester.tap(find.text('Library'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(composer).controller!.text, 'Lina draft');
    expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
  });

  testWidgets(
    'all eight turn states, explicit retry, stop and mid-turn input',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      expect(find.text('Composing'), findsOneWidget);
      await tester.enterText(composer, 'first');
      await tester.pump();
      await tester.tap(find.text('Send'));
      await tester.pump();
      core.pending.last.complete(event('item_done', {}, effect: 'applied'));
      await tester.pump();
      expect(find.text('Accepted'), findsOneWidget);
      core.stream('lina', 1, 'turn', 'turn_state', {
        'active': true,
        'phase': 'streaming',
        'agent_id': 'lina',
      });
      await tester.pump();
      expect(find.text('Responding'), findsOneWidget);
      core.stream('lina', 2, 'reply', 'output_delta', {
        'text': 'A streamed reply',
        'agent_id': 'lina',
      });
      await tester.pump();
      await tester.tap(find.text('Queue next'));
      await tester.enterText(composer, 'while working');
      await tester.pump();
      await tester.tap(find.text('Send'));
      await tester.pump();
      expect((core.requests.last.payload as ProtocolInput).mode, 'queue');
      core.pending.last.complete(event('item_done', {}, effect: 'applied'));
      await tester.pump();
      expect(find.text('Queued'), findsOneWidget);
      await tester.tap(find.text('Stop'));
      await tester.pump();
      expect(core.requests.last.kind, 'interrupt');
      expect(
        (core.requests.last.payload as ProtocolInterrupt).conversationId,
        'lina-main',
      );
      expect(find.text('User-stopped'), findsNothing);
      core.pending.last.complete(event('item_done', {}, effect: 'applied'));
      await tester.pump();
      core.stream('lina', 3, 'turn', 'turn_state', {'active': false});
      await tester.pump();
      expect(find.text('User-stopped'), findsOneWidget);
      await tester.enterText(composer, 'failure');
      await tester.pump();
      await tester.tap(find.text('Send'));
      await tester.pump();
      core.pending.last.complete(Envelope.fromJson(fixture('outcomes/failed')));
      await tester.pump();
      expect(find.text('Failed'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      final before = core.requests.where((r) => r.kind == 'input').length;
      await tester.pump(const Duration(seconds: 10));
      expect(core.requests.where((r) => r.kind == 'input'), hasLength(before));
      await tester.tap(find.text('Retry'));
      await tester.pump();
      core.pending.last.complete(event('item_done', {}, effect: 'applied'));
      await tester.pump();
      core.stream('lina', 4, 'turn', 'turn_state', {'active': true});
      core.stream('lina', 5, 'reply', 'item_done', {
        'text': 'Completed reply',
        'speaker': 'agent',
        'agent_id': 'lina',
      });
      core.stream('lina', 6, 'turn', 'turn_state', {'active': false});
      await tester.pump();
      expect(find.text('Completed'), findsOneWidget);
      core.drop();
      await tester.pump();
      expect(find.text('Disconnected'), findsWidgets);
    },
  );
  testWidgets(
    'late receipts and stream replies cannot change a corrected target or draft',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      await tester.enterText(composer, 'original');
      await tester.pump();
      await tester.tap(find.text('Send'));
      await tester.pump();
      final original = core.pending.last;
      await tester.enterText(composer, 'corrected Lina draft');
      await choose(tester, 'Sion');
      await tester.enterText(composer, 'Sion draft');
      original.complete(event('item_done', {}, effect: 'applied'));
      core.stream('lina', 1, 'late', 'item_done', {
        'text': 'Lina-only late reply',
        'speaker': 'agent',
        'agent_id': 'lina',
      });
      await tester.pump();
      expect(tester.widget<TextField>(composer).controller!.text, 'Sion draft');
      expect(find.text('Lina-only late reply'), findsNothing);
      await choose(tester, 'Lina');
      expect(
        tester.widget<TextField>(composer).controller!.text,
        'corrected Lina draft',
      );
      expect(find.text('Lina-only late reply'), findsOneWidget);
      expect(
        (core.requests.where((r) => r.kind == 'input').single.payload
                as ProtocolInput)
            .conversationId,
        'lina-main',
      );
    },
  );
  testWidgets(
    'disconnect and reconnect preserve draft and reading position without resend',
    (tester) async {
      final core = ConversationCore();
      core.snapshots['lina'] = List.generate(
        40,
        (i) => {
          'kind': 'item_done',
          'key': 'message-$i',
          'revision': 1,
          'payload': {
            'text':
                'Synthetic paragraph $i\nReading position should stay here.',
            'speaker': 'agent',
            'agent_id': 'lina',
          },
        },
      );
      await mount(tester, core);
      final list = find.byKey(const PageStorageKey('conversation:lina'));
      final scroll = tester.widget<ListView>(list).controller!;
      scroll.jumpTo(900);
      await tester.pump();
      final position = scroll.offset;
      await tester.enterText(composer, 'Uncertain request');
      await tester.pump();
      await tester.tap(find.text('Send'));
      await tester.pump();
      core.drop();
      core.pending.last.completeError(const ConnectionLost());
      await tester.pump();
      expect(scroll.offset, position);
      expect(
        tester.widget<TextField>(composer).controller!.text,
        'Uncertain request',
      );
      final count = core.requests.where((r) => r.kind == 'input').length;
      core.live();
      await tester.pumpAndSettle();
      expect(scroll.offset, position);
      expect(
        tester.widget<TextField>(composer).controller!.text,
        'Uncertain request',
      );
      expect(core.requests.where((r) => r.kind == 'input'), hasLength(count));
      await tester.tap(find.text('Library'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Back'));
      await tester.pump();
      expect(tester.widget<ListView>(list).controller!.offset, position);
      tester.view.physicalSize = const Size(1050, 1000);
      await tester.pump();
      expect(
        tester.widget<TextField>(composer).controller!.text,
        'Uncertain request',
      );
    },
  );
  testWidgets(
    'duplicate deltas are ignored and a sequence gap requests a snapshot',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      core.stream('lina', 1, 'reply', 'output_delta', {
        'text': 'hello',
        'agent_id': 'lina',
      });
      core.stream('lina', 1, 'reply', 'output_delta', {
        'text': 'hello',
        'agent_id': 'lina',
      });
      core.stream('lina', 3, 'reply', 'output_delta', {
        'text': 'should not append',
        'agent_id': 'lina',
      });
      await tester.pumpAndSettle();
      expect(find.text('hello'), findsOneWidget);
      expect(find.textContaining('should not append'), findsNothing);
      expect(core.requests.where((r) => r.kind == 'subscribe'), hasLength(2));
      core.emit(
        event('snapshot', {
          ...core.snapshot('lina'),
          'cursor': {'epoch': '42', 'seq': 3},
          'items': [
            {
              'kind': 'item_done',
              'key': 'reply',
              'revision': 3,
              'payload': {'text': 'Complete replacement'},
            },
          ],
        }),
      );
      await tester.pump();
      expect(find.text('Complete replacement'), findsOneWidget);
      expect(find.text('hello'), findsNothing);
    },
  );

  testWidgets(
    'fixture flow: delegation and question leave conversation usable through restart',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      await tester.enterText(composer, 'Delegate a synthetic reading plan');
      await tester.pump();
      await tester.tap(find.text('Send'));
      await tester.pump();
      core.pending.last.complete(event('item_done', {}, effect: 'applied'));
      await tester.pump();
      core.stream('lina', 1, 'delegated', 'item_done', {
        'text': 'The reading plan is underway.',
        'speaker': 'agent',
        'agent_id': 'lina',
      });
      final question = {
        ...fixture('values/question_card')['payload'] as Map<String, dynamic>,
        'conversation_id': 'lina-main',
      };
      core.stream('lina', 2, 'question', 'question', question);
      await tester.pump();
      await tester.enterText(composer, 'A separate general question');
      await tester.pump();
      await tester.tap(find.text('Send'));
      await tester.pump();
      expect(core.requests.where((r) => r.kind == 'input'), hasLength(2));
      core.pending.last.complete(event('item_done', {}, effect: 'applied'));
      await tester.pump();
      await tester.enterText(composer, 'Draft during restart');
      core.snapshots['lina'] = [
        {
          'kind': 'item_done',
          'key': 'delegated',
          'revision': 1,
          'payload': {
            'text': 'The reading plan is underway.',
            'speaker': 'agent',
            'agent_id': 'lina',
          },
        },
        {
          'kind': 'question',
          'key': 'question',
          'revision': 2,
          'payload': question,
        },
      ];
      core.drop();
      await tester.pump();
      core.live(epoch: '43');
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(composer).controller!.text,
        'Draft during restart',
      );
      expect(core.requests.where((r) => r.kind == 'input'), hasLength(2));
      final transcript = tester
          .widget<ListView>(
            find.byKey(const PageStorageKey('conversation:lina')),
          )
          .controller!;
      transcript.jumpTo(transcript.position.maxScrollExtent);
      await tester.pump();
      expect(find.text('The reading plan is underway.'), findsOneWidget);
      expect(find.text('Send the document'), findsOneWidget);
    },
  );
  testWidgets(
    'an idle turn without a committed answer is unknown, never completed',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      core.stream('lina', 1, 'turn', 'turn_state', {'active': true});
      core.stream('lina', 2, 'turn', 'turn_state', {'active': false});
      await tester.pump();
      expect(find.text('Completed'), findsNothing);
      expect(find.textContaining('without a confirmed answer'), findsOneWidget);
    },
  );

  testWidgets(
    'document panel reads full pages and never promotes a preview to saved',
    (tester) async {
      final core = ConversationCore();
      core.welcome = ProtocolWelcome.fromJson({
        ...core.welcome!.toJson(),
        'capabilities': [
          {'name': 'conversation', 'version': '1.0'},
          CoreConnection.capabilities.firstWhere((c) => c['name'] == 'results'),
        ],
      });
      final result = {
        ...fixture('results/document_draft')['payload'] as Map<String, dynamic>,
        'title': 'Synthetic document',
        'provenance': {
          'agent_id': 'lina',
          'conversation_id': 'lina-main',
          'turn_id': 'turn',
          'task_id': null,
        },
      };
      core.snapshots['lina'] = [
        {'kind': 'result', 'key': 'document', 'revision': 1, 'payload': result},
      ];
      await mount(tester, core);
      final list = tester
          .widget<ListView>(
            find.byKey(const PageStorageKey('conversation:lina')),
          )
          .controller!;
      list.jumpTo(list.position.maxScrollExtent);
      await tester.pump();
      await tester.tap(find.text('Read'));
      await tester.pump();
      expect(core.requests.last.kind, 'result_get');
      expect(
        (core.requests.last.payload as ProtocolResultGet).conversationId,
        'lina-main',
      );
      core.pending.last.complete(
        event('result', {...result, 'text': 'First page\n', 'next': 8}),
      );
      await tester.pump();
      expect(
        (core.requests.last.payload as ProtocolResultGet).offset,
        ExactNumber('8'),
      );
      core.pending.last.complete(
        event('result', {...result, 'text': 'Last page'}),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widgetList<SelectableText>(find.byType(SelectableText))
            .map((w) => w.data)
            .toList(),
        contains('First page\nLast page'),
      );
      expect(find.text('Saved by Core'), findsNothing);
      expect(find.text('Preview · Not saved'), findsWidgets);
      await tester.tap(find.text('Full screen'));
      await tester.pump();
      expect(composer, findsOneWidget);
      await tester.tap(find.text('Close'));
      await tester.pump();
      expect(composer, findsOneWidget);
      expect(find.text('Home'), findsOneWidget);
    },
  );

  testWidgets(
    'Home renders Core progress in its supplied order and forgets a replaced snapshot',
    (tester) async {
      final core = ConversationCore();
      core.welcome = ProtocolWelcome.fromJson({
        ...core.welcome!.toJson(),
        'capabilities': [
          {'name': 'conversation', 'version': '1.0'},
          {'name': 'progress', 'version': '1.0'},
        ],
      });
      final data =
          fixture('normal/progress')['payload'] as Map<String, dynamic>;
      final row = (data['rows'] as List).first as Map<String, dynamic>;
      core.answers['progress_get'] = event('progress', {
        ...data,
        'rows': [
          {
            ...row,
            'ref': 'a',
            'line': {...row['line'] as Map, 'name': 'Zeta'},
          },
          {
            ...row,
            'ref': 'b',
            'line': {...row['line'] as Map, 'name': 'Alpha'},
          },
        ],
      });
      await mount(tester, core);
      final names = tester
          .widgetList<LinaText>(find.byType(LinaText))
          .map((w) => w.data)
          .where((t) => t.startsWith('Zeta') || t.startsWith('Alpha'))
          .toList();
      expect(names, ['Zeta · Draft workshop', 'Alpha · Draft workshop']);
      expect(find.text('Nothing to decide now.'), findsOneWidget);
      core.emit(
        event('snapshot', {
          'topic': 'progress',
          'cursor': {'epoch': '42', 'seq': 1},
          'revocation_epoch': '0',
          'items': [],
        }),
      );
      await tester.pump();
      expect(find.text('Zeta · Draft workshop'), findsNothing);
      expect(find.text('Nothing to decide now.'), findsNothing);
    },
  );
}
