// SPDX-License-Identifier: AGPL-3.0-only
use lina_core::follow::{Follow, on_store_change};
use lina_core::synthetic::{self, SyntheticSource};
use lina_core::{EventSource, Store};

#[test]
fn new_message_at_the_bottom_follows_and_marks_read() {
    assert_eq!(
        on_store_change(3, 4, true),
        Follow {
            scroll_to_bottom: true,
            mark_read: true
        }
    );
}

#[test]
fn new_message_while_reading_older_ones_keeps_the_scroll() {
    assert_eq!(
        on_store_change(3, 4, false),
        Follow {
            scroll_to_bottom: false,
            mark_read: true
        }
    );
}

#[test]
fn change_without_a_new_message_touches_nothing() {
    assert_eq!(on_store_change(3, 3, true), Follow::default());
    assert_eq!(on_store_change(3, 3, false), Follow::default());
}

#[test]
fn open_conversation_stays_read_while_messages_arrive() {
    let mut store = Store::new(synthetic::seed());
    let open = "c-archive";
    store.mark_read(open).unwrap();
    let mut seen = store.messages(open).len();
    let mut source = SyntheticSource::new();
    for _ in 0..8 {
        for result in store.apply_all(source.poll()) {
            result.unwrap();
        }
        let now = store.messages(open).len();
        if on_store_change(seen, now, false).mark_read {
            store.mark_read(open).unwrap();
        }
        seen = now;
    }
    assert!(seen > 3, "the synthetic source wrote to the open conversation");
    assert_eq!(store.conversation(open).unwrap().unread, 0);
    let others: u32 = store
        .conversations()
        .iter()
        .filter(|c| c.id != open)
        .map(|c| c.unread)
        .sum();
    assert!(others > 0, "other conversations still count unread messages");
}
