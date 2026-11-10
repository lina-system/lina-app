// SPDX-License-Identifier: Apache-2.0
//! Synthetic data for the prototype: made-up agents and folders only.

use std::collections::BTreeMap;

use crate::event::{Event, EventSource};
use crate::model::{Author, Conversation, Message, State};
use crate::view_spec::ViewSpec;

pub const ARCHIVE_VIEW: &str = "archive-board";
const START: u64 = 1_793_000_000;

pub const ARCHIVE_VIEW_SPEC: &str = r#"{
  "id": "archive-board",
  "version": 1,
  "title": "보관 압축 현황",
  "owner": "보관 에이전트",
  "refresh": { "every": "60s" },
  "layout": [
    { "part": "stat-row", "id": "summary", "data": { "tiles": [
      { "label": "압축한 폴더", "value": 120, "unit": "개" },
      { "label": "아낀 용량", "value": 412, "unit": "GB", "delta": 12 },
      { "label": "실패", "value": 0, "hideWhenZero": true },
      { "label": "남은 폴더", "value": 80, "unit": "개" }
    ] } },
    { "part": "progress", "id": "overall", "data": { "done": 120, "total": 200 } },
    { "part": "list", "id": "folders", "data": { "rows": [
      { "title": "사진 모음 A", "sub": "34 GB", "state": "done" },
      { "title": "작업 파일 B", "sub": "51 GB", "state": "in_progress" },
      { "title": "음성 메모 C", "sub": "8 GB", "state": "waiting" },
      { "title": "옛 백업 D", "sub": "120 GB", "state": "planned" }
    ] } },
    { "part": "table", "id": "disks", "data": {
      "columns": [
        { "key": "name", "label": "디스크", "primary": true },
        { "key": "used", "label": "사용(GB)", "align": "end", "format": "number" },
        { "key": "free", "label": "남음(GB)", "align": "end", "format": "number" }
      ],
      "rows": [
        { "name": "보관 디스크 1", "used": 1840, "free": 160 },
        { "name": "보관 디스크 2", "used": 2210, "free": 1790 },
        { "name": "작업 디스크", "used": 610, "free": 390 }
      ],
      "sort": "used"
    } }
  ]
}"#;

const AGENT_LINES: [(&str, &str, &str); 4] = [
    ("c-archive", "보관 에이전트", "폴더 하나를 더 압축했습니다."),
    ("c-equipment", "장비 에이전트", "장비 상태를 다시 확인했습니다."),
    ("c-weekly", "보고 에이전트", "이번 주 기록을 하나 더 모았습니다."),
    ("c-budget", "정산 에이전트", "구독 결제 하나를 정리했습니다."),
];

fn conversation(id: &str, title: &str, agent: &str, at: u64) -> Conversation {
    Conversation {
        id: id.into(),
        title: title.into(),
        agent: agent.into(),
        unread: 0,
        preview: String::new(),
        updated_at: at,
    }
}

/// The starting scene: four conversations, a few messages, one agent-built view.
pub fn seed() -> State {
    let mut state = State {
        conversations: vec![
            conversation("c-archive", "보관 압축", "보관 에이전트", START),
            conversation("c-equipment", "장비 목록", "장비 에이전트", START - 600),
            conversation("c-weekly", "주간 보고", "보고 에이전트", START - 1200),
            conversation("c-budget", "구독 정리", "정산 에이전트", START - 1800),
        ],
        messages: BTreeMap::new(),
        views: BTreeMap::new(),
        next_message_id: 0,
        now: START,
    };
    let spec = ViewSpec::parse(ARCHIVE_VIEW_SPEC).expect("seed view spec is valid");
    state.views.insert(spec.id.clone(), spec);

    let opening: [(&str, Author, &str, u64, Option<&str>); 6] = [
        (
            "c-archive",
            Author::Me,
            "보관 디스크 정리 상황 알려 줘.",
            START - 120,
            None,
        ),
        (
            "c-archive",
            Author::Agent("보관 에이전트".into()),
            "진행 현황 화면을 만들었습니다. 1분마다 새로 고칩니다.",
            START - 60,
            Some(ARCHIVE_VIEW),
        ),
        (
            "c-archive",
            Author::Agent("보관 에이전트".into()),
            "지금 작업 파일 B를 압축하고 있습니다.",
            START,
            None,
        ),
        (
            "c-equipment",
            Author::Agent("장비 에이전트".into()),
            "장비 12개를 목록에 올렸습니다.",
            START - 600,
            None,
        ),
        (
            "c-weekly",
            Author::Agent("보고 에이전트".into()),
            "주간 보고 초안이 준비됐습니다.",
            START - 1200,
            None,
        ),
        (
            "c-budget",
            Author::Agent("정산 에이전트".into()),
            "이번 달 구독은 7개입니다.",
            START - 1800,
            None,
        ),
    ];
    for (conversation_id, author, text, at, view_id) in opening {
        let id = state.next_message_id;
        state.next_message_id += 1;
        if let Some(each) = state.conversations.iter_mut().find(|c| c.id == conversation_id) {
            each.preview = text.into();
        }
        state.messages.entry(conversation_id.into()).or_default().push(Message {
            id,
            conversation_id: conversation_id.into(),
            author,
            text: text.into(),
            at,
            view_id: view_id.map(Into::into),
        });
    }
    state
}

/// Pushes one agent message and one progress step per poll; the host polls it
/// once a second.
#[derive(Debug, Default)]
pub struct SyntheticSource {
    tick: u64,
}

impl SyntheticSource {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn ticks(&self) -> u64 {
        self.tick
    }
}

impl EventSource for SyntheticSource {
    fn poll(&mut self) -> Vec<Event> {
        self.tick += 1;
        let tick = self.tick;
        let at = START + tick;
        let (conversation_id, agent, line) = AGENT_LINES[(tick as usize) % AGENT_LINES.len()];
        let done = (120 + tick).min(200);
        vec![
            Event::MessageAdded {
                conversation_id: conversation_id.into(),
                author: Author::Agent(agent.into()),
                text: format!("{line} ({tick}번째 소식)"),
                at,
                view_id: None,
            },
            Event::ProgressSet {
                view_id: ARCHIVE_VIEW.into(),
                node_id: "overall".into(),
                done,
            },
            Event::TileSet {
                view_id: ARCHIVE_VIEW.into(),
                node_id: "summary".into(),
                tile: 0,
                value: done as f64,
            },
            Event::TileSet {
                view_id: ARCHIVE_VIEW.into(),
                node_id: "summary".into(),
                tile: 3,
                value: (200 - done) as f64,
            },
        ]
    }
}
