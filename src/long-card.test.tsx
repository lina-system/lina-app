import { act, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { FINISHED_SHOWN, RECORDS_AT_ONCE, Store } from "./data/store";
import { LONG_CARD, SyntheticSource } from "./data/synthetic-source";
import { W } from "./words";

// lina-app#253: the hub's biggest card (142 worker runs) took 8-13 s to open. Its detail came in 250 ms, then the page
// asked every run's record at once; the core answers one read after another, so the card list asked meanwhile landed
// behind them all, the head read 제목 없음 until then, and the history waited for the last record. Records are read a
// few at a time, newest run first, never ahead of the lists; the history draws from the first that hold rounds and the
// head reads 불러오는 중 while the list row is not read. Made-up words (LONG_CARD), in the hub's shape.

const CARD = LONG_CARD.card;
const runId = (n: number) => `w-86${String(n).padStart(3, "0")}`;
const NEWEST = runId(LONG_CARD.runs);

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const frame = (container: Element) => container.querySelector("[data-testid=detail-frame] article.detail");
const rows = (container: Element) => [...(frame(container)?.querySelectorAll("[data-testid=timeline] li") ?? [])].map((row) => row.textContent);
const comments = (container: Element) => frame(container)?.querySelector("[data-testid=card-comments]") ?? null;
const head = (container: Element) => frame(container)?.querySelector("h1")?.textContent;

function countRecords(source: SyntheticSource) {
  const counted = { records: new Set<string>() };
  const read = source.read.bind(source);
  source.read = (async (name, id) => {
    const result = await read(name, id);
    if (name === "record") counted.records.add(id as string);
    return result;
  }) as SyntheticSource["read"];
  return counted;
}

/**
 * The core as the hub runs it: every read answered after the one before it. Each record waits at the head of the line
 * until the test lets it through, so whatever was asked after it waits too.
 */
function serialCore(source: SyntheticSource) {
  const read = source.read.bind(source);
  let line: Promise<unknown> = Promise.resolve();
  let gate: (() => void) | null = null;
  const asked: string[] = [];
  const answered: string[] = [];
  let out = 0;
  let most = 0;
  source.read = ((name, id) => {
    if (name === "record") {
      asked.push(id as string);
      most = Math.max(most, (out += 1));
    }
    const turn = line.then(async () => {
      if (name === "record") await new Promise<void>((go) => (gate = go));
      const result = await read(name, id);
      if (name === "record") out -= 1;
      answered.push(name === "record" ? `record:${id}` : name);
      return result;
    });
    line = turn;
    return turn;
  }) as SyntheticSource["read"];
  return {
    asked,
    answered,
    most: () => most,
    waiting: () => gate !== null,
    next() {
      const go = gate;
      gate = null;
      go?.();
    },
  };
}

/** Holds every read of the named routes until the test lets them through. */
function holdReads(source: SyntheticSource, names: readonly string[]) {
  const held: { name: string; id?: string; go: () => void }[] = [];
  const asked: string[] = [];
  let holding = true;
  const read = source.read.bind(source);
  source.read = (async (name, id) => {
    if (name === "record") asked.push(id as string);
    if (holding && names.includes(name)) await new Promise<void>((go) => held.push({ name, id, go }));
    return read(name, id);
  }) as SyntheticSource["read"];
  return {
    asked,
    held: (name: string) => held.filter((each) => each.name === name),
    release(name: string) {
      for (const each of held.filter((one) => one.name === name)) {
        held.splice(held.indexOf(each), 1);
        each.go();
      }
    },
    stop() {
      holding = false;
      for (const each of held.splice(0)) each.go();
    },
  };
}

async function openWork(wide: boolean, source: SyntheticSource) {
  setWide(wide);
  window.history.replaceState(null, "", "/app/#/running");
  const store = new Store(source);
  const view = render(<App store={store} />);
  await waitFor(() => expect(view.getByTestId("freshness").hasAttribute("data-quiet")).toBe(true));
  return { store, view };
}

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`the long card's history draws before its last record lands, and what it drew stays on top (${width})`, async () => {
    const source = new SyntheticSource({ longCard: true, serialRecordMs: 1 });
    const counted = countRecords(source);
    setWide(wide);
    window.history.replaceState(null, "", `/app/#/cards/${CARD}`);
    const view = render(<App store={new Store(source)} />);
    let atFirst: number | null = null;
    let first: (string | null)[] = [];
    const observer = new MutationObserver(() => {
      if (atFirst !== null || !rows(view.container).length) return;
      atFirst = counted.records.size;
      first = rows(view.container);
    });
    observer.observe(view.container, { subtree: true, childList: true, characterData: true });
    await waitFor(() => expect(comments(view.container)).not.toBeNull(), { timeout: 5000 });
    observer.disconnect();
    expect(counted.records.size).toBe(LONG_CARD.runs);
    expect(atFirst).not.toBeNull();
    expect(atFirst).toBeLessThan(LONG_CARD.runs);
    expect(rows(view.container).length).toBeGreaterThan(first.length);
    expect(rows(view.container).slice(0, first.length)).toEqual(first);
  });

  test(`the long card's head reads 불러오는 중 while its list row is not read, never 제목 없음 (${width})`, async () => {
    const source = new SyntheticSource({ longCard: true });
    const reads = holdReads(source, ["cards"]);
    setWide(wide);
    window.history.replaceState(null, "", `/app/#/cards/${CARD}`);
    const view = render(<App store={new Store(source)} />);
    await waitFor(() => expect(head(view.container)).toBeTruthy());
    expect(reads.held("cards").length).toBeGreaterThan(0);
    expect(head(view.container)).toBe(W.loading);
    expect(view.container.textContent).not.toContain(W.untitled);
    await act(async () => reads.stop());
    await waitFor(() => expect(head(view.container)).toBe(LONG_CARD.goal));
  });
}

