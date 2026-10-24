// SPDX-License-Identifier: Apache-2.0
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/launcher.dart';
import 'package:lina_app/lina_app.dart';
import 'package:lina_design/lina_design.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'platform slot forwards show/hide without transporting token values',
    () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(launcherChannel, (call) async {
            calls.add(call);
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(launcherChannel, null),
      );
      const host = MacLauncherHost();
      await host.show(LinaTokens.dark);
      await host.close();
      expect(calls.map((c) => c.method), ['show', 'hide']);
      expect(calls.every((c) => c.arguments == null), isTrue);
    },
  );
  testWidgets(
    'embedded view owns replies and never creates an input or result list',
    (tester) async {
      await tester.pumpWidget(const LinaApp(home: LauncherAnswer()));
      expect(find.text('Agent replies'), findsOneWidget);
      expect(find.byType(EditableText), findsNothing);
      expect(find.byType(ListView), findsNothing);
      await tester.binding.defaultBinaryMessenger.handlePlatformMessage(
        launcherChannel.name,
        const StandardMethodCodec().encodeMethodCall(
          const MethodCall('submit', {'query': 'synthetic', 'resultID': null}),
        ),
        (_) {},
      );
      await tester.pump();
      expect(
        find.text(
          'Search is not connected yet. Open LINA to talk to an agent.',
        ),
        findsOneWidget,
      );
      expect(find.text('synthetic'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'answer area fits the reserved native height and captures in isolation',
    (tester) async {
      await tester.runAsync(() async {
        final font = FontLoader('packages/lina_design/Pretendard');
        for (final weight in ['Regular', 'Bold']) {
          font.addFont(
            File('../lina_design/assets/fonts/Pretendard-$weight.otf')
                .readAsBytes()
                .then(ByteData.sublistView),
          );
        }
        await font.load();
      });
      tester.view.physicalSize = const Size(632, 176);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(const LinaApp(home: LauncherAnswer()));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      if (Platform.environment['LINA_UPDATE_CAPTURES'] == '1') {
        await expectLater(
          find.byType(LauncherAnswer),
          matchesGoldenFile('../../../docs/captures/31/answer-area.png'),
        );
      }
    },
  );
}
