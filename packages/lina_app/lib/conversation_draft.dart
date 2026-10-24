// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:flutter/services.dart';

/// Local draft delivery, never a Core request or an implicit send action.
abstract interface class ConversationDraftHost {
  void attach(bool Function(String) append);
  void detach();
}

class MacConversationDraftHost implements ConversationDraftHost {
  const MacConversationDraftHost();
  static const channel = MethodChannel('org.lina.app/launcher/v1');

  @override
  void attach(bool Function(String) append) {
    channel.setMethodCallHandler((call) async {
      if (call.method != 'appendDraft') {
        throw MissingPluginException('Unknown conversation draft event');
      }
      final arguments = call.arguments;
      if (arguments is! Map || arguments['text'] is! String) return false;
      final text = arguments['text'] as String;
      return text.isNotEmpty && append(text);
    });
    // Native waits for this handshake before delivering to a prewarmed engine.
    unawaited(channel.invokeMethod<void>('draftReady'));
  }

  @override
  void detach() => channel.setMethodCallHandler(null);
}
