import { act, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { RECORDS_AT_ONCE, Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { W } from "./words";

// lina-app#232: the hub's long card took about 20 s to show more than 불러오는 중 on a phone's first open. Its detail
// names 117 worker runs, 110 of them run ids, and each of those serves the card's one record (lina-app#153), about
// 300 kB: the sheet waited for all 110 reads (33 MB) before drawing any history. The record of the run seen last is
// read first and alone; its rounds draw at once, the other records come after it and add below in place, and the
// comments wait for them all. Made-up words in the hub's shape, field by field.

const MIN = 60;
const CARD = "k-101";
const SENTENCES = ["변경 목록을 한 줄씩 정리했다.", "화면 기록을 다시 읽었다.", "결과를 짧게 남겼다.", "시험이 모두 통과했다."];

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

type Scene = SyntheticSource["scene"];

/**
 * The long card's shape on k-101: 117 worker runs (110 run ids, the rest command words, several first seen in the same
 * second), 111 runs, 509 comments, and one record of the whole card that every run id serves.
 */
function longCard(): { source: SyntheticSource; runIds: string[]; newest: string } {
  const { scene } = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const now = scene.now;
  const base = scene.cardDetails[CARD];
  const start = now - 4 * 24 * 60 * MIN;
  const words = ["wait", "status", "accept", "send", "check", "close", "verify"];
  const workerRuns = Array.from({ length: 117 }, (_, index) => {
    const word = index % 17 === 1 ? words[Math.floor(index / 17)] : null;
    const first = start + Math.floor(index / 2) * 50 * MIN;
    return { id: word ?? `OT-QAB${String(1_000_000 + index).padStart(10, "0")}`, kind: word ? ("lina-worker" as const) : ("omo" as const), firstSeenAt: first, lastSeenAt: first + 20 * MIN };
  });
  const runIds = workerRuns.filter((worker) => !words.includes(worker.id)).map((worker) => worker.id);
  const newest = runIds.at(-1) as string;
  const runs = Array.from({ length: 111 }, (_, index) => ({ ...base.runs[0], id: 3000 + index, startedAt: start + index * 50 * MIN, endedAt: start + index * 50 * MIN + 25 * MIN, lastHeartbeatAt: null, live: false, summary: SENTENCES[index % SENTENCES.length] }));
  const comments = Array.from({ length: 509 }, (_, index) => ({ id: 9000 + index, author: index % 5 === 0 ? "worker-a" : "lina-worker", body: SENTENCES[index % SENTENCES.length], createdAt: start + index * 10 * MIN + 5 }));
  const row = (at: number, kind: "tools" | "said" | "comment", text: string | null, count = 1) => ({ at, kind, text, count });
  // The card's one record, newest round first: each run a round of a sentence, its tool steps and a result.
  const rounds = runs
    .map((run, index) => ({ run: index + 1, startedAt: run.startedAt, endedAt: run.endedAt, endKnown: true, startUnknown: false, result: SENTENCES[(index + 1) % SENTENCES.length], verdict: null, stopped: false, rows: [row(run.startedAt + MIN, "said", SENTENCES[index % SENTENCES.length]), row(run.startedAt + 2 * MIN, "tools", null, 3)] }))
    .reverse();
  const records: Scene["records"] = { ...scene.records };
  for (const id of runIds) records[id] = { ...scene.records.r1, id, cardId: CARD, rounds, comments: [row(start + 30 * MIN, "comment", "기록은 짧게 남겨 주세요.")], errors: [] };
  const cardDetails = { ...scene.cardDetails, [CARD]: { ...base, readOnly: true, workerRuns, runs, comments } };
  return { source: new SyntheticSource({ now, scene: { ...scene, cardDetails, records } }), runIds, newest };
}

/** Holds the card's detail and every record read until the test lets them through. */
function holdReads(source: SyntheticSource) {
  const held: { name: string; id?: string; go: () => void }[] = [];
  let holding = true;
  const read = source.read.bind(source);
  source.read = (async (name, id) => {
    if (holding && (name === "record" || (name === "card" && id === CARD))) await new Promise<void>((go) => held.push({ name, id, go }));
    return read(name, id);
  }) as SyntheticSource["read"];
  return {
    held: (name: string) => held.filter((each) => each.name === name),
    release(name: string, id?: string) {
      for (const each of held.filter((one) => one.name === name && (id === undefined || one.id === id))) {
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

const frame = (container: Element) => container.querySelector("[data-testid=detail-frame] article.detail");
// The history's lines: each round's head and each row (a tool step is folded with the rows that do not stand whole, G138).
const rows = (container: Element) => [...(frame(container)?.querySelectorAll("[data-testid=timeline] .timeline-head, [data-testid=timeline] li") ?? [])].map((row) => row.textContent);

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`the long card draws its head and newest history from one record, then fills the rest below in place (${width})`, async () => {
    const { source, newest } = longCard();
    const reads = holdReads(source);
    setWide(wide);
    window.history.replaceState(null, "", "/app/#/running");
    const view = render(<App store={new Store(source)} />);
    await waitFor(() => expect(view.getByTestId("freshness").hasAttribute("data-quiet")).toBe(true));
    act(() => {
      window.location.hash = `#/cards/${CARD}`;
    });
    await waitFor(() => expect(reads.held("card")).toHaveLength(1));
    await act(async () => reads.release("card"));

    // The record of the run seen last is asked alone; the head stands while it comes.
    await waitFor(() => expect(reads.held("record").map((each) => each.id)).toEqual([newest]));
    expect(frame(view.container)?.querySelector("[data-testid=detail-loading]")?.textContent).toBe(W.loading);
    await act(async () => reads.release("record", newest));

    // Its rounds draw now, above one 불러오는 중 line; the comments wait for the other records, which are asked now.
    await waitFor(() => expect(rows(view.container).length).toBeGreaterThan(10));
    const first = rows(view.container);
    const article = frame(view.container) as Element;
    const loading = article.querySelector("[data-testid=detail-loading]");
    expect(loading).not.toBeNull();
    expect(article.querySelector("[data-testid=timeline]")?.compareDocumentPosition(loading as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(article.querySelector("[data-testid=card-comments]")).toBeNull();
    // The others are asked a few at a time (lina-app#253).
    await waitFor(() => expect(reads.held("record")).toHaveLength(RECORDS_AT_ONCE));

    await act(async () => reads.stop());
    await waitFor(() => expect(article.querySelector("[data-testid=card-comments]")).not.toBeNull());
    expect(article.querySelector("[data-testid=detail-loading]")).toBeNull();
    // What was drawn stays where it was: the same rows lead the history.
    expect(rows(view.container).slice(0, first.length)).toEqual(first);
  });
}
