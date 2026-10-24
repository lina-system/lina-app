// SPDX-License-Identifier: Apache-2.0
import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'lina_app.dart';
import 'core_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final connection = CoreConnection(platform: nativePlatform);
  final preferences = DisplayPreferences();
  final endpoint =
      Platform.environment['LINA_CORE_ENDPOINT'] ??
      const String.fromEnvironment('LINA_CORE_ENDPOINT');
  runApp(
    LinaApp(
      preferences: preferences,
      home: CoreScreen(
        connection: connection,
        preferences: preferences,
        endpoint: endpoint,
      ),
    ),
  );
  if (endpoint.isNotEmpty) unawaited(connection.connect(endpoint));
  // Opt-in process instrumentation used by the release smoke harness.
  if (Platform.environment['LINA_MEASURE_STARTUP'] == '1') {
    WidgetsBinding.instance.waitUntilFirstFrameRasterized.then(
      (_) => stdout.writeln('LINA_FIRST_FRAME'),
    );
  }
}
