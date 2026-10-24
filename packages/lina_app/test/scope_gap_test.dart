// SPDX-License-Identifier: Apache-2.0
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/core_screen.dart';
import 'package:lina_app/lina_app.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'support/conversation_core.dart';

class AddressCore extends CoreConnection {
  AddressCore() : super(platform: 'linux/amd64');
  Future<void>? attempt;
  int attempts = 0;
  @override
  Future<void> connect(String endpoint) {
    attempts++;
    return attempt = super.connect(endpoint);
  }
}

const invalidAddress =
    'The Core address is not valid. Use unix:///path or tcp://host:port, then connect again.';
const unavailableCore =
    'Core could not be reached. Start Core and check its address, then connect again.';
final composer = find.byKey(const ValueKey('composer'));
final address = find.byWidgetPredicate(
  (widget) =>
      widget is TextField && widget.decoration?.labelText == 'Core address',
);

Future<void> mount(WidgetTester tester, CoreConnection core) async {
  tester.view.physicalSize = const Size(1200, 1000);
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

Future<void> connectFromForm(
  WidgetTester tester,
  AddressCore core, {
  bool keyboard = false,
}) async {
  await tester.runAsync(() async {
    if (keyboard) {
      await tester.testTextInput.receiveAction(TextInputAction.done);
    } else {
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Connect'),
        ),
      );
    }
    await core.attempt;
  });
  await tester.pumpAndSettle();
}

