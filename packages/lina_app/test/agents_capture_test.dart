// SPDX-License-Identifier: Apache-2.0
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/core_screen.dart';
import 'package:lina_app/lina_app.dart';

import 'support/conversation_core.dart';

void main() {
  setUpAll(() async {
    final body = FontLoader('packages/lina_design/Pretendard');
    for (final weight in ['Regular', 'Bold']) {
      body.addFont(
        Future.value(
          ByteData.sublistView(
            File('../lina_design/assets/fonts/Pretendard-$weight.otf')
                .readAsBytesSync(),
          ),
        ),
      );
    }
    await body.load();
  });
  for (final mode in ['light', 'dark', 'high-contrast']) {
    for (final width in ['desktop', 'phone']) {
      testWidgets('agents $mode $width layout, navigation and capture', (
        tester,
      ) async {
        tester.view.physicalSize = width == 'desktop'
            ? const Size(1280, 1000)
            : const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final core = ConversationCore();
        addTearDown(core.dispose);
        final p = DisplayPreferences()
          ..update(
            theme: mode == 'light' ? ThemeMode.light : ThemeMode.dark,
            contrast: mode == 'high-contrast',
            motion: true,
          );
        addTearDown(p.dispose);
        await tester.pumpWidget(
          LinaApp(
            preferences: p,
            home: CoreScreen(connection: core, preferences: p),
          ),
        );
        await tester.pumpAndSettle();
        if (width == 'phone') {
          await tester.tap(find.text('Menu'));
          await tester.pumpAndSettle();
        }
        await tester.tap(find.text('Agents'));
        await tester.pumpAndSettle();
        expect(find.text('Talk with Sion'), findsOneWidget);
        expect(tester.takeException(), isNull);
        if (Platform.environment['LINA_UPDATE_CAPTURES'] == '1') {
          await expectLater(
            find.byType(Scaffold),
            matchesGoldenFile(
              '../../../docs/captures/10/agents-$mode-$width.png',
            ),
          );
        }
        if (width == 'phone') {
          // Native dropdown key navigation changes the Core target on phone too.
          await tester.tap(find.byType(DropdownButtonFormField<String>));
          await tester.pumpAndSettle();
          await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
          await tester.sendKeyEvent(LogicalKeyboardKey.enter);
          await tester.pumpAndSettle();
          expect(find.text('Main conversation · Sion'), findsOneWidget);
          expect(
            core.requests.any(
              (r) =>
                  r.payload.json['operation'] == 'choose' &&
                  r.payload.json['agent_id'] == 'sion',
            ),
            isTrue,
          );
          p.update(text: true);
          await tester.pumpAndSettle();
          await tester.tap(find.text('New agent'));
          await tester.pumpAndSettle();
          tester.view.viewInsets = const FakeViewPadding(bottom: 250);
          addTearDown(tester.view.resetViewInsets);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          await tester.enterText(
            find.byKey(const ValueKey('agent-name')),
            '미라',
          );
          await tester.pumpAndSettle();
          if (mode == 'light' &&
              Platform.environment['LINA_UPDATE_CAPTURES'] == '1') {
            await expectLater(
              find.byType(Navigator).first,
              matchesGoldenFile('../../../docs/captures/10/create-phone.png'),
            );
          }
        }
      });
    }
  }
}
