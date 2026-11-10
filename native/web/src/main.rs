// SPDX-License-Identifier: AGPL-3.0-only
//! Web entry point: the same screens as the Mac, drawn into one browser canvas.
//! Single-threaded GPUI web platform; fonts are bundled at build time
//! (`LINA_WEB_FONT`) and Hangul missing from that font falls back to the
//! browser's Canvas text (GPUI's opt-in CJK fallback).
#![cfg_attr(target_family = "wasm", no_main)]

#[cfg(target_family = "wasm")]
mod web {
    use std::borrow::Cow;
    use std::rc::Rc;

    use gpui::Application;
    use gpui_web::{CanvasFontFallback, WebBackendPreference, WebPlatform};
    use lina_core::synthetic::{self, SyntheticSource};
    use lina_ui::{LaunchOptions, launch};
    use wasm_bindgen::prelude::wasm_bindgen;

    const FONT: &[u8] = include_bytes!(env!("LINA_WEB_FONT"));
    const FONT_FAMILY: &str = env!("LINA_WEB_FONT_FAMILY");

    #[wasm_bindgen(start)]
    pub fn start() {
        gpui_web::init_logging();
        let platform = Rc::new(WebPlatform::new_with_backend_and_font_fallback(
            false,
            WebBackendPreference::Auto,
            CanvasFontFallback::EmojiAndCjk,
        ));
        Application::with_platform(platform).run(|cx| {
            if let Err(error) = cx.text_system().add_fonts(vec![Cow::Borrowed(FONT)]) {
                log::error!("lina-web: font not loaded: {error:#}");
                return;
            }
            log::info!("lina-web: starting with synthetic data, font {FONT_FAMILY}");
            launch(
                cx,
                LaunchOptions {
                    state: synthetic::seed(),
                    source: Box::new(SyntheticSource::new()),
                    conversation: Some("c-archive".into()),
                    draft: None,
                    open_view: None,
                    window: None,
                    bench: false,
                    log_input: true,
                    notify_test: false,
                    started: None,
                    font_family: Some(FONT_FAMILY.into()),
                },
            );
        });
    }
}

#[cfg(not(target_family = "wasm"))]
fn main() {
    eprintln!("lina-web: build for wasm32-unknown-unknown with native/web/build.sh");
}
