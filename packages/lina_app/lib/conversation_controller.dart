// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lina_protocol/lina_protocol.dart';

enum TurnPresentation {
  composing,
  accepted,
  queued,
  responding,
  completed,
  userStopped,
  failed,
  disconnected,
}

/// Only presentation state lives here. Core remains the owner of every turn.
class AgentPresentation {
  AgentPresentation(this.agentId);
  final String agentId;
  final draft = TextEditingController();
  final search = TextEditingController();
  final scroll = ReadingController();
  final focus = FocusNode();
  String? conversationId;
  TopicWindow? window;
  ProtocolResult? document;
  ProtocolResult? newerDocument;
  String? documentError;
  bool documentLoading = false;
  Object documentRequest = Object();
  bool ready = false;
  bool sending = false;
  bool stopping = false;
  bool stopConfirmed = false;
  bool active = false;
  bool replyCompleted = false;
  bool queue = false;
  bool restoreFocus = false;
  bool composing = false;
  bool compositionEnding = false;
  bool showSearch = false;
  bool retryAllowed = false;
  Object editVersion = Object();
  String? feedback;
  TurnPresentation turn = TurnPresentation.composing;
  List<ProtocolStreamItem> get items => window?.items ?? const [];
  void dispose() {
    draft.dispose();
    search.dispose();
    scroll.dispose();
    focus.dispose();
  }
}

