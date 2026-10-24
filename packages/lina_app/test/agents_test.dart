// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lina_app/conversation_controller.dart';
import 'package:lina_protocol/lina_protocol.dart';

import 'conversation_test.dart' show mount, composer, choose;
import 'support/conversation_core.dart';

const lina = {'agent_id': 'lina', 'name': 'Lina', 'preset': 'lina'};
const sion = {'agent_id': 'sion', 'name': 'Sion', 'preset': 'dev'};

Envelope agentReply(
  String op,
  List<Map<String, dynamic>> agents, {
  String? id,
}) => event('agent_result', {
  'operation': op,
  if (id != null) 'agent_id': id,
  'agents': agents,
}, effect: op == 'choose' || op == 'list' ? 'none' : 'applied');

void main() {
  testWidgets('one agent opens directly with no conversation switcher', (
    tester,
  ) async {
    final core = ConversationCore()..live(agents: [lina]);
    await mount(tester, core);
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    expect(find.text('Main conversation · Lina'), findsOneWidget);
  });

  testWidgets('switch waits for Core and blocks sending the old draft', (
    tester,
  ) async {
    final core = ConversationCore();
    await mount(tester, core);
    await tester.enterText(composer, 'only for Lina');
    core.holdAgents = true;
    await choose(tester, 'Sion');
    expect(core.requests.last.kind, 'agent_request');
    expect(core.requests.last.payload.toJson(), {
      'operation': 'choose',
      'agent_id': 'sion',
    });
    expect(
      tester.widget<TextField>(composer).controller!.text,
      'only for Lina',
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
    core.agentReplies.single.complete(
      agentReply('choose', [lina, sion], id: 'sion'),
    );
    await tester.pumpAndSettle();
    expect(find.text('Main conversation · Sion'), findsOneWidget);
    expect(tester.widget<TextField>(composer).controller!.text, isEmpty);
  });

  testWidgets('agent list creates only after an applied Core result', (
    tester,
  ) async {
    final core = ConversationCore();
    await mount(tester, core);
    await tester.tap(find.text('Agents'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New agent'));
    await tester.pumpAndSettle();
    expect(find.text('Lina preset'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('agent-name')), 'Mira');
    await tester.pump();
    core.holdAgents = true;
    await tester.tap(find.text('Create'));
    await tester.pump();
    expect(core.requests.last.payload.toJson(), {
      'operation': 'create',
      'name': 'Mira',
    });
    expect(find.text('Talk with Mira'), findsNothing);
    core.agentReplies.single.complete(
      agentReply('create', [
        lina,
        sion,
        {'agent_id': 'mira', 'name': 'Mira', 'preset': 'lina'},
      ], id: 'mira'),
    );
    await tester.pumpAndSettle();
    expect(find.text('Talk with Mira'), findsOneWidget);
    expect(find.text('Main conversation · Lina'), findsOneWidget);
  });

  testWidgets('native stale submit callback cannot send another agent draft', (
    tester,
  ) async {
    final core = ConversationCore();
    await mount(tester, core);
    final oldSubmit = tester.widget<TextField>(composer).onSubmitted!;
    await choose(tester, 'Sion');
    await tester.enterText(composer, 'Sion draft');
    oldSubmit('old Lina callback');
    await tester.pump();
    expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
  });

  testWidgets(
    'reconnecting to another person never reuses the previous draft',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      await tester.enterText(composer, 'private Lina draft');
      core.drop();
      core.welcome = ProtocolWelcome.fromJson({
        ...core.welcome!.toJson(),
        'person_id': 'another-person',
      });
      core.phase = ConnectionPhase.connected;
      core.updates.add(null);
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(composer).controller!.text, isEmpty);
    },
  );

  testWidgets('removed agent does not fall back to the remaining partner', (
    tester,
  ) async {
    final core = ConversationCore();
    final controller = ConversationController(core);
    addTearDown(controller.dispose);
    addTearDown(core.dispose);
    await tester.pump();
    controller.selected.draft.text = 'for Lina';
    core.live(agents: [sion]);
    await tester.pump();
    expect(controller.canSend, isFalse);
    expect(controller.selected.draft.text, 'for Lina');
    await controller.choose('deleted-link');
    expect(controller.selectedId, 'lina');
  });
  testWidgets(
    'rename and confirmed delete use Core state and preserve only the draft',
    (tester) async {
      final core = ConversationCore();
      core.snapshots['lina'] = [
        {
          'kind': 'item_done',
          'key': 'private',
          'revision': 1,
          'payload': {'speaker': 'agent', 'text': 'Private conversation'},
        },
      ];
      await mount(tester, core);
      await tester.enterText(composer, 'Lina draft');
      await tester.tap(find.text('Agents'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('rename:lina')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('agent-name')),
        'Lina renamed',
      );
      await tester.pump();
      core.holdAgents = true;
      await tester.tap(find.text('Save name'));
      await tester.pump();
      expect(core.requests.last.payload.toJson(), {
        'operation': 'rename',
        'agent_id': 'lina',
        'name': 'Lina renamed',
      });
      expect(find.text('Main conversation · Lina'), findsOneWidget);
      final renamed = {...lina, 'name': 'Lina renamed'};
      core.agentReplies.last.complete(
        agentReply('rename', [renamed, sion], id: 'lina'),
      );
      await tester.pumpAndSettle();
      expect(find.text('Main conversation · Lina renamed'), findsOneWidget);
      expect(tester.widget<TextField>(composer).controller!.text, 'Lina draft');
      await tester.tap(find.byKey(const ValueKey('delete:lina')));
      await tester.pumpAndSettle();
      final count = core.requests.length;
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(core.requests.length, count);
      await tester.tap(find.byKey(const ValueKey('delete:lina')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete agent'));
      await tester.pump();
      expect(core.requests.last.payload.toJson(), {
        'operation': 'delete',
        'agent_id': 'lina',
      });
      expect(find.text('Main conversation · Lina renamed'), findsOneWidget);
      core.agentReplies.last.complete(agentReply('delete', [sion], id: 'lina'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      expect(find.text('Private conversation'), findsNothing);
      expect(tester.widget<TextField>(composer).controller!.text, 'Lina draft');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
      core.holdAgents = false;
      core.live(agents: [sion]);
      await tester.pumpAndSettle();
      await choose(tester, 'Sion');
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      expect(tester.widget<TextField>(composer).controller!.text, isEmpty);
    },
  );

  testWidgets(
    'uncertain mutation requires a read before another attempt and never replays',
    (tester) async {
      final core = ConversationCore();
      final controller = ConversationController(core);
      addTearDown(controller.dispose);
      addTearDown(core.dispose);
      await tester.pump();
      core.answers['agent_request'] = event(
        'agent_result',
        {},
        effect: 'unknown',
      );
      expect(await controller.createAgent('Mira'), isFalse);
      expect(controller.agentsUncertain, isTrue);
      final count = core.requests.length;
      expect(await controller.createAgent('Mira'), isFalse);
      expect(core.requests.length, count);
      core.answers['agent_request'] = agentReply('list', [lina, sion]);
      await controller.refreshAgents();
      expect(controller.canManageAgents, isTrue);
      expect(
        core.requests.where((r) => r.payload.json['operation'] == 'create'),
        hasLength(1),
      );
      expect(controller.agents, hasLength(2));
    },
  );

  testWidgets('refused or mismatched selection cannot enable a new recipient', (
    tester,
  ) async {
    final core = ConversationCore();
    final controller = ConversationController(core);
    addTearDown(controller.dispose);
    addTearDown(core.dispose);
    await tester.pump();
    controller.selected.draft.text = 'Lina only';
    core.answers['agent_request'] = event(
      'error',
      {},
      effect: 'refused',
      error: {
        ...fixture('unsupported_combination')['error'] as Map<String, dynamic>,
        'code': 'out_of_scope',
      },
    );
    await controller.choose('sion');
    expect(controller.selectedId, 'lina');
    expect(controller.selected.draft.text, 'Lina only');
    core.answers['agent_request'] = agentReply('choose', [
      lina,
      sion,
    ], id: 'lina');
    await controller.choose('sion');
    expect(controller.selectedId, 'lina');
    expect(controller.canSend, isFalse);
    core.answers['agent_request'] = agentReply('list', [lina, sion]);
    await controller.refreshAgents();
    expect(controller.selectedId, 'lina');
    expect(controller.canSend, isTrue);
  });

  testWidgets(
    'old connection reply cannot replace catalog or unlock a newer request',
    (tester) async {
      final core = ConversationCore();
      final controller = ConversationController(core);
      addTearDown(controller.dispose);
      addTearDown(core.dispose);
      await tester.pump();
      core.holdAgents = true;
      final old = controller.renameAgent('lina', 'Old name');
      core.drop();
      core.live(epoch: '43');
      await tester.pump();
      final newer = controller.renameAgent('sion', 'Sion renamed');
      expect(core.agentReplies, hasLength(2));
      core.agentReplies.first.complete(
        agentReply('rename', [
          {...lina, 'name': 'Old name'},
          sion,
        ], id: 'lina'),
      );
      await old;
      expect(controller.agentBusy, isTrue);
      expect(controller.selectedName, 'Lina');
      core.agentReplies.last.complete(
        agentReply('rename', [
          lina,
          {...sion, 'name': 'Sion renamed'},
        ], id: 'sion'),
      );
      await newer;
      await tester.pump();
      expect(controller.agentBusy, isFalse);
      expect(controller.selectedName, 'Lina');
    },
  );

  testWidgets(
    'unsupported management sends no mutation and retains conversation',
    (tester) async {
      final core = ConversationCore();
      core.welcome = ProtocolWelcome.fromJson({
        ...core.welcome!.toJson(),
        'capabilities': [
          {'name': 'conversation', 'version': '1.0'},
        ],
      });
      final controller = ConversationController(core);
      addTearDown(controller.dispose);
      addTearDown(core.dispose);
      await tester.pump();
      expect(await controller.createAgent('Mira'), isFalse);
      expect(await controller.renameAgent('lina', 'Name'), isFalse);
      expect(await controller.deleteAgent('lina'), isFalse);
      expect(core.requests.where((r) => r.kind == 'agent_request'), isEmpty);
      await controller.choose('sion');
      expect(controller.selectedId, 'sion');
      expect(controller.selected.conversationId, 'sion-main');
    },
  );

  testWidgets(
    'simultaneous switches serialize and keep mid-turn input with its agent',
    (tester) async {
      final core = ConversationCore();
      final controller = ConversationController(core);
      addTearDown(controller.dispose);
      addTearDown(core.dispose);
      await tester.pump();
      controller.selected.draft.text = 'while Lina works';
      core.stream('lina', 1, 'turn', 'turn_state', {
        'active': true,
        'agent_id': 'lina',
      });
      core.holdAgents = true;
      final pending = controller.choose('sion');
      await controller.choose('lina');
      await controller.send();
      expect(core.agentReplies, hasLength(1));
      expect(core.requests.where((r) => r.kind == 'input'), isEmpty);
      core.agentReplies.single.complete(
        agentReply('choose', [lina, sion], id: 'sion'),
      );
      await pending;
      controller.selected.draft.text = 'Sion only';
      final sent = controller.send();
      expect(core.requests.last.payload.json['conversation_id'], 'sion-main');
      core.pending.last.complete(event('item_done', {}, effect: 'applied'));
      await sent;
      core.holdAgents = false;
      await controller.choose('lina');
      expect(controller.selected.active, isTrue);
      expect(controller.selected.draft.text, 'while Lina works');
    },
  );
  testWidgets('refused switch restores the visible dropdown selection', (
    tester,
  ) async {
    final core = ConversationCore();
    await mount(tester, core);
    core.answers['agent_request'] = event(
      'error',
      {},
      effect: 'refused',
      error: {'code': 'out_of_scope', 'detail': 'Unavailable agent'},
    );
    await choose(tester, 'Sion');
    expect(
      tester
          .widget<DropdownButton<String>>(find.byType(DropdownButton<String>))
          .value,
      'lina',
    );
    expect(find.text('Main conversation · Lina'), findsOneWidget);
  });

  testWidgets(
    'reconnect reads Core selection without replaying choose or moving drafts',
    (tester) async {
      final core = ConversationCore();
      final controller = ConversationController(core);
      addTearDown(controller.dispose);
      addTearDown(core.dispose);
      await tester.pump();
      controller.selected.draft.text = 'Lina private draft';
      core.drop();
      core.selectedAgent = 'sion';
      core.live(epoch: '43');
      await tester.pump();
      expect(controller.selectedId, 'sion');
      expect(controller.selected.draft.text, isEmpty);
      expect(
        core.requests.where((r) => r.payload.json['operation'] == 'choose'),
        isEmpty,
      );
      await controller.choose('lina');
      expect(controller.selected.draft.text, 'Lina private draft');
    },
  );

  testWidgets(
    'a form opened before reconnect cannot mutate the new connection',
    (tester) async {
      final core = ConversationCore();
      await mount(tester, core);
      await tester.tap(find.text('Agents'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('New agent'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('agent-name')), 'Mira');
      core.drop();
      core.live(epoch: '43');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Create'));
      expect(
        core.requests.where((r) => r.payload.json['operation'] == 'create'),
        isEmpty,
      );
      expect(
        find.text('Connection changed. Close and reopen this form.'),
        findsOneWidget,
      );
    },
  );
  testWidgets(
    'refresh after uncertain deletion retains the missing agent draft',
    (tester) async {
      final core = ConversationCore();
      final controller = ConversationController(core);
      addTearDown(controller.dispose);
      addTearDown(core.dispose);
      await tester.pump();
      controller.selected.draft.text = 'For the deleted agent';
      core.answers['agent_request'] = event(
        'agent_result',
        {},
        effect: 'unknown',
      );
      await controller.deleteAgent('lina');
      core.answers['agent_request'] = agentReply('list', [sion]);
      core.selectedAgent = 'sion';
      await controller.refreshAgents();
      expect(controller.selectedId, 'lina');
      expect(controller.selected.draft.text, 'For the deleted agent');
      expect(controller.canSend, isFalse);
    },
  );
  testWidgets(
    'creating the first agent opens its main conversation without a switcher',
    (tester) async {
      final core = ConversationCore()..live(agents: []);
      await mount(tester, core);
      await tester.tap(find.text('Agents'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('New agent'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('agent-name')), 'Mira');
      await tester.pump();
      core.answers['agent_request'] = agentReply('create', [
        {'agent_id': 'mira', 'name': 'Mira', 'preset': 'lina'},
      ], id: 'mira');
      core.selectedAgent = 'mira';
      await tester.tap(find.text('Create'));
      await tester.pumpAndSettle();
      expect(find.text('Main conversation · Mira'), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      expect(find.text('New agent'), findsNothing);
    },
  );

  testWidgets('an error with unknown effect still fences mutation and input', (
    tester,
  ) async {
    final core = ConversationCore();
    final controller = ConversationController(core);
    addTearDown(controller.dispose);
    addTearDown(core.dispose);
    await tester.pump();
    core.answers['agent_request'] = event(
      'error',
      {},
      effect: 'unknown',
      error: {'code': 'unavailable', 'detail': 'Receipt unavailable'},
    );
    await controller.choose('sion');
    expect(controller.canManageAgents, isFalse);
    expect(controller.canSend, isFalse);
    final count = core.requests.length;
    await controller.createAgent('Mira');
    expect(core.requests.length, count);
  });
}
