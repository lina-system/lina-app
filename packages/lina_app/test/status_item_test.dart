// SPDX-License-Identifier: Apache-2.0
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/core_screen.dart';
import 'package:lina_app/lina_app.dart';
import 'package:lina_app/platform_slots.dart';
import 'package:lina_app/status_item.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'support/conversation_core.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <MethodCall>[];
  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(statusItemChannel, (call) async {
          calls.add(call);
          return null;
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(statusItemChannel, null);
  });

  for (final transport in ['tcp', 'unix']) {
    test('$transport stopped fake Core reaches native channel within 5 seconds', () async {
      if (transport == 'unix' && Platform.isWindows) return;
      final directory = await Directory.systemTemp.createTemp('lina-status-');
      addTearDown(() => directory.delete(recursive: true));
      final server = await ServerSocket.bind(
        transport == 'unix'
            ? InternetAddress(
                '${directory.path}/core.sock',
                type: InternetAddressType.unix,
              )
            : InternetAddress.loopbackIPv4,
        0,
      );
      final core = CoreConnection(platform: 'darwin/arm64');
      addTearDown(core.dispose);
      final sockets = <Socket>[];
      addTearDown(() async {
        for (final socket in sockets) {
          socket.destroy();
        }
        await server.close();
      });
      server.listen((socket) {
        sockets.add(socket);
        socket
            .cast<List<int>>()
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .listen((line) {
              final request = exactDecode(line) as Map;
              expect(request['method'], 'hello');
              final welcome = fixture('welcome');
              welcome['reply_to'] = request['params']['message_id'];
              socket.write(
                '${exactEncode({'jsonrpc': '2.0', 'id': request['id'], 'result': welcome})}\n',
              );
            });
      });
      final binding = StatusItemBinding(
        connection: core,
        host: const MacStatusItemHost(),
        agentName: () => '테스트 에이전트',
      );
      addTearDown(binding.dispose);
      await core.connect(
        transport == 'unix'
            ? 'unix://${directory.path}/core.sock'
            : 'tcp://127.0.0.1:${server.port}',
      );
      await Future<void>.delayed(Duration.zero);
      expect(calls.last.arguments, {
        'phase': 'connected',
        'agentName': '테스트 에이전트',
      });
      final disconnected = Completer<void>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(statusItemChannel, (call) async {
            calls.add(call);
            if ((call.arguments as Map)['phase'] == 'disconnected')
              disconnected.complete();
            return null;
          });
      final elapsed = Stopwatch()..start();
      sockets.single.destroy();
      await server.close();
      await disconnected.future.timeout(const Duration(seconds: 5));
      expect(elapsed.elapsed, lessThan(const Duration(seconds: 5)));
      expect(core.phase, ConnectionPhase.disconnected);
      expect(
        sockets,
        hasLength(1),
        reason: 'the menu must not open a second Core connection',
      );
      expect(calls.map((c) => c.method).toSet(), {'update'});
      // ignore: avoid_print
      print(
        '$transport stopped-Core channel latency: ${elapsed.elapsedMilliseconds}ms',
      );
      await binding.dispose();
      final count = calls.length;
      core.disconnect();
      await Future<void>.delayed(Duration.zero);
      expect(calls, hasLength(count));
    });
  }

  testWidgets('menu follows the actual selection, rename and removal', (
    tester,
  ) async {
    final core = ConversationCore();
    final preferences = DisplayPreferences();
    addTearDown(core.dispose);
    addTearDown(preferences.dispose);
    tester.view.physicalSize = const Size(1000, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      LinaApp(
        home: CoreScreen(
          connection: core,
          preferences: preferences,
          slots: const PlatformSlots(statusItem: MacStatusItemHost()),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      calls,
      isNotEmpty,
      reason: 'the conversation must publish its initial status',
    );
    expect((calls.last.arguments as Map)['agentName'], 'Lina');
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sion').last);
    await tester.pumpAndSettle();
    expect((calls.last.arguments as Map)['agentName'], 'Sion');
    final selected = core.welcome!.agents
        .singleWhere((a) => a.agentId == 'sion')
        .toJson();
    core.live(
      agents: [
        {...selected, 'name': '새 이름'},
      ],
    );
    await tester.pumpAndSettle();
    expect((calls.last.arguments as Map)['agentName'], '새 이름');
    core.live(agents: []);
    await tester.pumpAndSettle();
    expect((calls.last.arguments as Map)['agentName'], isNull);
    await tester.pumpWidget(const SizedBox());
    final count = calls.length;
    core.live(agents: [selected]);
    await tester.pump();
    expect(calls, hasLength(count));
  });
}
