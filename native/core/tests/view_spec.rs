// SPDX-License-Identifier: Apache-2.0
use lina_core::view_spec::{Part, Progress, Refresh, Tile, format_number};
use lina_core::{ViewSpec, synthetic};

#[test]
fn seed_spec_has_the_four_parts_in_order() {
    let spec = ViewSpec::parse(synthetic::ARCHIVE_VIEW_SPEC).unwrap();
    let parts: Vec<&str> = spec
        .layout
        .iter()
        .map(|node| match node.part {
            Part::StatRow(_) => "stat-row",
            Part::Progress(_) => "progress",
            Part::List(_) => "list",
            Part::Table(_) => "table",
        })
        .collect();
    assert_eq!(parts, ["stat-row", "progress", "list", "table"]);
    assert_eq!(spec.refresh.every_secs(), Some(60));
}

#[test]
fn spec_serializes_back_to_the_same_document() {
    let spec = ViewSpec::parse(synthetic::ARCHIVE_VIEW_SPEC).unwrap();
    let json = serde_json::to_string(&spec).unwrap();
    assert_eq!(ViewSpec::parse(&json).unwrap(), spec);
}

#[test]
fn bad_specs_are_refused_with_a_reason() {
    let cases = [
        ("\"title\": \"보관 압축 현황\"", "\"title\": \" \"", "title is empty"),
        ("\"state\": \"waiting\"", "\"state\": \"maybe\"", "unknown state word"),
        ("{ \"every\": \"60s\" }", "{ \"every\": \"soon\" }", "refresh every"),
        (
            "{ \"every\": \"60s\" }",
            "{ \"every\": \"60s\", \"on\": \"event\" }",
            "exactly one",
        ),
        (
            "\"done\": 120, \"total\": 200",
            "\"done\": 220, \"total\": 200",
            "over total",
        ),
    ];
    for (from, to, reason) in cases {
        let doc = synthetic::ARCHIVE_VIEW_SPEC.replacen(from, to, 1);
        assert_ne!(doc, synthetic::ARCHIVE_VIEW_SPEC, "case {from} did not apply");
        let error = ViewSpec::parse(&doc).unwrap_err();
        assert!(error.0.contains(reason), "{to}: {error}");
    }
}

#[test]
fn display_values_are_computed_in_the_core() {
    assert_eq!(format_number(1234567.0), "1,234,567");
    assert_eq!(format_number(-1200.0), "-1,200");
    assert_eq!(format_number(2.5), "2.5");
    let tile = Tile {
        label: "아낀 용량".into(),
        value: 412.0,
        unit: Some("GB".into()),
        delta: Some(12.0),
        hide_when_zero: false,
    };
    assert_eq!(tile.value_label(), "412 GB");
    assert_eq!(tile.delta_label().as_deref(), Some("+12"));
    assert_eq!(Progress { done: 3, total: 5 }.label(), "3 / 5 (60%)");
    assert_eq!(Progress { done: 0, total: 0 }.ratio(), 0.0);
    let on_event = Refresh {
        every: None,
        on: Some("event".into()),
    };
    assert_eq!(on_event.every_secs(), None);
}

#[test]
fn table_sorts_by_its_key_and_formats_numbers() {
    let spec = ViewSpec::parse(synthetic::ARCHIVE_VIEW_SPEC).unwrap();
    let Part::Table(table) = &spec.layout[3].part else {
        panic!("fourth node is the table")
    };
    let rows = table.sorted_rows();
    let used = &table.columns[1];
    let cells: Vec<String> = rows.iter().map(|row| table.cell_text(row, used)).collect();
    assert_eq!(cells, ["2,210", "1,840", "610"]);
}

#[test]
fn hidden_zero_tile_is_left_out() {
    let spec = ViewSpec::parse(synthetic::ARCHIVE_VIEW_SPEC).unwrap();
    let Part::StatRow(row) = &spec.layout[0].part else {
        panic!("first node is the stat row")
    };
    let labels: Vec<&str> = row.visible_tiles().map(|tile| tile.label.as_str()).collect();
    assert_eq!(labels, ["압축한 폴더", "아낀 용량", "남은 폴더"]);
}
