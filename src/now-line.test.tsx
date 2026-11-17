import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { NOW_SCENE, SyntheticSource } from "./data/synthetic-source";

// G138: on the hub's shapes of cards at work and waiting (`&hub=now`), a card's top line (its going round's head, 지금 and
// its row's second line) is the core's now line of 40 letters or fewer, else what its state says it waits for, else none.
// No bot comment ever stands there.

const TIME = "(?:어제 |\\d+월 \\d+일 )?\\d\\d:\\d\\d";
const N = NOW_SCENE;

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, wide = true) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(new SyntheticSource({ now: Math.floor(Date.now() / 1000), hubNow: true }))} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

async function frame(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return view.getByTestId("detail-frame");
}

/** The going round's head, once the record is drawn. */
async function head(card: HTMLElement): Promise<string> {
  await waitFor(() => expect(card.querySelector("[data-testid=timeline] .timeline-head")).not.toBeNull());
  return card.querySelector("[data-testid=timeline] .timeline-head")?.textContent ?? "";
}

const now = (card: HTMLElement) => card.querySelector("[data-testid=card-now] .box-text")?.textContent ?? null;

afterEach(() => {
  vi.unstubAllGlobals();
});

for (const wide of [true, false])
  test(`a going card with a now line of 40 letters or fewer reads it on top, and in 지금 (${wide ? 1280 : 390})`, async () => {
    const card = await frame(await open(`#/cards/${N.told}`, wide));
    expect(await head(card)).toMatch(new RegExp(`^${TIME} · 진행 중 · ${N.toldNow}$`));
    expect(now(card)).toBe(N.toldNow);
    expect([...N.toldNow].length).toBeLessThanOrEqual(40);
    expect(card.textContent).not.toMatch(/도구 사용|읽기 전용/);
  });

test("a waiting card whose now line is over 40 letters reads what its state says it waits for, never its ask", async () => {
  const card = await frame(await open(`#/cards/${N.waiting}`));
  expect(now(card)).toBe("검토를 기다리는 중");
  expect(card.textContent).not.toContain(N.longNow);
  expect(within(card).queryByText(N.ask)).toBeNull();
});

test("a going card with no now line whose question is in the work inbox reads 결정 대기 on top", async () => {
  const card = await frame(await open(`#/cards/${N.asking}`));
  expect(await head(card)).toMatch(new RegExp(`^${TIME} · 진행 중 · 결정 대기$`));
  expect(now(card)).toBe("결정 대기");
});

test("a going card with no now line and nothing the core says it waits for has no top line: its head reads 진행 중 alone", async () => {
  const card = await frame(await open(`#/cards/${N.going}`));
  expect(await head(card)).toMatch(new RegExp(`^${TIME} · 진행 중$`));
  expect(within(card).queryByTestId("card-now")).toBeNull();
  // Its tool step is no line of its own: it is in the one folded line.
  expect(card.textContent).not.toMatch(/도구 사용|Assigned|받음|접힌 댓글 \d+건/);
  expect(card.querySelector("[data-testid=timeline] [data-kind=folded]")?.textContent).toMatch(/접힌 기록/);
});

test("no bot comment stands as a top line: not on a going round's head, in 지금, on a row or as a stop's reason", async () => {
  for (const id of [N.told, N.going, N.asking, N.waiting, N.device]) {
    const view = await open(`#/cards/${id}`);
    const card = await frame(view);
    const top = [...card.querySelectorAll("[data-testid=timeline] .timeline-head, [data-testid=card-now], .detail-head")].map((each) => each.textContent).join("\n");
    expect(top, id).not.toContain(N.botSaid);
    expect(top, id).not.toContain(N.deviceSaid);
    expect(view.container.querySelector(".list-pane")?.textContent ?? "", id).not.toMatch(new RegExp(`${N.botSaid}|${N.deviceSaid}`));
    view.unmount();
  }
});

test("the going card's row reads the same top line on its second line at desktop width", async () => {
  const view = await open("#/running");
  const line = (id: string) => view.container.querySelector(`.list-pane a[href="#/cards/${id}"] .now`)?.textContent ?? null;
  expect(line(N.told)).toBe(N.toldNow);
  expect(line(N.asking)).toBe("결정 대기");
  expect(line(N.going)).toBeNull();
});

test("a feedback stop nobody asks the owner for reads 다른 일 대기 alone; a decision stop with nothing of why reads its words alone", async () => {
  const first = await open(`#/cards/${N.device}`);
  const device = await frame(first);
  await waitFor(() => expect(device.querySelector(".detail-head [data-testid=state]")?.textContent).toBe("중단됨 · 다른 일 대기"));
  expect(device.querySelector(".detail-head")?.textContent).not.toMatch(/피드백 대기|이유 기록 없음|답할 곳/);
  expect(within(device).queryByTestId("card-now")).toBeNull();
  first.unmount();
  const bare = await frame(await open(`#/cards/${N.bare}`));
  expect(within(bare).getByTestId("stop-why").textContent).toBe("결정 대기");
  expect(within(bare).getByTestId("answer-where").textContent).toMatch(/^답할 곳 · \S+ 대화$/);
  expect(bare.textContent).not.toMatch(/이유 기록 없음|읽기 전용/);
  expect(bare.querySelector("[data-testid=read-only]")).toBeNull();
});

// The hub sends no `waitingOn` on its own cards: a feedback stop there waits on the owner only when its question is in
// the work inbox, on its row and in its detail head alike, and only that one comes first among the stops.
for (const wide of [true, false])
  test(`a hub card stopped on feedback reads 피드백 대기 only when its question is in the work inbox (${wide ? 1280 : 390})`, async () => {
    const list = await open("#/running", wide);
    const row = (id: string) => list.container.querySelector(`a[href="#/cards/${encodeURIComponent(id)}"] [data-testid=state]`)?.textContent ?? null;
    // The stopped group draws its first rows and folds the rest in its `외 n개`: open it.
    for (const button of [...list.container.querySelectorAll(".more-row button")]) fireEvent.click(button);
    await waitFor(() => expect(row(N.hubWait)).toBe("중단됨 · 다른 일 대기"));
    expect(row(N.hubAsked)).toBe("중단됨 · 피드백 대기");
    list.unmount();
    const first = await open(`#/cards/${encodeURIComponent(N.hubWait)}`, wide);
    const waiting = await frame(first);
    await waitFor(() => expect(waiting.querySelector(".detail-head [data-testid=state]")?.textContent).toBe("중단됨 · 다른 일 대기"));
    expect(waiting.querySelector(".detail-head")?.textContent).not.toMatch(/피드백 대기|결정 대기|답할 곳/);
    first.unmount();
    const asked = await frame(await open(`#/cards/${encodeURIComponent(N.hubAsked)}`, wide));
    await waitFor(() => expect(within(asked).getByTestId("stop-why").textContent).toBe("피드백 대기"));
    expect(within(asked).getByTestId("answer-where").textContent).toMatch(/^답할 곳 · \S+ 대화$/);
  });
