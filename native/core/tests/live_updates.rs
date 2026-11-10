// SPDX-License-Identifier: AGPL-3.0-only
use std::cell::RefCell;
use std::rc::Rc;

use lina_core::synthetic::{self, ARCHIVE_VIEW, SyntheticSource};
use lina_core::view_spec::Part;
use lina_core::{ApiRequest, ApiResponse, Author, ChangeKind, CoreError, Event, EventSource, Store, ViewSpec, cache};

fn progress_done(store: &Store) -> u64 {
    let view = store.view(ARCHIVE_VIEW).unwrap();
    view.layout
        .iter()
        .find_map(|node| match &node.part {
            Part::Progress(progress) => Some(progress.done),
            _ => None,
        })
        .unwrap()
}

#[test]
fn every_event_reaches_every_subscriber_once() {
    let mut store = Store::new(synthetic::seed());
    let first = Rc::new(RefCell::new(Vec::new()));
    let second = Rc::new(RefCell::new(0usize));
    let first_log = first.clone();
    store.subscribe(move |change, _| first_log.borrow_mut().push(change.version));
    let second_count = second.clone();
    store.subscribe(move |_, _| *second_count.borrow_mut() += 1);

    let mut source = SyntheticSource::new();
    let mut events = Vec::new();
    for _ in 0..10 {
        events.extend(source.poll());
    }
    let n = events.len();
    let results = store.apply_all(events);

    assert!(results.iter().all(Result::is_ok), "{results:?}");
    assert_eq!(n, 40);
    assert_eq!(*first.borrow(), (1..=n as u64).collect::<Vec<_>>());
    assert_eq!(*second.borrow(), n);
    assert_eq!(store.version(), n as u64);
}

#[test]
fn subscriber_sees_state_after_the_change() {
    let mut store = Store::new(synthetic::seed());
    let seen = Rc::new(RefCell::new(None));
    let seen_in = seen.clone();
    store.subscribe(move |change, state| {
        if let ChangeKind::Message { conversation_id, .. } = &change.kind {
            *seen_in.borrow_mut() = state.messages[conversation_id].last().map(|m| m.text.clone());
        }
    });
    store.send_message("c-weekly", "  안녕하세요  ").unwrap();
    assert_eq!(seen.borrow().as_deref(), Some("안녕하세요"));
}

#[test]
fn unsubscribed_callback_is_not_called() {
    let mut store = Store::new(synthetic::seed());
    let count = Rc::new(RefCell::new(0));
    let count_in = count.clone();
    let id = store.subscribe(move |_, _| *count_in.borrow_mut() += 1);
    store.mark_read("c-archive").unwrap();
    assert!(store.unsubscribe(id));
    store.mark_read("c-archive").unwrap();
    assert_eq!(*count.borrow(), 1);
}

#[test]
fn synthetic_source_moves_progress_and_unread() {
    let mut store = Store::new(synthetic::seed());
    let before = progress_done(&store);
    let mut source = SyntheticSource::new();
    for _ in 0..3 {
        for result in store.apply_all(source.poll()) {
            result.unwrap();
        }
    }
    assert_eq!(progress_done(&store), before + 3);
    let total_unread: u32 = store.conversations().iter().map(|c| c.unread).sum();
    assert_eq!(total_unread, 3);
    assert_eq!(source.ticks(), 3);
}

#[test]
fn progress_stops_at_total() {
    let mut store = Store::new(synthetic::seed());
    store
        .apply(Event::ProgressSet {
            view_id: ARCHIVE_VIEW.into(),
            node_id: "overall".into(),
            done: 999,
        })
        .unwrap();
    assert_eq!(progress_done(&store), 200);
}

#[test]
fn newest_conversation_comes_first() {
    let mut store = Store::new(synthetic::seed());
    store.send_message("c-budget", "확인했어.").unwrap();
    store
        .apply(Event::MessageAdded {
            conversation_id: "c-budget".into(),
            author: Author::Agent("정산 에이전트".into()),
            text: "네.".into(),
            at: store.state().now + 5,
            view_id: None,
        })
        .unwrap();
    assert_eq!(store.conversations()[0].id, "c-budget");
}

#[test]
fn refused_actions_do_not_notify() {
    let mut store = Store::new(synthetic::seed());
    let count = Rc::new(RefCell::new(0));
    let count_in = count.clone();
    store.subscribe(move |_, _| *count_in.borrow_mut() += 1);
    assert_eq!(store.send_message("c-archive", "   "), Err(CoreError::EmptyMessage));
    assert!(matches!(
        store.send_message("c-missing", "hi"),
        Err(CoreError::UnknownConversation(_))
    ));
    assert!(matches!(
        store.apply(Event::TileSet {
            view_id: ARCHIVE_VIEW.into(),
            node_id: "overall".into(),
            tile: 0,
            value: 1.0
        }),
        Err(CoreError::WrongPart { .. })
    ));
    assert_eq!(*count.borrow(), 0);
    assert_eq!(store.version(), 0);
}

#[test]
fn api_save_view_bumps_version_and_refuses_unknown_parts() {
    let mut store = Store::new(synthetic::seed());
    let spec = store.view(ARCHIVE_VIEW).unwrap().clone();
    store.handle(ApiRequest::SaveView { spec }).unwrap();
    match store
        .handle(ApiRequest::GetView {
            view_id: ARCHIVE_VIEW.into(),
        })
        .unwrap()
    {
        ApiResponse::View { spec } => assert_eq!(spec.version, 2),
        other => panic!("unexpected {other:?}"),
    }
    match store
        .handle(ApiRequest::Messages {
            conversation_id: "c-archive".into(),
        })
        .unwrap()
    {
        ApiResponse::Messages { items } => assert_eq!(items[1].view_id.as_deref(), Some(ARCHIVE_VIEW)),
        other => panic!("unexpected {other:?}"),
    }
    let bad = synthetic::ARCHIVE_VIEW_SPEC.replace("\"part\": \"table\"", "\"part\": \"web-block\"");
    let error = ViewSpec::parse(&bad).unwrap_err();
    assert!(error.0.contains("web-block"), "{error}");
}

#[test]
fn cache_round_trips_the_state() {
    let mut store = Store::new(synthetic::seed());
    store.send_message("c-archive", "캐시 확인").unwrap();
    let dir = std::env::temp_dir().join(format!("lina-core-cache-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("state.json");
    assert_eq!(cache::load(&path).unwrap(), None);
    cache::save(&path, store.state()).unwrap();
    assert_eq!(cache::load(&path).unwrap().as_ref(), Some(store.state()));
    std::fs::remove_dir_all(&dir).unwrap();
}
