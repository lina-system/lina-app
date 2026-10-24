// SPDX-License-Identifier: Apache-2.0
// Synthetic one-connection demonstration peer. Never executes an effect.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:lina_protocol/lina_protocol.dart';

Future<void> main() async {
  final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  stdout.writeln('tcp://127.0.0.1:${server.port}');
  final socket = await server.first;
  await server.close();
  Map<String, dynamic> fixture(String path) => exactDecode(
    File('../../protocol/core/fixtures/client/1.0/$path.json')
        .readAsStringSync(),
  ) as Map<String, dynamic>;
  var count = 0;
  void send(Map<String, dynamic> envelope, {Map? request}) {
    envelope['message_id'] = 'synthetic-${count++}';
    envelope['reply_to'] = request?['params']['message_id'];
    socket.write(
      '${exactEncode({'jsonrpc': '2.0', if (request != null) 'id': request['id'], if (request == null) 'method': envelope['kind'], request == null ? 'params' : 'result': envelope})}\n',
    );
  }

  try {
    await for (final line
        in socket
            .cast<List<int>>()
            .transform(utf8.decoder)
            .transform(const LineSplitter())) {
      final rpc = exactDecode(line) as Map;
      final envelope = Envelope.fromJson(rpc['params'] as Map<String, dynamic>);
      if (envelope.kind == 'hello') {
        send(fixture('welcome'), request: rpc);
        send(fixture('results/summary'));
        final saved = fixture('results/saved_card');
        saved['payload']['result_id'] = 'another-synthetic-result';
        send(saved);
        send(fixture('outcomes/unknown'));
      } else {
        send(fixture('outcomes/out_of_scope'), request: rpc);
      }
    }
  } finally {
    socket.destroy();
  }
}