class ConversationController extends ChangeNotifier {
  ConversationController(this.core) {
    _changes = core.changes.listen((_) => _connectionChanged());
    _events = core.events.listen(_event);
    _connectionChanged();
  }
  final CoreConnection core;
  final Map<String, AgentPresentation> _agents = {};
  final List<AgentPresentation> _retired = [];
  List<ProtocolAgent> _catalog = const [];
  late final StreamSubscription<void> _changes;
  late final StreamSubscription<Envelope> _events;
  ProtocolWelcome? _welcome;
  Object _generation = Object();
  Object _selection = Object();
  Object get selectionVersion => _selection;
  bool _disposed = false;
  String? selectedId;
  String page = 'Home';
  final _back = <String>[];
  final _forward = <String>[];
  bool get canBack => _back.isNotEmpty;
  bool get canForward => _forward.isNotEmpty;
  final _unselected = AgentPresentation('');
  AgentPresentation get selected => _agents[selectedId] ?? _unselected;
  List<ProtocolAgent> get agents => _catalog;
  String? agentOperation;
  String? agentFeedback;
  bool agentsUncertain = false;
  bool _selectionUncertain = false;
  bool get agentBusy => agentOperation != null;
  bool get canManageAgents =>
      core.phase == ConnectionPhase.connected &&
      core.hasCapability('agents') &&
      !agentBusy &&
      !agentsUncertain;
  bool get canChooseAgent =>
      core.phase == ConnectionPhase.connected &&
      !agentBusy &&
      !agentsUncertain &&
      (core.hasCapability('agents') || core.hasCapability('conversation'));
  bool get selectionAvailable => agents.any((a) => a.agentId == selectedId);
  String get selectedName =>
      agents.where((a) => a.agentId == selectedId).firstOrNull?.name ??
      'Choose an agent';
  ProtocolProgress? progress;
  final _progress = TopicWindow('progress');
  final _refreshing = <String>{};
  bool get canSend =>
      selectionAvailable &&
      selected.ready &&
      core.phase == ConnectionPhase.connected &&
      core.hasCapability('conversation') &&
      !agentBusy &&
      !_selectionUncertain &&
      !selected.sending &&
      !selected.composing &&
      !selected.compositionEnding;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  AgentPresentation _agent(String id) => _agents.putIfAbsent(id, () {
    final state = AgentPresentation(id);
    state.draft.addListener(() {
      state.editVersion = Object();
      final composing =
          state.draft.value.composing.isValid &&
          !state.draft.value.composing.isCollapsed;
      if (state.composing && !composing) {
        state.compositionEnding = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_disposed) return;
          state.compositionEnding = false;
          _notify();
        });
        WidgetsBinding.instance.scheduleFrame();
      }
      state.composing = composing;
      _notify();
    });
    state.search.addListener(_notify);
    state.focus.addListener(() {
      if (state.focus.hasFocus) state.restoreFocus = true;
    });
    return state;
  });
  void _connectionChanged() {
    if (core.phase != ConnectionPhase.connected) {
      _generation = Object();
      if (agentBusy) {
        agentsUncertain = true;
        agentFeedback =
            '모름 · Reconnect and refresh agents to check the outcome.';
        agentOperation = null;
      }
      for (final state in _agents.values) {
        state.ready = false;
      }
      _notify();
      return;
    }
    final welcome = core.welcome;
    if (welcome == null || identical(welcome, _welcome)) {
      _notify();
      return;
    }
    final previous = _welcome;
    _welcome = welcome;
    _catalog = welcome.agents;
    _generation = Object();
    agentOperation = null;
    agentsUncertain = false;
    _selectionUncertain = false;
    if (previous != null &&
        (previous.mainId != welcome.mainId ||
            previous.personId != welcome.personId)) {
      // Never restore a draft or document into a different owner/workspace,
      // even if that Core happens to use the same agent ids.
      selected.focus.unfocus();
      _retired.addAll(_agents.values);
      _agents.clear();
      _unselected.draft.clear();
      selectedId = null;
      _selection = Object();
      agentFeedback = null;
    }
    _refreshing.clear();
    progress = null;
    _progress.needsSnapshot = true;
    for (final state in _agents.values) {
      state.ready = false;
      state.window?.needsSnapshot = true;
      state.replyCompleted = false;
      state.stopConfirmed = false;
      if (!selectionAvailable && state.agentId == selectedId)
        _removeConversation(state);
    }
    if (core.hasCapability('conversation')) {
      if (selectedId == null) {
        unawaited(_discover());
      } else if (selectionAvailable) {
        // Reconcile Core's saved choice without replaying a selection write.
        _selectionUncertain = true;
        unawaited(_discover(reconcile: true));
      }
    }
    if (core.hasCapability('progress')) unawaited(_loadProgress());
    _notify();
  }

  Future<void> _discover({bool reconcile = false}) async {
    final generation = _generation;
    final selection = _selection;
    try {
      final reply = await core.request(
        'history_get',
        ProtocolHistoryGet.fromJson({}),
      );
      if (_disposed ||
          generation != _generation ||
          selection != _selection ||
          (!reconcile && selectedId != null))
        return;
      if (reply.kind != 'history' || reply.error != null) return;
      final history = reply.typedPayload as ProtocolHistory;
      final id = history.agentId;
      if (id == null || !agents.any((a) => a.agentId == id)) return;
      final initial = selectedId == null;
      if (selectedId != id) {
        selected.restoreFocus = selected.focus.hasFocus;
        selected.focus.unfocus();
      }
      selectedId = id;
      _selectionUncertain = false;
      if (reconcile) agentFeedback = null;
      final state = _agent(id);
      if (initial) _carryInitialDraft(state);
      await _acceptHistory(state, history, generation);
    } on ConnectionLost {
      _notify();
    } on FormatException {
      _notify();
    }
  }

  Future<void> choose(String id) async {
    if (!canChooseAgent || !agents.any((a) => a.agentId == id)) return;
    final generation = _generation;
    if (core.hasCapability('agents') && !await _requestAgent('choose', id: id))
      return;
    if (_disposed ||
        generation != _generation ||
        !agents.any((a) => a.agentId == id))
      return;
    final state = _agent(id);
    if (selectedId == null) _carryInitialDraft(state);
    selected.restoreFocus = selected.focus.hasFocus;
    selected.focus.unfocus();
    _selection = Object();
    selectedId = id;
    _notify();
    if (state.restoreFocus) state.focus.requestFocus();
    if (!state.ready &&
        core.phase == ConnectionPhase.connected &&
        core.hasCapability('conversation'))
      await _load(state);
  }

  Future<bool> createAgent(String name) async {
    final generation = _generation;
    final applied = await _requestAgent('create', name: name);
    if (applied &&
        !_disposed &&
        generation == _generation &&
        selectedId == null &&
        agents.singleOrNull != null &&
        core.hasCapability('conversation')) {
      unawaited(_openFirstAgent(generation));
    }
    return applied;
  }

  Future<void> _openFirstAgent(Object generation) async {
    final selection = _selection;
    await _discover();
    if (!_disposed &&
        generation == _generation &&
        selection == _selection &&
        selectionAvailable &&
        selected.ready)
      navigate('Home');
  }

  Future<bool> renameAgent(String id, String name) =>
      _requestAgent('rename', id: id, name: name);
  Future<bool> deleteAgent(String id) => _requestAgent('delete', id: id);

  Future<void> refreshAgents() async {
    if (await _requestAgent('list')) {
      if (_selectionUncertain && selectionAvailable) {
        await _discover(reconcile: true);
      } else if (selectionAvailable && !selected.ready) {
        await _load(selected);
      }
    }
  }

  Future<bool> _requestAgent(
    String operation, {
    String? id,
    String? name,
  }) async {
    if (_disposed ||
        core.phase != ConnectionPhase.connected ||
        !core.hasCapability('agents') ||
        agentBusy ||
        (agentsUncertain && operation != 'list') ||
        (id != null && !agents.any((a) => a.agentId == id)) ||
        (name != null && name.trim().isEmpty))
      return false;
    final generation = _generation;
    // Invalidate an initial history request before an explicit selection.
    if (operation == 'choose') _selection = Object();
    agentOperation = operation;
    agentFeedback = 'Waiting for Core';
    _notify();
    void uncertain() {
      agentsUncertain = true;
      if (operation == 'choose' || (operation == 'delete' && id == selectedId))
        _selectionUncertain = true;
      agentFeedback =
          '모름 · Refresh agents to check the outcome before trying again.';
    }

    try {
      final reply = await core.request(
        'agent_request',
        ProtocolAgentRequest.fromJson({
          'operation': operation,
          if (id != null) 'agent_id': id,
          if (name != null) 'name': name,
        }),
      );
      if (_disposed || generation != _generation) return false;
      if (const [
        'refused',
        'failed',
        'cancelled',
      ].contains(reply.effectState)) {
        agentFeedback =
            'Core could not $operation the agent. Refresh agents and try again.';
        return false;
      }
      final expectedEffect = operation == 'list' || operation == 'choose'
          ? 'none'
          : 'applied';
      if (reply.error != null ||
          reply.kind != 'agent_result' ||
          reply.effectState != expectedEffect) {
        uncertain();
        return false;
      }
      final result = reply.typedPayload as ProtocolAgentResult;
      final rows = result.agents;
      if (result.operation != operation ||
          rows == null ||
          (id != null && result.agentId != id) ||
          rows.any((a) => a.agentId.isEmpty) ||
          rows.map((a) => a.agentId).toSet().length != rows.length ||
          (operation == 'create' &&
              !rows.any((a) => a.agentId == result.agentId)) ||
          (operation == 'choose' && !rows.any((a) => a.agentId == id)) ||
          (operation == 'delete' && rows.any((a) => a.agentId == id))) {
        uncertain();
        return false;
      }
      _catalog = rows;
      for (final entry in _agents.entries) {
        if (!rows.any((a) => a.agentId == entry.key))
          _removeConversation(entry.value);
      }
      agentsUncertain = false;
      if (operation == 'choose') _selectionUncertain = false;
      agentFeedback = switch (operation) {
        'create' => 'Agent created by Core.',
        'rename' => 'Name changed by Core.',
        'delete' => 'Agent deleted by Core. Choose another agent to continue.',
        _ => null,
      };
      return true;
    } on ConnectionLost {
      if (!_disposed && generation == _generation) uncertain();
      return false;
    } on FormatException {
      if (!_disposed && generation == _generation) uncertain();
      return false;
    } finally {
      if (generation == _generation) agentOperation = null;
      _notify();
    }
  }

  void _removeConversation(AgentPresentation state) {
    state.ready = false;
    state.window = null;
    state.conversationId = null;
    state.documentRequest = Object();
    state.document = null;
    state.newerDocument = null;
    state.active = false;
  }

  void _carryInitialDraft(AgentPresentation state) {
    if (_unselected.draft.text.isNotEmpty && state.draft.text.isEmpty) {
      state.draft.value = _unselected.draft.value;
      _unselected.draft.clear();
    }
  }

  Future<void> _load(AgentPresentation state) async {
    final generation = _generation;
    final key = 'history:${state.agentId}';
    if (!_refreshing.add(key)) return;
    try {
      final reply = await core.request(
        'history_get',
        ProtocolHistoryGet.fromJson({'agent_id': state.agentId}),
      );
      if (_disposed || generation != _generation) return;
      if (reply.kind != 'history' || reply.error != null) {
        state.feedback =
            'Could not open this conversation. Reconnect to try again.';
        return;
      }
      await _acceptHistory(
        state,
        reply.typedPayload as ProtocolHistory,
        generation,
      );
    } on ConnectionLost {
      /* keep the complete presentation */
    } on FormatException {
      state.feedback =
          'Could not read this conversation. Reconnect to try again.';
    } finally {
      if (generation == _generation) _refreshing.remove(key);
      _notify();
    }
  }

  Future<void> _acceptHistory(
    AgentPresentation state,
    ProtocolHistory history,
    Object generation,
  ) async {
    if (!agents.any((a) => a.agentId == state.agentId) ||
        history.agentId != state.agentId ||
        history.conversationId == null)
      return;
    final topic = 'conversation:${history.conversationId}';
    state.conversationId = history.conversationId;
    if (state.window?.topic != topic) state.window = TopicWindow(topic);
    if (history.snapshot != null) {
      _restoreSnapshot(state, history.snapshot!);
    }
    state.ready = true;
    _notify();
    await _subscribe(topic, generation);
  }

  void _restoreSnapshot(AgentPresentation state, ProtocolSnapshot snapshot) {
    if (state.window?.replace(snapshot) != true) return;
    // This schema has no terminal turn identity. An older answer or stop
    // receipt cannot establish the outcome of the turn in a restored window.
    state.active = false;
    state.replyCompleted = false;
    state.stopConfirmed = false;
    state.turn = TurnPresentation.composing;
    _project(state);
  }

  Future<void> _subscribe(String topic, Object generation) async {
    try {
      final reply = await core.request(
        'subscribe',
        ProtocolSubscribe.fromJson({'topic': topic}),
      );
      if (!_disposed && generation == _generation && reply.error == null)
        _event(reply);
    } on ConnectionLost {
      /* no replay of mutations */
    } on FormatException {
      /* protocol errors stay out of conversation */
    }
  }

  Future<void> _resync(TopicWindow window) async {
    final generation = _generation;
    if (!_refreshing.add(window.topic)) return;
    window.needsSnapshot = true;
    try {
      await _subscribe(window.topic, generation);
    } finally {
      if (generation == _generation) _refreshing.remove(window.topic);
    }
  }

  void _event(Envelope event) {
    if (_disposed ||
        core.phase != ConnectionPhase.connected ||
        event.error != null ||
        event.epoch != core.welcome?.epoch ||
        event.sender.id != core.welcome?.mainId)
      return;
    if (event.kind == 'snapshot') {
      final snapshot = event.typedPayload as ProtocolSnapshot;
      if (snapshot.topic == 'progress' && _progress.replace(snapshot)) {
        progress = null;
        for (final item in _progress.items) {
          _projectProgress(item);
        }
      }
      for (final state in _agents.values) {
        _restoreSnapshot(state, snapshot);
      }
    } else if (event.kind == 'resync' || event.kind == 'resync_required') {
      final topic = event.payload['topic'];
      for (final state in _agents.values) {
        if (state.window?.topic == topic) unawaited(_resync(state.window!));
      }
      if (topic == 'progress') unawaited(_resync(_progress));
    } else {
      for (final state in _agents.values) {
        final window = state.window;
        if (window == null ||
            (event.payload['stream'] as Map?)?['topic'] != window.topic)
          continue;
        if (window.apply(event.kind, event.payload)) {
          if (event.kind == 'item_done' && event.payload['speaker'] == 'agent')
            state.replyCompleted = true;
          _project(state);
        }
        if (window.needsSnapshot) unawaited(_resync(window));
      }
      if ((event.payload['stream'] as Map?)?['topic'] == 'progress') {
        if (_progress.apply(event.kind, event.payload)) {
          for (final item in _progress.items) {
            _projectProgress(item);
          }
        }
        if (_progress.needsSnapshot) unawaited(_resync(_progress));
      }
    }
    _notify();
  }

  void _project(AgentPresentation state) {
    for (final item in state.items) {
      if (item.kind == 'turn_state') {
        final turn = ProtocolTurnState.fromJson(
          item.payload as Map<String, dynamic>,
        );
        if (turn.active != null) {
          if (turn.active! && !state.active) state.replyCompleted = false;
          state.active = turn.active!;
          if (state.active) {
            state.turn = TurnPresentation.responding;
          } else if (state.stopConfirmed) {
            state.turn = TurnPresentation.userStopped;
          } else if (state.replyCompleted) {
            state.turn = TurnPresentation.completed;
          } else {
            state.turn = TurnPresentation.composing;
            state.feedback = '모름 · The reply ended without a confirmed answer.';
          }
          if (!state.active) state.stopping = false;
        }
      }
      if (item.kind == 'result' && state.document != null) {
        final result = ProtocolResult.fromJson(
          item.payload as Map<String, dynamic>,
        );
        if (result.resultId == state.document!.resultId &&
            state.document!.revision.compareTo(result.revision).isNegative) {
          // A notification is a card, not the versioned content being read.
          // Keep even an in-flight paginated read pinned until explicit choice.
          state.newerDocument = result;
        }
      }
    }
  }

  void _projectProgress(ProtocolStreamItem item) {
    if (item.kind != 'progress_update') return;
    final json = Map<String, dynamic>.from(item.payload as Map)
      ..remove('stream')
      ..remove('text');
    progress = ProtocolProgress.fromJson(json);
  }

  Future<void> _loadProgress() async {
    final generation = _generation;
    try {
      final reply = await core.request(
        'progress_get',
        ProtocolProgressGet.fromJson({'view': 'overview'}),
      );
      if (_disposed || generation != _generation) return;
      if (reply.kind == 'progress' && reply.error == null)
        progress = reply.typedPayload as ProtocolProgress;
      _notify();
      await _subscribe('progress', generation);
    } on ConnectionLost {
      _notify();
    } on FormatException {
      _notify();
    }
  }

  Future<void> send({AgentPresentation? target}) async {
    final state = selected;
    if ((target != null && !identical(target, state)) ||
        !canSend ||
        state.draft.text.isEmpty)
      return;
    final text = state.draft.text;
    final edit = state.editVersion;
    final generation = _generation;
    final conversation = state.conversationId!;
    final queue = state.queue;
    state.sending = true;
    state.retryAllowed = false;
    state.stopConfirmed = false;
    if (!state.active) state.replyCompleted = false;
    state.feedback = 'Waiting for Core';
    _notify();
    try {
      final reply = await core.request(
        'input',
        ProtocolInput.fromJson({
          'conversation_id': conversation,
          'input_id': core.newInputId(),
          'text': text,
          'mode': queue ? 'queue' : 'steer',
        }),
      );
      if (_disposed || generation != _generation) return;
      final confirmed =
          reply.kind == 'item_done' &&
          reply.effectState == 'applied' &&
          reply.error == null;
      if (confirmed) {
        state.turn = queue
            ? TurnPresentation.queued
            : TurnPresentation.accepted;
        state.feedback = 'Received by Core';
        if (state.editVersion == edit && !state.composing) state.draft.clear();
      } else {
        state.retryAllowed = const [
          'refused',
          'failed',
          'cancelled',
        ].contains(reply.effectState);
        state.turn = state.retryAllowed ? TurnPresentation.failed : state.turn;
        state.feedback = state.retryAllowed
            ? 'Could not send. Your draft is here; retry when ready.'
            : '모름 · Check this conversation before sending again.';
      }
    } on ConnectionLost {
      state.feedback = '모름 · Connection lost. Check Core before sending again.';
    } on FormatException {
      state.turn = TurnPresentation.failed;
      state.retryAllowed = true;
      state.feedback =
          'This message could not be sent. Edit the draft and retry.';
    } finally {
      state.sending = false;
      _notify();
    }
  }

  Future<void> stop({AgentPresentation? target}) async {
    final state = selected;
    if ((target != null && !identical(target, state)) ||
        agentBusy ||
        _selectionUncertain ||
        !selectionAvailable ||
        !state.ready ||
        !state.active ||
        state.stopping ||
        core.phase != ConnectionPhase.connected)
      return;
    final generation = _generation;
    state.stopping = true;
    state.feedback = 'Requesting stop';
    _notify();
    try {
      final reply = await core.request(
        'interrupt',
        ProtocolInterrupt.fromJson({'conversation_id': state.conversationId}),
      );
      if (_disposed || generation != _generation) return;
      state.stopConfirmed =
          reply.error == null &&
          const ['applied', 'cancelled'].contains(reply.effectState);
      state.feedback = state.stopConfirmed
          ? 'Stop requested'
          : '모름 · Check whether the reply stopped.';
      if (state.stopConfirmed && !state.active)
        state.turn = TurnPresentation.userStopped;
    } on ConnectionLost {
      state.feedback = '모름 · Check whether the reply stopped.';
    } on FormatException {
      state.feedback = 'Could not request a stop.';
    } finally {
      state.stopping = false;
      _notify();
    }
  }

  void navigate(String next) {
    if (page == next) return;
    selected.restoreFocus = selected.focus.hasFocus;
    _back.add(page);
    _forward.clear();
    page = next;
    _notify();
  }

  void back() {
    if (canBack) {
      _forward.add(page);
      page = _back.removeLast();
      _notify();
    }
  }

  void forward() {
    if (canForward) {
      _back.add(page);
      page = _forward.removeLast();
      _notify();
    }
  }

  void setQueue(bool value) {
    selected.queue = value;
    _notify();
  }

  void toggleSearch() {
    selected.showSearch = !selected.showSearch;
    _notify();
  }

  void openDocument(ProtocolResult? result) {
    final state = selected;
    state.documentRequest = Object();
    state.document = result;
    state.newerDocument = null;
    state.documentError = null;
    state.documentLoading = false;
    _notify();
    if (result != null && result.text == null)
      unawaited(_readDocument(state, result));
  }

  Future<void> _readDocument(
    AgentPresentation state,
    ProtocolResult result,
  ) async {
    if (!core.hasCapability('results') || !state.ready) return;
    final generation = _generation;
    final request = state.documentRequest;
    state.documentLoading = true;
    _notify();
    final text = StringBuffer();
    final offsets = <ExactNumber>{};
    ExactNumber? offset;
    try {
      do {
        final reply = await core.request(
          'result_get',
          ProtocolResultGet.fromJson({
            'result_id': result.resultId,
            'revision': result.revision,
            'conversation_id': state.conversationId,
            if (offset != null) 'offset': offset,
          }),
        );
        if (_disposed ||
            generation != _generation ||
            request != state.documentRequest ||
            state.document?.resultId != result.resultId ||
            state.document?.revision != result.revision)
          return;
        if (reply.kind != 'result' || reply.error != null) {
          state.documentError =
              'Could not load this saved version. Reopen it to try again.';
          return;
        }
        final page = reply.typedPayload as ProtocolResult;
        if (page.resultId != result.resultId ||
            page.revision != result.revision ||
            page.provenance.conversationId != state.conversationId)
          return;
        text.write(page.text ?? '');
        offset = page.next;
        if (offset != null && !offsets.add(offset)) {
          state.documentError = 'Could not read the rest of this document.';
          return;
        }
        if (offset == null)
          state.document = ProtocolResult.fromJson({
            ...page.toJson(),
            if (page.text != null) 'text': text.toString(),
          });
      } while (offset != null);
    } on ConnectionLost {
      state.documentError =
          'Disconnected. Reopen this document after reconnecting.';
    } on FormatException {
      state.documentError = 'Could not read this document.';
    } finally {
      if (request == state.documentRequest) state.documentLoading = false;
      _notify();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _changes.cancel();
    _events.cancel();
    for (final state in _agents.values) {
      state.dispose();
    }
    for (final state in _retired) {
      state.dispose();
    }
    _unselected.dispose();
    super.dispose();
  }
}

/// Carries reading position into the first layout after navigation or resize.
class ReadingController extends ScrollController {
  double? _retained;
  @override
  void detach(ScrollPosition position) {
    _retained = position.pixels;
    super.detach(position);
  }

  @override
  ScrollPosition createScrollPosition(
    ScrollPhysics physics,
    ScrollContext context,
    ScrollPosition? oldPosition,
  ) => ScrollPositionWithSingleContext(
    physics: physics,
    context: context,
    initialPixels: _retained ?? initialScrollOffset,
    keepScrollOffset: false,
  );
}
