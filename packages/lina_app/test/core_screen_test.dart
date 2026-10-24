// SPDX-License-Identifier: Apache-2.0
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/lina_app.dart';
import 'package:lina_app/core_screen.dart';
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
        home: CoreScreen(connection: core, preferences: p),
      ),
    );
    await tester.pumpAndSettle();
  }

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
