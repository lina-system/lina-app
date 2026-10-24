// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_design/lina_design.dart';
import 'package:lina_app/lina_app.dart';

void main() {
  testWidgets('app consumes the design package and follows platform contrast', (
    tester,
  ) async {
    addTearDown(tester.platformDispatcher.clearAllTestValues);
    await tester.pumpWidget(
      const LinaApp(home: Scaffold(body: LinaText('안녕하세요'))),
    );
    final context = tester.element(find.byType(LinaText));
    expect(LinaTokens.of(context).colorCanvas, LinaTokens.light.colorCanvas);
    expect(Theme.of(context).textTheme.bodyMedium!.height, 1.5);
    expect(
      Theme.of(context).textTheme.bodyMedium!.fontFamily,
      'packages/lina_design/Pretendard',
    );
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    await tester.pumpAndSettle();
    expect(LinaTokens.of(context).colorCanvas, LinaTokens.dark.colorCanvas);
    tester.platformDispatcher.accessibilityFeaturesTestValue =
        const FakeAccessibilityFeatures(
          highContrast: true,
          disableAnimations: true,
        );
    await tester.pumpAndSettle();
    expect(LinaTokens.of(context).colorText, LinaTokens.highContrast.colorText);
    expect(
      LinaTokens.of(context).colorCanvas,
      LinaTokens.highContrast.colorCanvas,
    );
  });
}
