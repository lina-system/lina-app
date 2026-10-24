// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';

import '../generated/icons.dart';
import '../generated/tokens.dart';
import 'icon.dart';
import 'text.dart';

enum LinaStatus { working, waiting, success, error, unknown }

class StatusLabel extends StatelessWidget {
  const StatusLabel({super.key, required this.status, required this.label});
  final LinaStatus status;
  final String label;
  @override
  Widget build(BuildContext context) {
    final t = LinaTokens.of(context);
    final (icon, color) = switch (status) {
      LinaStatus.working => (LinaIconName.working, t.colorWorking),
      LinaStatus.waiting => (LinaIconName.waiting, t.colorWaiting),
      LinaStatus.success => (LinaIconName.success, t.colorSuccess),
      LinaStatus.error => (LinaIconName.error, t.colorError),
      LinaStatus.unknown => (LinaIconName.unknown, t.colorUnknown),
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        LinaIcon(icon, color: color),
        SizedBox(width: t.spaceInline),
        Flexible(
          child: LinaText(
            label,
            style: Theme.of(context).textTheme.bodyMedium
                ?.copyWith(color: color),
          ),
        ),
      ],
    );
  }
}
