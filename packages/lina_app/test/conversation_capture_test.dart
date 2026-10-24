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
      testWidgets('$mode $width layout and capture', (tester) async {
        tester.view.physicalSize = width == 'desktop'
            ? const Size(1280, 1000)
            : const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final core = ConversationCore();
        addTearDown(core.dispose);
        core.snapshots['lina'] = [
          {
            'kind': 'item_done',
            'key': 'person',
            'revision': 1,
            'payload': {'speaker': 'person', 'text': '이번 주 읽기 계획을 같이 정리해 줘.'},
          },
          {
            'kind': 'item_done',
            'key': 'agent',
            'revision': 1,
            'payload': {
              'speaker': 'agent',
              'agent_id': 'lina',
              'text': '좋아요. 오늘은 짧은 글 하나부터 시작해요.\n읽고 나면 마음에 남은 문장을 함께 이야기해요.',
            },
          },
        ];
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
        expect(tester.takeException(), isNull);
        final semantics = tester.ensureSemantics();
        expect(
          find.bySemanticsLabel(RegExp('Connected to Core')),
          findsWidgets,
        );
        semantics.dispose();
        if (Platform.environment['LINA_UPDATE_CAPTURES'] == '1') {
          await expectLater(
            find.byType(Scaffold),
            matchesGoldenFile('../../../docs/captures/9/$mode-$width.png'),
          );
        }
        // The phone keyboard, accessibility scaling and resize keep the editor
        // usable without collapsing the entire body into an overflow.
        if (width == 'phone') {
          p.update(text: true);
          await tester.pumpAndSettle();
          tester.view.viewInsets = const FakeViewPadding(bottom: 250);
          addTearDown(tester.view.resetViewInsets);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
        }
      });
    }
  }
}
