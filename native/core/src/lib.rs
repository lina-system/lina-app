// SPDX-License-Identifier: AGPL-3.0-only
//! Platform-free core for the LINA native apps (lina-app#76).
//!
//! Screens read state from a [`Store`] and redraw when it reports a [`Change`];
//! every rule about data lives here, never in a platform's UI code.

pub mod api;
pub mod cache;
pub mod event;
pub mod follow;
pub mod model;
pub mod store;
pub mod synthetic;
pub mod view_spec;

pub use api::{ApiRequest, ApiResponse};
pub use event::{Event, EventSource};
pub use model::{Author, Conversation, Message, State};
pub use store::{Change, ChangeKind, CoreError, Store, SubscriptionId};
pub use view_spec::{Node, Part, SpecError, ViewSpec};
