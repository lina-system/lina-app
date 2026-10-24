// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lina_design/lina_design.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'platform_slots.dart';
import 'preferences.dart';

class CoreScreen extends StatefulWidget {
  const CoreScreen({
    super.key,
    required this.connection,
    required this.preferences,
    this.endpoint = '',
    this.slots = const PlatformSlots(),
  });
  final CoreConnection connection;
  final DisplayPreferences preferences;
  final String endpoint;
  final PlatformSlots slots;
  @override
  State<CoreScreen> createState() => _CoreScreenState();
}

class _CoreScreenState extends State<CoreScreen> {
  final _draft = TextEditingController();
  final _endpoint = TextEditingController();
  final _focus = FocusNode();
  String? _agent;
  String? _feedback;
  bool _sending = false;
  bool _compositionEnding = false;
  bool _wasComposing = false;
  @override
  void initState() {
    super.initState();
    _endpoint.text = widget.endpoint;
    _draft.addListener(_compositionChanged);
  }

  void _compositionChanged() {
    final composing =
        _draft.value.composing.isValid && !_draft.value.composing.isCollapsed;
    if (_wasComposing && !composing) {
      _compositionEnding = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _compositionEnding = false;
      });
      WidgetsBinding.instance.scheduleFrame();
    }
    _wasComposing = composing;
  }

  @override
  void dispose() {
    _draft.dispose();
    _endpoint.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_sending ||
        _wasComposing ||
        _compositionEnding ||
        _draft.text.isEmpty ||
        _agent == null ||
        !widget.connection.hasCapability('conversation') ||
        widget.connection.phase != ConnectionPhase.connected)
      return;
    final text = _draft.text;
    setState(() {
      _sending = true;
      _feedback = 'Waiting for Core';
    });
    try {
      final history = await widget.connection.request(
        'conversation_start',
        ProtocolConversationStart.fromJson({'agent_id': _agent}),
      );
      if (history.kind != 'history' || history.error != null) {
        if (mounted) setState(() => _feedback = history.error?.code ?? '모름');
        return;
      }
      final conversation =
          (history.typedPayload as ProtocolHistory).conversationId;
      if (conversation == null) {
        if (mounted) setState(() => _feedback = '모름');
        return;
      }
      final response = await widget.connection.request(
        'input',
        ProtocolInput.fromJson({
          'conversation_id': conversation,
          'input_id': history.messageId,
          'text': text,
          'mode': 'steer',
        }),
      );
      if (!mounted) return;
      setState(() {
        final confirmed =
            response.kind == 'item_done' &&
            response.effectState == 'applied' &&
            response.error == null;
        _feedback = confirmed
            ? 'Received by Core'
            : response.error?.code ??
                  (response.effectState == 'unknown'
                      ? '모름'
                      : response.effectState);
        // A composing or subsequently edited draft must never be overwritten.
        if (confirmed && !_wasComposing && _draft.text == text) _draft.clear();
      });
    } on ConnectionLost {
      if (mounted)
        setState(
          () => _feedback =
              '모름 · Connection lost. Check Core before sending again.',
        );
    } on FormatException {
      if (mounted)
        setState(
          () => _feedback =
              'This message could not be sent. Your draft is still here.',
        );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => StreamBuilder<void>(
    stream: widget.connection.changes,
    builder: (context, _) {
      final c = widget.connection;
      final t = LinaTokens.of(context);
      final (status, label) = switch (c.phase) {
        ConnectionPhase.connected => (LinaStatus.success, 'Connected to Core'),
        ConnectionPhase.connecting => (
          LinaStatus.working,
          'Connecting to Core',
        ),
        ConnectionPhase.rejected => (LinaStatus.error, 'Connection rejected'),
        ConnectionPhase.disconnected => (LinaStatus.unknown, 'Disconnected'),
      };
      final agents = c.welcome?.agents ?? <ProtocolAgent>[];
      final selected = agents.any((a) => a.agentId == _agent) ? _agent : null;
      return Scaffold(
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: t.layoutReadingWidth),
              child: ListView(
                padding: EdgeInsets.all(t.spaceGutter),
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      LinaText(
                        'lina.',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      TextButton(
                        onPressed: _settings,
                        child: const LinaText('Appearance'),
                      ),
                    ],
                  ),
                  SizedBox(height: t.spaceSection),
                  LinaText(
                    'A place to begin',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  SizedBox(height: t.spaceInline),
                  const LinaText(
                    'Your conversations and results, confirmed by Core.',
                  ),
                  SizedBox(height: t.spaceSection),
                  _panel(context, [
                    Semantics(
                      liveRegion: true,
                      child: StatusLabel(status: status, label: label),
                    ),
                    SizedBox(height: t.spaceInline),
                    LinaText(switch (c.phase) {
                      ConnectionPhase.connected =>
                        'You can ask Core. Its answers appear here.',
                      ConnectionPhase.connecting =>
                        'Waiting for Core to confirm this connection.',
                      ConnectionPhase.rejected => 'This app and Core cannot connect with their current versions or platform.',
                      ConnectionPhase.disconnected => 'Connect to your Core to continue. Your draft stays here.',
                    }),
                    if (c.refusalCode != null) LinaText(c.refusalCode!),
                    SizedBox(height: t.spaceGutter),
                    TextField(
                      controller: _endpoint,
                      decoration: const InputDecoration(
                        labelText: 'Core address',
                        hintText: 'unix:///path/to/core.sock or tcp://tailnet-host:port',
                      ),
                      autocorrect: false,
                      enableSuggestions: false,
                    ),
                    SizedBox(height: t.spaceInline),
                    Wrap(
                      spacing: t.spaceInline,
                      runSpacing: t.spaceCompact,
                      children: [
                        TextButton(
                          onPressed: c.phase == ConnectionPhase.connecting
                              ? null
                              : () {
                                  setState(() => _feedback = null);
                                  unawaited(c.connect(_endpoint.text));
                                },
                          child: LinaText(
                            c.phase == ConnectionPhase.connected
                                ? 'Reconnect'
                                : 'Connect',
                          ),
                        ),
                        if (c.phase == ConnectionPhase.connected ||
                            c.phase == ConnectionPhase.connecting)
                          TextButton(
                            onPressed: c.disconnect,
                            child: const LinaText('Disconnect'),
                          ),
                      ],
                    ),
                  ]),
                  SizedBox(height: t.spaceSection),
                  LinaText(
                    'Conversation',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  SizedBox(height: t.spaceGutter),
                  if (agents.isNotEmpty)
                    DropdownButtonFormField<String>(
                      key: ValueKey(c.welcome),
                      initialValue: selected,
                      isExpanded: true,
                      icon: LinaText(
                        LinaTokens.of(context).glyphUnicodeOverflow,
                      ),
                      decoration: const InputDecoration(labelText: 'Talk with'),
                      items: [
                        for (final agent in agents)
                          DropdownMenuItem(
                            value: agent.agentId,
                            child: LinaText(agent.name),
                          ),
                      ],
                      onChanged: _sending
                          ? null
                          : (value) => setState(() => _agent = value),
                    ),
                  SizedBox(height: t.spaceInline),
                  widget.slots.composer?.call(
                        context,
                        _draft,
                        _focus,
                        () => unawaited(_send()),
                        t,
                      ) ??
                      TextField(
                        key: const ValueKey('composer'),
                        controller: _draft,
                        focusNode: _focus,
                        keyboardType: TextInputType.multiline,
                        maxLines: null,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => unawaited(_send()),
                        decoration: const InputDecoration(
                          labelText: 'What is on your mind?',
                          hintText: '한국어로 편하게 적어 보세요.',
                        ),
                      ),
                  SizedBox(height: t.spaceInline),
                  Row(
                    children: [
                      TextButton(
                        onPressed:
                            _sending ||
                                selected == null ||
                                c.phase != ConnectionPhase.connected ||
                                !c.hasCapability('conversation')
                            ? null
                            : () => unawaited(_send()),
                        child: LinaText(_sending ? 'Waiting for Core' : 'Send'),
                      ),
                      SizedBox(width: t.spaceInline),
                      Expanded(
                        child: LinaText(
                          _feedback ?? 'A draft until Core confirms receipt.',
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: t.spaceSection),
                  LinaText(
                    'From Core',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  SizedBox(height: t.spaceGutter),
                  if (c.lastEffect == 'unknown')
                    const StatusLabel(status: LinaStatus.unknown, label: '모름'),
                  if (c.results.isEmpty)
                    const LinaText(
                      'Results will appear here when Core sends them.',
                    ),
                  for (final result in c.results)
                    Padding(
                      padding: EdgeInsets.only(bottom: t.spaceGutter),
                      child: _panel(context, [
                        StatusLabel(
                          status: result.status == 'saved'
                              ? LinaStatus.success
                              : LinaStatus.waiting,
                          label: result.status == 'saved'
                              ? 'Saved by Core'
                              : 'Preview · Not saved',
                        ),
                        SizedBox(height: t.spaceInline),
                        LinaText(
                          result.title,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        LinaText(result.summary),
                        if (result.completion != null)
                          LinaText(result.completion!.label),
                      ]),
                    ),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
  Widget _panel(BuildContext context, List<Widget> children) {
    final t = LinaTokens.of(context);
    return Container(
      padding: EdgeInsets.all(t.spaceGutter),
      decoration: ShapeDecoration(
        color: t.colorSurface,
        shape: ContinuousRectangleBorder(
          borderRadius: BorderRadius.circular(t.radiusCard),
          side: BorderSide(color: t.colorLine, width: t.borderWidth),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    );
  }

  Future<void> _settings() => showDialog<void>(
    context: context,
    builder: (context) => ListenableBuilder(
      listenable: widget.preferences,
      builder: (context, _) {
        final p = widget.preferences;
        return AlertDialog(
          title: const LinaText('Appearance'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButton<ThemeMode>(
                  value: p.themeMode,
                  isExpanded: true,
                  icon: LinaText(LinaTokens.of(context).glyphUnicodeOverflow),
                  items: [
                    for (final mode in ThemeMode.values)
                      DropdownMenuItem(
                        value: mode,
                        child: LinaText(switch (mode) {
                          ThemeMode.system => 'System theme',
                          ThemeMode.light => 'Light',
                          ThemeMode.dark => 'Dark',
                        }),
                      ),
                  ],
                  onChanged: (v) => p.update(theme: v),
                ),
                SwitchListTile(
                  title: const LinaText('High contrast'),
                  value: p.highContrast,
                  onChanged: (v) => p.update(contrast: v),
                ),
                SwitchListTile(
                  title: const LinaText('Reduce motion'),
                  value: p.reducedMotion,
                  onChanged: (v) => p.update(motion: v),
                ),
                SwitchListTile(
                  title: const LinaText('Larger text'),
                  value: p.largeText,
                  onChanged: (v) => p.update(text: v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const LinaText('Done'),
            ),
          ],
        );
      },
    ),
  );
}
