// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/core_screen.dart';
import 'package:lina_app/lina_app.dart';

import 'support/conversation_core.dart';
import 'support/memory_core.dart';

Future<void> mountMemory(WidgetTester tester, MemoryCore core) async {
  tester.view.physicalSize = const Size(1280, 1100);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(core.dispose);
  final preferences = DisplayPreferences();
  addTearDown(preferences.dispose);
  await tester.pumpWidget(
    LinaApp(
      preferences: preferences,
      home: CoreScreen(connection: core, preferences: preferences),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'remember previews destination and keeps draft until Core confirms',
    (tester) async {
      final core = MemoryCore();
      await mountMemory(tester, core);
      await tester.tap(find.text('Memory'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remember'));
      await tester.pumpAndSettle();
      expect(
        find.text('Save to: Lina personal · Scope: local'),
        findsOneWidget,
      );
      final editor = find.byKey(const ValueKey('memory-text'));
      await tester.enterText(editor, 'Prefers evening walks.');
      await tester.pump();
      await tester.tap(find.text('Send memory request'));
      await tester.pump();
      expect(core.writes.single.request.text, 'Prefers evening walks.');
      expect(find.text('Waiting for Core confirmation.'), findsOneWidget);
      expect(
        tester.widget<TextField>(editor).controller!.text,
        'Prefers evening walks.',
      );
      core.items = [memoryItem('saved', 'lina', 'Prefers evening walks.')];
      core.writes.single.reply.complete(
        event('memory_result', {
          'operation': 'remember',
          'item_id': 'saved',
        }, effect: 'applied'),
      );
      await tester.pumpAndSettle();
      expect(editor, findsNothing);
      expect(find.text('Core confirmed remembering.'), findsOneWidget);
      expect(find.text('Prefers evening walks.'), findsOneWidget);
    },
  );

  testWidgets(
    'forget is explicit, cancellable and never deletes conversation turns',
    (tester) async {
      final core = MemoryCore();
      await mountMemory(tester, core);
      await tester.tap(find.text('Memory'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Forget').first);
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Original conversation turns stay'),
        findsOneWidget,
      );
      expect(core.writes, isEmpty);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(core.writes, isEmpty);
      await tester.tap(find.text('Forget').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm forget'));
      await tester.pump();
      expect(core.writes.single.request.operation, 'forget');
      expect(
        core.writes.single.request.json.containsKey('delete_turns'),
        isFalse,
      );
      core.drop();
      await tester.pumpAndSettle();
      expect(find.text('Enjoys quiet reading together.'), findsNothing);
      expect(find.textContaining('Outcome unknown'), findsOneWidget);
    },
  );

  testWidgets('switching agent isolates open editor and ignores old receipt', (
    tester,
  ) async {
    final core = MemoryCore();
    await mountMemory(tester, core);
    await tester.tap(find.text('Memory'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remember'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('memory-text')),
      'Lina statement',
    );
    await tester.pump();
    await tester.tap(find.text('Send memory request'));
    await tester.pump();
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sion').last);
    await tester.pumpAndSettle();
    expect(find.text('Lina statement'), findsNothing);
    expect(find.text('Another agent private memory.'), findsOneWidget);
    expect(find.text('Enjoys quiet reading together.'), findsNothing);
    core.writes.single.reply.complete(
      event('memory_result', {
        'operation': 'remember',
        'item_id': 'saved',
      }, effect: 'applied'),
    );
    await tester.pumpAndSettle();
    expect(find.text('Core confirmed remembering.'), findsNothing);
    expect(core.writes.single.request.agentId, 'lina');
  });

  testWidgets(
    'source markers hide deleted quotes and unsupported actions stay disabled',
    (tester) async {
      final core = MemoryCore();
      core.items = [
        {
          ...memoryItem('marker', 'lina', 'A sourced statement'),
          'evidence_details': [
            {
              'reference': 'event:marker',
              'status': 'deleted',
              'quote': 'Erased quote',
              'tombstone': {
                'agent': 'lina',
                'person': 'synthetic-person',
                'at': 1700000000,
              },
            },
          ],
        },
      ];
      await mountMemory(tester, core);
      await tester.tap(find.text('Memory'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Deletion marker'), findsOneWidget);
      expect(find.text('Erased quote'), findsNothing);
      await tester.tap(find.text('Other memory actions'));
      await tester.pumpAndSettle();
      final delete = find.widgetWithText(TextButton, 'Permanently delete');
      expect(tester.widget<TextButton>(delete).onPressed, isNull);
      final move = find.widgetWithText(TextButton, 'Move layer');
      expect(tester.widget<TextButton>(move).onPressed, isNull);
      expect(core.writes, isEmpty);
    },
  );

  testWidgets('memory navigation shows only selected and shared knowledge', (
    tester,
  ) async {
    final core = MemoryCore();
    await mountMemory(tester, core);
    expect(find.text('Memory'), findsOneWidget);
    await tester.tap(find.text('Memory'));
    await tester.pumpAndSettle();
    expect(find.text('Enjoys quiet reading together.'), findsOneWidget);
    expect(find.text('Prefers tea in the morning.'), findsOneWidget);
    expect(find.text('Another agent private memory.'), findsNothing);
    expect(find.textContaining('Last updated: Unobserved'), findsWidgets);
    expect(find.textContaining('event:personal'), findsOneWidget);
  });
}
