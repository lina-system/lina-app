// SPDX-License-Identifier: Apache-2.0
import '../generated/protocol.dart';

/// A disposable display projection, never a conversation store. Snapshot and
/// cursor checks prevent duplicate text and cross-topic late-reply attachment.
class TopicWindow {
  TopicWindow(this.topic);
  final String topic;
  ProtocolStreamCursor? cursor;
  final Map<String, ProtocolStreamItem> _items = {};
  List<ProtocolStreamItem> get items => List.unmodifiable(_items.values);
  bool needsSnapshot = true;

  bool replace(ProtocolSnapshot snapshot) {
    if (snapshot.topic != topic) return false;
    if (!needsSnapshot &&
        cursor?.epoch == snapshot.cursor.epoch &&
        snapshot.cursor.seq.compareTo(cursor!.seq) < 0)
      return false;
    _items.clear();
    for (final item in snapshot.items) {
      _items[item.key] = item;
    }
    cursor = snapshot.cursor;
    needsSnapshot = false;
    return true;
  }

  bool apply(String kind, Map<String, dynamic> payload) {
    final raw = payload['stream'];
    if (raw is! Map<String, dynamic>) return false;
    final stream = ProtocolStreamMetadata.fromJson(raw);
    if (stream.topic != topic || needsSnapshot) return false;
    final current = cursor!;
    if (stream.cursor.epoch != current.epoch) {
      needsSnapshot = true;
      return false;
    }
    if (stream.cursor.seq.compareTo(current.seq) <= 0) return false;
    if (stream.cursor.seq.toBigInt() != current.seq.toBigInt() + BigInt.one) {
      needsSnapshot = true;
      return false;
    }
    cursor = stream.cursor;
    final prior = _items[stream.key];
    if (prior != null && stream.revision.compareTo(prior.revision) <= 0)
      return false;
    final body = Map<String, dynamic>.of(payload)..remove('stream');
    if (kind == 'output_delta' && prior?.kind == 'output_delta') {
      body['text'] =
          '${(prior!.payload as Map)['text'] ?? ''}${body['text'] ?? ''}';
    }
    _items[stream.key] = ProtocolStreamItem.fromJson({
      'kind': kind,
      'key': stream.key,
      'revision': stream.revision,
      'payload': body,
    });
    return true;
  }
}
