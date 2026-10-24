// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';

import '../generated/icons.dart';
import '../generated/tokens.dart';

class LinaIcon extends StatelessWidget {
  const LinaIcon(this.name, {super.key, this.color});
  final LinaIconName name;
  final Color? color;
  @override
  Widget build(BuildContext context) {
    final t = LinaTokens.of(context);
    return ExcludeSemantics(
      child: CustomPaint(
        size: Size.square(t.iconSize),
        painter: _IconPainter(name, color ?? t.colorText, t),
      ),
    );
  }
}

class _IconPainter extends CustomPainter {
  const _IconPainter(this.name, this.color, this.tokens);
  final LinaIconName name;
  final Color color;
  final LinaTokens tokens;
  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / tokens.iconGrid, size.height / tokens.iconGrid);
    canvas.drawPath(
      linaIconPath(name),
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = tokens.iconStroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_IconPainter old) =>
      name != old.name || color != old.color || tokens != old.tokens;
}
