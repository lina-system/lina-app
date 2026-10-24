// SPDX-License-Identifier: Apache-2.0
import 'dart:math' as math;
import 'dart:ui' show Tristate;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_design/lina_design.dart';

const _disabledLabels = [
  'Disabled filled',
  'Disabled elevated',
  'Disabled outlined',
  'Disabled text',
];

Widget _harness(
  LinaThemeMode mode,
  TextEditingController input, {
  VoidCallback? onAppearance,
  VoidCallback? onIcon,
}) => MaterialApp(
  theme: linaTheme(mode),
  home: Scaffold(
    appBar: AppBar(
      actions: [
        IconButton(
          onPressed: onIcon,
          tooltip: 'Appearance',
          icon: const Icon(Icons.palette_outlined),
        ),
      ],
    ),
    body: SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('lina.'),
              TextButton(
                onPressed: onAppearance,
                child: const Text('Appearance'),
              ),
            ],
          ),
          TextField(
            enabled: false,
            decoration: const InputDecoration(labelText: 'Disabled field'),
          ),
          TextField(
            enabled: false,
            decoration: const InputDecoration(hintText: 'Disabled hint'),
          ),
          TextField(
            key: const ValueKey('disabled-input'),
            enabled: false,
            controller: input,
            decoration: const InputDecoration(labelText: 'Disabled input'),
          ),
          FilledButton(onPressed: null, child: const Text('Disabled filled')),
          ElevatedButton(
            onPressed: null,
            child: const Text('Disabled elevated'),
          ),
          OutlinedButton(
            onPressed: null,
            child: const Text('Disabled outlined'),
          ),
          TextButton(onPressed: null, child: const Text('Disabled text')),
          FilledButton(onPressed: () {}, child: const Text('Enabled filled')),
          const Checkbox(value: false, onChanged: null),
          const Switch(value: false, onChanged: null),
        ],
      ),
    ),
  ),
);

double _contrast(Color foreground, Color background) {
  final a = foreground.computeLuminance();
  final b = background.computeLuminance();
  return (math.max(a, b) + 0.05) / (math.min(a, b) + 0.05);
}

/// Composites every ancestor [Material] color over the scaffold canvas so the
/// measured pair is the paint that actually sits behind the glyphs.
Color _backgroundOf(WidgetTester tester, Finder finder) {
  final element = tester.element(finder);
  var background = Theme.of(element).scaffoldBackgroundColor;
  final colors = <Color>[];
  element.visitAncestorElements((ancestor) {
    if (ancestor.widget case final Material material
        when material.color != null) {
      colors.add(material.color!);
    }
    return true;
  });
  for (final color in colors.reversed) {
    background = Color.alphaBlend(color, background);
  }
  return background;
}

Color _paragraphColor(WidgetTester tester, Finder finder) =>
    tester.renderObject<RenderParagraph>(finder).text.style!.color!;

Future<void> _pumpOn(
  WidgetTester tester,
  TargetPlatform platform,
  Widget Function() build,
) async {
  debugDefaultTargetPlatformOverride = platform;
  try {
    await tester.pumpWidget(build());
    await tester.pumpAndSettle();
  } finally {
    debugDefaultTargetPlatformOverride = null;
  }
}

