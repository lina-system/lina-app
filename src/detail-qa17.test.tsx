import { act, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import { W } from "./words";

// lina-app#217: a card shaped like the hub's (41 comments, 19 worker runs of which 3 are command words, 4 rounds whose
// own lines are raw text), its detail and its records answered late. The history and comment section is drawn once:
// while the card's own detail and its worker runs' records are read it shows one placeholder, never the partial
// history the detail alone gives (the 이전 기록 N건 box) that the records then redraw longer. The record of the run
// seen last is read first (lina-app#232): its round draws above the placeholder while the others are read, and they
// add below it.

const MIN = 60;
const CARD = "k-101";
const COMMAND_WORDS = ["wait", "accept", "send"];
const SECTION = "[data-testid=detail-loading], [data-testid=timeline], [data-testid=worker-runs], [data-testid=card-comments]";

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

type Scene = SyntheticSource["scene"];

/** The hub's card shape on k-101, made-up words: its detail and one record per worker run that is a run id. */
function hubShapedCard(): { source: SyntheticSource; runIds: string[] } {
  const { scene } = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
  const now = scene.now;
  const base = scene.cardDetails[CARD];
  const start = now - 10 * 60 * MIN;
  const runIds = Array.from({ length: 16 }, (_, index) => `OT-QA${1700 + index}`);
  const listed = [runIds[0], "wait", ...runIds.slice(1, 6), "accept", "send", ...runIds.slice(6)];
  const workerRuns = listed.map((id, index) => ({ ...base.workerRuns[0], id, kind: COMMAND_WORDS.includes(id) ? ("lina-worker" as const) : ("omo" as const), firstSeenAt: start + index * 30 * MIN, lastSeenAt: start + index * 30 * MIN + 20 * MIN }));
  const runs = Array.from({ length: 4 }, (_, index) => ({ ...base.runs[0], id: 2000 + index, startedAt: start + index * 2 * 60 * MIN - MIN, endedAt: start + (index + 1) * 2 * 60 * MIN - 2 * MIN, lastHeartbeatAt: null, live: false, summary: `waiting on worker ${runIds[index]} ${runIds[index + 1]} (sprint 1)` }));
  const comments = Array.from({ length: 41 }, (_, index) => {
    const author = index % 3 === 2 ? "worker-a" : index === 0 ? "worker-b" : "lina-worker";
    const body = author === "lina-worker" ? "[받음] 작업을 받음" : index % 2 ? "rc=1" : "변경 목록을 한 줄씩 정리했음.";
    return { id: 500 + index, author, body, createdAt: start + index * 12 * MIN };
  });
  const row = (at: number, kind: "tools" | "comment" | "said", text: string | null, count = 1) => ({ at, kind, text, count });
  const records: Scene["records"] = { ...scene.records };
  runIds.forEach((id, index) => {
    const seen = workerRuns.find((worker) => worker.id === id)?.firstSeenAt ?? start;
    records[id] = {
      ...scene.records.r1,
      id,
      cardId: CARD,
      rounds: [{ run: index + 1, startedAt: seen, endedAt: seen + 15 * MIN, endKnown: true, startUnknown: false, result: "요청한 변경을 마쳤음", verdict: null, stopped: false, rows: [row(seen + MIN, "tools", null, 2)] }],
      comments: index % 4 === 0 ? [row(seen + 2 * MIN, "comment", "장부 정리 / 확인.")] : [],
      errors: [],
    };
  });
  const cardDetails = { ...scene.cardDetails, [CARD]: { ...base, readOnly: true, workerRuns, runs, comments } };
  return { source: new SyntheticSource({ now, scene: { ...scene, cardDetails, records } }), runIds };
}

/** Holds the card's detail and every record read until the test lets them through, in the order they were asked. */
function holdReads(source: SyntheticSource) {
  const held: { name: string; id?: string; go: () => void }[] = [];
  let holding = true;
  const read = source.read.bind(source);
  source.read = (async (name, id) => {
    if (holding && (name === "record" || (name === "card" && id === CARD))) await new Promise<void>((go) => held.push({ name, id, go }));
    return read(name, id);
  }) as SyntheticSource["read"];
  return {
    held: (name: string) => held.filter((read) => read.name === name),
    release(name: string, id?: string) {
      for (const read of held.filter((each) => each.name === name && (id === undefined || each.id === id))) {
        held.splice(held.indexOf(read), 1);
        read.go();
      }
    },
    /** Lets the read asked last through alone. */
    releaseLast() {
      held.pop()?.go();
    },
    stop() {
      holding = false;
      for (const read of held.splice(0)) read.go();
    },
  };
}

/** The history and comment section as drawn: each box's name and text, "" before the card's frame stands. */
function section(container: Element): string {
  const article = container.querySelector("[data-testid=detail-frame] article.detail");
  if (!article) return "";
  return [...article.querySelectorAll(SECTION)].map((box) => `${box.getAttribute("data-testid")}:${box.textContent}`).join("\n");
}

/** Every state the section takes, one per change of the page. */
function watch(container: Element): string[] {
  const states = [section(container)];
  new MutationObserver(() => {
    const now = section(container);
    if (now !== states.at(-1)) states.push(now);
  }).observe(container, { subtree: true, childList: true, characterData: true, attributes: true });
  return states;
}

const PLACEHOLDER = `detail-loading:${W.loading}`;

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

  test(`a card read late draws its history and comments once: one placeholder until its detail and newest record are in, then only more below (${width})`, async () => {
    const { source, runIds } = hubShapedCard();
    const reads = holdReads(source);
    const { view } = await openWork(wide, source);
    const states = watch(view.container);
    act(() => {
      window.location.hash = `#/cards/${CARD}`;
    });
    await waitFor(() => expect(reads.held("card")).toHaveLength(1));
    await act(async () => reads.release("card"));
    // The detail is in; the record of the run seen last is asked first and alone, the others once it is in.
    await waitFor(() => expect(reads.held("record").map((read) => read.id)).toEqual([runIds.at(-1)]));
    await act(async () => reads.release("record"));
    await waitFor(() => expect(reads.held("record")).toHaveLength(runIds.length - 1));
    await act(async () => reads.release("record"));
    await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] [data-testid=card-comments]")).not.toBeNull());
    const settled = section(view.container);
    expect(settled).toContain("card-comments:");
    expect(settled).not.toContain(PLACEHOLDER);
    // Before the frame, the placeholder, the newest round above it, then the settled section: what was drawn of the
    // history leads it, nothing redrawn shorter or longer above.
    const between = states.filter((state) => state !== "" && state !== PLACEHOLDER && state !== settled);
    expect(between.length).toBeGreaterThan(0);
    for (const state of between) {
      const [history, placeholder] = state.split("\n");
      expect(placeholder).toBe(PLACEHOLDER);
      expect(settled.startsWith(history)).toBe(true);
    }
    expect(states.at(-1)).toBe(settled);

    // Closed and opened again, the section stands at once as it settled.
    reads.stop();
    act(() => {
      window.location.hash = "#/running";
    });
    await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] article.detail")).toBeNull());
    const again = watch(view.container);
    act(() => {
      window.location.hash = `#/cards/${CARD}`;
    });
    await waitFor(() => expect(section(view.container)).toBe(settled));
    expect(again.filter((state) => state !== "" && state !== settled)).toEqual([]);
  });

  test(`one record that lands alone while the others are read adds below and keeps the placeholder (${width})`, async () => {
    const { source, runIds } = hubShapedCard();
    const reads = holdReads(source);
    const { store, view } = await openWork(wide, source);
    act(() => {
      window.location.hash = `#/cards/${CARD}`;
    });
    await waitFor(() => expect(reads.held("card")).toHaveLength(1));
    await act(async () => reads.release("card"));
    await waitFor(() => expect(reads.held("record")).toHaveLength(1));
    await act(async () => reads.release("record"));
    await waitFor(() => expect(reads.held("record")).toHaveLength(runIds.length - 1));
    await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] [data-testid=timeline]")).not.toBeNull());
    const states = watch(view.container);
    // A change event names one of the records still out: it is read again on its own and lands before the rest.
    const alone = store.invalidate([["record", runIds[0]]]);
    await waitFor(() => expect(reads.held("record")).toHaveLength(runIds.length));
    reads.releaseLast();
    await act(async () => alone);
    expect(store.status("record", runIds[0])).toBe("ok");
    // Its round adds below what stands; the comments still wait under the placeholder.
    const [first] = states[0].split("\n");
    expect(states.every((state) => state.endsWith(PLACEHOLDER) && state.startsWith(first))).toBe(true);
    await act(async () => reads.stop());
    await waitFor(() => expect(view.container.querySelector("[data-testid=detail-frame] [data-testid=card-comments]")).not.toBeNull());
  });
}
