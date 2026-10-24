// SPDX-License-Identifier: Apache-2.0
// Optional installed-Core proof; never reads the person's existing Core state.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:lina_protocol/lina_protocol.dart';

Future<void> main(List<String> arguments) async {
  if (arguments.length != 1)
    throw ArgumentError('dart run bin/core_smoke.dart /path/to/lina');
  final binary = File(arguments.single).absolute.path;
  for (final listed in [false, true]) {
    final root = await Directory.systemTemp.createTemp('lina-app-core-');
    final socket = '${root.path}/client.sock';
    await Directory('${root.path}/system/core').create(recursive: true);
    await File('${root.path}/system/core/main.json')
        .writeAsString('{"main_id":"synthetic-app-core"}');
    final manifest = File('${root.path}/development.json');
    await manifest.writeAsString(
      jsonEncode({
        'supportedCombinations': [
          if (listed)
            {
              'connection': 'client',
              'peer': 'lina-app',
              'platform': nativePlatform,
              'protocolVersion': '1.0',
              'capabilities': [
                {'name': 'conversation', 'version': '1.0'},
              ],
              'evidence': [
                'development-only app codec corpus and local smoke; not release acceptance',
              ],
            },
        ],
      }),
    );
    // Core admits only private control directories, including the temp root.
    final permissions = await Process.run('chmod', ['-R', 'go-rwx', root.path]);
    if (permissions.exitCode != 0) throw StateError('Cannot secure smoke root');
    final process = await Process.start(
      binary,
      [
        'core',
        '--state-root',
        root.path,
        '--socket',
        socket,
        if (listed) ...['--manifest', manifest.path],
      ],
      environment: {'LINA_APPLEFM_HELPER': ''},
    );
    final out = process.stdout.transform(utf8.decoder).join();
    final err = process.stderr.transform(utf8.decoder).join();
    final client = CoreConnection(platform: nativePlatform);
    try {
      for (var i = 0; i < 200; i++) {
        if (await FileSystemEntity.type(socket) !=
            FileSystemEntityType.notFound)
          break;
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
      await client.connect('unix://$socket');
      if (listed) {
        if (client.phase != ConnectionPhase.connected)
          throw StateError(
            'listed development connection failed: ${client.phase} ${client.refusalCode}',
          );
        stdout.writeln(
          'PASS real Core welcome: $nativePlatform; epoch=${client.welcome!.epoch}; capabilities=${client.welcome!.capabilities.map((c) => c.name).join(',')}',
        );
        final disconnected = client.changes.firstWhere(
          (_) => client.phase == ConnectionPhase.disconnected,
        );
        process.kill(ProcessSignal.sigterm);
        await disconnected.timeout(const Duration(seconds: 10));
        stdout.writeln('PASS real Core termination shows disconnected');
      } else {
        if (client.phase != ConnectionPhase.rejected ||
            client.refusalCode != 'unsupported_combination')
          throw StateError(
            'unlisted combination did not reject: ${client.phase}',
          );
        stdout.writeln(
          'PASS real Core compiled table refuses lina-app with unsupported_combination',
        );
      }
    } finally {
      await client.dispose();
      process.kill(ProcessSignal.sigterm);
      try {
        await process.exitCode.timeout(const Duration(seconds: 10));
      } on TimeoutException {
        process.kill(ProcessSignal.sigkill);
        await process.exitCode;
      }
      final output = await out;
      final errors = await err;
      if (output.isNotEmpty) stdout.write(output);
      if (errors.isNotEmpty) stderr.write(errors);
      await root.delete(recursive: true);
    }
  }
}