void main() {
  for (final mode in LinaThemeMode.values) {
    testWidgets(
      '${mode.name}: disabled standard control text uses the disabled token at 4.5:1',
      (tester) async {
        final input = TextEditingController(text: 'Disabled input');
        addTearDown(input.dispose);
        await _pumpOn(
          tester,
          TargetPlatform.linux,
          () => _harness(mode, input),
        );
        final tokens = LinaTokens.of(tester.element(find.byType(Scaffold)));
        expect(
          Theme.of(tester.element(find.byType(Scaffold)))
              .textTheme
              .bodyLarge!
              .color!
              .toARGB32(),
          tokens.colorText.toARGB32(),
          reason: 'enabled bodyLarge must keep the text token',
        );

        final pairs = <(String, Finder, Color)>[
          (
            'TextField label',
            find.text('Disabled field'),
            _paragraphColor(tester, find.text('Disabled field')),
          ),
          (
            'TextField hint',
            find.text('Disabled hint'),
            _paragraphColor(tester, find.text('Disabled hint')),
          ),
          (
            'TextField input',
            find.byKey(const ValueKey('disabled-input')),
            tester
                .widget<EditableText>(
                  find.descendant(
                    of: find.byKey(const ValueKey('disabled-input')),
                    matching: find.byType(EditableText),
                  ),
                )
                .style
                .color!,
          ),
          for (final label in _disabledLabels)
            (
              label,
              find.text(label),
              _paragraphColor(tester, find.text(label)),
            ),
        ];

        for (final (name, finder, foreground) in pairs) {
          expect(
            foreground,
            tokens.colorDisabled,
            reason: '$name must use color.disabled',
          );
          final background = _backgroundOf(tester, finder);
          final ratio = _contrast(foreground, background);
          expect(
            ratio,
            greaterThanOrEqualTo(4.5),
            reason:
                '$name ${foreground.toARGB32().toRadixString(16)} on '
                '${background.toARGB32().toRadixString(16)} is '
                '${ratio.toStringAsFixed(3)}:1',
          );
        }
      },
    );

    testWidgets(
      '${mode.name}: standard controls keep 48x48 interactive targets',
      (tester) async {
        final input = TextEditingController(text: 'Disabled input');
        addTearDown(input.dispose);

        for (final platform in [TargetPlatform.android, TargetPlatform.linux]) {
          await _pumpOn(tester, platform, () => _harness(mode, input));

          final targets = <String, Finder>{
            for (final label in _disabledLabels)
              label: find.widgetWithText(switch (label) {
                'Disabled filled' => FilledButton,
                'Disabled elevated' => ElevatedButton,
                'Disabled outlined' => OutlinedButton,
                _ => TextButton,
              }, label),
            'Enabled filled': find.widgetWithText(
              FilledButton,
              'Enabled filled',
            ),
            'Checkbox': find.byType(Checkbox),
            'Switch': find.byType(Switch),
          };

          for (final MapEntry(key: name, value: finder) in targets.entries) {
            final size = tester.getSize(finder);
            expect(
              size.width,
              greaterThanOrEqualTo(48),
              reason: '$platform $name width ${size.width}',
            );
            expect(
              size.height,
              greaterThanOrEqualTo(48),
              reason: '$platform $name height ${size.height}',
            );
          }
        }
      },
    );

    testWidgets(
      '${mode.name}: toolbar and app bar buttons keep a 48px hit target',
      (tester) async {
        final input = TextEditingController();
        addTearDown(input.dispose);
        for (final platform in [TargetPlatform.android, TargetPlatform.linux]) {
          var appearance = 0;
          var icon = 0;
          await _pumpOn(
            tester,
            platform,
            () => _harness(
              mode,
              input,
              onAppearance: () => appearance++,
              onIcon: () => icon++,
            ),
          );

          final cases = <(String, Finder, int Function())>[
            (
              'toolbar Appearance',
              find.widgetWithText(TextButton, 'Appearance'),
              () => appearance,
            ),
            (
              'app bar icon',
              find.widgetWithIcon(IconButton, Icons.palette_outlined),
              () => icon,
            ),
          ];
          for (final (name, finder, taps) in cases) {
            final size = tester.getSize(finder);
            expect(
              size.width,
              greaterThanOrEqualTo(48),
              reason: '$platform $name width ${size.width}',
            );
            expect(
              size.height,
              greaterThanOrEqualTo(48),
              reason: '$platform $name height ${size.height}',
            );
            final center = tester.getCenter(finder);
            for (final offset in const [Offset(0, -23), Offset(0, 23)]) {
              final before = taps();
              await tester.tapAt(center + offset);
              await tester.pumpAndSettle();
              expect(
                taps(),
                before + 1,
                reason: '$platform $name must react ${offset.dy}px from center',
              );
            }
          }
        }
      },
    );

    testWidgets(
      '${mode.name}: disabled buttons keep native disabled semantics',
      (tester) async {
        final semantics = tester.ensureSemantics();
        final input = TextEditingController(text: 'Disabled input');
        addTearDown(input.dispose);
        await _pumpOn(
          tester,
          TargetPlatform.linux,
          () => _harness(mode, input),
        );

        for (final MapEntry(key: label, value: type) in {
          'Disabled filled': FilledButton,
          'Disabled elevated': ElevatedButton,
          'Disabled outlined': OutlinedButton,
          'Disabled text': TextButton,
        }.entries) {
          final finder = find.widgetWithText(type, label);
          final flags = tester
              .getSemantics(finder)
              .getSemanticsData()
              .flagsCollection;
          expect(flags.isButton, isTrue, reason: label);
          expect(flags.isEnabled, Tristate.isFalse, reason: label);
        }
        semantics.dispose();
      },
    );
  }
}
