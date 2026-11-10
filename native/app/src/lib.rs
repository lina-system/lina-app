// SPDX-License-Identifier: Apache-2.0
//! Shared GPUI screens. Platform entry points (`src/entry/`) only open the app
//! with [`launch`]; everything drawn is in this crate, and every data rule is in
//! `lina-core`.

mod core_model;
mod root;
mod text_input;
mod theme;
mod view_render;

use gpui::{App, AppContext, Bounds, KeyBinding, TitlebarOptions, WindowBounds, WindowOptions, point, px, size};
use lina_core::{EventSource, State};

pub use core_model::CoreModel;
pub use text_input::{TextInput, bind_text_input_keys};

/// What an entry point may choose; the screens decide the rest.
pub struct LaunchOptions {
    pub state: State,
    pub source: Box<dyn EventSource>,
    pub conversation: Option<String>,
    pub draft: Option<String>,
    pub window_origin: (f32, f32),
    pub window_size: (f32, f32),
}

gpui::actions!(lina, [Quit]);

pub fn launch(cx: &mut App, options: LaunchOptions) {
    bind_text_input_keys(cx);
    cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
    cx.on_action(|_: &Quit, cx| cx.quit());

    let core = cx.new(|cx| CoreModel::start(options.state, options.source, cx));
    let bounds = Bounds::new(
        point(px(options.window_origin.0), px(options.window_origin.1)),
        size(px(options.window_size.0), px(options.window_size.1)),
    );
    let conversation = options.conversation;
    let draft = options.draft;
    let window = cx
        .open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("LINA".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            |window, cx| cx.new(|cx| root::Root::new(core, conversation, draft, window, cx)),
        )
        .expect("open the main window");
    window
        .update(cx, |root, window, cx| {
            root.focus_input(window, cx);
            cx.activate(true);
        })
        .expect("focus the main window");
}
