// SPDX-License-Identifier: Apache-2.0
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/core_screen.dart';
import 'package:lina_app/lina_app.dart';
import 'package:lina_app/platform_slots.dart';
import 'package:lina_app/conversation_draft.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'support/conversation_core.dart';

const notAuthorized =
    'Core refused access for this device. Approve this device in Core, then connect again.';
const versionRefused =
    'This app and Core cannot connect with their current versions or platform. Update the app or Core, then connect again.';
const conversationUnavailable = 'Conversation is not available from this Core.';

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
    CoreConnection core, {
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
  testWidgets(
    'not_authorized refusal explains access and keeps the draft after EOF',
    (tester) async {
      final server = await tester.runAsync(
        () => ServerSocket.bind(InternetAddress.loopbackIPv4, 0),
      );
      addTearDown(server!.close);
      await tester.runAsync(() async {
        server.listen((socket) {
          addTearDown(socket.destroy);
          socket
              .cast<List<int>>()
              .transform(utf8.decoder)
              .transform(const LineSplitter())
              .listen((line) {
                final request = exactDecode(line) as Map;
                final refusal = fixture('outcomes/not_authorized');
                refusal['reply_to'] = request['params']['message_id'];
                socket.write(
                  '${exactEncode({'jsonrpc': '2.0', 'id': request['id'], 'result': refusal})}\n',
                );
                socket.close();
              });
        });
      });
      final core = CoreConnection(platform: 'linux/amd64');
      await mount(tester, core);
      final composer = find.byKey(const ValueKey('composer'));
      await tester.enterText(composer, 'Keep my draft');
      final draft = tester.widget<TextField>(composer).controller!;
      await tester.runAsync(
        () => core.connect('tcp://127.0.0.1:${server.port}'),
      );
      await tester.pumpAndSettle();
      expect(core.phase, ConnectionPhase.rejected);
      expect(core.refusalCode, 'not_authorized');
      expect(find.text(notAuthorized), findsWidgets);
      expect(find.textContaining('versions or platform'), findsNothing);
      expect(find.text('not_authorized'), findsNothing);
      expect(draft.text, 'Keep my draft');
      // The peer closes the socket after the refusal. EOF must not clear the
      // rejected state or the draft.
      await tester.pump(const Duration(milliseconds: 50));
      expect(core.phase, ConnectionPhase.rejected);
      expect(find.text(notAuthorized), findsWidgets);
      expect(draft.text, 'Keep my draft');
    },
    skip: Platform.isWindows,
  );
  testWidgets('version refusal keeps its own wording', (tester) async {
    final core = ConversationCore();
    await mount(tester, core);
    core.reject('unsupported_combination');
    await tester.pumpAndSettle();
    expect(find.text(versionRefused), findsWidgets);
    expect(find.text(notAuthorized), findsNothing);
    expect(find.textContaining('refused access'), findsNothing);
  });
  testWidgets(
    'welcome without conversation says unavailable and never invites sending',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      final composer = find.byKey(const ValueKey('composer'));
      await tester.enterText(composer, 'Keep my draft');
      final draft = tester.widget<TextField>(composer).controller!;
      core.welcome = ProtocolWelcome.fromJson({
        ...core.welcome!.toJson(),
        'capabilities': <Object?>[],
      });
      core.updates.add(null);
      await tester.pumpAndSettle();
      expect(find.text(conversationUnavailable), findsWidgets);
      expect(find.text('What is on your mind?'), findsNothing);
      expect(find.text('What would you like to work on?'), findsNothing);
      expect(find.text('A draft until Core confirms receipt.'), findsNothing);
      expect(tester.widget<TextField>(composer).enabled, isFalse);
      expect(draft.text, 'Keep my draft');
      final send = find.widgetWithText(TextButton, 'Send');
      expect(tester.widget<TextButton>(send).onPressed, isNull);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
    },
  );
  testWidgets('keyboard cannot bypass missing conversation capability', (
    tester,
  ) async {
    final core = ConversationCore();
    core.welcome = ProtocolWelcome.fromJson({
      ...core.welcome!.toJson(),
      'capabilities': <Object?>[],
    });
    await mount(tester, core);
    final composer = find.byKey(const ValueKey('composer'));
    expect(tester.widget<TextField>(composer).enabled, isFalse);
    expect(find.text(conversationUnavailable), findsWidgets);
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
