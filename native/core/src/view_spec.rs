// SPDX-License-Identifier: Apache-2.0
//! The view spec of lina-app#66: one JSON document per agent-built view.
//!
//! This round covers `id`, `version`, `title`, `owner`, one view-level `refresh`
//! rule and a `layout` of `stat-row`, `progress`, `list` and `table` nodes with
//! inline `data`. Anything else is refused when the spec is parsed.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// State words from the shared word list.
pub const STATES: [&str; 5] = ["planned", "in_progress", "waiting", "stopped", "done"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpecError(pub String);

impl fmt::Display for SpecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "view spec refused: {}", self.0)
    }
}

impl std::error::Error for SpecError {}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ViewSpec {
    pub id: String,
    #[serde(default = "first_version")]
    pub version: u32,
    pub title: String,
    pub owner: String,
    pub refresh: Refresh,
    pub layout: Vec<Node>,
}

fn first_version() -> u32 {
    1
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Refresh {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub every: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<String>,
}

impl Refresh {
    /// Seconds between refreshes for an `{"every": "60s"}` rule.
    pub fn every_secs(&self) -> Option<u64> {
        let every = self.every.as_deref()?;
        let (number, unit) = every.split_at(every.find(|c: char| !c.is_ascii_digit())?);
        let number: u64 = number.parse().ok()?;
        match unit {
            "s" => Some(number),
            "m" => Some(number * 60),
            _ => None,
        }
    }

    fn validate(&self) -> Result<(), SpecError> {
        match (&self.every, &self.on) {
            (Some(every), None) => match self.every_secs() {
                Some(secs) if secs > 0 => Ok(()),
                _ => Err(SpecError(format!(
                    "refresh every \"{every}\" is not like \"60s\" or \"5m\""
                ))),
            },
            (None, Some(on)) if on == "event" || on == "change" => Ok(()),
            (None, Some(on)) => Err(SpecError(format!("refresh on \"{on}\" is not event or change"))),
            _ => Err(SpecError("refresh needs exactly one of every or on".into())),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(flatten)]
    pub part: Part,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "part", content = "data", rename_all = "kebab-case")]
pub enum Part {
    StatRow(StatRow),
    Progress(Progress),
    List(List),
    Table(Table),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StatRow {
    pub tiles: Vec<Tile>,
}

impl StatRow {
    pub fn visible_tiles(&self) -> impl Iterator<Item = &Tile> {
        self.tiles
            .iter()
            .filter(|tile| !(tile.hide_when_zero && tile.value == 0.0))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Tile {
    pub label: String,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta: Option<f64>,
    #[serde(default, rename = "hideWhenZero")]
    pub hide_when_zero: bool,
}

impl Tile {
    pub fn value_label(&self) -> String {
        let number = format_number(self.value);
        match &self.unit {
            Some(unit) => format!("{number} {unit}"),
            None => number,
        }
    }

    pub fn delta_label(&self) -> Option<String> {
        self.delta.map(|delta| {
            let sign = if delta > 0.0 { "+" } else { "" };
            format!("{sign}{}", format_number(delta))
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Progress {
    pub done: u64,
    pub total: u64,
}

impl Progress {
    pub fn ratio(&self) -> f32 {
        if self.total == 0 {
            0.0
        } else {
            (self.done.min(self.total) as f64 / self.total as f64) as f32
        }
    }

    pub fn label(&self) -> String {
        format!("{} / {} ({}%)", self.done, self.total, (self.ratio() * 100.0).round())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct List {
    pub rows: Vec<Row>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Row {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

/// Screen word for a state, in the app's voice.
pub fn state_label(state: &str) -> &'static str {
    match state {
        "planned" => "예정",
        "in_progress" => "진행 중",
        "waiting" => "대기",
        "stopped" => "멈춤",
        "done" => "완료",
        _ => "",
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Table {
    pub columns: Vec<Column>,
    pub rows: Vec<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Column {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub align: Align,
    #[serde(default)]
    pub primary: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Align {
    #[default]
    Start,
    End,
}

impl Table {
    /// Rows in display order: by the `sort` key, largest number first.
    pub fn sorted_rows(&self) -> Vec<&Map<String, Value>> {
        let mut rows: Vec<_> = self.rows.iter().collect();
        if let Some(key) = &self.sort {
            rows.sort_by(|a, b| {
                let a = a.get(key).and_then(Value::as_f64).unwrap_or(f64::MIN);
                let b = b.get(key).and_then(Value::as_f64).unwrap_or(f64::MIN);
                b.total_cmp(&a)
            });
        }
        rows
    }

    pub fn cell_text(&self, row: &Map<String, Value>, column: &Column) -> String {
        match row.get(&column.key) {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(text)) => text.clone(),
            Some(Value::Number(number)) if column.format.as_deref() == Some("number") => {
                format_number(number.as_f64().unwrap_or_default())
            }
            Some(other) => other.to_string(),
        }
    }
}

/// Whole numbers with thousands separators, other numbers with one decimal.
pub fn format_number(value: f64) -> String {
    if value.fract() != 0.0 {
        return format!("{value:.1}");
    }
    let digits = format!("{}", value.abs() as u64);
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    if value < 0.0 { format!("-{out}") } else { out }
}

impl ViewSpec {
    /// Parse and validate one view spec document; unknown parts are refused.
    pub fn parse(json: &str) -> Result<ViewSpec, SpecError> {
        let spec: ViewSpec = serde_json::from_str(json).map_err(|error| SpecError(error.to_string()))?;
        spec.validate()?;
        Ok(spec)
    }

    pub fn validate(&self) -> Result<(), SpecError> {
        if self.id.trim().is_empty() {
            return Err(SpecError("id is empty".into()));
        }
        if self.title.trim().is_empty() {
            return Err(SpecError("title is empty".into()));
        }
        if self.owner.trim().is_empty() {
            return Err(SpecError("owner is empty".into()));
        }
        self.refresh.validate()?;
        for node in &self.layout {
            node.validate()?;
        }
        Ok(())
    }

    pub fn node_mut(&mut self, id: &str) -> Option<&mut Part> {
        self.layout
            .iter_mut()
            .find(|node| node.id.as_deref() == Some(id))
            .map(|node| &mut node.part)
    }
}

impl Node {
    fn validate(&self) -> Result<(), SpecError> {
        match &self.part {
            Part::StatRow(row) if row.tiles.is_empty() => Err(SpecError("stat-row has no tiles".into())),
            Part::Progress(progress) if progress.done > progress.total => Err(SpecError(format!(
                "progress done {} is over total {}",
                progress.done, progress.total
            ))),
            Part::List(list) => list
                .rows
                .iter()
                .filter_map(|row| row.state.as_deref())
                .find(|state| !STATES.contains(state))
                .map_or(Ok(()), |state| {
                    Err(SpecError(format!("unknown state word \"{state}\"")))
                }),
            Part::Table(table) if table.columns.is_empty() => Err(SpecError("table has no columns".into())),
            _ => Ok(()),
        }
    }
}
