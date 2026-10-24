// SPDX-License-Identifier: Apache-2.0
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

void main() => runApp(const KoreanInputApp());

class KoreanInputApp extends StatelessWidget {
  const KoreanInputApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Korean input research',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff31584d)),
      scaffoldBackgroundColor: const Color(0xfff5f4ef),
    ),
    home: const Composer(),
  );
}

/// A local-only instrumented field; receipts are not Core acknowledgements.
class Composer extends StatefulWidget {
  const Composer({super.key});

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _controller = TextEditingController();
  final _focus = FocusNode();
  bool _wasComposing = false;
  bool _commitTurn = false;
  int _committedCharacters = 0;
  int _sent = 0;
  int _markers = 0;
  String _receipt = '';

  bool get _composing =>
      _controller.value.composing.isValid &&
      !_controller.value.composing.isCollapsed;
  bool get _imeOwnsInput => _composing || _commitTurn;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_edited);
    _focus.addListener(_focusChanged);
  }

  void _trace(String event) {
    if (!const bool.fromEnvironment('IME_TRACE')) return;
    final value = _controller.value;
    // Opt-in research diagnostics: use synthetic input only.
    // ignore: avoid_print
    print(
      'IME_TRACE ${jsonEncode({
        'event': event,
        'text': value.text,
        'selection': [value.selection.baseOffset, value.selection.extentOffset],
        'composing': [value.composing.start, value.composing.end],
        'focused': _focus.hasFocus,
        'sent': _sent,
        'receipt': _receipt,
        'markers': _markers,
        'committedCharacters': _committedCharacters,
      })}',
    );
  }

  void _focusChanged() => _trace('focus');

  void _edited() {
    final composing = _composing;
    if (_wasComposing && !composing) {
      // IMEs may commit text and forward the same key in one event turn.
      _commitTurn = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() => _commitTurn = false);
      });
    }
    _wasComposing = composing;
    setState(() {
      // Read only. Never normalize, truncate or write into an IME preedit.
      if (!composing) {
        _committedCharacters = _controller.text.characters.length;
      }
    });
    _trace('edit');
  }

  void _send() {
    if (_imeOwnsInput || _controller.text.isEmpty) return;
    setState(() {
      _receipt = _controller.text;
      _sent += 1;
    });
    _trace('send');
    // The local sink accepts synchronously. Clear only after that receipt.
    _controller.clear();
  }

  KeyEventResult _key(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final enter =
        event.logicalKey == LogicalKeyboardKey.enter ||
        event.logicalKey == LogicalKeyboardKey.numpadEnter;
    final marker = event.logicalKey == LogicalKeyboardKey.f9;
    if (!enter && !marker) return KeyEventResult.ignored;
    _trace('key:${event.logicalKey.keyLabel}');
    // Leave composition keys to EditableText/the native IME, including F9
    // (fcitx5-hangul's Hanja conversion key). Do not queue a later send.
    if (_imeOwnsInput) return KeyEventResult.ignored;
    final keyboard = HardwareKeyboard.instance;
    if (enter &&
        keyboard.isShiftPressed &&
        !keyboard.isControlPressed &&
        !keyboard.isAltPressed &&
        !keyboard.isMetaPressed) {
      if (event is KeyDownEvent) {
        final value = _controller.value;
        if (value.selection.isValid) {
          _controller.value = value.replaced(value.selection, '\n');
        }
      }
      return KeyEventResult.handled;
    }
    if (keyboard.isControlPressed ||
        keyboard.isAltPressed ||
        keyboard.isMetaPressed ||
        keyboard.isShiftPressed) {
      return KeyEventResult.ignored;
    }
    if (event is KeyRepeatEvent) return KeyEventResult.handled;
    if (enter) {
      _send();
    } else {
      setState(() => _markers += 1);
      _trace('marker');
    }
    return KeyEventResult.handled;
  }

  @override
  void dispose() {
    _controller.removeListener(_edited);
    _controller.dispose();
    _focus.removeListener(_focusChanged);
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Korean input',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 8),
                const Text('Local composer research · synthetic text only'),
                const SizedBox(height: 24),
                Focus(
                  onKeyEvent: _key,
                  child: TextField(
                    controller: _controller,
                    focusNode: _focus,
                    autofocus: true,
                    minLines: 3,
                    maxLines: 6,
                    keyboardType: TextInputType.multiline,
                    textInputAction: TextInputAction.newline,
                    enableSuggestions: true,
                    autocorrect: true,
                    // Do not let the default completion callback clear preedit
                    // or move focus before the guarded platform send action.
                    onEditingComplete: () {},
                    onSubmitted: (_) => _send(),
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      labelText: 'Message',
                      hintText: '동해물과 백두산이',
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Enter sends · Shift+Enter adds a line · F9 adds a marker',
                ),
                const Text(
                  'While composing, the input method owns these keys.',
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _send,
                  child: const Text('Send locally'),
                ),
                const SizedBox(height: 20),
                Text('Composition: ${_composing ? 'active' : 'idle'}'),
                Text('Committed characters: $_committedCharacters'),
                Text('Markers: $_markers'),
                Text(_sent == 0 ? 'Sent 0' : 'Sent $_sent: $_receipt'),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
