import { render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { NOW_SCENE, SyntheticSource } from "./data/synthetic-source";

// G138: on the hub's shapes of cards at work and waiting (`&hub=now`), a card says what it does now in one sentence, a stop
// with no reason says its words alone, and a read-only card has no line saying so.

const TIME = "(?:어제 |\\d+월 \\d+일 )?\\d\\d:\\d\\d";
const N = NOW_SCENE;

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, wide = true) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000), hubNow: true });
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return { view, source };
}

async function frame(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return view.getByTestId("detail-frame");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

for (const wide of [true, false])
  test(`a going card's record opens on what it does now, its 지금 says the same, and no tool count stands as a line (${wide ? 1280 : 390})`, async () => {
    const { view } = await open(`#/cards/${N.going}`, wide);
    const card = await frame(view);
    await waitFor(() => expect(card.querySelector("[data-testid=timeline] .timeline-head")).not.toBeNull());
    expect(card.querySelector("[data-testid=timeline] .timeline-head")?.textContent).toMatch(new RegExp(`^${TIME} · 진행 중 · ${N.doing}$`));
    expect(within(card).getByTestId("card-now").textContent).toBe(`지금${N.doing}`);
    expect(card.textContent).not.toMatch(/도구 사용/);
    // The hand-out lines and the receipt are notices: the one folded comment is the progress report, the owner's is as saved.
    const comments = within(card).getByTestId("card-comments");
    expect(comments.textContent).toContain(N.ownerNote);
    expect(comments.textContent).not.toMatch(/Assigned|받음|접힌 댓글 \d/);
    expect(comments.textContent).toContain("접힌 댓글");
    expect(card.querySelector("[data-testid=read-only]")).toBeNull();
    expect(card.textContent).not.toContain("읽기 전용");
  });

test("the going card's row says the same sentence on its second line at desktop width, once its comments are read", async () => {
  const { view } = await open(`#/cards/${N.going}`);
  await frame(view);
  const link = view.container.querySelector(`.list-pane a[href="#/cards/${N.going}"]`) as HTMLElement;
  expect(link.querySelector(".now")?.textContent).toBe(N.doing);
});

test("a waiting card with only the owner's comment says what it waits for; a card with no sentence of its own says nothing", async () => {
  const { view } = await open(`#/cards/${N.waiting}`);
  expect(within(await frame(view)).getByTestId("card-now").textContent).toBe(`지금${N.waits}`);
});

test("a feedback stop nobody asks the owner for waits on something else and reads why from its newest bot comment", async () => {
  const { view } = await open(`#/cards/${N.device}`);
  const card = await frame(view);
  await waitFor(() => expect(card.querySelector(".detail-head [data-testid=state]")?.textContent).toBe(`중단됨 · 다른 일 대기 · ${N.deviceWhy}`));
  expect(card.textContent).not.toMatch(/피드백 대기|이유 기록 없음|답할 곳/);
  // Its why is in its head: no 지금 box says it again.
  expect(within(card).queryByTestId("card-now")).toBeNull();
});

test("a decision stop with nothing of why reads its words alone, and a read-only one names where to answer with no read-only line", async () => {
  const { view, source } = await open(`#/cards/${N.bare}`);
  const card = await frame(view);
  expect(within(card).getByTestId("stop-why").textContent).toBe("결정 대기");
  expect(card.textContent).not.toContain("이유 기록 없음");
  const agent = source.scene.items.agents[1];
  expect(within(card).getByTestId("answer-where").textContent).toBe(`답할 곳 · ${agent.name} 대화`);
  expect(card.querySelector("[data-testid=read-only]")).toBeNull();
  expect(within(card).queryByRole("textbox")).toBeNull();
});
