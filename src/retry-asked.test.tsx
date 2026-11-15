import { act, fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { HttpSource } from "./data/http-source";
import { Live } from "./data/live";
import { Store } from "./data/store";
import { storedCopy } from "./data/stored";
import { SyntheticSource } from "./data/synthetic-source";
import type { CardRow } from "./model";
import { Actions } from "./ui/actions";

// lina-app#208: 다시 시도 on a stopped work card leaves the owner's comment on the card, and that comment is the request's
// trace in the core's record. A new page, a second window or a page opened from its kept copy reads 요청함 from it and
// sends nothing again, until the card's last beat moves past it.

const TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] };
const ORIGIN = "https://hub.test";
const RETRY = "다시 시도해 주세요.";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

type Scene = SyntheticSource["scene"];
type CardComment = Scene["cardDetails"][string]["comments"][number];

/**
 * k-103 as the core serves a card its failure breaker gave up on (a disposable core, 11-16): blocked by a `gave_up`
 * event, so `failed`, waiting on the owner, not tried again, no beat on the row; its detail holds the one run the
 * breaker closed, and `comments` the given ones. The owner's comment on a card is by `owner`, as the core's answer
 * route writes it.
 */
function gaveUp(comments: (now: number) => CardComment[] = () => [], beat: number | null = null): SyntheticSource {
  const { scene } = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const stop = { state: "stopped", reason: "failed", waitingOn: "owner", retry: "none", ask: null, lastHeartbeatAt: beat, endedAt: null } as const;
  const cards = scene.cards.cards.map((card) => (card.id === "k-103" ? { ...card, ...stop, elapsedSeconds: 600 } : card));
  const run = { id: 1, profile: scene.cardDetails["k-103"].agent, status: "gave_up", outcome: "gave_up", startedAt: scene.now - 600, endedAt: scene.now - 599, lastHeartbeatAt: null, summary: null, live: false };
  const cardDetails = { ...scene.cardDetails, "k-103": { ...scene.cardDetails["k-103"], ...stop, elapsedSeconds: 600, runs: [run], comments: comments(scene.now) } };
  return new SyntheticSource({ now: scene.now, scene: { ...scene, cards: { ...scene.cards, cards }, cardDetails } });
}

