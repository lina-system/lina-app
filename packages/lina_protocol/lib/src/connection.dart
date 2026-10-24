// SPDX-License-Identifier: Apache-2.0
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import '../generated/protocol.dart';
import 'receiver.dart';

enum ConnectionPhase { disconnected, connecting, connected, rejected }

class ConnectionLost implements Exception {
  const ConnectionLost();
  @override
  String toString() => 'Connection lost; outcome unknown. No automatic resend.';
}

/// Native stream transport. Core authenticates the socket or tailnet peer.
/// Holds only the current display snapshot and in-flight request correlations.
class CoreConnection {
  CoreConnection({
    required this.platform,
    this.onRequestWritten,
    this.timeout = const Duration(seconds: 5),
  });
  final String platform;

  /// Optional metadata-only request log, emitted at the actual transport write.
  /// Never includes payloads, expressions, identities or conversation content.
  final void Function(String kind)? onRequestWritten;
  final Duration timeout;
  static const maxFrameBytes = 1024 * 1024;
  static const productVersion = '0.1.0-dev';
  static const capabilities = [
    {'name': 'conversation', 'version': '1.0'},
    {
      'name': 'results',
      'version': '1.0',
      'types': [
        'summary',
        'table',
        'diagram',
        'chart',
        'document_draft',
        'comparison',
        'plan_view',
        'file',
      ],
      'catalogs': <String>[],
    },
  ];
  final _changes = StreamController<void>.broadcast(sync: true);
  Stream<void> get changes => _changes.stream;
  ConnectionPhase phase = ConnectionPhase.disconnected;
  String? refusalCode;
  ProtocolWelcome? welcome;
  String? lastEffect;
  final Map<String, ProtocolResult> _results = {};
  List<ProtocolResult> get results => List.unmodifiable(_results.values);
  final Map<String, Completer<Envelope>> _pending = {};
  Socket? _socket;
  StreamSubscription<List<int>>? _subscription;
  Timer? _deadline;
  Completer<void>? _opening;
  String? _helloId;
  String _clientId = '';
  int _generation = 0;
  bool _disposed = false;
  ProtocolReceiver _receiver = ProtocolReceiver();
  final List<int> _buffer = [];
  int get malformedFrames => _receiver.malformed;
  int get unknownKinds => _receiver.unknownKinds;
  bool hasCapability(String name) =>
      welcome?.capabilities.any((c) => c.name == name && c.version == '1.0') ??
      false;
  String _id() => List.generate(
    16,
    (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
  void _notify() {
    if (!_disposed) _changes.add(null);
  }

  Future<void> connect(String endpoint) async {
    if (_disposed) throw StateError('disposed');
    disconnect();
    final generation = ++_generation;
    phase = ConnectionPhase.connecting;
    refusalCode = null;
    welcome = null;
    lastEffect = null;
    _results.clear();
    _clientId = _id();
    _receiver = ProtocolReceiver();
    final opening = Completer<void>();
    _opening = opening;
    _deadline = Timer(timeout, () {
      if (generation == _generation) _end();
    });
    _notify();
    try {
      final uri = Uri.parse(endpoint);
      final Socket socket;
      if (uri.scheme == 'unix' && uri.path.isNotEmpty && uri.host.isEmpty) {
        socket = await Socket.connect(
          InternetAddress(uri.path, type: InternetAddressType.unix),
          0,
          timeout: timeout,
        );
      } else if (uri.scheme == 'tcp' &&
          uri.host.isNotEmpty &&
          uri.hasPort &&
          uri.userInfo.isEmpty &&
          (uri.path.isEmpty || uri.path == '/')) {
        socket = await Socket.connect(uri.host, uri.port, timeout: timeout);
      } else {
        throw const FormatException(
          'Use unix:///path or tcp://tailnet-host:port',
        );
      }
      if (generation != _generation || phase != ConnectionPhase.connecting) {
        socket.destroy();
        return;
      }
      _socket = socket;
      _subscription = socket.listen(
        (bytes) => _receive(bytes, generation),
        onError: (Object e) => _endGeneration(generation),
        onDone: () => _endGeneration(generation),
      );
      final hello = _envelope(
        'hello',
        ProtocolHello.fromJson({
          'party': 'client',
          'id': _clientId,
          'product_version': productVersion,
          'protocol_versions': ['1.0'],
          'capabilities': capabilities,
          'peer': 'lina-app',
          'platform': platform,
        }).toJson(),
      );
      _helloId = hello.messageId;
      _write(hello);
    } catch (_) {
      if (generation == _generation) _end();
    }
    await opening.future;
  }

  Envelope _envelope(
    String kind,
    Map<String, dynamic> payload, {
    String? idempotencyKey,
  }) => Envelope.fromJson({
    'protocol': {'name': 'client', 'version': '1.0'},
    'kind': kind,
    'message_id': _id(),
    'attempt_id': _id(),
    'reply_to': null,
    'sender': {'party': 'client', 'id': _clientId},
    'epoch': welcome?.epoch ?? '0',
    'sent_at': DateTime.now().toUtc().toIso8601String(),
    'idempotency_key': idempotencyKey,
    'effect_state': 'none',
    'receipt_ref': null,
    'source_refs': <Object?>[],
    'error': null,
    'payload': payload,
  });
  void _write(Envelope envelope) {
    final frame = utf8.encode(
      '${exactEncode({'jsonrpc': '2.0', 'id': envelope.messageId, 'method': envelope.kind, 'params': envelope.toJson()})}\n',
    );
    if (frame.length > maxFrameBytes)
      throw const FormatException('frame too large');
    _socket!.add(frame);
    onRequestWritten?.call(envelope.kind);
  }

  Future<Envelope> request(
    String kind,
    ProtocolObject payload, {
    String? idempotencyKey,
  }) async {
    if (phase != ConnectionPhase.connected) throw const ConnectionLost();
    final envelope = _envelope(
      kind,
      payload.toJson(),
      idempotencyKey: idempotencyKey,
    );
    final completer = Completer<Envelope>();
    _pending[envelope.messageId] = completer;
    try {
      _write(envelope);
      return await completer.future.timeout(
        timeout,
        onTimeout: () {
          _end();
          throw const ConnectionLost();
        },
      );
    } catch (_) {
      _pending.remove(envelope.messageId);
      rethrow;
    }
  }

  void _receive(List<int> bytes, int generation) {
    if (generation != _generation) return;
    for (final byte in bytes) {
      if (byte == 10) {
        final frame = List<int>.of(_buffer);
        _buffer.clear();
        try {
          _frame(utf8.decode(frame));
        } on FormatException {
          _end();
          return;
        }
        if (generation != _generation) return;
      } else {
        _buffer.add(byte);
        if (_buffer.length >= maxFrameBytes) {
          _end();
          return;
        }
      }
    }
  }

  void _frame(String text) {
    final rpc = exactDecode(text);
    if (rpc is! Map<String, dynamic> ||
        rpc['jsonrpc'] != '2.0' ||
        rpc.containsKey('error'))
      throw const FormatException('invalid RPC frame');
    final response = rpc.containsKey('result');
    if (response
        ? (rpc.containsKey('params') ||
              rpc.containsKey('method') ||
              rpc['id'] is! String)
        : (rpc.containsKey('id') ||
              rpc['method'] is! String ||
              !rpc.containsKey('params')))
      throw const FormatException('invalid RPC shape');
    Envelope? envelope;
    try {
      envelope = _receiver.receive(
        exactEncode(rpc[response ? 'result' : 'params']),
      );
    } on FormatException {
      if (phase == ConnectionPhase.connecting) rethrow;
      _notify();
      return;
    }
    if (envelope == null) {
      _notify();
      return;
    }
    if (!response && rpc['method'] != envelope.kind)
      throw const FormatException('notification kind mismatch');
    if (envelope.sender.party != 'core' || envelope.protocol.version != '1.0')
      throw const FormatException('invalid Core sender/version');
    if (phase == ConnectionPhase.connecting) {
      if (!response || rpc['id'] != _helloId || envelope.replyTo != _helloId)
        throw const FormatException('uncorrelated hello');
      if (envelope.kind == 'error' &&
          envelope.effectState == 'refused' &&
          envelope.error != null) {
        refusalCode = envelope.error!.code;
        _end(rejected: true);
        return;
      }
      if (envelope.kind != 'welcome' ||
          envelope.error != null ||
          envelope.effectState != 'none')
        throw const FormatException('expected welcome');
      final selected = envelope.typedPayload as ProtocolWelcome;
      if (selected.protocolVersion != '1.0' ||
          selected.mainId.isEmpty ||
          selected.personId.isEmpty ||
          selected.mainId != envelope.sender.id ||
          selected.epoch != envelope.epoch)
        throw const FormatException('invalid welcome identity');
      final names = <String>{};
      for (final capability in selected.capabilities) {
        if (!names.add(capability.name))
          throw const FormatException('duplicate capability');
        final offered = capabilities.where(
          (c) =>
              c['name'] == capability.name &&
              c['version'] == capability.version,
        );
        if (offered.isEmpty)
          throw const FormatException('unoffered capability');
        for (final field in ['types', 'catalogs']) {
          if ((capability.json[field] as List? ?? []).any(
            (v) => !(offered.single[field] as List? ?? []).contains(v),
          ))
            throw const FormatException('unoffered capability values');
        }
      }
      welcome = selected;
      phase = ConnectionPhase.connected;
      _deadline?.cancel();
      _opening?.complete();
      _opening = null;
      _notify();
      return;
    }
    if (phase != ConnectionPhase.connected ||
        envelope.sender.id != welcome!.mainId ||
        envelope.epoch != welcome!.epoch)
      throw const FormatException('stale Core identity');
    Completer<Envelope>? pending;
    if (response) {
      if (rpc['id'] != envelope.replyTo)
        throw const FormatException('uncorrelated response');
      pending = _pending.remove(rpc['id']);
      if (pending == null)
        return; // duplicate or obsolete response cannot change display
    } else if (envelope.replyTo != null) {
      throw const FormatException('notification has reply_to');
    }
    lastEffect = envelope.effectState;
    if (envelope.kind == 'result' &&
        envelope.effectState != 'refused' &&
        envelope.effectState != 'failed' &&
        envelope.error == null) {
      final result = envelope.typedPayload as ProtocolResult;
      final prior = _results[result.resultId];
      if (prior == null || result.revision.compareTo(prior.revision) >= 0)
        _results[result.resultId] = result;
    }
    pending?.complete(envelope);
    _notify();
  }

  void _endGeneration(int generation) {
    if (generation == _generation) _end();
  }

  void _end({bool rejected = false}) {
    ++_generation;
    _deadline?.cancel();
    _deadline = null;
    _socket?.destroy();
    _socket = null;
    _subscription?.cancel();
    _subscription = null;
    _buffer.clear();
    _opening?.complete();
    _opening = null;
    final uncertain = _pending.isNotEmpty;
    for (final pending in _pending.values) {
      pending.completeError(const ConnectionLost());
    }
    _pending.clear();
    if (rejected) {
      phase = ConnectionPhase.rejected;
    } else if (phase != ConnectionPhase.rejected) {
      phase = ConnectionPhase.disconnected;
    }
    if (uncertain) lastEffect = 'unknown';
    _notify();
  }

  void disconnect() => _end();
  Future<void> dispose() async {
    disconnect();
    _disposed = true;
    await _changes.close();
  }
}
