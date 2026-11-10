// SPDX-License-Identifier: AGPL-3.0-only
//! Shared GPUI screens. Platform entry points (`src/entry/`, `web/`) only open
//! the app with [`launch`]; everything drawn is in this crate, and every data
//! rule is in `lina-core`.

mod bench;
mod core_model;
mod root;
mod text_input;
mod theme;
mod view_render;

use std::time::Instant;

use gpui::{
    App, AppContext, Bounds, KeyBinding, Menu, MenuItem, SharedString, SystemNotification, TitlebarOptions,
    WindowBounds, WindowOptions, point, px, size,
};
use lina_core::{EventSource, State};

pub use core_model::CoreModel;
pub use text_input::{TextInput, bind_text_input_keys};

/// What an entry point may choose; the screens decide the rest.
pub struct LaunchOptions {
    pub state: State,
    pub source: Box<dyn EventSource>,
    pub conversation: Option<String>,
    pub draft: Option<String>,
    /// `None` lets the platform size the window (phone, browser canvas).
    pub window: Option<((f32, f32), (f32, f32))>,
    /// Scroll the open conversation to its end by itself and log frame gaps.
    pub bench: bool,
    /// Open this view at start (on a phone: the view screen instead of the conversation).
    pub open_view: Option<String>,
    /// Log the text field's content and marked (IME) range on every change.
    pub log_input: bool,
    /// Post one system notification at start and log that it was posted.
    pub notify_test: bool,
    /// Process start, for the first-frame time; `None` where `Instant` is unavailable.
    pub started: Option<Instant>,
    /// Font family for all text, where the platform has no system font (web).
    pub font_family: Option<SharedString>,
}

gpui::actions!(lina, [Quit]);

pub fn launch(cx: &mut App, options: LaunchOptions) {
    bind_text_input_keys(cx);
    cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
    cx.on_action(|_: &Quit, cx| cx.quit());
    cx.set_menus([Menu::new("LINA").items([MenuItem::action("LINA 종료", Quit)])]);
    if options.notify_test {
        cx.show_system_notification(SystemNotification {
            tag: "lina-proto-notify-test".into(),
            title: "LINA".into(),
            body: "알림 시험".into(),
            actions: Vec::new(),
        });
        eprintln!("lina-ui: system notification posted");
    }

    let core = cx.new(|cx| CoreModel::start(options.state, options.source, cx));
    let window_bounds = options.window.map(|((x, y), (width, height))| {
        WindowBounds::Windowed(Bounds::new(point(px(x), px(y)), size(px(width), px(height))))
    });
    let root_options = root::RootOptions {
        conversation: options.conversation,
        draft: options.draft,
        bench: options.bench,
        log_input: options.log_input,
        open_view: options.open_view,
        started: options.started,
        font_family: options.font_family,
    };
    let window = cx
        .open_window(
            WindowOptions {
                window_bounds,
                titlebar: Some(TitlebarOptions {
                    title: Some("LINA".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            |window, cx| cx.new(|cx| root::Root::new(core, root_options, window, cx)),
        )
        .expect("open the main window");
    window
        .update(cx, |root, window, cx| {
            root.focus_input(window, cx);
            cx.activate(true);
        })
        .expect("focus the main window");
}
