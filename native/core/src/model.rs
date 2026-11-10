// SPDX-License-Identifier: Apache-2.0
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::view_spec::ViewSpec;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub unread: u32,
    pub preview: String,
    pub updated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "name", rename_all = "snake_case")]
pub enum Author {
    Me,
    Agent(String),
}

impl Author {
    pub fn label(&self) -> &str {
        match self {
            Author::Me => "나",
            Author::Agent(name) => name,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub id: u64,
    pub conversation_id: String,
    pub author: Author,
    pub text: String,
    pub at: u64,
    pub view_id: Option<String>,
}

impl Message {
    pub fn time_label(&self) -> String {
        clock_label(self.at)
    }
}

/// `HH:MM` of a unix time in seconds, on the UTC clock.
pub fn clock_label(at: u64) -> String {
    let minutes_of_day = (at % 86_400) / 60;
    format!("{:02}:{:02}", minutes_of_day / 60, minutes_of_day % 60)
}

/// Everything a screen can show. It is also the shape of the local cache.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct State {
    pub conversations: Vec<Conversation>,
    pub messages: BTreeMap<String, Vec<Message>>,
    pub views: BTreeMap<String, ViewSpec>,
    pub next_message_id: u64,
    pub now: u64,
}
