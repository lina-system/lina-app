import { render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { ROUND25, SyntheticSource } from "./data/synthetic-source";

// lina-app#269 (the hub's long card, 11-18): a card's 기록 read `07:17 · 검토 통과 · <a bot's progress comment>`, so a comment
// read as the verdict. A round's head says its verdict and only a sentence of the round's own a now line would pass;
// rounds that read their verdict alone one after another are one `×n` line, even with the comments the card boxes
// between them. A stopped or waiting card's list row says what it does now under its state line. Every text is made up.

const NOW = Math.floor(Date.now() / 1000);
const TIME = String.raw`(?:어제 |\d+월 \d+일 )?\d\d:\d\d`;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function open(wide: boolean, hash: string) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  return render(<App store={new Store(new SyntheticSource({ now: NOW, hubRound25: true }))} />);
}

async function card(wide: boolean) {
  const view = open(wide, `#/cards/${ROUND25.card}`);
  await waitFor(() => expect(view.getAllByTestId("timeline-block").length).toBeGreaterThan(0));
  const heads = view.getAllByTestId("timeline-block").map((block) => (block.querySelector(".timeline-head")?.textContent ?? "").replace(new RegExp(`^${TIME} · `), ""));
  return { view, heads, text: view.getByTestId("timeline").textContent ?? "" };
}

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`a round's head says its verdict and never a bot's comment made as it ended (${width})`, async () => {
    const { view, text } = await card(wide);
    for (const note of [ROUND25.noteLatin, ...ROUND25.noteKorean]) expect(text).not.toContain(note);
    const box = view.getByTestId("card-comments").textContent ?? "";
    for (const note of ROUND25.noteKorean) expect(box).toContain(note);
  });

  test(`a report line with Latin words or longer than a now line is no sentence on its head and folds (${width})`, async () => {
    const { heads, text } = await card(wide);
    expect(heads[0]).toBe(`검토 통과 · ${ROUND25.shown}`);
    expect(text).not.toMatch(/fake|Playwright|reject|run/);
    expect(heads.some((head) => head.includes(ROUND25.long))).toBe(false);
    expect(text).toMatch(new RegExp(`${TIME} · 접힌 기록 3건`));
  });

  test(`rounds that read their verdict alone are one ×n line, with the boxed comments between them (${width})`, async () => {
    const { heads } = await card(wide);
    expect(heads).toEqual([`검토 통과 · ${ROUND25.shown}`, "검토를 통과했다", "검토를 통과하지 못했다", "검토를 통과했다 ×3", "검토를 통과하지 못했다"]);
  });

  test(`a stopped or waiting row says what it does now under its state line, and one with none its state line alone (${width})`, async () => {
    const view = open(wide, "#/running");
    const row = (title: string) => view.getAllByTestId("row").find((each) => each.textContent?.includes(title));
    await waitFor(() => expect(row(ROUND25.stops[0].title)).toBeDefined());
    for (const each of [...ROUND25.stops, ROUND25.waiting]) {
      const drawn = row(each.title);
      expect(drawn, each.title).toBeDefined();
      expect(drawn!.querySelector("[data-testid=row-now]")?.textContent ?? null, each.title).toBe(each.now);
    }
  });
}
