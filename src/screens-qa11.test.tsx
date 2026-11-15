import { render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { ROUND11_WORD, STATE_WORD, W } from "./words";

// lina-app#179: UI QA round 11 on the scene shaped like the hub's response (`&hub=round11`): every card read-only, three
// finished cards whose titles differ only by a hash, a planned card with nothing of its own yet, and the decision on T2
// asked 19 days ago while the item list serves T2 `waiting` with no reason since two days ago.

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

const now = () => Math.floor(Date.now() / 1000);
const hub = () => new SyntheticSource({ now: now(), hubRound11: true });

async function open(hash: string, source: SyntheticSource = hub(), wide = true) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

async function frame(view: ReturnType<typeof render>): Promise<HTMLElement> {
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).not.toBeNull());
  await waitFor(() => expect(view.container.querySelector("[data-testid=detail-loading]")).toBeNull());
  return view.getByTestId("detail-frame");
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const navCount = (view: ReturnType<typeof render>, testid: string) => ({
  count: Number(view.getByTestId(testid).querySelector("[data-testid=nav-count]")?.textContent ?? "0"),
  stopped: Number(view.getByTestId(testid).querySelector("[data-testid=nav-stopped]")?.textContent ?? "0"),
});
const rows = (root: Element | null) => (root ? root.querySelectorAll("[data-testid=row]").length : 0);

test("item 1: every sidebar number is the rows of the list it opens, 완료 the lines the work tab lists", async () => {
  const view = await open("#/running");
  const sidebar = {
    inbox: navCount(view, "nav-inbox"),
    running: navCount(view, "nav-running"),
    due: navCount(view, "nav-due"),
    done: navCount(view, "nav-done"),
    goals: navCount(view, "nav-goals"),
    agents: [0, 1, 2].map((index) => navCount(view, `nav-agent-${index}`)),
  };
  const home = view.getByTestId("screen-running");
  const workDone = rows(home.querySelector("[data-testid=section-recent]")) + rows(home.querySelector("[data-testid=section-older]"));
  expect(sidebar.done.count).toBe(workDone);
  expect(sidebar.running.count).toBe(rows(home.querySelector("[data-testid=section-active]")));
  expect(sidebar.running.stopped).toBe(Number(home.querySelector("[data-testid=head-stopped] [data-testid=stopped-count]")?.textContent));
  view.unmount();

  const lists: [string, string, number][] = [
    ["#/done", "screen-done", sidebar.done.count],
    ["#/inbox", "screen-inbox", sidebar.inbox.count],
    ["#/due", "screen-due", sidebar.due.count],
    ["#/goals", "screen-goals", sidebar.goals.count],
  ];
  for (const [hash, testid, count] of lists) {
    const list = await open(hash);
    expect(rows(list.getByTestId(testid)), hash).toBe(count);
    list.unmount();
  }
  const { scene } = hub();
  for (const [index, agent] of scene.items.agents.entries()) {
    const screen = await open(`#/agents/${agent.id}`);
    const running = screen.getByTestId("screen-agent").querySelector("[data-testid=section-running]");
    const stopped = running ? running.querySelectorAll(".is-stopped").length : 0;
    expect({ count: rows(running) - stopped, stopped }, agent.id).toEqual(sidebar.agents[index]);
    screen.unmount();
  }
});

test("item 2: a running card and a stopped card name their run history with one word", async () => {
  const heads: string[] = [];
  for (const id of ["k-101", "k-103"]) {
    const view = await open(`#/cards/${id}`);
    const detail = await frame(view);
    await waitFor(() => expect(detail.querySelector("[data-testid=timeline], [data-testid=worker-runs]")).not.toBeNull());
    heads.push(detail.querySelector("[data-testid=timeline], [data-testid=worker-runs]")?.querySelector(".box-head")?.textContent ?? "");
    view.unmount();
  }
  expect(heads).toEqual([W.record, W.record]);
});

test("item 3: a scheduled read-only card with nothing of its own says so in one line; a card with content does not", async () => {
  for (const wide of [true, false]) {
    const view = await open("#/cards/k-106", hub(), wide);
    const detail = wide ? await frame(view) : await waitFor(() => view.getByTestId("screen-card"));
    expect(detail.querySelector("[data-testid=state]")?.textContent).toBe(STATE_WORD.planned);
    await waitFor(() => expect(detail.querySelector("[data-testid=card-nothing]")?.textContent).toBe(ROUND11_WORD.nothingYet));
    view.unmount();
  }
  const busy = await open("#/cards/k-101");
  expect((await frame(busy)).querySelector("[data-testid=card-nothing]")).toBeNull();
});

/** T2's decision as the inbox, its own head and its goal's 할 일 in the conversation tab say it: the state word and the time. */
async function decisionLines() {
  const inbox = await open("#/inbox");
  const row = inbox.getByTestId("screen-inbox").querySelector('li:has(> a[href="#/items/T2"])');
  const fromInbox = { word: row?.querySelector(".kind-word")?.textContent, time: row?.querySelector(".time")?.textContent };
  inbox.unmount();
  const item = await open("#/items/T2");
  const head = (await frame(item)).querySelector(".detail-head .head-check");
  const fromHead = { word: head?.querySelector("[data-testid=state]")?.textContent, time: head?.querySelector(".time")?.textContent?.replace(/^ · /, "") };
  item.unmount();
  const talk = await open("#/talk/ag-1?goal=G1");
  const goal = await waitFor(() => talk.getByTestId("screen-goal"));
  const line = goal.querySelector('a[href="#/items/T2"]');
  const fromGoal = { word: line?.querySelector("[data-testid=state]")?.textContent, time: line?.querySelector(".time")?.textContent?.replace(/^ · /, "") };
  talk.unmount();
  return { fromInbox, fromHead, fromGoal };
}

test("item 4: one decision reads one word in the inbox, its detail and its goal's 할 일; a planned to-do reads 예정 alone", async () => {
  const { fromInbox, fromHead, fromGoal } = await decisionLines();
  expect([fromInbox.word, fromHead.word, fromGoal.word]).toEqual([ROUND11_WORD.decisionWait, ROUND11_WORD.decisionWait, ROUND11_WORD.decisionWait]);
  // T3 waits for its date: 예정, with no time since it was planned, in its head and in its goal's 할 일.
  const item = await open("#/items/T3");
  const head = (await frame(item)).querySelector(".detail-head .head-check .sub")?.textContent;
  item.unmount();
  const talk = await open("#/talk/ag-1?goal=G1");
  const goal = await waitFor(() => talk.getByTestId("screen-goal"));
  const line = goal.querySelector('a[href="#/items/T3"] .sub')?.textContent;
  expect([head, line]).toEqual([STATE_WORD.planned, STATE_WORD.planned]);
});

test("item 5: one decision waits the same time everywhere, the time since its question was asked", async () => {
  const { fromInbox, fromHead, fromGoal } = await decisionLines();
  expect([fromInbox.time, fromHead.time, fromGoal.time]).toEqual(["19일 전", "19일 전", "19일 전"]);
});
