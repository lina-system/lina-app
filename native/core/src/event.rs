// SPDX-License-Identifier: Apache-2.0
use serde::{Deserialize, Serialize};

use crate::model::Author;
use crate::view_spec::ViewSpec;

/// One change pushed from outside: the server's live stream, or a synthetic source.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    MessageAdded {
        conversation_id: String,
        author: Author,
        text: String,
        at: u64,
        view_id: Option<String>,
    },
    ProgressSet {
        view_id: String,
        node_id: String,
        done: u64,
    },
    TileSet {
        view_id: String,
        node_id: String,
        tile: usize,
        value: f64,
    },
    ViewSaved {
        spec: ViewSpec,
    },
}

/// Where events come from. The host calls `poll` on its own clock (a timer, a
/// socket wakeup) and hands what it returns to the store; the core never owns a
/// thread or a runtime, so the same source works on every platform.
pub trait EventSource {
    fn poll(&mut self) -> Vec<Event>;
}
