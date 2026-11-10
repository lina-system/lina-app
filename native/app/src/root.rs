// SPDX-License-Identifier: Apache-2.0
use gpui::prelude::*;
use gpui::{
    AnyElement, Context, Entity, FocusHandle, Focusable, FontWeight, ScrollHandle, Subscription, Window, div, px,
};
use lina_core::{Author, Message};

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
    _subscriptions: Vec<Subscription>,
}

impl Root {
    pub fn new(
        core: Entity<CoreModel>,
        conversation: Option<String>,
        draft: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let input = cx.new(|cx| TextInput::new("메시지 입력", cx));
        if let Some(draft) = draft {
            input.update(cx, |input, cx| input.set_text(&draft, cx));
        }
        let selected = conversation
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
        Root {
            core,
            input,
            selected,
            open_view,
            messages_scroll,
            frames: 0,
            _subscriptions: subscriptions,
        }
    }

    pub fn focus_input(&self, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.input.focus_handle(cx));
    }

    fn select(&mut self, id: String, cx: &mut Context<Self>) {
        self.core.update(cx, |core, cx| core.mark_read(&id, cx));
        self.selected = id;
        self.messages_scroll.scroll_to_bottom();
        cx.notify();
    }

    fn sidebar(&self, cx: &mut Context<Self>) -> AnyElement {
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
            .w(px(280.))
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

    fn conversation(&self, cx: &mut Context<Self>) -> AnyElement {
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
            .min_w(px(360.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .px_4()
                    .py_3()
                    .border_b_1()
                    .border_color(theme::line())
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
        let store = self.core.read(cx).store();
        eprintln!(
            "lina-ui: frame {} at v{} ({} messages in {}, view open: {}, window {:?})",
            self.frames,
            store.version(),
            store.messages(&self.selected).len(),
            self.selected,
            self.open_view.is_some(),
            window.bounds().size,
        );
        div()
            .flex()
            .size_full()
            .bg(theme::surface())
            .text_color(theme::text())
            .text_size(theme::TEXT_BODY)
            .child(self.sidebar(cx))
            .child(self.conversation(cx))
            .children(self.view_panel(cx))
    }
}

impl Focusable for Root {
    fn focus_handle(&self, cx: &gpui::App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}
