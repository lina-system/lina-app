// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:lina_design/lina_design.dart';

import 'preferences.dart';
export 'preferences.dart';

class LinaApp extends StatelessWidget {
  const LinaApp({
    super.key,
    required this.home,
    this.themeMode = ThemeMode.system,
    this.preferences,
  });
  final Widget home;
  final ThemeMode themeMode;
  final DisplayPreferences? preferences;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: preferences ?? const _NoPreferences(),
    builder: (context, _) => MaterialApp(
      title: 'LINA',
      debugShowCheckedModeBanner: false,
      themeMode: preferences?.themeMode ?? themeMode,
      theme: linaTheme(
        preferences?.highContrast == true
            ? LinaThemeMode.highContrast
            : LinaThemeMode.light,
      ),
      darkTheme: linaTheme(
        preferences?.highContrast == true
            ? LinaThemeMode.highContrast
            : LinaThemeMode.dark,
      ),
      highContrastTheme: linaTheme(LinaThemeMode.highContrast),
      highContrastDarkTheme: linaTheme(LinaThemeMode.highContrast),
      builder: (context, child) {
        final media = MediaQuery.of(context);
        final t = LinaTokens.of(context);
        return MediaQuery(
          data: media.copyWith(
            disableAnimations:
                media.disableAnimations || preferences?.reducedMotion == true,
            highContrast:
                media.highContrast || preferences?.highContrast == true,
            textScaler: preferences?.largeText == true
                ? TextScaler.linear(
                    media.textScaler.scale(t.typeSize) /
                        t.typeSize *
                        t.accessibilityScaleLarge,
                  )
                : media.textScaler,
          ),
          child: child!,
        );
      },
      home: home,
    ),
  );
}

class _NoPreferences implements Listenable {
  const _NoPreferences();
  @override
  void addListener(VoidCallback listener) {}
  @override
  void removeListener(VoidCallback listener) {}
}
