// SPDX-License-Identifier: Apache-2.0
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lina_design/lina_design.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'agent_mark.dart';
import 'conversation_controller.dart';

class AgentsPanel extends StatelessWidget {
  const AgentsPanel({super.key, required this.conversation});
  final ConversationController conversation;

  @override
  Widget build(BuildContext context) {
    final t = LinaTokens.of(context);
    return ListView(
      padding: EdgeInsets.all(t.spaceGutter),
      children: [
        LinaText('Agents', style: Theme.of(context).textTheme.titleLarge),
        SizedBox(height: t.spaceInline),
        const LinaText(
          'Choose who to talk with. Your workspace, tools and devices stay the same.',
        ),
        SizedBox(height: t.spaceInline),
        Wrap(
          spacing: t.spaceInline,
          children: [
            TextButton(
              onPressed: conversation.canManageAgents
                  ? () => _name(context)
                  : null,
              child: const LinaText('New agent'),
            ),
            TextButton(
              onPressed:
                  !conversation.agentBusy &&
                      conversation.core.phase == ConnectionPhase.connected &&
                      conversation.core.hasCapability('agents')
                  ? () => unawaited(conversation.refreshAgents())
                  : null,
              child: const LinaText('Refresh agents'),
            ),
          ],
        ),
        if (!conversation.core.hasCapability('agents'))
          const LinaText('Agent management is unavailable on this connection.'),
        if (conversation.agents.isEmpty)
          const LinaText(
            'No agents yet. Create an agent to start a conversation.',
          ),
        for (final agent in conversation.agents)
          Padding(
            padding: EdgeInsets.only(top: t.spaceSection),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const AgentMark(),
                    SizedBox(width: t.spaceInline),
                    Expanded(
                      child: LinaText(
                        agent.name,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    if (agent.agentId == conversation.selectedId)
                      const LinaText('Selected'),
                  ],
                ),
                if (agent.preset != null) LinaText('Preset: ${agent.preset}'),
                Wrap(
                  spacing: t.spaceInline,
                  children: [
                    TextButton(
                      onPressed: conversation.canChooseAgent
                          ? () async {
                              await conversation.choose(agent.agentId);
                              if (context.mounted &&
                                  conversation.selectedId == agent.agentId &&
                                  !conversation.agentsUncertain)
                                conversation.navigate('Home');
                            }
                          : null,
                      child: LinaText('Talk with ${agent.name}'),
                    ),
                    TextButton(
                      key: ValueKey('rename:${agent.agentId}'),
                      onPressed: conversation.canManageAgents
                          ? () => _name(context, agent: agent)
                          : null,
                      child: const LinaText('Rename'),
                    ),
                    TextButton(
                      key: ValueKey('delete:${agent.agentId}'),
                      onPressed: conversation.canManageAgents
                          ? () => _delete(context, agent)
                          : null,
                      child: const LinaText('Delete'),
                    ),
                  ],
                ),
              ],
            ),
          ),
      ],
    );
  }

  Future<void> _name(BuildContext context, {ProtocolAgent? agent}) =>
      showDialog<void>(
        context: context,
        builder: (_) =>
            _AgentNameDialog(conversation: conversation, agent: agent),
      );

  Future<void> _delete(BuildContext context, ProtocolAgent agent) async {
    final welcome = conversation.core.welcome;
    await showDialog<void>(
      context: context,
      builder: (context) => ListenableBuilder(
        listenable: conversation,
        builder: (context, _) => AlertDialog(
          title: LinaText(
            'Delete ${agent.name}?',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const LinaText(
                  'Core will remove this agent from your list and end its channel bindings. Shared knowledge stays. Restore is not available in this app.',
                ),
                if (conversation.agentFeedback != null)
                  Semantics(
                    liveRegion: true,
                    child: LinaText(conversation.agentFeedback!),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const LinaText('Cancel'),
            ),
            TextButton(
              onPressed:
                  conversation.canManageAgents &&
                      identical(welcome, conversation.core.welcome) &&
                      conversation.agents.any((a) => a.agentId == agent.agentId)
                  ? () async {
                      final applied = await conversation.deleteAgent(
                        agent.agentId,
                      );
                      if (applied && context.mounted) Navigator.pop(context);
                    }
                  : null,
              child: const LinaText('Delete agent'),
            ),
          ],
        ),
      ),
    );
  }
}

class _AgentNameDialog extends StatefulWidget {
  const _AgentNameDialog({required this.conversation, this.agent});
  final ConversationController conversation;
  final ProtocolAgent? agent;
  @override
  State<_AgentNameDialog> createState() => _AgentNameDialogState();
}

class _AgentNameDialogState extends State<_AgentNameDialog> {
  late final TextEditingController name;
  ProtocolWelcome? welcome;
  @override
  void initState() {
    super.initState();
    // Capture connection identity when the form opens, before its first edit.
    name = TextEditingController(text: widget.agent?.name);
    welcome = widget.conversation.core.welcome;
  }

  @override
  void dispose() {
    name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([widget.conversation, name]),
    builder: (context, _) {
      final conversation = widget.conversation;
      final agent = widget.agent;
      final sameConnection = identical(welcome, conversation.core.welcome);
      final valid =
          sameConnection &&
          conversation.canManageAgents &&
          name.text.trim().isNotEmpty &&
          !(name.value.composing.isValid &&
              !name.value.composing.isCollapsed) &&
          (agent == null ||
              conversation.agents.any((a) => a.agentId == agent.agentId));
      return AlertDialog(
        title: LinaText(
          agent == null ? 'New agent' : 'Rename ${agent.name}',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (agent == null) ...[
                const LinaText('Lina preset'),
                const LinaText(
                  'Create a companion from Lina. More presets are not available yet.',
                ),
              ],
              TextField(
                key: const ValueKey('agent-name'),
                controller: name,
                autofocus: true,
                enabled: !conversation.agentBusy && sameConnection,
                decoration: const InputDecoration(labelText: 'Name'),
              ),
              if (!sameConnection)
                const LinaText(
                  'Connection changed. Close and reopen this form.',
                ),
              if (conversation.agentFeedback != null)
                Semantics(
                  liveRegion: true,
                  child: LinaText(conversation.agentFeedback!),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const LinaText('Cancel'),
          ),
          TextButton(
            onPressed: valid
                ? () async {
                    final applied = agent == null
                        ? await conversation.createAgent(name.text)
                        : await conversation.renameAgent(
                            agent.agentId,
                            name.text,
                          );
                    if (applied && context.mounted) Navigator.pop(context);
                  }
                : null,
            child: LinaText(agent == null ? 'Create' : 'Save name'),
          ),
        ],
      );
    },
  );
}
