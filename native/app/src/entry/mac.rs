// SPDX-License-Identifier: Apache-2.0
//! macOS entry point. iOS and web entry points go next to this file and call
//! the same `lina_ui::launch`.

use gpui::Application;
use lina_core::synthetic::{self, SyntheticSource};
use lina_ui::{LaunchOptions, launch};

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let options = LaunchOptions {
        state: synthetic::seed(),
        source: Box::new(SyntheticSource::new()),
        conversation: flag(&args, "--conversation"),
        draft: flag(&args, "--draft"),
        window_origin: (40., 60.),
        window_size: (1280., 800.),
    };
    eprintln!("lina-proto: starting with synthetic data");
    Application::new().run(move |cx| launch(cx, options));
}
