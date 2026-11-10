// SPDX-License-Identifier: AGPL-3.0-only
use std::time::Duration;

use gpui::{Context, Task};
use lina_core::{ChangeKind, CoreError, EventSource, State, Store};

/// Holds the core store inside GPUI and feeds it from an event source once a
/// second. Screens observe this entity and redraw on notify.
pub struct CoreModel {
    store: Store,
    source: Box<dyn EventSource>,
    _pump: Task<()>,
}

impl CoreModel {
    pub fn start(state: State, source: Box<dyn EventSource>, cx: &mut Context<Self>) -> Self {
        let mut store = Store::new(state);
        store.subscribe(|change, _| {
            let what = match &change.kind {
                ChangeKind::Message {
                    conversation_id,
                    message_id,
                } => {
                    format!("message {message_id} in {conversation_id}")
                }
                ChangeKind::Conversation { conversation_id } => format!("conversation {conversation_id}"),
                ChangeKind::View { view_id } => format!("view {view_id}"),
            };
            eprintln!("lina-core: change v{} {what}", change.version);
        });
        let pump = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                let alive = this.update(cx, |model, cx| model.pump(cx));
                if alive.is_err() {
                    break;
                }
            }
        });
        CoreModel {
            store,
            source,
            _pump: pump,
        }
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    fn pump(&mut self, cx: &mut Context<Self>) {
        let events = self.source.poll();
        let mut changed = 0;
        for result in self.store.apply_all(events) {
            match result {
                Ok(_) => changed += 1,
                Err(error) => eprintln!("lina-core: event refused: {error}"),
            }
        }
        if changed > 0 {
            eprintln!("lina-ui: redraw after {changed} changes (v{})", self.store.version());
            cx.notify();
        }
    }

    pub fn send_message(&mut self, conversation_id: &str, text: &str, cx: &mut Context<Self>) -> Result<(), CoreError> {
        self.store.send_message(conversation_id, text)?;
        cx.notify();
        Ok(())
    }

    pub fn mark_read(&mut self, conversation_id: &str, cx: &mut Context<Self>) {
        match self.store.mark_read(conversation_id) {
            Ok(_) => cx.notify(),
            Err(error) => eprintln!("lina-core: {error}"),
        }
    }
}
