// SPDX-License-Identifier: Apache-2.0
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/lina_app.dart';
import 'package:lina_app/core_screen.dart';
import 'package:lina_app/platform_slots.dart';
import 'package:lina_app/conversation_draft.dart';
import 'package:lina_protocol/lina_protocol.dart';
import 'package:lina_design/lina_design.dart';

Map<String, dynamic> fixture(String path) => exactDecode(
  File('../../protocol/core/fixtures/client/1.0/$path.json').readAsStringSync(),
) as Map<String, dynamic>;

class DisplayCore extends CoreConnection {
  DisplayCore() : super(platform: 'darwin/arm64');
  final requests =
      <({String kind, ProtocolObject payload, Completer<Envelope> reply})>[];
  final cards = <ProtocolResult>[];
  @override
  List<ProtocolResult> get results => cards;
  @override
  Future<Envelope> request(
    String kind,
    ProtocolObject payload, {
    String? idempotencyKey,
  }) {
    final reply = Completer<Envelope>();
    requests.add((kind: kind, payload: payload, reply: reply));
    return reply.future;
  }

  void live() {
    phase = ConnectionPhase.connected;
    final data = fixture('welcome')['payload'] as Map<String, dynamic>;
    data['capabilities'] = [
      {'name': 'conversation', 'version': '1.0'},
    ];
    welcome = ProtocolWelcome.fromJson(data);
  }
}

class ReconnectCore extends DisplayCore {
  final _updates = StreamController<void>.broadcast(sync: true);
  @override
  Stream<void> get changes => _updates.stream;
  void deliverWelcome(List<Object?> agents) {
    phase = ConnectionPhase.connected;
    final data = fixture('welcome')['payload'] as Map<String, dynamic>;
    data['capabilities'] = [
      {'name': 'conversation', 'version': '1.0'},
    ];
    data['agents'] = agents;
    welcome = ProtocolWelcome.fromJson(data);
    _updates.add(null);
  }

  @override
  Future<void> dispose() async {
    await _updates.close();
    await super.dispose();
  }
}

class DraftFixture implements ConversationDraftHost {
  bool Function(String)? append;
  @override
  void attach(bool Function(String) handler) => append = handler;
  @override
  void detach() => append = null;
}

