// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/services.dart';

class PanelBridge {
  static const channel = MethodChannel('org.lina.spike/mac_panel/v1');
  Future<Map<String, dynamic>> call(String method, [Object? arguments]) async =>
      Map<String, dynamic>.from(
        await channel.invokeMapMethod<String, dynamic>(method, arguments) ?? {},
      );
  void listen(void Function(Map<String, dynamic>) changed) {
    channel.setMethodCallHandler((call) async {
      if (call.method == 'stateChanged')
        changed(Map<String, dynamic>.from(call.arguments as Map));
    });
  }

  void dispose() => channel.setMethodCallHandler(null);
}
