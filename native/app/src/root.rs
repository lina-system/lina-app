// SPDX-License-Identifier: AGPL-3.0-only
use gpui::prelude::*;
use std::time::{Duration, Instant};

use gpui::{
    AnyElement, Context, Entity, FocusHandle, Focusable, FontWeight, ScrollHandle, Subscription, Task, Window, div,
    point, px,
};
use lina_core::{Author, Message};

use crate::bench::ScrollBench;
use crate::core_model::CoreModel;
use crate::text_input::{Submit, TextInput};
use crate::theme;
use crate::view_render::{render_view, view_card};

pub struct Root {
    core: Entity<CoreModel>,
    input: Entity<TextInput>,
    selected: String,
    open_view: Option<String>,
    messages_scroll: ScrollHandle,
    frames: u64,
    started: Option<Instant>,
    font_family: Option<gpui::SharedString>,
    show_list: bool,
    bench: Option<ScrollBench>,
    _bench_task: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

/// Below this width the screen shows one column: the list or one conversation.
const NARROW: f32 = 760.;

pub struct RootOptions {
    pub conversation: Option<String>,
    pub draft: Option<String>,
    pub bench: bool,
    pub log_input: bool,
    pub started: Option<Instant>,
    pub font_family: Option<gpui::SharedString>,
}

impl Root {
    pub fn new(core: Entity<CoreModel>, options: RootOptions, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| TextInput::new("메시지 입력", options.log_input, cx));
        if let Some(draft) = options.draft {
            input.update(cx, |input, cx| input.set_text(&draft, cx));
        }
        let selected = options
            .conversation
            .filter(|id| core.read(cx).store().conversation(id).is_some())
            .or_else(|| core.read(cx).store().conversations().first().map(|c| c.id.clone()))
            .unwrap_or_default();
        let open_view = core
            .read(cx)
            .store()
            .messages(&selected)
            .iter()
            .rev()
            .find_map(|message| message.view_id.clone());
        let messages_scroll = ScrollHandle::new();
        let subscriptions = vec![
            cx.observe(&core, |this: &mut Self, _, cx| {
                this.messages_scroll.scroll_to_bottom();
                cx.notify();
            }),
            cx.subscribe_in(&input, window, |this: &mut Self, _, Submit(text), _, cx| {
                let selected = this.selected.clone();
                let sent = this.core.update(cx, |core, cx| core.send_message(&selected, text, cx));
                if let Err(error) = sent {
                    eprintln!("lina-ui: not sent: {error}");
                }
            }),
        ];
        core.update(cx, |core, cx| core.mark_read(&selected, cx));
        let bench_task = options.bench.then(|| {
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(Duration::from_secs(2)).await;
                if this
                    .update(cx, |this, _| {
                        eprintln!("lina-bench: scroll start");
                        this.bench = Some(ScrollBench::default());
                    })
                    .is_err()
                {
                    return;
                }
                loop {
                    cx.background_executor().timer(Duration::from_millis(16)).await;
                    match this.update(cx, |this, cx| this.bench_step(cx)) {
                        Ok(false) => {}
                        Ok(true) | Err(_) => break,
                    }
                }
            })
        });
        Root {
            core,
            input,
            selected,
            open_view,
            messages_scroll,
            frames: 0,
            started: options.started,
            font_family: options.font_family,
            show_list: false,
            bench: None,
            _bench_task: bench_task,
            _subscriptions: subscriptions,
        }
    }

    /// One automatic scroll step of 40 px; true when the list reached its end.
    fn bench_step(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(bench) = self.bench.as_mut() else {
            return true;
        };
        bench.steps += 1;
        let max = self.messages_scroll.max_offset().y;
        let offset = self.messages_scroll.offset();
        if max <= px(0.) && bench.steps < 200 {
            cx.notify();
            return false;
        }
        let next = (offset.y - px(40.)).max(-max);
        self.messages_scroll.set_offset(point(offset.x, next));
        cx.notify();
        if next <= -max {
            eprintln!(
                "lina-bench: scroll done {} messages={} scrolled_px={:.0}",
                bench.summary(),
                self.core.read(cx).store().messages(&self.selected).len(),
                f32::from(max)
            );
            self.bench = None;
            return true;
        }
        false
    }

    pub fn focus_input(&self, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.input.focus_handle(cx), cx);
    }

    fn select(&mut self, id: String, cx: &mut Context<Self>) {
        self.core.update(cx, |core, cx| core.mark_read(&id, cx));
        self.selected = id;
        self.show_list = false;
        self.messages_scroll.scroll_to_bottom();
        cx.notify();
    }

    fn sidebar(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let store = self.core.read(cx).store();
        let rows: Vec<_> = store
            .conversations()
            .into_iter()
            .map(|conversation| {
                let id = conversation.id.clone();
                let is_selected = id == self.selected;
                div()
                    .id(gpui::SharedString::from(format!("conversation-{id}")))
                    .flex()
                    .flex_col()
                    .gap_1()
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .when(is_selected, |row| row.bg(theme::selected()))
                    .cursor_pointer()
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .child(
                                div()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(conversation.title.clone()),
                            )
                            .child(
                                div()
                                    .text_size(theme::TEXT_SMALL)
                                    .text_color(theme::muted())
                                    .child(lina_core::model::clock_label(conversation.updated_at)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .gap_2()
                            .child(
                                div()
                                    .flex_1()
                                    .overflow_hidden()
                                    .text_size(theme::TEXT_SMALL)
                                    .text_color(theme::muted())
                                    .whitespace_nowrap()
                                    .text_ellipsis()
                                    .child(conversation.preview.clone()),
                            )
                            .when(conversation.unread > 0, |row| {
                                row.child(
                                    div()
                                        .px_2()
                                        .rounded_full()
                                        .bg(theme::accent())
                                        .text_color(theme::surface())
                                        .text_size(theme::TEXT_SMALL)
                                        .child(conversation.unread.to_string()),
                                )
                            }),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| this.select(id.clone(), cx)))
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .map(|list| if narrow { list.w_full() } else { list.w(px(280.)) })
            .h_full()
            .p_2()
            .gap_1()
            .bg(theme::sidebar())
            .border_r_1()
            .border_color(theme::line())
            .child(
                div()
                    .px_3()
                    .py_2()
                    .text_size(theme::TEXT_LARGE)
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("대화"),
            )
            .children(rows)
            .into_any_element()
    }

    fn message_row(&self, message: &Message, cx: &mut Context<Self>) -> AnyElement {
        let mine = message.author == Author::Me;
        let card = message.view_id.as_ref().and_then(|view_id| {
            let spec = self.core.read(cx).store().view(view_id)?;
            let view_id = view_id.clone();
            Some(
                div()
                    .id(gpui::SharedString::from(format!("view-card-{}", message.id)))
                    .cursor_pointer()
                    .child(view_card(spec))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.open_view = Some(view_id.clone());
                        cx.notify();
                    })),
            )
        });
        div()
            .flex()
            .flex_col()
            .gap_1()
            .when(mine, |row| row.items_end())
            .child(
                div()
                    .text_size(theme::TEXT_SMALL)
                    .text_color(theme::muted())
                    .child(format!("{} · {}", message.author.label(), message.time_label())),
            )
            .child(
                div()
                    .max_w(px(520.))
                    .px_3()
                    .py_2()
                    .rounded_lg()
                    .bg(if mine { theme::mine() } else { theme::sidebar() })
                    .child(message.text.clone()),
            )
            .children(card)
            .into_any_element()
    }

    fn conversation(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let store = self.core.read(cx).store();
        let (title, agent) = store
            .conversation(&self.selected)
            .map(|c| (c.title.clone(), c.agent.clone()))
            .unwrap_or_default();
        let messages: Vec<Message> = store.messages(&self.selected).to_vec();
        let mut rows = Vec::with_capacity(messages.len());
        for message in &messages {
            rows.push(self.message_row(message, cx));
        }
        div()
            .flex()
            .flex_col()
            .flex_1()
            .h_full()
            .when(!narrow, |column| column.min_w(px(360.)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .px_4()
                    .py_3()
                    .border_b_1()
                    .border_color(theme::line())
                    .when(narrow, |head| {
                        head.child(
                            div()
                                .id("back-to-list")
                                .text_size(theme::TEXT_SMALL)
                                .text_color(theme::accent())
                                .cursor_pointer()
                                .child("‹ 대화 목록")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.show_list = true;
                                    cx.notify();
                                })),
                        )
                    })
                    .child(div().font_weight(FontWeight::SEMIBOLD).child(title))
                    .child(
                        div()
                            .text_size(theme::TEXT_SMALL)
                            .text_color(theme::muted())
                            .child(agent),
                    ),
            )
            .child(
                div()
                    .id("messages")
                    .flex_1()
                    .overflow_y_scroll()
                    .track_scroll(&self.messages_scroll)
                    .child(div().flex().flex_col().gap_3().p_4().children(rows)),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .p_3()
                    .border_t_1()
                    .border_color(theme::line())
                    .child(div().flex_1().child(self.input.clone()))
                    .child(
                        div()
                            .id("send")
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .bg(theme::accent())
                            .text_color(theme::surface())
                            .cursor_pointer()
                            .child("보내기")
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.input.update(cx, |input, cx| {
                                    input.submit(window, cx);
                                });
                            })),
                    ),
            )
            .into_any_element()
    }

    fn view_panel(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let view_id = self.open_view.as_ref()?;
        let spec = self.core.read(cx).store().view(view_id)?;
        Some(
            div()
                .id("view-panel")
                .flex()
                .flex_col()
                .gap_3()
                .w(px(460.))
                .h_full()
                .p_4()
                .overflow_y_scroll()
                .border_l_1()
                .border_color(theme::line())
                .child(
                    div().flex().justify_end().child(
                        div()
                            .id("close-view")
                            .text_size(theme::TEXT_SMALL)
                            .text_color(theme::accent())
                            .cursor_pointer()
                            .child("닫기")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.open_view = None;
                                cx.notify();
                            })),
                    ),
                )
                .child(render_view(spec))
                .into_any_element(),
        )
    }
}

