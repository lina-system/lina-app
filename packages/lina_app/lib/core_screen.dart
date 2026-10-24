// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lina_design/lina_design.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'agent_mark.dart';
import 'agents_panel.dart';
import 'conversation_controller.dart';
import 'platform_slots.dart';
import 'preferences.dart';
import 'status_item.dart';

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
  late final ConversationController _conversation;
  final _endpoint = TextEditingController();
  final _scaffold = GlobalKey<ScaffoldState>();
  bool _fullDocument = false;
  StatusItemBinding? _statusItem;
  String? _statusAgentName;
  @override
  void initState() {
    super.initState();
    _endpoint.text = widget.endpoint;
    _conversation = ConversationController(widget.connection);
    final statusHost = widget.slots.statusItem;
    if (statusHost != null) {
      _statusItem = StatusItemBinding(
        connection: widget.connection,
        host: statusHost,
        agentName: () => _selectedAgentName,
      );
      _statusAgentName = _selectedAgentName;
      _conversation.addListener(_publishSelectedAgent);
    }
  }

  String? get _selectedAgentName =>
      _conversation.selectionAvailable ? _conversation.selectedName : null;

  void _publishSelectedAgent() {
    final name = _selectedAgentName;
    if (name == _statusAgentName) return;
    _statusAgentName = name;
    _statusItem?.publish();
  }

  @override
  void dispose() {
    _conversation.removeListener(_publishSelectedAgent);
    _statusItem?.dispose();
    _conversation.dispose();
    _endpoint.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _conversation,
    builder: (context, _) {
      final t = LinaTokens.of(context);
      final desktop = MediaQuery.sizeOf(context).width >= t.layoutDesktopWidth;
      final state = _conversation.selected;
      final document = state.document;
      return CallbackShortcuts(
        bindings: {
          const SingleActivator(LogicalKeyboardKey.arrowLeft, alt: true):
              _conversation.back,
          const SingleActivator(LogicalKeyboardKey.arrowRight, alt: true):
              _conversation.forward,
          const SingleActivator(LogicalKeyboardKey.keyF, meta: true):
              _conversation.toggleSearch,
          const SingleActivator(LogicalKeyboardKey.keyF, control: true):
              _conversation.toggleSearch,
        },
        child: Scaffold(
          key: _scaffold,
          drawer: desktop
              ? null
              : Drawer(child: SafeArea(child: _navigation())),
          endDrawer: desktop || document == null
              ? null
              : Drawer(
                  width: MediaQuery.sizeOf(context).width,
                  child: SafeArea(child: _document(document)),
                ),
          body: SafeArea(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (desktop && document == null)
                  SizedBox(width: t.layoutSidebarWidth, child: _navigation()),
                if (!_fullDocument || document == null || !desktop)
                  Expanded(
                    child: Column(
                      children: [
                        _header(desktop),
                        _connectionStatus(),
                        Expanded(
                          child: _conversation.page == 'Home'
                              ? _transcript()
                              : _section(),
                        ),
                        _composer(),
                      ],
                    ),
                  ),
                if (desktop && document != null)
                  Expanded(
                    child: Column(
                      children: [
                        Expanded(child: _document(document)),
                        if (_fullDocument) _composer(),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      );
    },
  );
  Widget _navigation() {
    final t = LinaTokens.of(context);
    return Container(
      color: t.colorSurface,
      child: ListView(
        padding: EdgeInsets.all(t.spaceGutter),
        children: [
          LinaText('lina.', style: Theme.of(context).textTheme.titleLarge),
          SizedBox(height: t.spaceSection),
          for (final name in [
            'Home',
            'Agents',
            'Goals',
            'Map',
            'Library',
            'Memos',
          ])
            Padding(
              padding: EdgeInsets.only(bottom: t.spaceInline),
              child: Semantics(
                selected: _conversation.page == name,
                child: TextButton(
                  onPressed: () {
                    _conversation.navigate(name);
                    _scaffold.currentState?.closeDrawer();
                  },
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: LinaText(name),
                  ),
                ),
              ),
            ),
          SizedBox(height: t.spaceSection),
          TextButton(onPressed: _settings, child: const LinaText('Appearance')),
          SizedBox(height: t.spaceInline),
          TextButton(
            onPressed: _connectionSettings,
            child: const LinaText('Connection'),
          ),
        ],
      ),
    );
  }

  Widget _header(bool desktop) {
    final t = LinaTokens.of(context);
    return Padding(
      padding: EdgeInsets.all(t.spaceInline),
      child: Row(
        children: [
          if (!desktop)
            TextButton(
              onPressed: () => _scaffold.currentState?.openDrawer(),
              child: const LinaText('Menu'),
            ),
          if (desktop) ...[
            TextButton(
              onPressed: _conversation.canBack ? _conversation.back : null,
              child: const LinaText('Back'),
            ),
            SizedBox(width: t.spaceInline),
            TextButton(
              onPressed: _conversation.canForward
                  ? _conversation.forward
                  : null,
              child: const LinaText('Forward'),
            ),
          ],
          SizedBox(width: t.spaceInline),
          const AgentMark(),
          SizedBox(width: t.spaceInline),
          Expanded(
            child:
                _conversation.agents.isNotEmpty &&
                    _conversation.agents.first == _conversation.agents.last &&
                    _conversation.selectionAvailable
                ? LinaText(
                    _conversation.selectedName,
                    style: Theme.of(context).textTheme.titleMedium,
                  )
                : DropdownButtonFormField<String>(
                    key: ValueKey((
                      _conversation.selectedId,
                      _conversation.selectionVersion,
                      widget.connection.welcome,
                      _conversation.agentOperation,
                      _conversation.agents,
                      _conversation.agentsUncertain,
                    )),
                    initialValue: _conversation.selectionAvailable
                        ? _conversation.selectedId
                        : null,
                    isExpanded: true,
                    icon: LinaText(t.glyphUnicodeOverflow),
                    decoration: const InputDecoration(labelText: 'Talk with'),
                    items: [
                      for (final agent in _conversation.agents)
                        DropdownMenuItem(
                          value: agent.agentId,
                          child: LinaText(agent.name),
                        ),
                    ],
                    onChanged: _conversation.canChooseAgent
                        ? (id) {
                            if (id != null) unawaited(_conversation.choose(id));
                          }
                        : null,
                  ),
          ),
          SizedBox(width: t.spaceInline),
          TextButton(
            onPressed: _conversation.toggleSearch,
            child: const LinaText('Find'),
          ),
        ],
      ),
    );
  }

  Widget _connectionStatus() {
    final core = widget.connection;
    final t = LinaTokens.of(context);
    final (status, label) = switch (core.phase) {
      ConnectionPhase.connected => (LinaStatus.success, 'Connected to Core'),
      ConnectionPhase.connecting => (LinaStatus.working, 'Connecting to Core'),
      ConnectionPhase.rejected => (LinaStatus.error, 'Connection rejected'),
      ConnectionPhase.disconnected => (LinaStatus.unknown, 'Disconnected'),
    };
    return Padding(
      padding: EdgeInsets.symmetric(
        horizontal: t.spaceGutter,
        vertical: t.spaceInline,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Semantics(
                  liveRegion: true,
                  child: StatusLabel(status: status, label: label),
                ),
              ),
              if (core.phase != ConnectionPhase.connected)
                TextButton(
                  onPressed: _connectionSettings,
                  child: const LinaText('Connect'),
                ),
            ],
          ),
          if (_connectionProblem != null)
            Semantics(
              liveRegion: true,
              child: StatusLabel(
                status: LinaStatus.error,
                label: _connectionProblem!,
              ),
            ),
        ],
      ),
    );
  }

  Widget _transcript() {
    final t = LinaTokens.of(context);
    final state = _conversation.selected;
    final query = state.search.text.toLowerCase();
    return Column(
      key: ValueKey(state.agentId),
      children: [
        if (state.showSearch)
          Padding(
            padding: EdgeInsets.all(t.spaceInline),
            child: TextField(
              controller: state.search,
              decoration: const InputDecoration(
                labelText: 'Find in this conversation',
              ),
            ),
          ),
        Expanded(
          child: ListView(
            key: PageStorageKey('conversation:${state.agentId}'),
            controller: state.scroll,
            padding: EdgeInsets.all(t.spaceGutter),
            children: [
              if (query.isEmpty) _home(),
              for (final item in state.items)
                if (const [
                      'item_done',
                      'output_delta',
                      'result',
                      'question',
                      'approval_request',
                    ].contains(item.kind) &&
                    (query.isEmpty ||
                        exactEncode(item.payload)
                            .toLowerCase()
                            .contains(query)))
                  Padding(
                    padding: EdgeInsets.only(top: t.spaceSection),
                    child: _item(item),
                  ),
              if (state.items.isEmpty)
                Padding(
                  padding: EdgeInsets.symmetric(vertical: t.spaceSection),
                  child: LinaText(
                    _conversation.selectionAvailable
                        ? 'What would you like to work on?'
                        : 'Choose an available agent to continue. Your draft stays here.',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _home() {
    final t = LinaTokens.of(context);
    final progress = _conversation.progress;
    final waiting = progress?.waiting;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _panel([
          StatusLabel(status: LinaStatus.waiting, label: '나를 기다리는 것'),
          SizedBox(height: t.spaceInline),
          if (waiting == null)
            const LinaText('모름 · Waiting for an update from Core.')
          else if (waiting.isEmpty)
            const LinaText('Nothing to decide now.')
          else
            for (final row in waiting)
              Padding(
                padding: EdgeInsets.only(top: t.spaceInline),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const AgentMark(),
                        SizedBox(width: t.spaceInline),
                        Expanded(child: LinaText(row.line.agentName)),
                      ],
                    ),
                    LinaText(row.line.sentence),
                    if (row.line.context.isNotEmpty) LinaText(row.line.context),
                    if (row.line.recommendation.isNotEmpty)
                      LinaText(row.line.recommendation),
                  ],
                ),
              ),
          if (progress?.waitingMore != null &&
              progress!.waitingMore!.toString() != '0')
            LinaText('+${progress.waitingMore} more'),
        ]),
        SizedBox(height: t.spaceInline),
        _panel([
          LinaText('오늘', style: Theme.of(context).textTheme.titleMedium),
          SizedBox(height: t.spaceInline),
          const LinaText('모름 · Today’s list is not available yet.'),
        ]),
        if (progress?.rows != null) ...[
          SizedBox(height: t.spaceInline),
          _panel([
            LinaText(
              'At a glance',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            for (final row in progress!.rows!)
              Padding(
                padding: EdgeInsets.only(top: t.spaceInline),
                child: LinaText(
                  '${row.line.name} · ${row.line.now ?? row.line.stage}',
                ),
              ),
          ]),
        ],
      ],
    );
  }

  Widget _item(ProtocolStreamItem item) {
    final payload = item.payload as Map<String, dynamic>;
    final t = LinaTokens.of(context);
    if (item.kind == 'result') {
      final result = ProtocolResult.fromJson(payload);
      return _panel([
        _resultStatus(result),
        SizedBox(height: t.spaceInline),
        LinaText(result.title, style: Theme.of(context).textTheme.titleMedium),
        LinaText(result.summary),
        TextButton(
          onPressed: () => _open(result),
          child: const LinaText('Read'),
        ),
      ]);
    }
    if (item.kind == 'question' || item.kind == 'approval_request') {
      final card = payload['card'] as Map?;
      return _panel([
        const StatusLabel(status: LinaStatus.waiting, label: 'Waiting for you'),
        LinaText(
          card?['summary'] as String? ?? 'A decision needs your attention.',
        ),
        const LinaText('You can keep talking while this waits.'),
      ]);
    }
    final speaker = payload['speaker'] as String? ?? 'agent';
    final agentId = payload['agent_id'] as String?;
    final name =
        _conversation.agents
            .where((a) => a.agentId == agentId)
            .firstOrNull
            ?.name ??
        _conversation.selectedName;
    return Column(
      key: ValueKey(item.key),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (speaker == 'agent') ...[
              const AgentMark(),
              SizedBox(width: t.spaceInline),
            ],
            Expanded(
              child: LinaText(switch (speaker) {
                'person' => 'You',
                'agent' => name,
                'forwarded' => 'Forwarded',
                _ => 'Notice',
              }, style: Theme.of(context).textTheme.titleMedium),
            ),
            if (item.kind == 'output_delta')
              const StatusLabel(
                status: LinaStatus.working,
                label: 'Responding',
              ),
          ],
        ),
        SizedBox(height: t.spaceInline),
        _prose(payload['text'] as String? ?? ''),
        if (payload['details'] != null)
          ExpansionTile(
            trailing: LinaText(t.glyphUnicodeOverflow),
            title: const LinaText('Details'),
            children: [_prose(payload['details'] as String)],
          ),
      ],
    );
  }

  Widget _prose(String text) {
    final t = LinaTokens.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final part in text.split('```').indexed)
          if (part.$1.isOdd)
            Container(
              color: t.colorSurface,
              padding: EdgeInsets.all(t.spaceInline),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: SelectableText(part.$2, style: linaCodeStyle(context)),
              ),
            )
          else if (part.$2.isNotEmpty)
            SelectableText(
              part.$2,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
      ],
    );
  }

  Widget _composer() {
    final t = LinaTokens.of(context);
    final state = _conversation.selected;
    final connected = widget.connection.phase == ConnectionPhase.connected;
    final turn = !connected ? TurnPresentation.disconnected : state.turn;
    final label = switch (turn) {
      TurnPresentation.composing => 'Composing',
      TurnPresentation.accepted => 'Accepted',
      TurnPresentation.queued => 'Queued',
      TurnPresentation.responding => 'Responding',
      TurnPresentation.completed => 'Completed',
      TurnPresentation.userStopped => 'User-stopped',
      TurnPresentation.failed => 'Failed',
      TurnPresentation.disconnected => 'Disconnected',
    };
    final status = switch (turn) {
      TurnPresentation.composing ||
      TurnPresentation.accepted ||
      TurnPresentation.queued => LinaStatus.waiting,
      TurnPresentation.responding => LinaStatus.working,
      TurnPresentation.completed ||
      TurnPresentation.userStopped => LinaStatus.success,
      TurnPresentation.failed => LinaStatus.error,
      TurnPresentation.disconnected => LinaStatus.unknown,
    };
    return Container(
      padding: EdgeInsets.all(t.spaceGutter),
      decoration: BoxDecoration(
        color: t.colorCanvas,
        border: Border(
          top: BorderSide(color: t.colorLine, width: t.borderWidth),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: t.spaceInline,
            runSpacing: t.spaceInline,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              LinaText('Main conversation · ${_conversation.selectedName}'),
              StatusLabel(status: status, label: label),
            ],
          ),
          SizedBox(height: t.spaceInline),
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: t.layoutComposerHeight),
            child: Focus(
              onKeyEvent: (_, event) => _composerKey(state, event),
              child:
                  widget.slots.composer?.call(
                    context,
                    state.draft,
                    state.focus,
                    () => unawaited(_conversation.send(target: state)),
                    t,
                  ) ??
                  TextField(
                    key: const ValueKey('composer'),
                    controller: state.draft,
                    focusNode: state.focus,
                    keyboardType: TextInputType.multiline,
                    maxLines: null,
                    textInputAction: TextInputAction.newline,
                    onEditingComplete: () {},
                    onSubmitted: (_) =>
                        unawaited(_conversation.send(target: state)),
                    decoration: const InputDecoration(
                      labelText: 'What is on your mind?',
                      hintText: '한국어로 편하게 적어 보세요.',
                    ),
                  ),
            ),
          ),
          SizedBox(height: t.spaceInline),
          Wrap(
            spacing: t.spaceInline,
            runSpacing: t.spaceInline,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              TextButton(
                onPressed: _conversation.canSend && state.draft.text.isNotEmpty
                    ? () => unawaited(_conversation.send(target: state))
                    : null,
                child: LinaText(
                  state.sending
                      ? 'Waiting for Core'
                      : state.retryAllowed
                      ? 'Retry'
                      : 'Send',
                ),
              ),
              FilterChip(
                label: const LinaText('Queue next'),
                selected: state.queue,
                onSelected: _conversation.setQueue,
                showCheckmark: false,
              ),
              if (state.active)
                TextButton(
                  onPressed: connected && !state.stopping
                      ? () => unawaited(_conversation.stop(target: state))
                      : null,
                  child: LinaText(state.stopping ? 'Requesting stop' : 'Stop'),
                ),
            ],
          ),
          SizedBox(height: t.spaceInline),
          Semantics(
            liveRegion: true,
            child: LinaText(
              _conversation.agentFeedback ??
                  (!_conversation.selectionAvailable &&
                          _conversation.selectedId != null
                      ? 'This agent is unavailable. Your draft is kept here; choose an agent to continue.'
                      : null) ??
                  state.feedback ??
                  (connected && !widget.connection.hasCapability('conversation')
                      ? 'Conversation is unavailable. Check your Core connection.'
                      : 'A draft until Core confirms receipt.'),
            ),
          ),
        ],
      ),
    );
  }

  KeyEventResult _composerKey(AgentPresentation state, KeyEvent event) {
    if (!identical(state, _conversation.selected) ||
        (event is! KeyDownEvent && event is! KeyRepeatEvent) ||
        (event.logicalKey != LogicalKeyboardKey.enter &&
            event.logicalKey != LogicalKeyboardKey.numpadEnter)) {
      return KeyEventResult.ignored;
    }
    final value = state.draft.value;
    // Candidate confirmation and the commit frame belong to the IME. Never
    // queue a send or modify preedit in response to an application shortcut.
    if ((value.composing.isValid && !value.composing.isCollapsed) ||
        state.compositionEnding)
      return KeyEventResult.ignored;
    final keyboard = HardwareKeyboard.instance;
    if (keyboard.isAltPressed) return KeyEventResult.ignored;
    if (keyboard.isShiftPressed) {
      if (keyboard.isControlPressed || keyboard.isMetaPressed)
        return KeyEventResult.ignored;
      if (event is KeyDownEvent && value.selection.isValid) {
        state.draft.value = value
            .replaced(value.selection, '\n')
            .copyWith(
              selection: TextSelection.collapsed(
                offset: value.selection.start + '\n'.length,
              ),
            );
      }
    } else if (event is KeyDownEvent) {
      // Plain, Cmd and Ctrl Enter share the acknowledgement/composition gate.
      unawaited(_conversation.send(target: state));
    }
    return KeyEventResult.handled;
  }

  Widget _section() {
    if (_conversation.page == 'Agents')
      return AgentsPanel(conversation: _conversation);
    final t = LinaTokens.of(context);
    return ListView(
      padding: EdgeInsets.all(t.spaceGutter),
      children: [
        LinaText(
          _conversation.page,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        SizedBox(height: t.spaceSection),
        if (_conversation.page == 'Library') ...[
          for (final item in _conversation.selected.items.where(
            (i) => i.kind == 'result',
          ))
            _item(item),
          if (!_conversation.selected.items.any((i) => i.kind == 'result'))
            const LinaText('No results in this conversation yet.'),
        ] else
          const LinaText(
            'This view is not available yet. You can ask your agent below.',
          ),
      ],
    );
  }

  Widget _resultStatus(ProtocolResult result) => StatusLabel(
    status: result.status == 'saved' ? LinaStatus.success : LinaStatus.waiting,
    label: result.status == 'saved' ? 'Saved by Core' : 'Preview · Not saved',
  );
  void _open(ProtocolResult result) {
    _conversation.openDocument(result);
    if (MediaQuery.sizeOf(context).width <
        LinaTokens.of(context).layoutDesktopWidth) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _scaffold.currentState?.openEndDrawer(),
      );
    }
  }

  Widget _document(ProtocolResult result) {
    final t = LinaTokens.of(context);
    return Container(
      color: t.colorSurface,
      child: Column(
        children: [
          Padding(
            padding: EdgeInsets.all(t.spaceInline),
            child: Wrap(
              spacing: t.spaceInline,
              children: [
                if (MediaQuery.sizeOf(context).width >= t.layoutDesktopWidth)
                  TextButton(
                    onPressed: () =>
                        setState(() => _fullDocument = !_fullDocument),
                    child: LinaText(
                      _fullDocument ? 'Split view' : 'Full screen',
                    ),
                  ),
                TextButton(
                  onPressed: () {
                    _scaffold.currentState?.closeEndDrawer();
                    _conversation.openDocument(null);
                  },
                  child: const LinaText('Close'),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: EdgeInsets.all(t.spaceGutter),
              children: [
                _resultStatus(result),
                if (_conversation.selected.newerDocument != null)
                  TextButton(
                    onPressed: () => _conversation.openDocument(
                      _conversation.selected.newerDocument,
                    ),
                    child: const LinaText('Read latest'),
                  ),
                SizedBox(height: t.spaceSection),
                LinaText(
                  result.title,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                SizedBox(height: t.spaceInline),
                _prose(result.text ?? result.summary),
                if (result.completion != null)
                  LinaText(result.completion!.label),
                if (_conversation.selected.documentLoading)
                  const LinaText('Loading the full document…'),
                if (_conversation.selected.documentError != null)
                  LinaText(_conversation.selected.documentError!),
                if (result.text == null &&
                    !_conversation.selected.documentLoading)
                  const LinaText('The full document is not available.'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _panel(List<Widget> children) {
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

  String? get _connectionProblem => switch (widget.connection.problem) {
    ConnectionProblem.invalidAddress => 'The Core address is not valid. Use unix:///path or tcp://host:port, then connect again.',
    ConnectionProblem.unavailable => 'Core could not be reached. Start Core and check its address, then connect again.',
    null => null,
  };

  Future<void> _connectFromDialog(BuildContext context) async {
    if (widget.connection.phase == ConnectionPhase.connecting) return;
    await widget.connection.connect(_endpoint.text);
    if (context.mounted && widget.connection.phase == ConnectionPhase.connected)
      Navigator.pop(context);
  }

  Future<void> _connectionSettings() => showDialog<void>(
    context: context,
    builder: (context) => StreamBuilder<void>(
      stream: widget.connection.changes,
      builder: (context, _) => AlertDialog(
        title: LinaText(
          'Connection',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: _endpoint,
                enabled: widget.connection.phase != ConnectionPhase.connecting,
                autocorrect: false,
                enableSuggestions: false,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => unawaited(_connectFromDialog(context)),
                decoration: const InputDecoration(
                  labelText: 'Core address',
                  hintText:
                      'unix:///path/to/core.sock or tcp://tailnet-host:port',
                ),
              ),
              if (_connectionProblem != null)
                Semantics(
                  liveRegion: true,
                  child: StatusLabel(
                    status: LinaStatus.error,
                    label: _connectionProblem!,
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const LinaText('Close'),
          ),
          TextButton(
            onPressed: () {
              widget.connection.disconnect();
              Navigator.pop(context);
            },
            child: const LinaText('Disconnect'),
          ),
          TextButton(
            onPressed: widget.connection.phase == ConnectionPhase.connecting
                ? null
                : () => unawaited(_connectFromDialog(context)),
            child: LinaText(
              widget.connection.phase == ConnectionPhase.connecting
                  ? 'Connecting'
                  : 'Connect',
            ),
          ),
        ],
      ),
    ),
  );
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
                if (widget.slots.launcher != null)
                  TextButton(
                    onPressed: () async {
                      try {
                        await widget.slots.launcher!.show(
                          LinaTokens.of(context),
                        );
                      } on Exception {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: LinaText(
                                'Launcher is unavailable. Try again.',
                              ),
                            ),
                          );
                        }
                      }
                    },
                    child: const LinaText('Open launcher'),
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
