// SPDX-License-Identifier: Apache-2.0
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'connection_test.dart' show serverFor, fixture, emit;

void main() {
  for (final transport in ['tcp', 'unix']) {
    test(
      '$transport negotiates agents and transports correlated management requests',
      () async {
        if (transport == 'unix' && Platform.isWindows) return;
        final peer = await serverFor(transport);
        addTearDown(peer.server.close);
        final connection = CoreConnection(platform: 'linux/amd64');
        addTearDown(connection.dispose);
        final received = <Map>[];
        peer.server.listen((socket) {
          addTearDown(socket.destroy);
          socket
              .cast<List<int>>()
              .transform(utf8.decoder)
              .transform(const LineSplitter())
              .listen((line) {
                final request = exactDecode(line) as Map;
                if (request['method'] == 'hello') {
                  expect(
                    request['params']['payload']['capabilities'],
                    contains(equals({'name': 'agents', 'version': '1.0'})),
                  );
                  final welcome = fixture('welcome');
                  welcome['payload']['capabilities'] = [
                    {'name': 'agents', 'version': '1.0'},
                  ];
                  emit(socket, welcome, request: request);
                } else {
                  expect(request['method'], 'agent_request');
                  final payload = request['params']['payload'] as Map;
                  received.add(payload);
                  final operation = payload['operation'];
                  final result = fixture('normal/agent_result');
                  result['effect_state'] =
                      operation == 'list' || operation == 'choose'
                      ? 'none'
                      : 'applied';
                  result['payload'] = {
                    'operation': operation,
                    if (operation != 'list') 'agent_id': 'synthetic-agent',
                    'agents': operation == 'delete'
                        ? []
                        : [
                            {
                              'agent_id': 'synthetic-agent',
                              'name': payload['name'] ?? 'Mira',
                              'preset': 'lina',
                            },
                          ],
                  };
                  emit(socket, result, request: request);
                }
              });
        });
        await connection.connect(peer.endpoint);
        expect(connection.hasCapability('agents'), isTrue);
        for (final operation in [
          'list',
          'create',
          'choose',
          'rename',
          'delete',
        ]) {
          final request = ProtocolAgentRequest.fromJson({
            'operation': operation,
            if (operation == 'create' || operation == 'rename') 'name': 'Mira',
            if (['choose', 'rename', 'delete'].contains(operation))
              'agent_id': 'synthetic-agent',
          });
          final reply = await connection.request('agent_request', request);
          expect(reply.kind, 'agent_result');
          expect(
            (reply.typedPayload as ProtocolAgentResult).operation,
            operation,
          );
          expect(received.last, request.toJson());
        }
        expect(received, hasLength(5));
      },
    );
  }
}
