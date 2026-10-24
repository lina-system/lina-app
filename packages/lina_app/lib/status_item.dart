// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:flutter/services.dart';
import 'package:lina_protocol/lina_protocol.dart';

const statusItemChannel = MethodChannel('org.lina.app/status-item/v1');

/// A local presentation boundary; the native host never connects to Core.
abstract interface class StatusItemHost {
  Future<void> update(ConnectionPhase phase, String? agentName);
}

class MacStatusItemHost implements StatusItemHost {
  const MacStatusItemHost();

  @override
  Future<void> update(ConnectionPhase phase, String? agentName) =>
      statusItemChannel.invokeMethod<void>('update', {
        'phase': phase.name,
        'agentName': agentName,
      });
}

/// Observes the conversation's connection, including EOF/error notifications.
/// No polling, retry, request or independent connection is introduced here.
class StatusItemBinding {
  StatusItemBinding({
    required this.connection,
    required this.host,
    required this.agentName,
  }) {
    _changes = connection.changes.listen((_) => publish());
    publish();
  }

  final CoreConnection connection;
  final StatusItemHost host;
  final String? Function() agentName;
  StreamSubscription<void>? _changes;

  void publish() => unawaited(host.update(connection.phase, agentName()));

  Future<void> dispose() async {
    await _changes?.cancel();
    _changes = null;
  }
}
