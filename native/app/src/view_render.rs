// SPDX-License-Identifier: Apache-2.0
//! Draws a view spec with the component set. Values and labels come from
//! `lina-core`; this file only lays them out.

use gpui::{AnyElement, Div, FontWeight, IntoElement, ParentElement, Styled, div, px, relative};
use lina_core::ViewSpec;
use lina_core::view_spec::{Align, List, Part, Progress, StatRow, Table, state_label};

use crate::theme;

pub fn render_view(spec: &ViewSpec) -> Div {
    let refresh = match spec.refresh.every_secs() {
        Some(secs) if secs % 60 == 0 => format!("{}분마다 새로 고침", secs / 60),
        Some(secs) => format!("{secs}초마다 새로 고침"),
        None => "바뀔 때 새로 고침".to_string(),
    };
    div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .flex_col()
                .gap_1()
                .child(
                    div()
                        .text_size(theme::TEXT_LARGE)
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(spec.title.clone()),
                )
                .child(
                    div()
                        .text_size(theme::TEXT_SMALL)
                        .text_color(theme::muted())
                        .child(format!("{} · {refresh} · v{}", spec.owner, spec.version)),
                ),
        )
        .children(spec.layout.iter().map(|node| render_part(&node.part)))
}

/// The card shown inside the conversation: title, two numbers, one progress line.
pub fn view_card(spec: &ViewSpec) -> Div {
    let mut card = div()
        .flex()
        .flex_col()
        .gap_2()
        .p_3()
        .w(px(320.))
        .rounded_lg()
        .border_1()
        .border_color(theme::line())
        .bg(theme::surface())
        .child(div().font_weight(FontWeight::SEMIBOLD).child(spec.title.clone()));
    for node in &spec.layout {
        match &node.part {
            Part::StatRow(row) => {
                card = card.child(div().flex().gap_4().children(row.visible_tiles().take(2).map(|tile| {
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_size(theme::TEXT_SMALL)
                                .text_color(theme::muted())
                                .child(tile.label.clone()),
                        )
                        .child(div().font_weight(FontWeight::SEMIBOLD).child(tile.value_label()))
                })));
            }
            Part::Progress(progress) => card = card.child(progress_bar(progress)),
            _ => {}
        }
    }
    card.child(
        div()
            .text_size(theme::TEXT_SMALL)
            .text_color(theme::accent())
            .child("화면 열기"),
    )
}

fn render_part(part: &Part) -> AnyElement {
    match part {
        Part::StatRow(row) => stat_row(row).into_any_element(),
        Part::Progress(progress) => progress_bar(progress).into_any_element(),
        Part::List(list) => list_rows(list).into_any_element(),
        Part::Table(table) => table_grid(table).into_any_element(),
    }
}

fn stat_row(row: &StatRow) -> Div {
    div()
        .flex()
        .flex_wrap()
        .gap_3()
        .children(row.visible_tiles().map(|tile| {
            div()
                .flex()
                .flex_col()
                .gap_1()
                .p_3()
                .min_w(px(120.))
                .rounded_lg()
                .bg(theme::sidebar())
                .child(
                    div()
                        .text_size(theme::TEXT_SMALL)
                        .text_color(theme::muted())
                        .child(tile.label.clone()),
                )
                .child(
                    div()
                        .text_size(theme::TEXT_LARGE)
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(tile.value_label()),
                )
                .children(tile.delta_label().map(|delta| {
                    div()
                        .text_size(theme::TEXT_SMALL)
                        .text_color(theme::accent())
                        .child(delta)
                }))
        }))
}

fn progress_bar(progress: &Progress) -> Div {
    div()
        .flex()
        .items_center()
        .gap_3()
        .child(
            div().flex_1().h(px(8.)).rounded_full().bg(theme::line()).child(
                div()
                    .h_full()
                    .rounded_full()
                    .bg(theme::accent())
                    .w(relative(progress.ratio())),
            ),
        )
        .child(
            div()
                .text_size(theme::TEXT_SMALL)
                .text_color(theme::muted())
                .child(progress.label()),
        )
}

fn list_rows(list: &List) -> Div {
    div()
        .flex()
        .flex_col()
        .rounded_lg()
        .border_1()
        .border_color(theme::line())
        .children(list.rows.iter().map(|row| {
            let state = row.state.clone().unwrap_or_default();
            div()
                .flex()
                .items_center()
                .justify_between()
                .px_3()
                .py_2()
                .border_b_1()
                .border_color(theme::line())
                .child(
                    div().flex().flex_col().child(row.title.clone()).children(
                        row.sub
                            .clone()
                            .map(|sub| div().text_size(theme::TEXT_SMALL).text_color(theme::muted()).child(sub)),
                    ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .text_size(theme::TEXT_SMALL)
                        .child(div().size(px(8.)).rounded_full().bg(theme::state_color(&state)))
                        .child(state_label(&state)),
                )
        }))
}

fn table_grid(table: &Table) -> Div {
    let cell = |align: Align| {
        let base = div().flex_1().px_3().py_2().flex();
        match align {
            Align::Start => base.justify_start(),
            Align::End => base.justify_end(),
        }
    };
    div()
        .flex()
        .flex_col()
        .rounded_lg()
        .border_1()
        .border_color(theme::line())
        .child(
            div()
                .flex()
                .bg(theme::sidebar())
                .text_size(theme::TEXT_SMALL)
                .text_color(theme::muted())
                .children(
                    table
                        .columns
                        .iter()
                        .map(|column| cell(column.align).child(column.label.clone())),
                ),
        )
        .children(table.sorted_rows().into_iter().map(|row| {
            div().flex().border_t_1().border_color(theme::line()).children(
                table
                    .columns
                    .iter()
                    .map(|column| cell(column.align).child(table.cell_text(row, column))),
            )
        }))
}
