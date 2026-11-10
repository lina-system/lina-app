// SPDX-License-Identifier: AGPL-3.0-only
use std::fmt;

use crate::event::Event;
use crate::model::{Author, Conversation, Message, State};
use crate::view_spec::{Part, SpecError, ViewSpec};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    Message { conversation_id: String, message_id: u64 },
    Conversation { conversation_id: String },
    View { view_id: String },
}

/// What one accepted event or action changed, numbered in order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub version: u64,
    pub kind: ChangeKind,
}

#[derive(Debug, PartialEq)]
pub enum CoreError {
    UnknownConversation(String),
    UnknownView(String),
    UnknownNode { view_id: String, node_id: String },
    WrongPart { view_id: String, node_id: String },
    EmptyMessage,
    Spec(SpecError),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::UnknownConversation(id) => write!(f, "unknown conversation {id}"),
            CoreError::UnknownView(id) => write!(f, "unknown view {id}"),
            CoreError::UnknownNode { view_id, node_id } => write!(f, "view {view_id} has no node {node_id}"),
            CoreError::WrongPart { view_id, node_id } => {
                write!(f, "node {node_id} of view {view_id} is another part")
            }
            CoreError::EmptyMessage => write!(f, "message is empty"),
            CoreError::Spec(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for CoreError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SubscriptionId(u64);

pub type Subscriber = Box<dyn FnMut(&Change, &State)>;

/// The state every screen reads, and the only place that changes it.
pub struct Store {
    state: State,
    version: u64,
    subscribers: Vec<(SubscriptionId, Subscriber)>,
    next_subscription: u64,
}

impl Store {
    pub fn new(state: State) -> Self {
        Store {
            state,
            version: 0,
            subscribers: Vec::new(),
            next_subscription: 0,
        }
    }

    pub fn state(&self) -> &State {
        &self.state
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    /// Called once for every change, after it is applied.
    pub fn subscribe(&mut self, subscriber: impl FnMut(&Change, &State) + 'static) -> SubscriptionId {
        let id = SubscriptionId(self.next_subscription);
        self.next_subscription += 1;
        self.subscribers.push((id, Box::new(subscriber)));
        id
    }

    pub fn unsubscribe(&mut self, id: SubscriptionId) -> bool {
        let before = self.subscribers.len();
        self.subscribers.retain(|(each, _)| *each != id);
        self.subscribers.len() != before
    }

    /// Conversations, most recently updated first.
    pub fn conversations(&self) -> Vec<&Conversation> {
        let mut list: Vec<_> = self.state.conversations.iter().collect();
        list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
        list
    }

    pub fn conversation(&self, id: &str) -> Option<&Conversation> {
        self.state.conversations.iter().find(|each| each.id == id)
    }

    pub fn messages(&self, conversation_id: &str) -> &[Message] {
        self.state.messages.get(conversation_id).map_or(&[], Vec::as_slice)
    }

    pub fn view(&self, id: &str) -> Option<&ViewSpec> {
        self.state.views.get(id)
    }

    pub fn apply(&mut self, event: Event) -> Result<Change, CoreError> {
        let kind = match event {
            Event::MessageAdded {
                conversation_id,
                author,
                text,
                at,
                view_id,
            } => self.add_message(conversation_id, author, text, at, view_id)?,
            Event::ProgressSet { view_id, node_id, done } => {
                match self.node_mut(&view_id, &node_id)? {
                    Part::Progress(progress) => progress.done = done.min(progress.total),
                    _ => return Err(CoreError::WrongPart { view_id, node_id }),
                }
                ChangeKind::View { view_id }
            }
            Event::TileSet {
                view_id,
                node_id,
                tile,
                value,
            } => {
                match self.node_mut(&view_id, &node_id)? {
                    Part::StatRow(row) if tile < row.tiles.len() => row.tiles[tile].value = value,
                    _ => return Err(CoreError::WrongPart { view_id, node_id }),
                }
                ChangeKind::View { view_id }
            }
            Event::ViewSaved { mut spec } => {
                spec.validate().map_err(CoreError::Spec)?;
                if let Some(old) = self.state.views.get(&spec.id) {
                    spec.version = old.version + 1;
                }
                let view_id = spec.id.clone();
                self.state.views.insert(view_id.clone(), spec);
                ChangeKind::View { view_id }
            }
        };
        Ok(self.publish(kind))
    }

    /// Apply events in order; a refused event does not stop the rest.
    pub fn apply_all(&mut self, events: Vec<Event>) -> Vec<Result<Change, CoreError>> {
        events.into_iter().map(|event| self.apply(event)).collect()
    }

    /// The owner's own message from the text field.
    pub fn send_message(&mut self, conversation_id: &str, text: &str) -> Result<Change, CoreError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(CoreError::EmptyMessage);
        }
        let at = self.state.now;
        let kind = self.add_message(conversation_id.to_string(), Author::Me, text.to_string(), at, None)?;
        Ok(self.publish(kind))
    }

    pub fn mark_read(&mut self, conversation_id: &str) -> Result<Change, CoreError> {
        let conversation = self.conversation_mut(conversation_id)?;
        conversation.unread = 0;
        Ok(self.publish(ChangeKind::Conversation {
            conversation_id: conversation_id.to_string(),
        }))
    }

    fn add_message(
        &mut self,
        conversation_id: String,
        author: Author,
        text: String,
        at: u64,
        view_id: Option<String>,
    ) -> Result<ChangeKind, CoreError> {
        if let Some(view) = &view_id
            && !self.state.views.contains_key(view)
        {
            return Err(CoreError::UnknownView(view.clone()));
        }
        let from_agent = matches!(author, Author::Agent(_));
        let conversation = self.conversation_mut(&conversation_id)?;
        conversation.preview = text.clone();
        conversation.updated_at = at;
        if from_agent {
            conversation.unread += 1;
        }
        let message_id = self.state.next_message_id;
        self.state.next_message_id += 1;
        self.state.now = self.state.now.max(at);
        self.state
            .messages
            .entry(conversation_id.clone())
            .or_default()
            .push(Message {
                id: message_id,
                conversation_id: conversation_id.clone(),
                author,
                text,
                at,
                view_id,
            });
        Ok(ChangeKind::Message {
            conversation_id,
            message_id,
        })
    }

    fn conversation_mut(&mut self, id: &str) -> Result<&mut Conversation, CoreError> {
        self.state
            .conversations
            .iter_mut()
            .find(|each| each.id == id)
            .ok_or_else(|| CoreError::UnknownConversation(id.to_string()))
    }

    fn node_mut(&mut self, view_id: &str, node_id: &str) -> Result<&mut Part, CoreError> {
        let view = self
            .state
            .views
            .get_mut(view_id)
            .ok_or_else(|| CoreError::UnknownView(view_id.to_string()))?;
        view.node_mut(node_id).ok_or_else(|| CoreError::UnknownNode {
            view_id: view_id.to_string(),
            node_id: node_id.to_string(),
        })
    }

    fn publish(&mut self, kind: ChangeKind) -> Change {
        self.version += 1;
        let change = Change {
            version: self.version,
            kind,
        };
        for (_, subscriber) in &mut self.subscribers {
            subscriber(&change, &self.state);
        }
        change
    }
}
