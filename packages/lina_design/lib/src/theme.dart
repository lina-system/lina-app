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
    color: _DisabledAwareTextColor(t.colorText, t.colorDisabled),
  );
  ButtonStyle controlStyle({required Color? disabledBackground}) => ButtonStyle(
    minimumSize: WidgetStatePropertyAll(
      Size(t.controlMinimum, t.controlMinimum),
    ),
    foregroundColor: WidgetStateProperty.resolveWith(
      (states) =>
          states.contains(WidgetState.disabled) ? t.colorDisabled : null,
    ),
    backgroundColor: WidgetStateProperty.resolveWith(
      (states) =>
          states.contains(WidgetState.disabled) ? disabledBackground : null,
    ),
  );
  TextStyle stateLabel(Set<WidgetState> states) => body.copyWith(
    color: states.contains(WidgetState.disabled)
        ? t.colorDisabled
        : states.contains(WidgetState.error)
        ? t.colorError
        : t.colorMuted,
  );
  final theme = ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: t.colorCanvas,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
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
    inputDecorationTheme: InputDecorationThemeData(
      labelStyle: WidgetStateTextStyle.resolveWith(stateLabel),
      floatingLabelStyle: WidgetStateTextStyle.resolveWith(
        (states) => body.copyWith(
          color: states.contains(WidgetState.disabled)
              ? t.colorDisabled
              : states.contains(WidgetState.error)
              ? t.colorError
              : states.contains(WidgetState.focused)
              ? t.colorAccent
              : t.colorMuted,
        ),
      ),
      hintStyle: WidgetStateTextStyle.resolveWith(
        (states) => body.copyWith(
          color: states.contains(WidgetState.disabled)
              ? t.colorDisabled
              : t.colorMuted,
        ),
      ),
      helperStyle: WidgetStateTextStyle.resolveWith(
        (states) => body.copyWith(
          fontSize: t.typeLabelSize,
          color: states.contains(WidgetState.disabled)
              ? t.colorDisabled
              : t.colorMuted,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: controlStyle(disabledBackground: t.colorSurface),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: controlStyle(disabledBackground: t.colorSurface),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: controlStyle(disabledBackground: null),
    ),
    iconTheme: IconThemeData(size: t.iconSize, color: t.colorText),
    iconButtonTheme: IconButtonThemeData(
      style: ButtonStyle(
        minimumSize: WidgetStatePropertyAll(
          Size(t.controlMinimum, t.controlMinimum),
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (states) =>
              states.contains(WidgetState.disabled) ? t.colorDisabled : null,
        ),
      ),
    ),
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
  return theme;
}

/// Text color that maps Material's dimmed body derivation to the token.
///
/// Material derives the disabled TextField input color as an opacity of
/// `bodyLarge.color`, which [InputDecorationThemeData] cannot reach. That
/// disabled derivation is the only framework path that dims this color, so it
/// resolves to `color.disabled`; the painted enabled color stays the text
/// token.
class _DisabledAwareTextColor extends Color {
  _DisabledAwareTextColor(Color enabled, this.disabled)
    : super(enabled.toARGB32());

  final Color disabled;

  @override
  Color withOpacity(double opacity) => disabled;
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
