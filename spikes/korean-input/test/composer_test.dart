// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:korean_input/main.dart';

void main() {
  Future<TextEditingController> start(WidgetTester tester) async {
    await tester.pumpWidget(const KoreanInputApp());
    await tester.tap(find.byType(TextField));
    await tester.pump();
    return tester.widget<TextField>(find.byType(TextField)).controller!;
  }

  void edit(WidgetTester tester, String text, {TextRange? composing}) {
    tester.testTextInput.updateEditingValue(
      TextEditingValue(
        text: text,
        selection: TextSelection.collapsed(offset: text.length),
        composing: composing ?? TextRange.empty,
      ),
    );
  }

  testWidgets(
    'Enter sends the entire committed draft exactly once and clears',
    (tester) async {
      final controller = await start(tester);
      edit(tester, '동해물과 백두산이');
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(find.text('Sent 1: 동해물과 백두산이'), findsOneWidget);
      expect(controller.text, isEmpty);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(find.text('Sent 1: 동해물과 백두산이'), findsOneWidget);
    },
  );

  testWidgets('active composition and commit-turn Enter never send or clear', (
    tester,
  ) async {
    final controller = await start(tester);
    edit(tester, '한', composing: const TextRange(start: 0, end: 1));
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(controller.text, '한');
    expect(find.text('Sent 0'), findsOneWidget);
    edit(tester, '한');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(controller.text, '한');
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(find.text('Sent 1: 한'), findsOneWidget);
  });

  testWidgets('Shift+Enter inserts a newline and does not send', (
    tester,
  ) async {
    final controller = await start(tester);
    edit(tester, '동해');
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pump();
    expect(controller.text, '동해\n');
    expect(find.text('Sent 0'), findsOneWidget);
  });

  testWidgets('F9 shortcut is suppressed during composition and commit turn', (
    tester,
  ) async {
    await start(tester);
    edit(tester, '한', composing: const TextRange(start: 0, end: 1));
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.f9);
    await tester.pump();
    expect(find.text('Markers: 0'), findsOneWidget);
    edit(tester, '한');
    await tester.sendKeyEvent(LogicalKeyboardKey.f9);
    await tester.pump();
    expect(find.text('Markers: 0'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.f9);
    await tester.pump();
    expect(find.text('Markers: 1'), findsOneWidget);
  });

  testWidgets('suggestions remain enabled and counts wait for commit', (
    tester,
  ) async {
    await start(tester);
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.enableSuggestions, isTrue);
    expect(field.autocorrect, isTrue);
    expect(field.maxLength, isNull);
    expect(field.inputFormatters, isNull);
    expect(field.keyboardType, TextInputType.multiline);
    edit(tester, '가', composing: const TextRange(start: 0, end: 1));
    await tester.pump();
    expect(find.text('Committed characters: 0'), findsOneWidget);
    edit(tester, '가👨‍👩‍👧‍👦');
    await tester.pump();
    expect(find.text('Committed characters: 2'), findsOneWidget);
  });

  testWidgets('platform send action uses the same composition gate', (
    tester,
  ) async {
    final controller = await start(tester);
    edit(tester, '한', composing: const TextRange(start: 0, end: 1));
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();
    expect(controller.text, '한');
    expect(find.text('Sent 0'), findsOneWidget);
    edit(tester, '한');
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pump();
    expect(find.text('Sent 1: 한'), findsOneWidget);
  });
  testWidgets('Shift+Enter replaces the selection without trimming the draft', (
    tester,
  ) async {
    final controller = await start(tester);
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
    expect(controller.text, ' \n ');
    await tester.sendKeyEvent(LogicalKeyboardKey.numpadEnter);
    await tester.pump();
    expect(find.text('Sent 1:  \n '), findsOneWidget);
  });

  testWidgets('Shift+Enter cannot replace an active composing selection', (
    tester,
  ) async {
    final controller = await start(tester);
    edit(tester, '한', composing: const TextRange(start: 0, end: 1));
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pump();
    expect(controller.value.text, '한');
    expect(controller.value.composing, const TextRange(start: 0, end: 1));
    expect(find.text('Sent 0'), findsOneWidget);
  });

  testWidgets('held Enter cannot send a newly arriving draft', (tester) async {
    await start(tester);
    edit(tester, '첫 글');
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    edit(tester, '다음 글');
    await tester.pump();
    await tester.sendKeyRepeatEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(find.text('Sent 1: 첫 글'), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      '다음 글',
    );
  });
}