test("records are read at most a few at once, newest run first, and a list asked meanwhile lands after those few", async () => {
  const source = new SyntheticSource({ longCard: true });
  const core = serialCore(source);
  const { store, view } = await openWork(true, source);
  act(() => {
    window.location.hash = `#/cards/${CARD}`;
  });
  // The newest run's record leads, alone; the next few follow once it is in.
  await waitFor(() => expect(core.asked).toEqual([NEWEST]));
  await act(async () => core.next());
  await waitFor(() => expect(core.asked.length).toBeGreaterThan(1));
  expect(core.asked.length).toBeLessThanOrEqual(1 + RECORDS_AT_ONCE);
  // A change on the lists, as the stream sends it, while those records are out.
  const before = core.answered.length;
  const lists = store.invalidate([["cards"], ["board"], ["goals"]]);
  for (let turn = 0; turn < 2 * LONG_CARD.runs && !core.answered.slice(before).includes("cards"); turn += 1) {
    await waitFor(() => expect(core.waiting()).toBe(true));
    await act(async () => core.next());
  }
  await act(async () => lists);
  const ahead = core.answered.slice(before, core.answered.indexOf("cards", before)).filter((read) => read.startsWith("record:"));
  expect(ahead.length).toBeLessThanOrEqual(RECORDS_AT_ONCE);
  // The rest, newest run first, never more than a few out at once.
  for (let turn = 0; turn < 2 * LONG_CARD.runs && core.answered.filter((read) => read.startsWith("record:")).length < LONG_CARD.runs; turn += 1) {
    await waitFor(() => expect(core.waiting()).toBe(true));
    await act(async () => core.next());
  }
  expect(core.most()).toBeLessThanOrEqual(RECORDS_AT_ONCE);
  expect(core.asked).toEqual(Array.from({ length: LONG_CARD.runs }, (_, index) => runId(LONG_CARD.runs - index)));
  await waitFor(() => expect(comments(view.container)).not.toBeNull());
});

test("a worker run's page opened while the long card's records are read has its record read next", async () => {
  const source = new SyntheticSource({ longCard: true });
  const reads = holdReads(source, ["record"]);
  await openWork(true, source);
  act(() => {
    window.location.hash = `#/cards/${CARD}`;
  });
  await waitFor(() => expect(reads.held("record")).toHaveLength(1));
  await act(async () => reads.release("record"));
  await waitFor(() => expect(reads.held("record")).toHaveLength(RECORDS_AT_ONCE));
  const asked = reads.asked.length;
  const opened = new Promise<void>((resolve) => window.addEventListener("hashchange", () => resolve(), { once: true }));
  act(() => {
    window.location.hash = `#/runs/${runId(1)}`;
  });
  await act(async () => opened);
  await act(async () => reads.release("record"));
  await waitFor(() => expect(reads.asked.length).toBeGreaterThan(asked));
  expect(reads.asked[asked]).toBe(runId(1));
  reads.stop();
});

test("a drawn long card that gains a newer run keeps its history on screen while that run's record is read", async () => {
  const source = new SyntheticSource({ longCard: true });
  const store = new Store(source);
  setWide(true);
  window.history.replaceState(null, "", `/app/#/cards/${CARD}`);
  const view = render(<App store={store} />);
  await waitFor(() => expect(comments(view.container)).not.toBeNull(), { timeout: 5000 });
  const drawn = rows(view.container);
  expect(drawn.length).toBeGreaterThan(0);
  // A live update names one more run, seen after all the others, whose record is not in yet.
  const fresh = runId(LONG_CARD.runs + 1);
  const detail = source.scene.cardDetails[CARD];
  const seen = Math.max(...detail.workerRuns.map((worker) => worker.lastSeenAt ?? 0)) + 60;
  detail.workerRuns = [...detail.workerRuns, { id: fresh, kind: "lina-worker", firstSeenAt: seen, lastSeenAt: seen }];
  const base = source.scene.records[runId(1)];
  const start = seen;
  source.scene.records[fresh] = { ...base, id: fresh, comments: [], rounds: base.rounds.map((round) => ({ ...round, startedAt: start, endedAt: start + 60, result: "가상 새 묶음을 정리했다.", rows: [{ at: start + 30, kind: "said", text: "가상 새 묶음의 줄을 읽었다.", count: 1 }] })) };
  (source as unknown as { changed(): void }).changed();
  const reads = holdReads(source, ["record"]);
  await act(async () => {
    void store.invalidate([["card", CARD]]);
  });
  await waitFor(() => expect(reads.held("record")).toHaveLength(1));
  expect(reads.asked).toEqual([fresh]);
  expect(rows(view.container)).toEqual(drawn);
  expect(comments(view.container)).not.toBeNull();
  await act(async () => reads.release("record"));
  await waitFor(() => expect(rows(view.container).length).toBeGreaterThan(drawn.length));
  reads.stop();
});

