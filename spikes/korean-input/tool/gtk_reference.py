#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Native GTK comparison field. Receipts deliberately remain in the Flutter app."""
import json
import gi

gi.require_version('Gtk', '3.0')
from gi.repository import Gtk  # noqa: E402

window = Gtk.Window(title='GTK Korean reference')
window.set_default_size(1000, 720)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=24)
box.set_border_width(48)
window.add(box)
box.pack_start(Gtk.Label(label='Native GTK TextView · synthetic text only'), False, False, 0)
field = Gtk.TextView()
field.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
field.set_size_request(600, 140)
box.pack_start(field, False, False, 0)
button = Gtk.Button(label='Focus target')
box.pack_start(button, False, False, 0)
buffer = field.get_buffer()


def trace(event, preedit=None):
    print('GTK_TRACE ' + json.dumps({
        'event': event,
        'text': buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), True),
        'cursor': buffer.get_property('cursor-position'),
        'preedit': preedit,
        'focused': field.has_focus(),
    }, ensure_ascii=False), flush=True)


buffer.connect('changed', lambda *_: trace('edit'))
field.connect('preedit-changed', lambda _, text: trace('preedit', text))
field.connect('focus-in-event', lambda *_: trace('focus-in'))
field.connect('focus-out-event', lambda *_: trace('focus-out'))
window.connect('destroy', Gtk.main_quit)
window.show_all()
field.grab_focus()
Gtk.main()
