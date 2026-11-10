// SPDX-License-Identifier: AGPL-3.0-only
//! iOS entry point: the same screens as the Mac, sized by the phone. Build for
//! `aarch64-apple-ios-sim` with `app/ios/build-sim.sh`.

#[cfg(target_os = "ios")]
fn main() {
    use lina_core::synthetic::{self, SyntheticSource};
    use lina_ui::{LaunchOptions, launch};

    let options = LaunchOptions {
        state: synthetic::seed(),
        source: Box::new(SyntheticSource::new()),
        conversation: Some("c-archive".into()),
        draft: None,
        window: None,
        bench: false,
        log_input: true,
        notify_test: false,
        font_family: None,
        started: Some(std::time::Instant::now()),
    };
    eprintln!("lina-proto-ios: starting with synthetic data");
    gpui_platform::application().run(move |cx| launch(cx, options));
}

#[cfg(not(target_os = "ios"))]
fn main() {
    eprintln!("lina-proto-ios: build this binary for an iOS target (app/ios/build-sim.sh)");
}
