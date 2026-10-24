// SPDX-License-Identifier: Apache-2.0
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mac_panel/main.dart';
import 'package:mac_panel/panel_bridge.dart';

class SyntheticBridge extends PanelBridge {
  @override
  Future<Map<String, dynamic>> call(String method, [Object? arguments]) async =>
      {
        'clipboardEnabled': false,
        'history': <String>[],
        'shortcut': {
          'keyCode': 49,
          'modifiers': ['control', 'option'],
        },
      };
  @override
  void listen(void Function(Map<String, dynamic>) changed) {}
  @override
  void dispose() {}
}

void main() {
  testWidgets('panel layout fits and optionally captures synthetic UI', (
    tester,
  ) async {
    final capture = Platform.environment['MAC_PANEL_CAPTURE'] == '1';
    if (capture) {
      // Use a system font for local evidence only; do not redistribute it.
      await tester.runAsync(() async {
        final loader = FontLoader('Roboto')
          ..addFont(
            File('/System/Library/Fonts/Supplemental/Arial.ttf')
                .readAsBytes()
                .then((b) => ByteData.sublistView(b)),
          );
        await loader.load();
        final icons = FontLoader('MaterialIcons')
          ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
        await icons.load();
      });
    }
    tester.view.physicalSize = const Size(680, 460);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final key = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: key,
        child: PanelApp(bridge: SyntheticBridge()),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('No clipboard items'), findsOneWidget);
    if (capture) {
      await tester.runAsync(() async {
        final boundary =
            key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        final image = await boundary.toImage(pixelRatio: 2);
        final png = await image.toByteData(format: ui.ImageByteFormat.png);
        await File('../../docs/captures/LA-89/flutter-panel.png')
            .writeAsBytes(png!.buffer.asUint8List());
        image.dispose();
      });
    }
  });
}
