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
  late final StreamSubscription<void> _changes;
  late final StreamSubscription<Envelope> _events;
  ProtocolWelcome? _welcome;
  Object _generation = Object();
  Object _selection = Object();
  bool _disposed = false;
  String? selectedId;
  String page = 'Home';
  final _back = <String>[];
  final _forward = <String>[];
  bool get canBack => _back.isNotEmpty;
  bool get canForward => _forward.isNotEmpty;
  final _unselected = AgentPresentation('');
  AgentPresentation get selected => _agents[selectedId] ?? _unselected;
  List<ProtocolAgent> get agents => core.welcome?.agents ?? const [];
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
    _generation = Object();
    _refreshing.clear();
    progress = null;
    _progress.needsSnapshot = true;
    for (final state in _agents.values) {
      state.ready = false;
      state.window?.needsSnapshot = true;
      if (previous != null &&
          (previous.mainId != welcome.mainId ||
              previous.personId != welcome.personId)) {
        state.window = null;
        state.conversationId = null;
        state.document = null;
      }
    }
    if (core.hasCapability('conversation')) {
      if (selectedId == null) {
        unawaited(_discover());
      } else if (selectionAvailable) {
        unawaited(_load(selected));
      }
    }
    if (core.hasCapability('progress')) unawaited(_loadProgress());
    _notify();
  }

  Future<void> _discover() async {
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
          selectedId != null)
        return;
      if (reply.kind != 'history' || reply.error != null) return;
      final history = reply.typedPayload as ProtocolHistory;
      final id = history.agentId;
      if (id == null || !agents.any((a) => a.agentId == id)) return;
      selectedId = id;
      final state = _agent(id);
      if (_unselected.draft.text.isNotEmpty && state.draft.text.isEmpty) {
        state.draft.value = _unselected.draft.value;
      }
      await _acceptHistory(state, history, generation);
    } on ConnectionLost {
      _notify();
    } on FormatException {
      _notify();
    }
  }

  Future<void> choose(String id) async {
    if (!agents.any((a) => a.agentId == id)) return;
    selected.restoreFocus = selected.focus.hasFocus;
    selected.focus.unfocus();
    _selection = Object();
    selectedId = id;
    final state = _agent(id);
    _notify();
    if (state.restoreFocus) state.focus.requestFocus();
    if (!state.ready &&
        core.phase == ConnectionPhase.connected &&
        core.hasCapability('conversation'))
      await _load(state);
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
    if (history.agentId != state.agentId || history.conversationId == null)
      return;
    final topic = 'conversation:${history.conversationId}';
    state.conversationId = history.conversationId;
    if (state.window?.topic != topic) state.window = TopicWindow(topic);
    if (history.snapshot != null) {
      state.window!.replace(history.snapshot!);
      state.replyCompleted = state.items.any(
        (item) =>
            item.kind == 'item_done' &&
            (item.payload as Map?)?['speaker'] == 'agent',
      );
      _project(state);
    }
    state.ready = true;
    _notify();
    await _subscribe(topic, generation);
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
        if (state.window?.replace(snapshot) == true) {
          state.active = false;
          state.replyCompleted = state.items.any(
            (item) =>
                item.kind == 'item_done' &&
                (item.payload as Map?)?['speaker'] == 'agent',
          );
          _project(state);
        }
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
          state.document = result;
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

  Future<void> send() async {
    final state = selected;
    if (!canSend || state.draft.text.isEmpty) return;
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

  Future<void> stop() async {
    final state = selected;
    if (!selectionAvailable ||
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
