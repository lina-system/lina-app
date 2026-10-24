// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';

import 'composer.dart';
import 'panel_bridge.dart';
import 'spike_tokens.dart';

void main() => runApp(PanelApp());

class PanelApp extends StatefulWidget {
  PanelApp({super.key, PanelBridge? bridge}) : bridge = bridge ?? PanelBridge();
  final PanelBridge bridge;
  @override
  State<PanelApp> createState() => _PanelAppState();
}

class _PanelAppState extends State<PanelApp> {
  Map<String, dynamic> _state = {};
  String? _error;
  int _submissions = 0;
  int _preset = 0;
  @override
  void initState() {
    super.initState();
    widget.bridge.listen(_update);
    WidgetsBinding.instance.addPostFrameCallback((_) => _call('ready'));
  }

  void _update(Map<String, dynamic> value) {
    if (mounted)
      setState(() {
        _state = value;
        final shortcut = value['shortcut'] as Map?;
        final modifiers = (shortcut?['modifiers'] as List?) ?? [];
        _preset = modifiers.contains('command') ? 1 : 0;
      });
  }

  Future<void> _call(String method, [Object? args]) async {
    try {
      _update(await widget.bridge.call(method, args));
      if (mounted) setState(() => _error = null);
    } catch (_) {
      if (mounted)
        setState(
          () => _error =
              'Could not update the panel. The previous setting is kept.',
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = List<String>.from(_state['history'] as List? ?? []);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: SpikeTokens.accent,
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: Colors.transparent,
        textTheme: const TextTheme(
          bodyMedium: TextStyle(
            fontSize: SpikeTokens.bodySize,
            color: SpikeTokens.ink,
          ),
        ),
      ),
      home: Scaffold(
        body: Container(
          decoration: BoxDecoration(
            color: SpikeTokens.paper,
            borderRadius: BorderRadius.circular(SpikeTokens.radius),
          ),
          padding: const EdgeInsets.all(SpikeTokens.inset),
          child: Material(
            type: MaterialType.transparency,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'lina.  Panel study',
                        style: TextStyle(
                          fontSize: SpikeTokens.titleSize,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: () => _call('hide'),
                      child: const Text('Close · Esc'),
                    ),
                  ],
                ),
                const SizedBox(height: SpikeTokens.gap),
                PanelComposer(
                  onSubmit: (_) => setState(() => _submissions++),
                  onDismiss: () => _call('hide'),
                ),
                const SizedBox(height: SpikeTokens.gap),
                Row(
                  children: [
                    const Text('Open panel  '),
                    DropdownButton<int>(
                      value: _preset,
                      items: const [
                        DropdownMenuItem(value: 0, child: Text('Ctrl+Option+Space')),
                        DropdownMenuItem(value: 1, child: Text('Cmd+Shift+Space')),
                      ],
                      onChanged: (value) => _call('configureShortcut', {
                        'keyCode': 49,
                        'modifiers': value == 0
                            ? ['control', 'option']
                            : ['command', 'shift'],
                      }),
                    ),
                  ],
                ),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Clipboard history'),
                  subtitle: const Text(
                    'On this Mac, in memory. Turning off clears it.',
                  ),
                  value: _state['clipboardEnabled'] == true,
                  onChanged: (value) =>
                      _call('setClipboardEnabled', {'enabled': value}),
                ),
                if (_error != null) Text(_error!),
                Expanded(
                  child: items.isEmpty
                      ? const Align(
                          alignment: Alignment.centerLeft,
                          child: Text('No clipboard items'),
                        )
                      : ListView(
                          children: [
                            for (final text in items)
                              ListTile(
                                dense: true,
                                title: Text(
                                  text,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                        ),
                ),
                Text(
                  'Research only · $_submissions submissions · No messages sent',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    widget.bridge.dispose();
    super.dispose();
  }
}