void main() {
  setUpAll(() async {
    final font = FontLoader('packages/lina_design/Pretendard');
    for (final weight in ['Regular', 'Bold']) {
      font.addFont(
        Future.value(
          ByteData.sublistView(
            File('../lina_design/assets/fonts/Pretendard-$weight.otf')
                .readAsBytesSync(),
          ),
        ),
      );
    }
    await font.load();
  });
  Future<void> mount(
    WidgetTester tester,
    DisplayCore core, {
    Size size = const Size(1000, 1100),
    DisplayPreferences? preferences,
    PlatformSlots slots = const PlatformSlots(),
  }) async {
    tester.view.physicalSize = size;
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
      final core = DisplayCore()..live();
      final host = DraftFixture();
      await mount(tester, core, slots: PlatformSlots(conversationDraft: host));
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
      expect(core.requests, isEmpty);
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
      expect(core.requests, isEmpty);
      await tester.pumpWidget(const SizedBox());
      expect(host.append, isNull);
    },
  );

  testWidgets(
    'Korean composition remains unchanged; one input waits for Core confirmation',
    (tester) async {
      final core = DisplayCore()..live();
      await mount(tester, core);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Example preset agent').last);
      await tester.pumpAndSettle();
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
      await tester.tap(find.text('Send'));
      await tester.pump();
      expect(core.requests, isEmpty);
      final controller = tester.widget<TextField>(composer).controller!;
      expect(controller.value.composing, const TextRange(start: 0, end: 1));
      tester.testTextInput.updateEditingValue(
        const TextEditingValue(
          text: '한글 그대로',
          selection: TextSelection.collapsed(offset: 6),
        ),
      );
      await tester.pump();
      await tester.pump();
      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();
      expect(core.requests.length, 1);
      await tester.tap(
        find.text('Waiting for Core').first,
        warnIfMissed: false,
      );
      final history = fixture('normal/history');
      history['payload'] = {'conversation_id': 'synthetic-conversation'};
      core.requests.first.reply.complete(Envelope.fromJson(history));
      await tester.pump();
      expect(core.requests.length, 2);
      expect(core.requests.last.kind, 'input');
      expect((core.requests.last.payload as ProtocolInput).text, '한글 그대로');
      expect(controller.text, '한글 그대로');
      final receipt = fixture('conversation/item_done');
      receipt['effect_state'] = 'applied';
      core.requests.last.reply.complete(Envelope.fromJson(receipt));
      await tester.pump();
      expect(controller.text, isEmpty);
      expect(find.text('Received by Core'), findsOneWidget);
    },
  );
  testWidgets('keyboard submit cannot bypass the negotiated capability', (
    tester,
  ) async {
    final core = DisplayCore()..live();
    core.welcome = ProtocolWelcome.fromJson({
      ...core.welcome!.toJson(),
      'capabilities': <Object?>[],
    });
    await mount(tester, core);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Example preset agent').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('composer')), '보내지 않음');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();
    expect(core.requests, isEmpty);
  });
  testWidgets('reconnect clears an agent the new welcome no longer lists', (
    tester,
  ) async {
    final core = ReconnectCore()..live();
    await mount(tester, core);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Example preset agent').last);
    await tester.pumpAndSettle();
    final composer = find.byKey(const ValueKey('composer'));
    await tester.enterText(composer, '이어지는 초안');
    await tester.pump();

    core.deliverWelcome([
      {'agent_id': 'agent-other', 'name': 'Another agent', 'preset': null},
    ]);
    await tester.pumpAndSettle();

    expect(tester.widget<TextField>(composer).controller!.text, '이어지는 초안');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();
    expect(core.requests, isEmpty);
    final send = tester.widget<TextButton>(
      find.ancestor(of: find.text('Send'), matching: find.byType(TextButton)),
    );
    expect(send.onPressed, isNull);
  });
  testWidgets('native composer submit checks the reconnected welcome too', (
    tester,
  ) async {
    final core = ReconnectCore()..live();
    final slots = PlatformSlots(
      composer: (context, controller, focus, submit, tokens) => TextField(
        key: const ValueKey('native-composer'),
        controller: controller,
        focusNode: focus,
        onSubmitted: (_) => submit(),
      ),
    );
    await mount(tester, core, slots: slots);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Example preset agent').last);
    await tester.pumpAndSettle();
    final composer = find.byKey(const ValueKey('native-composer'));
    await tester.enterText(composer, '이어지는 초안');
    await tester.pump();

    core.deliverWelcome([
      {'agent_id': 'agent-other', 'name': 'Another agent', 'preset': null},
    ]);
    await tester.pumpAndSettle();

    expect(tester.widget<TextField>(composer).controller!.text, '이어지는 초안');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();
    expect(core.requests, isEmpty);
  });
  testWidgets('system accessibility and explicit desktop fallbacks combine', (
    tester,
  ) async {
    final preferences = DisplayPreferences()
      ..update(contrast: true, motion: true, text: true, theme: ThemeMode.dark);
    await mount(tester, DisplayCore(), preferences: preferences);
    final context = tester.element(find.byType(CoreScreen));
    expect(MediaQuery.of(context).highContrast, isTrue);
    expect(MediaQuery.of(context).disableAnimations, isTrue);
    expect(MediaQuery.of(context).textScaler.scale(10), greaterThan(10));
    expect(Theme.of(context).brightness, Brightness.dark);
    expect(
      tester
          .widget<MaterialApp>(find.byType(MaterialApp))
          .themeAnimationDuration,
      LinaTokens.light.motionReduced,
    );
  });
  for (final name in ['disconnected', 'connected', 'rejected', 'mobile']) {
    testWidgets('capture $name and preserve accessible status labels', (
      tester,
    ) async {
      final core = DisplayCore();
      final preferences = DisplayPreferences();
      if (name == 'connected') {
        core.live();
        core.lastEffect = 'unknown';
        core.cards.add(
          ProtocolResult.fromJson({
            ...fixture('results/summary')['payload'] as Map<String, dynamic>,
            'title': 'A small beginning',
            'summary': '오늘 할 수 있는 한 가지부터 시작해요.',
          }),
        );
        core.cards.add(
          ProtocolResult.fromJson({
            ...fixture('results/saved_card')['payload'] as Map<String, dynamic>,
            'title': 'A note to return to',
            'summary': 'Core confirmed this result is saved.',
          }),
        );
        preferences.update(theme: ThemeMode.dark);
      }
      if (name == 'rejected') {
        core.phase = ConnectionPhase.rejected;
        core.refusalCode = 'unsupported_combination';
        preferences.update(contrast: true);
      }
      if (name == 'mobile') preferences.update(text: true);
      await mount(
        tester,
        core,
        preferences: preferences,
        size: name == 'mobile' ? const Size(390, 1000) : const Size(1000, 1400),
      );
      expect(tester.takeException(), isNull);
      final semantics = tester.ensureSemantics();
      expect(
        find.bySemanticsLabel(
          RegExp(
            name == 'connected'
                ? 'Connected to Core'
                : name == 'rejected'
                ? 'Connection rejected'
                : 'Disconnected',
          ),
        ),
        findsWidgets,
      );
      semantics.dispose();
      // Raster evidence is generated explicitly; cross-OS font rasterizers are
      // not compared pixel-for-pixel by the general native build matrix.
      if (Platform.environment['LINA_UPDATE_CAPTURES'] == '1') {
        await expectLater(
          find.byType(Scaffold),
          matchesGoldenFile('../../../docs/captures/6/$name.png'),
        );
      }
    });
  }
}
