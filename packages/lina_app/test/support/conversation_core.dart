// SPDX-License-Identifier: Apache-2.0
import 'dart:async';
import 'dart:io';

import 'package:lina_protocol/lina_protocol.dart';

Map<String, dynamic> fixture(String name) => exactDecode(
  File('../../protocol/core/fixtures/client/1.0/$name.json').readAsStringSync(),
) as Map<String, dynamic>;

Envelope event(
  String kind,
  Map<String, dynamic> payload, {
  String effect = 'none',
  String epoch = '42',
  Map<String, dynamic>? error,
}) => Envelope.fromJson({
  ...fixture('conversation/item_done'),
  'kind': kind,
  'payload': payload,
  'effect_state': effect,
  'error': error,
  'epoch': epoch,
});

class ConversationCore extends CoreConnection {
  ConversationCore() : super(platform: 'linux/amd64') {
    live();
  }
  final updates = StreamController<void>.broadcast(sync: true);
  final messages = StreamController<Envelope>.broadcast(sync: true);
  final requests = <({String kind, ProtocolObject payload})>[];
  final pending = <Completer<Envelope>>[];
  final answers = <String, Envelope>{};
  final snapshots = <String, List<Map<String, dynamic>>>{};
  bool holdHistory = false;
  String selectedAgent = 'lina';
  bool holdAgents = false;
  final agentReplies = <Completer<Envelope>>[];
  final histories = <Completer<Envelope>>[];
  @override
  Stream<Envelope> get events => messages.stream;
  @override
  Stream<void> get changes => updates.stream;
  void live({List<Map<String, dynamic>>? agents, String epoch = '42'}) {
    phase = ConnectionPhase.connected;
    welcome = ProtocolWelcome.fromJson({
      ...fixture('welcome')['payload'] as Map<String, dynamic>,
      'capabilities': [
        {'name': 'conversation', 'version': '1.0'},
        {'name': 'agents', 'version': '1.0'},
      ],
      'epoch': epoch,
      'agents':
          agents ??
          [
            {'agent_id': 'lina', 'name': 'Lina', 'preset': 'lina'},
            {'agent_id': 'sion', 'name': 'Sion', 'preset': 'dev'},
          ],
    });
    updates.add(null);
  }

  void drop() {
    phase = ConnectionPhase.disconnected;
    updates.add(null);
  }

  /// Mirrors Core's typed refusal: the rejected phase survives the later EOF.
  void reject(String code) {
    phase = ConnectionPhase.rejected;
    refusalCode = code;
    welcome = null;
    updates.add(null);
  }

  void emit(Envelope envelope) {
    messages.add(envelope);
    updates.add(null);
  }

  Map<String, dynamic> snapshot(String agent) => {
    'topic': 'conversation:$agent-main',
    'cursor': {'epoch': welcome!.epoch, 'seq': 0},
    'revocation_epoch': '0',
    'items': snapshots[agent] ?? [],
  };
  Envelope history(String agent) => event('history', {
    'agent_id': agent,
    'conversation_id': '$agent-main',
    'snapshot': snapshot(agent),
  });
  @override
  Future<Envelope> request(
    String kind,
    ProtocolObject payload, {
    String? idempotencyKey,
  }) async {
    requests.add((kind: kind, payload: payload));
    if (answers.containsKey(kind)) return answers[kind]!;
    if (kind == 'agent_request') {
      if (holdAgents) {
        final c = Completer<Envelope>();
        agentReplies.add(c);
        return c.future;
      }
      if (payload.json['operation'] == 'choose')
        selectedAgent = payload.json['agent_id'] as String;
      return event('agent_result', {
        'operation': payload.json['operation'],
        if (payload.json['agent_id'] != null)
          'agent_id': payload.json['agent_id'],
        'agents': welcome!.agents.map((a) => a.toJson()).toList(),
      });
    }
    if (kind == 'history_get' || kind == 'conversation_start') {
      if (holdHistory) {
        final c = Completer<Envelope>();
        histories.add(c);
        return c.future;
      }
      return history(payload.json['agent_id'] as String? ?? selectedAgent);
    }
    if (kind == 'subscribe') return event('item_done', {});
    final c = Completer<Envelope>();
    pending.add(c);
    return c.future;
  }

  void stream(
    String agent,
    int seq,
    String key,
    String kind,
    Map<String, dynamic> payload, {
    int? revision,
  }) {
    emit(
      event(kind, {
        ...payload,
        'stream': {
          'topic': 'conversation:$agent-main',
          'cursor': {'epoch': welcome!.epoch, 'seq': seq},
          'key': key,
          'revision': revision ?? seq,
        },
      }, epoch: welcome!.epoch),
    );
  }

  @override
  Future<void> dispose() async {
    await updates.close();
    await messages.close();
    await super.dispose();
  }
}
