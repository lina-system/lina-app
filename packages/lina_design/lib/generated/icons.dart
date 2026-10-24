// SPDX-License-Identifier: Apache-2.0
// GENERATED. Lucide subset: ISC AND MIT; see THIRD-PARTY-NOTICES.md.
import 'dart:ui';

enum LinaIconName {
  citation,
  success,
  error,
  working,
  waiting,
  unknown,
  memory,
  identity,
}

Path linaIconPath(LinaIconName name) => switch (name) {
  LinaIconName.citation =>
    Path()
      ..moveTo(14, 2)
      ..lineTo(14, 8)
      ..lineTo(20, 8)
      ..moveTo(14, 2)
      ..lineTo(6, 2)
      ..cubicTo(4.9, 2, 4, 2.9, 4, 4)
      ..lineTo(4, 20)
      ..cubicTo(4, 21.1, 4.9, 22, 6, 22)
      ..lineTo(18, 22)
      ..cubicTo(19.1, 22, 20, 21.1, 20, 20)
      ..lineTo(20, 8)
      ..close()
      ..moveTo(8, 13)
      ..lineTo(16, 13)
      ..moveTo(8, 17)
      ..lineTo(16, 17),
  LinaIconName.success =>
    Path()
      ..moveTo(20, 6)
      ..lineTo(9, 17)
      ..lineTo(4, 12),
  LinaIconName.error =>
    Path()
      ..moveTo(18, 6)
      ..lineTo(6, 18)
      ..moveTo(6, 6)
      ..lineTo(18, 18),
  LinaIconName.working =>
    Path()
      ..addOval(Rect.fromCircle(center: Offset(12, 12), radius: 9))
      ..moveTo(12, 7)
      ..lineTo(12, 12)
      ..lineTo(15, 14),
  LinaIconName.waiting =>
    Path()
      ..addOval(Rect.fromCircle(center: Offset(12, 12), radius: 9))
      ..moveTo(12, 6)
      ..lineTo(12, 13)
      ..moveTo(12, 17)
      ..lineTo(12, 18),
  LinaIconName.unknown =>
    Path()
      ..addOval(Rect.fromCircle(center: Offset(12, 12), radius: 9))
      ..moveTo(9, 9)
      ..cubicTo(9, 5, 16, 5, 15, 10)
      ..cubicTo(15, 12, 12, 12, 12, 14)
      ..moveTo(12, 17)
      ..lineTo(12, 18),
  LinaIconName.memory =>
    Path()
      ..moveTo(5, 3)
      ..lineTo(19, 3)
      ..lineTo(19, 21)
      ..lineTo(5, 21)
      ..close()
      ..moveTo(5, 17)
      ..lineTo(19, 17)
      ..moveTo(9, 3)
      ..lineTo(9, 10)
      ..lineTo(12, 8)
      ..lineTo(15, 10)
      ..lineTo(15, 3),
  LinaIconName.identity =>
    Path()..addOval(Rect.fromCircle(center: Offset(12, 12), radius: 9)),
};
