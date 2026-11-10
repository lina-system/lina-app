// SPDX-License-Identifier: Apache-2.0
//! The client API model: the requests a screen sends to the core and what it
//! gets back. A network client will carry the same shapes later.

use serde::{Deserialize, Serialize};

use crate::model::{Conversation, Message};
use crate::store::{CoreError, Store};
use crate::view_spec::ViewSpec;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum ApiRequest {
    ListConversations,
    Messages { conversation_id: String },
    SendMessage { conversation_id: String, text: String },
    MarkRead { conversation_id: String },
    GetView { view_id: String },
    SaveView { spec: ViewSpec },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ApiResponse {
    Conversations { items: Vec<Conversation> },
    Messages { items: Vec<Message> },
    View { spec: ViewSpec },
    Accepted { version: u64 },
}

impl Store {
    pub fn handle(&mut self, request: ApiRequest) -> Result<ApiResponse, CoreError> {
        Ok(match request {
            ApiRequest::ListConversations => ApiResponse::Conversations {
                items: self.conversations().into_iter().cloned().collect(),
            },
            ApiRequest::Messages { conversation_id } => {
                if self.conversation(&conversation_id).is_none() {
                    return Err(CoreError::UnknownConversation(conversation_id));
                }
                ApiResponse::Messages {
                    items: self.messages(&conversation_id).to_vec(),
                }
            }
            ApiRequest::SendMessage { conversation_id, text } => ApiResponse::Accepted {
                version: self.send_message(&conversation_id, &text)?.version,
            },
            ApiRequest::MarkRead { conversation_id } => ApiResponse::Accepted {
                version: self.mark_read(&conversation_id)?.version,
            },
            ApiRequest::GetView { view_id } => ApiResponse::View {
                spec: self.view(&view_id).cloned().ok_or(CoreError::UnknownView(view_id))?,
            },
            ApiRequest::SaveView { spec } => ApiResponse::Accepted {
                version: self.apply(crate::event::Event::ViewSaved { spec })?.version,
            },
        })
    }
}
