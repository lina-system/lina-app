// SPDX-License-Identifier: AGPL-3.0-only
//! What the open conversation does when the store changes: follow new
//! messages only if the reader was already at the bottom, and mark the open
//! conversation read whenever a message arrives in it.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Follow {
    pub scroll_to_bottom: bool,
    pub mark_read: bool,
}

/// `seen` is the message count the screen last showed for the open
/// conversation, `now` its count after the change, and `at_bottom` whether the
/// reader was at the end of the list before the change.
pub fn on_store_change(seen: usize, now: usize, at_bottom: bool) -> Follow {
    let arrived = now > seen;
    Follow {
        scroll_to_bottom: arrived && at_bottom,
        mark_read: arrived,
    }
}
