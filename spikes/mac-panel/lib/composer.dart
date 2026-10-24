// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Uses Flutter's NSTextInputClient bridge; never rewrites marked text.
class PanelComposer extends StatefulWidget {
  const PanelComposer({
    super.key,
    required this.onSubmit,
    this.onDismiss,
    this.readOnly = false,
  });
  final ValueChanged<String> onSubmit;
  final VoidCallback? onDismiss;
  final bool readOnly;
  @override
  State<PanelComposer> createState() => _PanelComposerState();
}

class _PanelComposerState extends State<PanelComposer> {
  final _controller = TextEditingController();
  bool _wasComposing = false;
  bool _commitGuard = false;
  int _revision = 0;
  bool get _composing =>
      _controller.value.composing.isValid &&
      !_controller.value.composing.isCollapsed;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() {
      final revision = ++_revision;
      if (_wasComposing || _composing) _commitGuard = true;
      if (!_composing) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && revision == _revision) _commitGuard = false;
        });
        WidgetsBinding.instance.scheduleFrame();
      }
      _wasComposing = _composing;
    });
  }

  KeyEventResult _key(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent || _composing || _commitGuard)
      return KeyEventResult.ignored;
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      widget.onDismiss?.call();
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter &&
        !HardwareKeyboard.instance.isShiftPressed) {
      final text = _controller.text;
      if (text.trim().isNotEmpty) {
        widget.onSubmit(text);
        _controller.clear();
      }
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) => Focus(
    onKeyEvent: _key,
    child: TextField(
      controller: _controller,
      autofocus: !widget.readOnly,
      readOnly: widget.readOnly,
      minLines: 1,
      maxLines: 3,
      textInputAction: TextInputAction.newline,
      autocorrect: false,
      enableSuggestions: false,
      decoration: const InputDecoration(
        labelText: 'Ask or search',
        hintText: 'Type in Korean or English',
        border: OutlineInputBorder(),
      ),
    ),
  );
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
}
