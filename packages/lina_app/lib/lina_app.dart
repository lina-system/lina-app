// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:lina_design/lina_design.dart';

/// App theme boundary. Native runners, navigation and Core transport belong to #6.
class LinaApp extends StatelessWidget {
  const LinaApp({
    super.key,
    required this.home,
    this.themeMode = ThemeMode.system,
  });
  final Widget home;
  final ThemeMode themeMode;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'LINA',
    debugShowCheckedModeBanner: false,
    themeMode: themeMode,
    theme: linaTheme(LinaThemeMode.light),
    darkTheme: linaTheme(LinaThemeMode.dark),
    highContrastTheme: linaTheme(LinaThemeMode.highContrast),
    highContrastDarkTheme: linaTheme(LinaThemeMode.highContrast),
    home: home,
  );
}
