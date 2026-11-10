// SPDX-License-Identifier: Apache-2.0
//! Design tokens from lina-app#66: system font, three text sizes, one accent
//! colour. Light only in this round.

use gpui::{Hsla, Pixels, px, rgb};

pub const TEXT_SMALL: Pixels = px(12.);
pub const TEXT_BODY: Pixels = px(14.);
pub const TEXT_LARGE: Pixels = px(22.);

pub fn accent() -> Hsla {
    rgb(0x3b6fd8).into()
}

pub fn text() -> Hsla {
    rgb(0x1d1d1f).into()
}

pub fn muted() -> Hsla {
    rgb(0x6e6e73).into()
}

pub fn line() -> Hsla {
    rgb(0xe3e3e8).into()
}

pub fn surface() -> Hsla {
    rgb(0xffffff).into()
}

pub fn sidebar() -> Hsla {
    rgb(0xf3f3f6).into()
}

pub fn selected() -> Hsla {
    rgb(0xdfe7f8).into()
}

pub fn mine() -> Hsla {
    rgb(0xe7eefc).into()
}

pub fn state_color(state: &str) -> Hsla {
    match state {
        "done" => rgb(0x2f9e5b).into(),
        "in_progress" => accent(),
        "waiting" => rgb(0xd08b16).into(),
        "stopped" => rgb(0xc8392b).into(),
        _ => muted(),
    }
}
