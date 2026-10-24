// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:lina_protocol/lina_protocol.dart';

import 'conversation_core.dart';

Map<String, dynamic> memoryItem(String id, String holder, String content) => {
  'item_id': id,
  'content': content,
  'holder': holder,
  'scope': 'private',
  'revision': 1,
  'evidence': ['event:$id'],
};

class MemoryCore extends ConversationCore {
  MemoryCore() {
    enableMemory();
  }
  List<Map<String, dynamic>> items = [
    memoryItem('personal', 'lina', 'Enjoys quiet reading together.'),
    memoryItem('shared', 'all', 'Prefers tea in the morning.'),
    memoryItem('other', 'sion', 'Another agent private memory.'),
  ];
  final writes =
      <({ProtocolMemoryRequest request, Completer<Envelope> reply})>[];
  final reads = <Completer<Envelope>>[];
  bool holdReads = false;
  String? next;

  void enableMemory() {
    welcome = ProtocolWelcome.fromJson({
      ...welcome!.toJson(),
      'capabilities': [
        ...welcome!.capabilities.map((c) => c.toJson()),
        {'name': 'memory', 'version': '1.0'},
      ],
    });
    updates.add(null);
  }

  Envelope listing() => event('memory_result', {
    'operation': 'list',
    'items': items,
    if (next != null) 'next': next,
  }, epoch: welcome!.epoch);

  @override
  Future<Envelope> request(
    String kind,
    ProtocolObject payload, {
    String? idempotencyKey,
  }) async {
    if (kind != 'memory_request') {
      return super.request(kind, payload, idempotencyKey: idempotencyKey);
    }
    requests.add((kind: kind, payload: payload));
    final request = payload as ProtocolMemoryRequest;
    if (request.operation == 'list') {
      if (!holdReads) return listing();
      final c = Completer<Envelope>();
      reads.add(c);
      return c.future;
    }
    final c = Completer<Envelope>();
    writes.add((request: request, reply: c));
    return c.future;
  }
}