impl Render for Root {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.frames += 1;
        if let Some(bench) = self.bench.as_mut() {
            bench.frame();
        }
        let size = window.bounds().size;
        let narrow = size.width < px(NARROW);
        if self.frames <= 3 || self.frames.is_multiple_of(100) {
            let store = self.core.read(cx).store();
            eprintln!(
                "lina-ui: frame {} at v{} ({} messages in {}, view open: {}, narrow: {narrow}, window {:?})",
                self.frames,
                store.version(),
                store.messages(&self.selected).len(),
                self.selected,
                self.open_view.is_some(),
                size,
            );
        }
        if self.frames == 1
            && let Some(started) = self.started
        {
            eprintln!(
                "lina-bench: first_frame_ms={:.1}",
                started.elapsed().as_secs_f64() * 1000.0
            );
        }
        let root = div()
            .flex()
            .size_full()
            .bg(theme::surface())
            .text_color(theme::text())
            .text_size(theme::TEXT_BODY)
            .when_some(self.font_family.clone(), |root, family| root.font_family(family));
        if narrow {
            return if self.show_list {
                root.child(self.sidebar(true, cx))
            } else {
                root.child(self.conversation(true, cx))
            };
        }
        root.child(self.sidebar(false, cx))
            .child(self.conversation(false, cx))
            .children(self.view_panel(cx))
    }
}

impl Focusable for Root {
    fn focus_handle(&self, cx: &gpui::App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}
