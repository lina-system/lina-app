// SPDX-License-Identifier: Apache-2.0
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lina_protocol/lina_protocol.dart';

Map<String, dynamic> fixture(String path) => exactDecode(
  File('../../protocol/core/fixtures/client/1.0/$path.json').readAsStringSync(),
) as Map<String, dynamic>;
void emit(Socket socket, Map<String, dynamic> envelope, {Map? request}) {
  if (request != null) envelope['reply_to'] = request['params']['message_id'];
  socket.write(
    '${exactEncode({'jsonrpc': '2.0', if (request != null) 'id': request['id'], if (request == null) 'method': envelope['kind'], request == null ? 'params' : 'result': envelope})}\n',
  );
}

Future<({ServerSocket server, String endpoint})> serverFor(
  String transport,
) async {
  if (transport == 'unix') {
    final dir = await Directory.systemTemp.createTemp('lina-socket-');
    addTearDown(() => dir.delete(recursive: true));
    final path = '${dir.path}/core.sock';
    return (
      server: await ServerSocket.bind(
        InternetAddress(path, type: InternetAddressType.unix),
        0,
      ),
      endpoint: 'unix://$path',
    );
  }
  final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  return (server: server, endpoint: 'tcp://127.0.0.1:${server.port}');
}

void main() {
  for (final transport in ['unix', 'tcp']) {
    test(
      '$transport handshake, preview, confirmed saved, unknown, drop',
      () async {
        if (transport == 'unix' && Platform.isWindows) return;
        final peer = await serverFor(transport);
        addTearDown(peer.server.close);
        final connection = CoreConnection(platform: 'darwin/arm64');
        addTearDown(connection.dispose);
        final accepted = Completer<Socket>();
        peer.server.listen((socket) {
          addTearDown(socket.destroy);
          accepted.complete(socket);
          socket
              .cast<List<int>>()
              .transform(utf8.decoder)
              .transform(const LineSplitter())
              .listen((line) {
                final request = exactDecode(line) as Map;
                if (request['method'] == 'hello') {
                  expect(request['params']['payload']['peer'], 'lina-app');
                  emit(socket, fixture('welcome'), request: request);
                } else {
                  emit(socket, fixture('outcomes/unknown'), request: request);
                }
              });
        });
        await connection.connect(peer.endpoint);
        expect(connection.phase, ConnectionPhase.connected);
        final socket = await accepted.future;
        final preview = connection.changes.first;
        emit(socket, fixture('results/summary'));
        await preview;
        expect(connection.results.single.status, 'preview');
        final pending = connection.request(
          'result_save',
          ProtocolResultSave.fromJson({
            'result_id': 'result-example',
            'revision': 1,
            'destination': {},
          }),
          idempotencyKey: 'result-example:1:save:default',
        );
        expect(connection.results.single.status, 'preview');
        await pending;
        expect(connection.lastEffect, 'unknown');
        expect(connection.results.single.status, 'preview');
        final saved = connection.changes.first;
        emit(socket, fixture('results/saved_card'));
        await saved;
        expect(connection.results.single.status, 'saved');
        final dropped = connection.changes.first;
        socket.destroy();
        await dropped;
        expect(connection.phase, ConnectionPhase.disconnected);
      },
    );
  }
  for (final fault in [
    'refusal',
    'wrong-id',
    'wrong-reply',
    'wrong-main',
    'wrong-epoch',
    'wrong-version',
    'extra-capability',
    'pre-welcome',
    'oversize',
    'timeout',
  ]) {
    test('handshake rejects $fault', () async {
      final peer = await serverFor('tcp');
      addTearDown(peer.server.close);
      final connection = CoreConnection(
        platform: 'darwin/arm64',
        timeout: const Duration(milliseconds: 150),
      );
      addTearDown(connection.dispose);
      peer.server.listen((socket) {
        addTearDown(socket.destroy);
        socket
            .cast<List<int>>()
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .listen((line) {
              final request = exactDecode(line) as Map;
              final welcome = fixture(
                fault == 'refusal' ? 'unsupported_combination' : 'welcome',
              );
              switch (fault) {
                case 'timeout':
                  return;
                case 'oversize':
                  socket.write('x' * (CoreConnection.maxFrameBytes + 1));
                  return;
                case 'wrong-main':
                  welcome['payload']['main_id'] = 'other';
                case 'wrong-epoch':
                  welcome['payload']['epoch'] = '43';
                case 'wrong-version':
                  welcome['payload']['protocol_version'] = '1.1';
                case 'extra-capability':
                  welcome['payload']['capabilities'] = [
                    {'name': 'admin', 'version': '1.0'},
                  ];
                case 'pre-welcome':
                  emit(socket, fixture('results/saved_card'));
                  return;
                case 'wrong-id':
                  request['id'] = 'wrong';
                case 'wrong-reply':
                  request['params']['message_id'] = 'wrong';
              }
              emit(socket, welcome, request: request);
              if (fault == 'refusal') socket.close();
            });
      });
      await connection.connect(peer.endpoint);
      expect(
        connection.phase,
        fault == 'refusal'
            ? ConnectionPhase.rejected
            : ConnectionPhase.disconnected,
      );
      if (fault == 'refusal')
        expect(connection.refusalCode, 'unsupported_combination');
      expect(connection.results, isEmpty);
    });
  }
  test(
    'drop with a pending effect yields unknown and never resends on reconnect',
    () async {
      final peer = await serverFor('tcp');
      addTearDown(peer.server.close);
      final connection = CoreConnection(platform: 'darwin/arm64');
      addTearDown(connection.dispose);
      var effects = 0;
      peer.server.listen((socket) {
        addTearDown(socket.destroy);
        socket
            .cast<List<int>>()
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .listen((line) {
              final request = exactDecode(line) as Map;
              if (request['method'] == 'hello') {
                emit(socket, fixture('welcome'), request: request);
              } else {
                effects++;
                socket.destroy();
              }
            });
      });
      await connection.connect(peer.endpoint);
      await expectLater(
        connection.request(
          'result_save',
          ProtocolResultSave.fromJson({
            'result_id': 'result-example',
            'revision': 1,
            'destination': {},
          }),
          idempotencyKey: 'result-example:1:save:default',
        ),
        throwsA(isA<ConnectionLost>()),
      );
      expect(connection.phase, ConnectionPhase.disconnected);
      expect(connection.lastEffect, 'unknown');
      await connection.connect(peer.endpoint);
      expect(effects, 1);
      expect(connection.results, isEmpty);
    },
  );
}
