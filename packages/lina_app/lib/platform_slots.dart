// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:lina_design/lina_design.dart';

import 'status_item.dart';

/// #1 can supply a native composition view without changing draft ownership.
typedef ComposerBuilder = Widget Function(
  BuildContext context,
  TextEditingController controller,
  FocusNode focus,
  VoidCallback submit,
  LinaTokens tokens,
);

/// #2 can supply a native launcher host. The token snapshot is the same as the app.
abstract interface class LauncherHost {
  Future<void> show(LinaTokens tokens);
  Future<void> close();
}

class PlatformSlots {
  const PlatformSlots({this.composer, this.launcher, this.statusItem});
  final ComposerBuilder? composer;
  final LauncherHost? launcher;
  final StatusItemHost? statusItem;
}