const asked = (now: number, ago: number): CardComment => ({ id: 41, author: "owner", body: RETRY, createdAt: now - ago });

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function running(source: SyntheticSource, wide = true, store = new Store(source)) {
  setWide(wide);
  window.history.replaceState(null, "", "/app/#/running");
  const view = render(<App store={store} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return { view, row: () => within(view.getByTestId("screen-running")) };
}

test("a fresh page on a card whose comments hold the owner's request reads 요청함 and offers no 다시 시도", async () => {
  for (const wide of [true, false]) {
    const source = gaveUp((now) => [asked(now, 120)]);
    const answer = vi.spyOn(source, "answerCard");
    const { view, row } = await running(source, wide);
    await waitFor(() => expect(row().getByTestId("retry-requested").textContent).toMatch(/^\S+에게 요청함$/), { timeout: 5000 });
    expect(row().queryAllByTestId("retry")).toHaveLength(0);
    expect(answer).not.toHaveBeenCalled();
    view.unmount();
  }
});

test("a request older than the card's last beat is answered: 다시 시도 stands again", async () => {
  const source = gaveUp((now) => [asked(now, 300)], Math.floor(Date.now() / 1000) - 60);
  const { row } = await running(source);
  await waitFor(() => expect((row().getByTestId("retry") as HTMLButtonElement).disabled).toBe(false), { timeout: 5000 });
  expect(row().queryByTestId("retry-requested")).toBeNull();
});

test("while the card's comments are not read, 다시 시도 is drawn disabled and a press sends nothing", async () => {
  const source = gaveUp();
  const read = source.read.bind(source);
  vi.spyOn(source, "read").mockImplementation(((name: string, ...rest: unknown[]) => (name === "card" ? new Promise(() => {}) : (read as (...args: unknown[]) => unknown)(name, ...rest))) as typeof source.read);
  const answer = vi.spyOn(source, "answerCard");
  const { row } = await running(source);
  const button = row().getByTestId("retry") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(answer).not.toHaveBeenCalled();
});

test("pressed once, a reload and a second window read 요청함 from the card and send no second comment; on the card, not its to-do", async () => {
  const source = gaveUp();
  const answer = vi.spyOn(source, "answerCard");
  const retry = vi.spyOn(source, "retry");
  const first = await running(source);
  // The card's detail is read for its row, so its runs name the to-do T5; a work card still takes the request on the card.
  await waitFor(() => expect((first.row().getByTestId("retry") as HTMLButtonElement).disabled).toBe(false), { timeout: 5000 });
  fireEvent.click(first.row().getByTestId("retry"));
  await waitFor(() => expect(first.row().getByTestId("retry-requested")).toBeTruthy());
  expect(answer.mock.calls).toEqual([["k-103", { text: RETRY }]]);
  expect(retry).not.toHaveBeenCalled();
  first.view.unmount();
  for (const wide of [true, false]) {
    // Another page has its own connection to the core: its own source on the same record.
    const other = new SyntheticSource({ scene: source.scene });
    const otherAnswer = vi.spyOn(other, "answerCard");
    const again = await running(other, wide);
    await waitFor(() => expect(again.row().getByTestId("retry-requested").textContent).toMatch(/^\S+에게 요청함$/), { timeout: 5000 });
    expect(again.row().queryAllByTestId("retry")).toHaveLength(0);
    expect(otherAnswer).not.toHaveBeenCalled();
    again.view.unmount();
  }
  expect(answer).toHaveBeenCalledTimes(1);
  expect(source.scene.cardDetails["k-103"].comments.filter((comment) => comment.body === RETRY)).toHaveLength(1);
});

test("a page opened from its kept copy reads 요청함 at once, before the card is read again", async () => {
  vi.useFakeTimers(TIMERS);
  const items = new Map<string, string>();
  const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };
  const copy = () => storedCopy(new HttpSource({ fetch: (() => Promise.reject(new Error("no core"))) as typeof fetch, token: "token-a" }), { storage: () => storage, origin: ORIGIN, app: "test-1" });
  const source = gaveUp((now) => [asked(now, 120)]);
  setWide(true);
  window.history.replaceState(null, "", "/app/#/running");
  const firstStore = new Store(source, { stored: copy() });
  const firstView = render(<App store={firstStore} />);
  const stop = new Live(firstStore).start();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  await vi.waitFor(() => expect(within(firstView.getByTestId("screen-running")).getByTestId("retry-requested")).toBeTruthy(), { timeout: 3000 });
  stop();
  firstView.unmount();

  const next = new SyntheticSource({ scene: source.scene, live: "down" });
  const read = vi.spyOn(next, "read");
  const view = render(<App store={new Store(next, { stored: copy() })} />);
  const row = within(view.getByTestId("screen-running"));
  expect(row.getByTestId("retry-requested").textContent).toMatch(/^\S+에게 요청함$/);
  expect(row.queryAllByTestId("retry")).toHaveLength(0);
  expect(read).not.toHaveBeenCalled();
});

test("Actions sends nothing for a card whose request the record holds, or whose record is not read yet", async () => {
  const writes: string[] = [];
  const store = {
    get: () => undefined,
    write: async (send: (source: unknown) => Promise<unknown>) => {
      await send({ answerCard: async (id: string) => writes.push(`answerCard ${id}`), retry: async (id: string) => writes.push(`retry ${id}`) });
      return { ok: true, data: {} };
    },
  } as unknown as Store;
  const actions = new Actions(store, () => {});
  const row = (asked: boolean | null) => ({ key: "card:k-1", kind: "card", id: "k-1", todo: "T1", agent: "ag-1", state: "stopped", asked }) as unknown as CardRow;
  await actions.retry(row(true));
  await actions.retry(row(null));
  expect(writes).toEqual([]);
  await actions.retry(row(false));
  expect(writes).toEqual(["answerCard k-1"]);
});
