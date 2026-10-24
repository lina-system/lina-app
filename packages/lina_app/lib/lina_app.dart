// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:lina_design/lina_design.dart';

import 'preferences.dart';
export 'preferences.dart';

class LinaApp extends StatefulWidget {
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
  State<LinaApp> createState() => _LinaAppState();
}

class _LinaAppState extends State<LinaApp> with WidgetsBindingObserver {
  DisplayPreferences? get preferences => widget.preferences;
  ThemeMode get themeMode => widget.themeMode;
  Widget get home => widget.home;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAccessibilityFeatures() => setState(() {});
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: preferences ?? const _NoPreferences(),
    builder: (context, _) => MaterialApp(
      title: 'LINA',
      themeAnimationDuration:
          preferences?.reducedMotion == true ||
              WidgetsBinding
                  .instance
                  .platformDispatcher
                  .accessibilityFeatures
                  .disableAnimations
          ? LinaTokens.light.motionReduced
          : LinaTokens.light.motionSettle,
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
