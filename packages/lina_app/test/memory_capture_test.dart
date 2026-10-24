// SPDX-License-Identifier: Apache-2.0
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/core_screen.dart';
import 'package:lina_app/lina_app.dart';

import 'support/memory_core.dart';

void main() {
  setUpAll(() async {
    final fonts = FontLoader('packages/lina_design/Pretendard');
    for (final weight in ['Regular', 'Bold']) {
      fonts.addFont(
        Future.value(
          ByteData.sublistView(
            File('../lina_design/assets/fonts/Pretendard-$weight.otf')
                .readAsBytesSync(),
          ),
        ),
      );
    }
    await fonts.load();
  });
  for (final mode in ['light', 'dark', 'high-contrast']) {
    for (final width in ['desktop', 'phone']) {
      testWidgets('memory $mode $width layout and capture', (tester) async {
        tester.view.physicalSize = width == 'desktop'
            ? const Size(1280, 1100)
            : const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final core = MemoryCore();
        addTearDown(core.dispose);
        final preferences = DisplayPreferences()
          ..update(
            theme: mode == 'light' ? ThemeMode.light : ThemeMode.dark,
            contrast: mode == 'high-contrast',
            motion: true,
          );
        addTearDown(preferences.dispose);
        await tester.pumpWidget(
          LinaApp(
            preferences: preferences,
            home: CoreScreen(connection: core, preferences: preferences),
          ),
        );
        await tester.pumpAndSettle();
        if (width == 'phone') {
          await tester.tap(find.text('Menu'));
          await tester.pumpAndSettle();
        }
        await tester.tap(find.text('Memory'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final semantics = tester.ensureSemantics();
        expect(find.bySemanticsLabel('Lina · Memory'), findsOneWidget);
        semantics.dispose();
        if (Platform.environment['LINA_UPDATE_CAPTURES'] == '1') {
          await expectLater(
            find.byType(Scaffold),
            matchesGoldenFile('../../../docs/captures/11/$mode-$width.png'),
          );
        }
        if (width == 'phone') {
          preferences.update(text: true);
          await tester.pumpAndSettle();
          await tester.tap(find.text('Remember'));
          await tester.pumpAndSettle();
          tester.view.viewInsets = const FakeViewPadding(bottom: 250);
          addTearDown(tester.view.resetViewInsets);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          await tester.scrollUntilVisible(
            find.byKey(const ValueKey('memory-text')),
            120,
            scrollable: find
                .descendant(
                  of: find.byKey(const ValueKey('memory-list')),
                  matching: find.byType(Scrollable),
                )
                .first,
          );
          expect(tester.takeException(), isNull);
        }
      });
    }
  }
}
