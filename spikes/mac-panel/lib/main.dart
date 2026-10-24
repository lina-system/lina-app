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
    final startCapture =
        (_state['captureSequence'] as int? ?? -1) < 0 &&
        (value['captureSequence'] as int? ?? -1) >= 0;
    if (startCapture) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _call('measurementReady'),
      );
    }
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
    final captureSequence = _state['captureSequence'] as int? ?? -1;
    final capturing = captureSequence >= 0;
    final marker = [
      const Color(0xffeb2337),
      const Color(0xff19be46),
      const Color(0xff1e46eb),
      const Color(0xfff5c814),
    ];
    if (captureSequence.isOdd) marker.setAll(0, marker.reversed.toList());
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
        body: Stack(
          children: [
            Container(
              decoration: BoxDecoration(
                color: capturing
                    ? SpikeTokens.paper.withAlpha(255)
                    : SpikeTokens.paper,
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
                      readOnly: capturing,
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
                            DropdownMenuItem(
                              value: 0,
                              child: Text('Ctrl+Option+Space'),
                            ),
                            DropdownMenuItem(
                              value: 1,
                              child: Text('Cmd+Shift+Space'),
                            ),
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
                    if (capturing)
                      const SizedBox(height: 16)
                    else
                      Text(
                        'Research only · $_submissions submissions · No messages sent',
                      ),
                  ],
                ),
              ),
            ),
            if (capturing)
              Positioned(
                left: 24,
                bottom: 24,
                child: Row(
                  children: [
                    for (final color in marker)
                      ColoredBox(
                        color: color,
                        child: const SizedBox(width: 24, height: 16),
                      ),
                  ],
                ),
              ),
          ],
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
