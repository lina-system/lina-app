// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';

import '../generated/tokens.dart';

enum LinaThemeMode { light, dark, highContrast }

ThemeData linaTheme(LinaThemeMode mode) {
  final t = switch (mode) {
    LinaThemeMode.light => LinaTokens.light,
    LinaThemeMode.dark => LinaTokens.dark,
    LinaThemeMode.highContrast => LinaTokens.highContrast,
  };
  final scheme = ColorScheme(
    brightness: mode == LinaThemeMode.light
        ? Brightness.light
        : Brightness.dark,
    primary: t.colorAccent,
    onPrimary: t.colorOnAccent,
    secondary: t.colorAccent,
    onSecondary: t.colorOnAccent,
    error: t.colorError,
    onError: t.colorCanvas,
    surface: t.colorCanvas,
    onSurface: t.colorText,
    onSurfaceVariant: t.colorMuted,
    outline: t.colorBorder,
    outlineVariant: t.colorLine,
    surfaceContainerHighest: t.colorSurface,
  );
  final body = TextStyle(
    fontFamily: t.typeBody,
    package: 'lina_design',
    fontSize: t.typeSize,
    fontWeight: t.typeWeight,
    height: t.typeLineHeight,
    color: t.colorText,
  );
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: t.colorCanvas,
    extensions: [t],
    textTheme: TextTheme(
      bodyLarge: body,
      bodyMedium: body,
      bodySmall: body.copyWith(fontSize: t.typeLabelSize),
      titleLarge: body.copyWith(
        fontSize: t.typeTitleSize,
        fontWeight: t.typeTitleWeight,
      ),
      titleMedium: body.copyWith(fontWeight: t.typeTitleWeight),
      labelLarge: body,
      labelMedium: body.copyWith(fontSize: t.typeLabelSize),
    ),
    iconTheme: IconThemeData(size: t.iconSize, color: t.colorText),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: t.colorAccent,
      selectionColor: t.colorSelection,
      selectionHandleColor: t.colorAccent,
    ),
    textButtonTheme: TextButtonThemeData(
      style: ButtonStyle(
        minimumSize: WidgetStatePropertyAll(
          Size(t.controlMinimum, t.controlMinimum),
        ),
        padding: WidgetStatePropertyAll(EdgeInsets.all(t.spaceInline)),
        foregroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.disabled)
              ? t.colorDisabled
              : t.colorAccent,
        ),
        backgroundColor: WidgetStatePropertyAll(t.colorSurface),
        textStyle: WidgetStatePropertyAll(body),
        shape: WidgetStatePropertyAll(
          ContinuousRectangleBorder(
            borderRadius: BorderRadius.circular(t.radiusCard),
          ),
        ),
        side: WidgetStateProperty.resolveWith(
          (states) => BorderSide(
            color: states.contains(WidgetState.focused)
                ? t.colorFocus
                : t.colorBorder,
            width: states.contains(WidgetState.focused)
                ? t.borderFocusWidth
                : t.borderWidth,
          ),
        ),
      ),
    ),
  );
}

TextStyle linaCodeStyle(BuildContext context) {
  final t = LinaTokens.of(context);
  return TextStyle(
    fontFamily: t.typeCodeNative,
    package: 'lina_design',
    fontSize: t.typeSize,
    height: t.typeLineHeight,
    color: t.colorText,
  );
}
