// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:lina_protocol/lina_protocol.dart';

/// A disposable Core projection, never a memory store or a mutation queue.
class MemoryController extends ChangeNotifier {
  MemoryController(this.core, this.agentId) {
    _changes = core.changes.listen((_) => _connectionChanged());
    _events = core.events.listen(_event);
    _connectionChanged();
  }

  final CoreConnection core;
  final String agentId;
  late final StreamSubscription<void> _changes;
  late final StreamSubscription<Envelope> _events;
  ProtocolWelcome? _welcome;
  Object _generation = Object();
  bool _disposed = false;
  bool _active = true;
  bool loading = false;
  bool writing = false;
  bool observed = false;
  String? feedback;
  String? next;
  String? _revocation;
  final _cursors = <String>{};
  List<ProtocolMemorySummary> items = const [];
  bool get available =>
      _active &&
      core.phase == ConnectionPhase.connected &&
      core.hasCapability('memory') &&
      (core.welcome?.agents.any((a) => a.agentId == agentId) ?? false);
  bool get canWrite => available && observed && !loading && !writing;
  Object get session =>
      _welcome == null ? (null, null) : (_welcome!.mainId, _welcome!.personId);

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _clear() {
    _generation = Object();
    items = const [];
    next = null;
    _cursors.clear();
    observed = false;
    loading = false;
    if (writing) feedback = 'Outcome unknown. Refresh before another action.';
    writing = false;
  }

  void _connectionChanged() {
    final welcome = core.welcome;
    if (!available) {
      _clear();
      _notify();
      return;
    }
    if (!identical(welcome, _welcome)) {
      final oldSession = session;
      _clear();
      _welcome = welcome;
      if (session != oldSession) feedback = null;
      _revocation = null;
      unawaited(refresh());
    }
  }

  void _event(Envelope event) {
    if (!available || event.epoch != core.welcome?.epoch) return;
    final payload = event.payload;
    final snapshot = payload['snapshot'];
    final epoch =
        payload['revocation_epoch'] ??
        (snapshot is Map ? snapshot['revocation_epoch'] : null);
    if (epoch is String && epoch != _revocation) {
      _revocation = epoch;
      _clear();
      unawaited(refresh());
    }
  }

  void suspend() {
    _active = false;
    _clear();
    _notify();
  }

  Future<void> resume() async {
    _active = true;
    if (!identical(_welcome, core.welcome)) {
      final previous = session;
      _welcome = core.welcome;
      if (session != previous) feedback = null;
    }
    await refresh();
  }

  Future<void> refresh() async {
    if (_disposed || !available || writing) return;
    _clear();
    await _read();
  }

  Future<void> loadMore() async {
    if (!available || loading || writing || next == null) return;
    await _read(after: next);
  }

  Future<void> _read({String? after}) async {
    final generation = _generation;
    loading = true;
    _notify();
    try {
      final reply = await core.request(
        'memory_request',
        ProtocolMemoryRequest.fromJson({
          'operation': 'list',
          'agent_id': agentId,
          if (after != null) 'after': after,
        }),
      );
      if (!_current(generation)) return;
      if (reply.kind != 'memory_result' ||
          reply.error != null ||
          reply.effectState != 'none') {
        throw const FormatException('memory list not confirmed');
      }
      final result = reply.typedPayload as ProtocolMemoryResult;
      if (result.operation != 'list' ||
          result.items == null ||
          (result.next != null &&
              (result.next == after || _cursors.contains(result.next)))) {
        throw const FormatException('incomplete memory page');
      }
      if (after != null) _cursors.add(after);
      final visible = <String, ProtocolMemorySummary>{
        for (final item in items) item.itemId: item,
        for (final item in result.items!)
          if (item.holder == agentId || item.holder == 'all') item.itemId: item,
      };
      items = List.unmodifiable(visible.values);
      next = result.next;
      observed = true;
    } on Object {
      if (!_current(generation)) return;
      // A failed page is not an empty or complete list.
      observed = false;
      next = null;
      feedback = 'Memory is unobserved. Refresh to ask Core again.';
    } finally {
      if (_current(generation)) {
        loading = false;
        _notify();
      }
    }
  }

  bool _current(Object generation) =>
      !_disposed && available && identical(generation, _generation);

  bool _contains(ProtocolMemorySummary item) => items.any(
    (current) =>
        current.itemId == item.itemId &&
        current.revision == item.revision &&
        current.holder == item.holder,
  );

  Future<bool> remember(String text, String holder, String scope) async {
    if (text.trim().isEmpty ||
        (holder != agentId && holder != 'all') ||
        !const ['local', 'private', 'never-leaves'].contains(scope))
      return false;
    return _write('remember', {'text': text, 'holder': holder, 'scope': scope});
  }

  Future<bool> correct(ProtocolMemorySummary item, String text) async {
    if (!_contains(item) || text.trim().isEmpty) return false;
    // Core retains the existing layer/scope; correction is not a layer move.
    return _write('correct', {'item_id': item.itemId, 'text': text});
  }

  Future<bool> forget(ProtocolMemorySummary item) async {
    if (!_contains(item)) return false;
    return _write('forget', {'item_id': item.itemId});
  }

  Future<bool> _write(String operation, Map<String, dynamic> fields) async {
    if (!canWrite) return false;
    final generation = _generation;
    writing = true;
    feedback = 'Waiting for Core confirmation.';
    _notify();
    var confirmed = false;
    try {
      final reply = await core.request(
        'memory_request',
        ProtocolMemoryRequest.fromJson({
          'operation': operation,
          'agent_id': agentId,
          ...fields,
        }),
      );
      if (!_current(generation)) return false;
      if (const [
        'refused',
        'failed',
        'cancelled',
      ].contains(reply.effectState)) {
        feedback =
            'Core did not apply the change'
            '${reply.error == null ? '' : ' (${reply.error!.code})'}. '
            'Refresh and review your request.';
      } else if (reply.kind == 'memory_result' &&
          reply.error == null &&
          reply.effectState == 'applied') {
        final result = reply.typedPayload as ProtocolMemoryResult;
        confirmed =
            result.operation == operation &&
            result.itemId != null &&
            (operation != 'forget' || result.itemId == fields['item_id']);
      }
      if (confirmed) {
        feedback = switch (operation) {
          'forget' =>
            'Core confirmed forgetting. Conversation turns are retained.',
          'correct' => 'Core confirmed the correction.',
          _ => 'Core confirmed remembering.',
        };
      } else {
        if (feedback == 'Waiting for Core confirmation.') {
          feedback = 'Outcome unknown. Refresh before another action.';
        }
        items = const [];
        observed = false;
        next = null;
      }
    } on Object {
      if (!_current(generation)) return false;
      feedback = 'Outcome unknown. Refresh before another action.';
      items = const [];
      observed = false;
      next = null;
    } finally {
      if (_current(generation)) {
        writing = false;
        _notify();
      }
    }
    if (confirmed) await refresh();
    return confirmed;
  }

  @override
  void dispose() {
    _disposed = true;
    _generation = Object();
    unawaited(_changes.cancel());
    unawaited(_events.cancel());
    super.dispose();
  }
}
