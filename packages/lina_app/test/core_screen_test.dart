// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/core_screen.dart';
import 'package:lina_app/lina_app.dart';
import 'package:lina_app/platform_slots.dart';
import 'package:lina_app/conversation_draft.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'support/conversation_core.dart';

class DraftFixture implements ConversationDraftHost {
  bool Function(String)? append;
  @override
  void attach(bool Function(String) handler) => append = handler;
  @override
  void detach() => append = null;
}

void main() {
  Future<void> mount(
    WidgetTester tester,
    ConversationCore core, {
    PlatformSlots slots = const PlatformSlots(),
    DisplayPreferences? preferences,
  }) async {
    tester.view.physicalSize = const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(core.dispose);
    final p = preferences ?? DisplayPreferences();
    addTearDown(p.dispose);
    await tester.pumpWidget(
      LinaApp(
        preferences: p,
        home: CoreScreen(connection: core, preferences: p, slots: slots),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'translation appends an unsent draft and preserves IME composition',
    (tester) async {
      final core = ConversationCore();
      final host = DraftFixture();
      await mount(tester, core, slots: PlatformSlots(conversationDraft: host));
      final requestCount = core.requests.length;
      final composer = find.byKey(const ValueKey('composer'));
      final controller = tester.widget<TextField>(composer).controller!;
      const translation =
          'Translation (English → Korean)\ngood morning\n\n좋은 아침';
      expect(host.append!(translation), isTrue);
      await tester.pump();
      expect(controller.text, translation);
      await tester.enterText(composer, 'Existing draft');
      expect(host.append!(translation), isTrue);
      await tester.pump();
      expect(controller.text, 'Existing draft\n\n$translation');
      expect(core.requests.length, requestCount);
      controller.value = const TextEditingValue(
        text: '한',
        selection: TextSelection.collapsed(offset: 1),
        composing: TextRange(start: 0, end: 1),
      );
      expect(host.append!(translation), isFalse);
      expect(controller.value.composing, const TextRange(start: 0, end: 1));
      expect(controller.text, '한');
      controller.value = const TextEditingValue(text: '한글');
      expect(host.append!(translation), isFalse);
      await tester.pump();
      expect(host.append!(translation), isTrue);
      expect(controller.text, '한글\n\n$translation');
      expect(core.requests.length, requestCount);
      await tester.pumpWidget(const SizedBox());
      expect(host.append, isNull);
    },
  );

  testWidgets('Korean composition stays intact and sends once after commit', (
    tester,
  ) async {
    final core = ConversationCore();
    await mount(tester, core);
    final composer = find.byKey(const ValueKey('composer'));
    await tester.showKeyboard(composer);
    tester.testTextInput.updateEditingValue(
      const TextEditingValue(
        text: '한',
        selection: TextSelection.collapsed(offset: 1),
        composing: TextRange(start: 0, end: 1),
      ),
    );
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();
    expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
    expect(
      tester.widget<TextField>(composer).controller!.value.composing,
      const TextRange(start: 0, end: 1),
    );
    tester.testTextInput.updateEditingValue(
      const TextEditingValue(
        text: '한글 그대로',
        selection: TextSelection.collapsed(offset: 6),
      ),
    );
    await tester.testTextInput.receiveAction(TextInputAction.send);
    expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
    await tester.pump();
    await tester.pump();
    await tester.tap(find.text('Send'));
    await tester.pump();
    expect(core.requests.where((r) => r.kind == 'input'), hasLength(1));
    expect((core.requests.last.payload as ProtocolInput).text, '한글 그대로');
    expect(tester.widget<TextField>(composer).controller!.text, '한글 그대로');
    core.pending.last.complete(event('item_done', {}, effect: 'applied'));
    await tester.pump();
    expect(tester.widget<TextField>(composer).controller!.text, isEmpty);
    expect(find.text('Received by Core'), findsOneWidget);
  });
  for (final native in [false, true]) {
    testWidgets(
      'removed agent blocks ${native ? 'native' : 'Flutter'} submit and retains draft',
      (tester) async {
        final core = ConversationCore();
        await mount(
          tester,
          core,
          slots: native
              ? PlatformSlots(
                  composer: (context, controller, focus, submit, tokens) =>
                      TextField(
                        key: const ValueKey('native-composer'),
                        controller: controller,
                        focusNode: focus,
                        onSubmitted: (_) => submit(),
                      ),
                )
              : const PlatformSlots(),
        );
        final composer = find.byKey(
          ValueKey(native ? 'native-composer' : 'composer'),
        );
        await tester.enterText(composer, '이어지는 초안');
        core.drop();
        core.live(
          agents: [
            {'agent_id': 'sion', 'name': 'Sion', 'preset': 'dev'},
          ],
        );
        await tester.pumpAndSettle();
        expect(tester.widget<TextField>(composer).controller!.text, '이어지는 초안');
        await tester.testTextInput.receiveAction(TextInputAction.send);
        await tester.pump();
        expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
      },
    );
  }
  testWidgets('keyboard cannot bypass missing conversation capability', (
    tester,
  ) async {
    final core = ConversationCore();
    core.welcome = ProtocolWelcome.fromJson({
      ...core.welcome!.toJson(),
      'capabilities': <Object?>[],
    });
    await mount(tester, core);
    await tester.enterText(find.byKey(const ValueKey('composer')), 'Not sent');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();
    expect(core.requests, isEmpty);
  });
  testWidgets('accessibility fallbacks combine with system settings', (
    tester,
  ) async {
    final preferences = DisplayPreferences()
      ..update(contrast: true, motion: true, text: true, theme: ThemeMode.dark);
    await mount(tester, ConversationCore(), preferences: preferences);
    final context = tester.element(find.byType(CoreScreen));
    expect(MediaQuery.of(context).highContrast, isTrue);
    expect(MediaQuery.of(context).disableAnimations, isTrue);
    expect(MediaQuery.of(context).textScaler.scale(10), greaterThan(10));
    expect(Theme.of(context).brightness, Brightness.dark);
    expect(tester.takeException(), isNull);
  });
}
