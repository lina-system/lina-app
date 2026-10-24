// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mac_panel/composer.dart';

void main() {
  testWidgets('Enter preserves composition and submits committed Korean once', (
    tester,
  ) async {
    final submitted = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: PanelComposer(onSubmit: submitted.add)),
      ),
    );
    await tester.tap(find.byType(TextField));
    tester.testTextInput.updateEditingValue(
      const TextEditingValue(
        text: '동해물과 백두산이',
        selection: TextSelection.collapsed(offset: 9),
        composing: TextRange(start: 8, end: 9),
      ),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(submitted, isEmpty);
    expect(find.text('동해물과 백두산이'), findsOneWidget);
    tester.testTextInput.updateEditingValue(
      const TextEditingValue(
        text: '동해물과 백두산이',
        selection: TextSelection.collapsed(offset: 9),
      ),
    );
    // IME's commit/Enter in the same frame must not submit either.
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(submitted, isEmpty);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(submitted, ['동해물과 백두산이']);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(submitted, hasLength(1));
  });

  testWidgets('Shift+Enter retains a draft and Escape delegates dismissal', (
    tester,
  ) async {
    final submitted = <String>[];
    var dismissed = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PanelComposer(
            onSubmit: submitted.add,
            onDismiss: () => dismissed++,
          ),
        ),
      ),
    );
    await tester.tap(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'draft');
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    expect(submitted, isEmpty);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    expect(dismissed, 1);
  });
}
