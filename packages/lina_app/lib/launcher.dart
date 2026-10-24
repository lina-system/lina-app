// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lina_design/lina_design.dart';

import 'lina_app.dart';
import 'platform_slots.dart';

/// Local presentation channel, independent of the Core wire protocol.
const launcherChannel = MethodChannel('org.lina.app/launcher/v1');

class MacLauncherHost implements LauncherHost {
  const MacLauncherHost();
  @override
  Future<void> show(LinaTokens tokens) async {
    // Both hosts compile the same pinned DTCG; colors never cross the channel.
    await launcherChannel.invokeMethod<void>('show');
  }

  @override
  Future<void> close() async => launcherChannel.invokeMethod<void>('hide');
}

class LauncherAnswer extends StatefulWidget {
  const LauncherAnswer({super.key, this.channel = launcherChannel});
  final MethodChannel channel;
  @override
  State<LauncherAnswer> createState() => _LauncherAnswerState();
}

class _LauncherAnswerState extends State<LauncherAnswer> {
  String _message = 'Open LINA to continue a conversation.';
  @override
  void initState() {
    super.initState();
    widget.channel.setMethodCallHandler(_handle);
  }

  Future<void> _handle(MethodCall call) async {
    switch (call.method) {
      case 'queryChanged':
        // Search providers and the launcher capability are separate work.
        // Do not echo, log or send the draft to Core from this host boundary.
        break;
      case 'submit':
        if (mounted) {
          setState(() {
            _message =
                'Search is not connected yet. Open LINA to talk to an agent.';
          });
        }
        break;
      case 'stateChanged':
        break;
      default:
        throw MissingPluginException('Unknown launcher presentation event');
    }
  }

  @override
  void dispose() {
    widget.channel.setMethodCallHandler(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = LinaTokens.of(context);
    return Material(
      color: t.colorCanvas,
      child: Padding(
        padding: EdgeInsets.all(t.spaceInline),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            LinaText(
              'Agent replies',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            SizedBox(height: t.spaceInline),
            Expanded(child: SingleChildScrollView(child: LinaText(_message))),
          ],
        ),
      ),
    );
  }
}

void runLauncher() {
  final binding = WidgetsFlutterBinding.ensureInitialized();
  runApp(const LinaApp(home: LauncherAnswer()));
  // Native starts the hidden engine explicitly. Readiness means rasterized,
  // not merely scheduled: the first user-open never exposes an empty Flutter view.
  unawaited(
    binding.waitUntilFirstFrameRasterized.then(
      (_) => launcherChannel.invokeMethod<void>('ready'),
    ),
  );
}