test("a long card opened by its address keeps its own title once the full card-list read fails, never 불러오는 중 for good", async () => {
  const source = new SyntheticSource({ longCard: true, manyFinished: true });
  // Older than the first page's newest few finished cards: its row is not on that page.
  const row = source.scene.cards.cards.find((card) => card.id === CARD);
  if (row) row.endedAt = (row.endedAt ?? 0) - 90 * 24 * 3600;
  const finished = source.scene.cards.cards.filter((card) => card.state === "done" && card.id !== CARD);
  expect(finished.filter((card) => (card.endedAt ?? 0) > (row?.endedAt ?? 0)).length).toBeGreaterThan(FINISHED_SHOWN);
  // A title of its own that may be drawn (LONG_CARD.own holds a Latin word the rule keeps off the screen).
  const own = "가상 긴 기록 묶음 옮기기";
  source.scene.cardDetails[CARD].title = own;
  const read = source.read.bind(source);
  const asked: (string | undefined)[] = [];
  source.read = (async (name, id) => {
    if (name === "cards") {
      asked.push(id);
      // The first page comes in; every read without that limit fails, as a core that drops the long list would.
      if (id !== String(FINISHED_SHOWN)) return { kind: "failed", offline: false, at: Math.floor(Date.now() / 1000) };
    }
    return read(name, id);
  }) as SyntheticSource["read"];
  setWide(true);
  window.history.replaceState(null, "", `/app/#/cards/${CARD}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(asked.some((id) => id !== String(FINISHED_SHOWN))).toBe(true), { timeout: 5000 });
  await waitFor(() => expect(head(view.container)).toBeTruthy());
  await waitFor(() => expect(head(view.container)).not.toBe(W.loading), { timeout: 5000 });
  expect(head(view.container)).toBe(own);
  expect(view.container.textContent).not.toContain(W.untitled);
});

test("a card off the first page reads its goal's title once the full card-list read fails, 불러오는 중 while pending, 제목 없음 when nothing names it", async () => {
  // lina-app#258: an own title with a Latin word, which the drawn-title rule keeps off the screen, as real cards have.
  const own = "fake route check (a-mac·b-mac)";
  const goalTitle = "가상 목표";
  const scene = (mode: "failed" | "pending" | "unknown") => {
    const source = new SyntheticSource({ longCard: true, manyFinished: true });
    const cards = source.scene.cards.cards;
    const row = cards.find((card) => card.id === CARD)!;
    row.endedAt = (row.endedAt ?? 0) - 90 * 24 * 3600;
    source.scene.cardDetails[CARD].title = own;
    if (mode === "unknown") cards.splice(cards.indexOf(row), 1);
    else source.scene.goals.goals.push({ ...source.scene.goals.goals[0], id: "kg-fake", title: goalTitle, workCards: [row] });
    const read = source.read.bind(source);
    source.read = (async (name, id) => {
      // The first page comes in; with `failed` every read without that limit fails.
      if (mode === "failed" && name === "cards" && id !== String(FINISHED_SHOWN)) return { kind: "failed", offline: false, at: Math.floor(Date.now() / 1000) };
      return read(name, id);
    }) as SyntheticSource["read"];
    return source;
  };
  const open = (source: SyntheticSource) => {
    setWide(true);
    window.history.replaceState(null, "", `/app/#/cards/${CARD}`);
    const store = new Store(source);
    return { store, view: render(<App store={store} />) };
  };

  const failed = open(scene("failed"));
  await waitFor(() => expect(failed.store.status("cards")).toBe("failed"), { timeout: 5000 });
  await waitFor(() => expect(head(failed.view.container)).toBe(goalTitle), { timeout: 5000 });
  expect(failed.view.container.textContent).not.toContain(W.untitled);
  failed.view.unmount();

  const held = scene("pending");
  const reads = holdReads(held, ["cards"]);
  const pending = open(held);
  await waitFor(() => expect(head(pending.view.container)).toBeTruthy());
  expect(reads.held("cards").length).toBeGreaterThan(0);
  expect(head(pending.view.container)).toBe(W.loading);
  reads.stop();
  pending.view.unmount();

  const unknown = open(scene("unknown"));
  await waitFor(() => expect(unknown.store.status("cards")).toBe("ok"), { timeout: 5000 });
  await waitFor(() => expect(head(unknown.view.container)).toBe(W.untitled), { timeout: 5000 });
}, 30_000);
