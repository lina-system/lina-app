// SPDX-License-Identifier: Apache-2.0
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_design/lina_design.dart';

final anchor = PassageAnchor(
  assetId: 'synthetic-guide',
  revision: 'saved-3',
  address: '4쪽 · 시작하기 · 10–42',
  contentHash: 'synthetic-sha256',
  capturedAt: DateTime.utc(2026, 1, 1),
  sourceUrl: Uri.parse('https://example.invalid/guide'),
);
Widget host(Widget child, {double scale = 1}) => MaterialApp(
  theme: linaTheme(LinaThemeMode.light),
  home: MediaQuery(
    data: MediaQueryData(textScaler: TextScaler.linear(scale)),
    child: Scaffold(
      body: Center(child: SizedBox(width: 340, child: child)),
    ),
  ),
);
void main() {
  setUpAll(() async {
    final loader = FontLoader('packages/lina_design/Pretendard');
    for (final weight in ['Regular', 'Bold']) {
      loader.addFont(
        Future.value(
          ByteData.sublistView(
            File('assets/fonts/Pretendard-$weight.otf').readAsBytesSync(),
          ),
        ),
      );
    }
    await loader.load();
    final mono = FontLoader('packages/lina_design/JetBrainsMono')
      ..addFont(
        Future.value(
          ByteData.sublistView(
            File('assets/fonts/JetBrainsMono-Regular.ttf').readAsBytesSync(),
          ),
        ),
      );
    await mono.load();
  });
  test(
    'Korean words retain original text when display joiners are removed',
    () {
      const text = '동해물과 백두산이\n마르고 닳도록';
      final display = koreanWordPhrase(text);
      expect(display, contains('동\u2060해\u2060물\u2060과 백'));
      expect(display.replaceAll('\u2060', ''), text);
    },
  );
  testWidgets(
    'citation shows its passage and forwards the identical complete anchor',
    (tester) async {
      PassageAnchor? opened;
      await tester.pumpWidget(
        host(
          CitationChip(
            source: '시작 안내',
            anchor: anchor,
            onOpen: (a) => opened = a,
          ),
        ),
      );
      expect(
        find.byWidgetPredicate(
          (w) => w is LinaText && w.data == anchor.address,
        ),
        findsOneWidget,
      );
      await tester.tap(find.byType(TextButton));
      expect(identical(opened, anchor), isTrue);
      final semantics = tester.ensureSemantics();
      expect(find.bySemanticsLabel(RegExp('시작 안내')), findsOneWidget);
      semantics.dispose();
    },
  );
  testWidgets('revoked evidence stays labeled and cannot navigate', (
    tester,
  ) async {
    var called = false;
    await tester.pumpWidget(
      host(
        CitationChip(
          source: '안내',
          anchor: anchor,
          unavailableLabel: '연결 해제됨',
          onOpen: (_) => called = true,
        ),
      ),
    );
    expect(
      tester.widget<TextButton>(find.byType(TextButton)).onPressed,
      isNull,
    );
    await tester.tap(find.byType(TextButton));
    expect(called, isFalse);
    expect(
      find.byWidgetPredicate((w) => w is LinaText && w.data == '연결 해제됨'),
      findsOneWidget,
    );
  });
  testWidgets('large text wraps without overflow and preserves target size', (
    tester,
  ) async {
    await tester.pumpWidget(
      host(
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CitationChip(
              source: '아주 긴 자료 이름과 여러 단어로 된 안내 문서',
              anchor: anchor,
              onOpen: (_) {},
            ),
            const StatusLabel(
              status: LinaStatus.unknown,
              label: '모름 — 아직 확인되지 않았어요',
            ),
          ],
        ),
        scale: 2,
      ),
    );
    expect(tester.takeException(), isNull);
    expect(
      tester.getSize(find.byType(TextButton)).height,
      greaterThanOrEqualTo(48),
    );
  });
  testWidgets('keyboard activation opens a citation exactly once', (
    tester,
  ) async {
    var count = 0;
    await tester.pumpWidget(
      host(CitationChip(source: '안내', anchor: anchor, onOpen: (_) => count++)),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(count, 1);
  });
  for (final mode in LinaThemeMode.values) {
    testWidgets('${mode.name} shared widgets golden', (tester) async {
      await tester.binding.setSurfaceSize(const Size(620, 560));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          theme: linaTheme(mode),
          home: Scaffold(
            body: RepaintBoundary(
              key: const ValueKey('capture'),
              child: Builder(
                builder: (context) {
                  final t = LinaTokens.of(context);
                  return ColoredBox(
                    color: t.colorCanvas,
                    child: Padding(
                      padding: EdgeInsets.all(t.spacePage),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          LinaText(
                            '자료와 근거',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          SizedBox(height: t.spaceSection),
                          const LinaText('출처의 문장으로 바로 이동해요. 모르는 것은 모름으로 표시해요.'),
                          SizedBox(height: t.spaceSection),
                          CitationChip(
                            source: '시작 안내',
                            anchor: anchor,
                            onOpen: (_) {},
                          ),
                          SizedBox(height: t.spaceSection),
                          for (final state in [
                            (LinaStatus.working, '살펴보는 중'),
                            (LinaStatus.waiting, '나를 기다림'),
                            (LinaStatus.success, '완료'),
                            (LinaStatus.error, '실패'),
                            (LinaStatus.unknown, '모름'),
                          ])
                            Padding(
                              padding: EdgeInsets.only(bottom: t.spaceInline),
                              child: StatusLabel(
                                status: state.$1,
                                label: state.$2,
                              ),
                            ),
                          SizedBox(height: t.spaceInline),
                          Text(
                            'final answer = evidence;',
                            style: linaCodeStyle(context),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final filename = mode == LinaThemeMode.highContrast
          ? 'high-contrast'
          : mode.name;
      await expectLater(
        find.byKey(const ValueKey('capture')),
        matchesGoldenFile('../../../docs/captures/5/$filename.png'),
      );
    });
  }
}
