// SPDX-License-Identifier: AGPL-3.0-only
//! macOS entry point. The iOS (`ios.rs`) and web (`native/web/`) entry points
//! call the same `lina_ui::launch`.
//!
//! Flags: `--conversation <id>`, `--draft <text>`, `--open-view <view id>`, `--bench` (1,000 extra
//! messages, no live events, automatic scroll), `--log-input`, `--notify-test`.

use std::time::Instant;

use lina_core::EventSource;
use lina_core::synthetic::{self, QuietSource, SyntheticSource};
use lina_ui::{LaunchOptions, launch};

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1).cloned())
}

fn main() {
    let started = Instant::now();
    let args: Vec<String> = std::env::args().collect();
    let has = |name: &str| args.iter().any(|arg| arg == name);
    let bench = has("--bench");
    let mut state = synthetic::seed();
    let mut conversation = flag(&args, "--conversation");
    let source: Box<dyn EventSource> = if bench {
        let added = synthetic::add_bulk_messages(&mut state, "c-weekly", 1000);
        eprintln!("lina-bench: added {added} messages to c-weekly");
        conversation = Some("c-weekly".into());
        Box::new(QuietSource)
    } else {
        Box::new(SyntheticSource::new())
    };
    let options = LaunchOptions {
        state,
        source,
        conversation,
        draft: flag(&args, "--draft"),
        open_view: flag(&args, "--open-view"),
        window: Some(((40., 60.), (1280., 800.))),
        bench,
        log_input: has("--log-input"),
        notify_test: has("--notify-test"),
        font_family: None,
        started: Some(started),
    };
    eprintln!("lina-proto: starting with synthetic data (pid {})", std::process::id());
    gpui_platform::application().run(move |cx| launch(cx, options));
}
