// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lina_design/lina_design.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'memory_controller.dart';

class MemoryScreen extends StatefulWidget {
  const MemoryScreen({
    super.key,
    required this.core,
    required this.agentId,
    required this.agentName,
    required this.onAskAgent,
  });
  final CoreConnection core;
  final String agentId;
  final String agentName;
  final VoidCallback onAskAgent;
  @override
  State<MemoryScreen> createState() => _MemoryScreenState();
}

class _MemoryScreenState extends State<MemoryScreen>
    with WidgetsBindingObserver {
  late final MemoryController memory;
  final text = TextEditingController();
  final scroll = ScrollController();
  String? operation;
  ProtocolMemorySummary? editing;
  late String holder;
  String scope = 'local';
  late Object session;
  @override
  void initState() {
    super.initState();
    holder = widget.agentId;
    memory = MemoryController(widget.core, widget.agentId);
    session = memory.session;
    memory.addListener(_changed);
    text.addListener(_textChanged);
    WidgetsBinding.instance.addObserver(this);
  }

  void _textChanged() => setState(() {});

  void _changed() {
    if (memory.session != session || (!memory.observed && editing != null)) {
      session = memory.session;
      text.clear();
      operation = null;
      editing = null;
    }
    setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(memory.resume());
    } else {
      memory.suspend();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    memory.removeListener(_changed);
    memory.dispose();
    text.removeListener(_textChanged);
    text.dispose();
    scroll.dispose();
    super.dispose();
  }

  String _layer(String holder) => holder == 'all'
      ? 'Shared with all agents'
      : '${widget.agentName} personal';

  void _edit(String action, [ProtocolMemorySummary? item]) {
    setState(() {
      operation = action;
      editing = item;
      text.text = action == 'correct' ? item!.content : '';
      holder = item?.holder ?? widget.agentId;
      scope = item?.scope ?? 'local';
    });
    if (scroll.hasClients) scroll.jumpTo(scroll.position.minScrollExtent);
  }

  Future<void> _submit() async {
    final draft = text.value;
    final submittedOperation = operation;
    final submittedItem = editing;
    final applied = switch (operation) {
      'remember' => await memory.remember(text.text, holder, scope),
      'correct' => await memory.correct(editing!, text.text),
      'forget' => await memory.forget(editing!),
      _ => false,
    };
    if (!mounted || !applied) return;
    if (text.value == draft &&
        operation == submittedOperation &&
        identical(editing, submittedItem)) {
      setState(() {
        operation = null;
        editing = null;
        text.clear();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = LinaTokens.of(context);
    return ListView(
      controller: scroll,
      key: const ValueKey('memory-list'),
      padding: EdgeInsets.all(t.spaceGutter),
      children: [
        LinaText(
          '${widget.agentName} · Memory',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        SizedBox(height: t.spaceInline),
        const LinaText('Memories about you and conversation preferences'),
        const LinaText(
          'Personal knowledge belongs to the selected agent. '
          'Shared knowledge is available to every agent.',
        ),
        SizedBox(height: t.spaceInline),
        Wrap(
          spacing: t.spaceInline,
          runSpacing: t.spaceInline,
          children: [
            TextButton(
              onPressed: memory.available && !memory.writing && !memory.loading
                  ? () => unawaited(memory.refresh())
                  : null,
              child: const LinaText('Refresh memory'),
            ),
            FilledButton(
              onPressed: memory.canWrite ? () => _edit('remember') : null,
              child: const LinaText('Remember'),
            ),
          ],
        ),
        if (!memory.available)
          const LinaText(
            'Memory is unobserved. Connect to a Core that supports '
            'memory and choose an available agent.',
          ),
        if (memory.feedback != null)
          Semantics(liveRegion: true, child: LinaText(memory.feedback!)),
        if (memory.loading) const LinaText('Loading memory from Core…'),
        if (operation != null) _editor(),
        if (memory.observed && memory.items.isEmpty && memory.next == null)
          const LinaText(
            'Core returned no memories for this agent or the shared layer.',
          ),
        for (final layer in [widget.agentId, 'all']) ...[
          SizedBox(height: t.spaceSection),
          LinaText(
            _layer(layer),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          for (final item in memory.items.where((item) => item.holder == layer))
            _item(item),
        ],
        if (memory.next != null) ...[
          const LinaText('More memories remain. This list is partial.'),
          TextButton(
            onPressed: !memory.loading && !memory.writing
                ? () => unawaited(memory.loadMore())
                : null,
            child: const LinaText('Load more memories'),
          ),
        ],
        SizedBox(height: t.spaceSection),
        ExpansionTile(
          trailing: LinaText(t.glyphUnicodeOverflow),
          title: const LinaText('Persona and conversation preferences'),
          children: [
            const LinaText(
              'Persona is separate from memory. Fixed core, default '
              'voice, user voice and growth belong to this agent. Their current '
              'values are unobserved here. A conversation preference is memory; '
              'a request to change how the agent behaves belongs in conversation.',
            ),
            TextButton(
              onPressed: widget.onAskAgent,
              child: LinaText('Ask ${widget.agentName} in conversation'),
            ),
          ],
        ),
        ExpansionTile(
          trailing: LinaText(t.glyphUnicodeOverflow),
          title: const LinaText('External work sources'),
          children: [
            const LinaText(
              'Source connections and origin labels are unobserved. '
              'External work logs and memories/ are read-only evidence; '
              'the app cannot connect, pause or exclude them yet.',
            ),
            Wrap(
              spacing: t.spaceInline,
              children: const [
                TextButton(onPressed: null, child: LinaText('Connect source')),
                TextButton(onPressed: null, child: LinaText('Pause source')),
                TextButton(onPressed: null, child: LinaText('Exclude source')),
              ],
            ),
          ],
        ),
      ],
    );
  }

  Widget _item(ProtocolMemorySummary item) {
    final t = LinaTokens.of(context);
    final details = item.evidenceDetails ?? const <ProtocolMemoryEvidence>[];
    final references = {...item.evidence, ...details.map((d) => d.reference)};
    return Card(
      child: Padding(
        padding: EdgeInsets.all(t.spaceGutter),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SelectableText(item.content),
            SizedBox(height: t.spaceInline),
            LinaText('Layer: ${_layer(item.holder)} · Scope: ${item.scope}'),
            LinaText('Revision: ${item.revision}'),
            const LinaText(
              'Last updated: Unobserved · Corrected by: Unobserved',
            ),
            const LinaText('Source origin and observation status: Unobserved'),
            if (references.isEmpty) const LinaText('Sources: Unobserved'),
            for (final reference in references) ...[
              SelectableText('Source: $reference'),
              for (final evidence in details.where(
                (d) => d.reference == reference,
              )) ...[
                if (evidence.status != null)
                  LinaText('Source status: ${evidence.status}'),
                if (evidence.tombstone != null)
                  LinaText(
                    'Deletion marker · Person: ${evidence.tombstone!.person} · '
                    'Agent: ${evidence.tombstone!.agent} · '
                    'Recorded at: ${evidence.tombstone!.at}',
                  )
                else if (evidence.quote != null &&
                    evidence.status == 'available')
                  SelectableText(evidence.quote!),
              ],
            ],
            Wrap(
              spacing: t.spaceInline,
              runSpacing: t.spaceInline,
              children: [
                TextButton(
                  onPressed: memory.canWrite
                      ? () => _edit('correct', item)
                      : null,
                  child: const LinaText('Correct'),
                ),
                TextButton(
                  onPressed: memory.canWrite
                      ? () => _edit('forget', item)
                      : null,
                  child: const LinaText('Forget'),
                ),
              ],
            ),
            ExpansionTile(
              trailing: LinaText(t.glyphUnicodeOverflow),
              title: const LinaText('Other memory actions'),
              children: const [
                LinaText(
                  'Moving between layers and permanent deletion are not '
                  'available from Core in this app yet.',
                ),
                TextButton(onPressed: null, child: LinaText('Move layer')),
                TextButton(
                  onPressed: null,
                  child: LinaText('Permanently delete'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _editor() {
    final t = LinaTokens.of(context);
    final forgetting = operation == 'forget';
    final composing =
        text.value.composing.isValid && !text.value.composing.isCollapsed;
    return Card(
      child: Padding(
        padding: EdgeInsets.all(t.spaceGutter),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            LinaText(
              forgetting ? 'Confirm forgetting' : 'Review memory change',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (operation == 'remember') ...[
              DropdownButtonFormField<String>(
                initialValue: holder,
                decoration: const InputDecoration(labelText: 'Save to layer'),
                items: [
                  for (final id in [widget.agentId, 'all'])
                    DropdownMenuItem(value: id, child: LinaText(_layer(id))),
                ],
                onChanged: memory.writing
                    ? null
                    : (value) => setState(() => holder = value!),
              ),
              DropdownButtonFormField<String>(
                initialValue: scope,
                decoration: const InputDecoration(labelText: 'Privacy scope'),
                items: [
                  for (final value in ['local', 'private', 'never-leaves'])
                    DropdownMenuItem(value: value, child: LinaText(value)),
                ],
                onChanged: memory.writing
                    ? null
                    : (value) => setState(() => scope = value!),
              ),
            ],
            SizedBox(height: t.spaceInline),
            LinaText(
              '${forgetting ? 'Remove from' : 'Save to'}: ${_layer(holder)} · Scope: $scope',
            ),
            if (holder == 'all')
              const LinaText('This change applies to every agent.'),
            if (forgetting) ...[
              SelectableText(editing!.content),
              const LinaText(
                'Ask Core to forget this item and exclude it from recall. '
                'Core owns removal of derived data and the deletion record. '
                'Original conversation turns stay. This is not permanent deletion.',
              ),
            ] else
              TextField(
                key: const ValueKey('memory-text'),
                controller: text,
                readOnly: memory.writing,
                maxLines: null,
                decoration: const InputDecoration(
                  labelText: 'Memory statement',
                ),
              ),
            SizedBox(height: t.spaceInline),
            Wrap(
              spacing: t.spaceInline,
              children: [
                FilledButton(
                  onPressed:
                      memory.canWrite &&
                          !composing &&
                          (forgetting || text.text.trim().isNotEmpty)
                      ? () => unawaited(_submit())
                      : null,
                  child: LinaText(
                    forgetting ? 'Confirm forget' : 'Send memory request',
                  ),
                ),
                TextButton(
                  onPressed: memory.writing
                      ? null
                      : () => setState(() {
                          operation = null;
                          editing = null;
                          text.clear();
                        }),
                  child: const LinaText('Cancel'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
