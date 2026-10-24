// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/widgets.dart';

/// Display-only word-phrase wrapping. Original content remains the semantics label.
String koreanWordPhrase(String text) => text.replaceAllMapped(
  RegExp(r'([가-힣])(?=[가-힣])'),
  (match) => '${match.group(1)}\u2060',
);

class LinaText extends StatelessWidget {
  const LinaText(this.data, {super.key, this.style});
  final String data;
  final TextStyle? style;
  @override
  Widget build(BuildContext context) => Text(
    koreanWordPhrase(data),
    style: style,
    semanticsLabel: data,
    softWrap: true,
  );
}
