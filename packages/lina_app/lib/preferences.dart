// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';

/// Presentation-only fallbacks, intentionally in memory for the skeleton.
class DisplayPreferences extends ChangeNotifier {
  ThemeMode themeMode = ThemeMode.system;
  bool highContrast = false;
  bool reducedMotion = false;
  bool largeText = false;
  void update({ThemeMode? theme, bool? contrast, bool? motion, bool? text}) {
    themeMode = theme ?? themeMode;
    highContrast = contrast ?? highContrast;
    reducedMotion = motion ?? reducedMotion;
    largeText = text ?? largeText;
    notifyListeners();
  }
}