Future<void> captureError(WidgetTester tester, String name) async {
  if (Platform.environment['LINA_UPDATE_CAPTURES'] == '1') {
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('../../../docs/captures/9/$name.png'),
    );
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
  for (final keyboard in [false, true]) {
    testWidgets(
      'invalid address shows cause and recovery via ${keyboard ? 'keyboard' : 'button'} without losing draft',
      (tester) async {
        final core = AddressCore();
        await mount(tester, core);
        await tester.enterText(composer, 'Keep my draft');
        final draft = tester.widget<TextField>(composer).controller!;
        await tester.tap(find.text('Connection'));
        await tester.pumpAndSettle();
        if (!keyboard) {
          tester.view.physicalSize = const Size(390, 844);
          await tester.pumpAndSettle();
        }
        await tester.enterText(address, 'not-an-endpoint');
        await connectFromForm(tester, core, keyboard: keyboard);
        expect(find.text(invalidAddress), findsWidgets);
        expect(find.byType(AlertDialog), findsOneWidget);
        expect(
          tester.widget<TextField>(address).controller!.text,
          'not-an-endpoint',
        );
        expect(draft.text, 'Keep my draft');
        expect(core.phase, ConnectionPhase.disconnected);
        expect(core.attempts, 1);
        expect(tester.takeException(), isNull);
        if (!keyboard) await captureError(tester, 'connection-invalid');
      },
    );
  }
  testWidgets(
    'unavailable local socket shows recovery and a corrected address connects',
    (tester) async {
      final core = AddressCore();
      await mount(tester, core);
      final root = await tester.runAsync(
        () => Directory('/tmp').createTemp('lina-address-test-'),
      );
      addTearDown(() => root!.delete(recursive: true));
      await tester.enterText(composer, 'Keep my local draft');
      final draft = tester.widget<TextField>(composer).controller!;
      await tester.tap(find.text('Connection'));
      await tester.pumpAndSettle();
      await tester.enterText(address, 'unix://${root!.path}/missing.sock');
      await connectFromForm(tester, core);
      expect(find.text(unavailableCore), findsWidgets);
      expect(find.text(invalidAddress), findsNothing);
      expect(draft.text, 'Keep my local draft');
      expect(core.attempts, 1);

      await captureError(tester, 'connection-unavailable');
      final server = await tester.runAsync(
        () => ServerSocket.bind(InternetAddress.loopbackIPv4, 0),
      );
      addTearDown(server!.close);
      final methods = <String>[];
      await tester.runAsync(() async {
        server.listen((socket) {
          addTearDown(socket.destroy);
          socket
              .cast<List<int>>()
              .transform(utf8.decoder)
              .transform(const LineSplitter())
              .listen((line) {
                final request = exactDecode(line) as Map;
                methods.add(request['method'] as String);
                final welcome = fixture('welcome');
                (welcome['payload'] as Map)['capabilities'] = <Object?>[];
                welcome['reply_to'] = request['params']['message_id'];
                socket.write(
                  '${exactEncode({'jsonrpc': '2.0', 'id': request['id'], 'result': welcome})}\n',
                );
              });
        });
      });
      await tester.enterText(address, 'tcp://127.0.0.1:${server.port}');
      await connectFromForm(tester, core);
      expect(core.phase, ConnectionPhase.connected);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text(unavailableCore), findsNothing);
      expect(draft.text, 'Keep my local draft');
      expect(core.attempts, 2);
      expect(methods, ['hello']);
    },
    skip: Platform.isWindows,
  );

  for (final key in [
    LogicalKeyboardKey.enter,
    LogicalKeyboardKey.numpadEnter,
  ]) {
    testWidgets(
      '${key.keyLabel} sends committed text once and preserves it until receipt',
      (tester) async {
        final core = ConversationCore();
        await mount(tester, core);
        await tester.enterText(composer, ' 한글 👋 ');
        await tester.pump();
        final draft = tester.widget<TextField>(composer).controller!;
        await tester.sendKeyDownEvent(key);
        await tester.pump();
        expect(core.requests.where((r) => r.kind == 'input'), hasLength(1));
        expect((core.requests.last.payload as ProtocolInput).text, ' 한글 👋 ');
        expect(draft.text, ' 한글 👋 ');
        core.pending.last.complete(event('item_done', {}, effect: 'applied'));
        await tester.pump();
        expect(draft.text, isEmpty);
        await tester.enterText(composer, 'Another draft');
        await tester.pump();
        await tester.sendKeyRepeatEvent(key);
        await tester.sendKeyUpEvent(key);
        await tester.pump();
        expect(core.requests.where((r) => r.kind == 'input'), hasLength(1));
        expect(draft.text, 'Another draft');
      },
    );
  }
  testWidgets(
    'Shift+Enter replaces the selection with a newline without sending',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      await tester.showKeyboard(composer);
      tester.testTextInput.updateEditingValue(
        const TextEditingValue(
          text: ' 한글 ',
          selection: TextSelection(baseOffset: 1, extentOffset: 3),
        ),
      );
      await tester.pump();
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      await tester.pump();
      final draft = tester.widget<TextField>(composer).controller!;
      expect(draft.text, ' \n ');
      expect(draft.selection, const TextSelection.collapsed(offset: 2));
      expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
    },
  );
  testWidgets(
    'Enter during composition and its commit frame never sends or changes preedit',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      await tester.showKeyboard(composer);
      const composing = TextEditingValue(
        text: '한',
        selection: TextSelection.collapsed(offset: 1),
        composing: TextRange(start: 0, end: 1),
      );
      tester.testTextInput.updateEditingValue(composing);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      final draft = tester.widget<TextField>(composer).controller!;
      expect(draft.value, composing);
      expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
      tester.testTextInput.updateEditingValue(
        const TextEditingValue(
          text: '한',
          selection: TextSelection.collapsed(offset: 1),
        ),
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(core.requests.where((r) => r.kind == 'input'), hasLength(1));
      expect((core.requests.last.payload as ProtocolInput).text, '한');
      core.pending.last.complete(event('item_done', {}, effect: 'applied'));
      await tester.pump();
    },
  );
  for (final modifier in [
    LogicalKeyboardKey.controlLeft,
    LogicalKeyboardKey.metaLeft,
  ]) {
    testWidgets('${modifier.keyLabel}+Enter remains an extra send', (
      tester,
    ) async {
      final core = ConversationCore();
      await mount(tester, core);
      await tester.enterText(composer, 'Extra shortcut');
      await tester.pump();
      await tester.sendKeyDownEvent(modifier);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.sendKeyUpEvent(modifier);
      await tester.pump();
      expect(core.requests.where((r) => r.kind == 'input'), hasLength(1));
      core.pending.last.complete(event('item_done', {}, effect: 'applied'));
      await tester.pump();
    });
  }
  testWidgets('Enter in conversation search cannot send the composer draft', (
    tester,
  ) async {
    final core = ConversationCore();
    await mount(tester, core);
    await tester.enterText(composer, 'Keep this draft');
    await tester.tap(find.text('Find'));
    await tester.pump();
    final search = find.byWidgetPredicate(
      (w) =>
          w is TextField &&
          w.decoration?.labelText == 'Find in this conversation',
    );
    await tester.enterText(search, 'Search only');
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
    expect(
      tester.widget<TextField>(composer).controller!.text,
      'Keep this draft',
    );
  });
}
