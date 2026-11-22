import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { routePath } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";
import { REPORT_IDS } from "./fixtures/reports";
import { messageParts, referencesAsSummaries, reportOfPage } from "./report/reference";
import { href, isFrame, parse } from "./router";

// lina-app#50: a chat message with a report reference shows one report card, never the report's body; the card opens
// the report beside the conversation on a wide window and in a sheet on a phone, and the open report follows its
// agent's edits with a small mark and its earlier versions one tap away.

async function open(hash: string, wide: boolean, prepare: (source: SyntheticSource) => void = () => {}) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide && !query.includes("prefers-color-scheme"), media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000), reports: true });
  prepare(source);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return { view, source };
}

const stack = () => (window.history.state as { stack?: string[] } | null)?.stack ?? [window.location.hash];

test("a reference line is a card part between the message's words; a page address names its report; a preview reads the summary", () => {
  const text = `보고를 올렸어요.\n[[report:${REPORT_IDS.long}|https://hub.invalid/reports/${REPORT_IDS.long}/page|중간 보고]]\n끝.`;
  expect(messageParts(text)).toEqual([
    { kind: "text", text: "보고를 올렸어요." },
    { kind: "report", reference: { id: REPORT_IDS.long, page: `https://hub.invalid/reports/${REPORT_IDS.long}/page`, summary: "중간 보고" } },
    { kind: "text", text: "끝." },
  ]);
  expect(messageParts("[[report:rep_123|x|y]]")).toEqual([{ kind: "text", text: "[[report:rep_123|x|y]]" }]);
  expect(referencesAsSummaries(text)).toBe("보고를 올렸어요.\n중간 보고\n끝.");
  expect(reportOfPage(`https://hub.invalid/reports/${REPORT_IDS.long}/page`)).toBe(REPORT_IDS.long);
  expect(reportOfPage("https://hub.invalid/r/old-note")).toBeNull();
});

test("a report has its own address, opens in the detail frame and reads one version by query", () => {
  expect(parse(`#/reports/${REPORT_IDS.long}`)).toEqual({ name: "report", id: REPORT_IDS.long });
  expect(parse(`#/reports/${REPORT_IDS.long}?v=2`)).toEqual({ name: "report", id: REPORT_IDS.long, version: 2 });
  expect(href({ name: "report", id: REPORT_IDS.long, version: 2 })).toBe(`#/reports/${REPORT_IDS.long}?v=2`);
  expect(isFrame({ name: "report", id: REPORT_IDS.long })).toBe(true);
  expect(routePath("report", `${REPORT_IDS.long}@2`)).toBe(`/api/lina/reports/${REPORT_IDS.long}?version=2`);
  expect(routePath("reports", "k-101")).toBe("/api/lina/reports?card=k-101");
});

test("the chat shows one card per report with its title and agent, no body; the card opens the inspector beside the usable chat, a second replaces it, close returns", async () => {
  const { view } = await open("#/talk/ag-1", true);
  const talk = within(view.getByTestId("agent-talk"));
  await waitFor(() => expect(talk.getAllByTestId("report-card")).toHaveLength(2));
  const [long, legacy] = talk.getAllByTestId("report-card");
  await waitFor(() => expect(long.textContent).toContain("가상 릴리스 변경 정리 · 중간 보고"));
  expect(long.querySelector(".report-card-meta")?.textContent).toMatch(/· 업데이트 12분 전$/);
  expect(view.getByTestId("agent-talk").textContent).not.toContain("묶음별 변경");
  expect(view.getByTestId("agent-talk").textContent).not.toContain("[[report:");
  const depth = stack().length;
  fireEvent.click(long);
  const inspector = await waitFor(() => view.getByTestId("report-inspector"));
  await waitFor(() => expect(within(inspector).getByRole("heading", { level: 1 }).textContent).toBe("가상 릴리스 변경 정리 · 중간 보고"));
  expect(stack()).toHaveLength(depth + 1);
  expect(view.getByTestId("agent-talk")).toBeTruthy();
  expect(view.getByRole("textbox", { name: "메시지" })).toBeTruthy();
  fireEvent.click(legacy);
  await waitFor(() => expect(within(view.getByTestId("report-inspector")).getByRole("heading", { level: 1 }).textContent).toBe("가상 백업 점검 메모"));
  expect(stack()).toHaveLength(depth + 1);
  fireEvent.click(within(view.getByTestId("report-inspector")).getByTestId("report-close"));
  await waitFor(() => expect(view.queryByTestId("report-inspector")).toBeNull());
  expect(window.location.hash).toBe("#/talk/ag-1");
});

test("a report page address in a message opens the viewer on a plain click; the old dashboard's address stays a link", async () => {
  const { view } = await open("#/talk/ag-1", true);
  const link = await waitFor(() => view.getByRole("link", { name: "오류 예시" }));
  fireEvent.click(link);
  await waitFor(() => expect(window.location.hash).toBe(`#/reports/${REPORT_IDS.broken}`));
  await waitFor(() => expect(within(view.getByTestId("report-inspector")).getAllByTestId("report-block-broken").length).toBeGreaterThan(3));
  const old = view.getByRole("link", { name: "옛 보고서" });
  expect(old.getAttribute("href")).toBe("https://hub.invalid/r/old-note");
  expect(old.getAttribute("target")).toBe("_blank");
});

test("an agent's edit updates the open report in place with a small mark, and its earlier versions open from the viewer", async () => {
  const { view, source } = await open(`#/reports/${REPORT_IDS.long}`, true);
  const report = await waitFor(() => view.getByTestId("report"));
  await waitFor(() => expect(report.dataset.version).toBe("3"));
  expect(view.queryByTestId("report-updated")).toBeNull();
  expect(source.reportEditedElsewhere(REPORT_IDS.long)).toBe(true);
  await waitFor(() => expect(view.getByTestId("report").dataset.version).toBe("4"));
  expect(view.getByTestId("report").textContent).toContain("추가된 문단 1");
  fireEvent.click(view.getByTestId("report-updated"));
  expect(view.queryByTestId("report-updated")).toBeNull();
  fireEvent.click(view.getByTestId("report-history"));
  const versions = within(view.getByTestId("report-versions")).getAllByRole("button");
  expect(versions.map((each) => each.querySelector(".report-version-n")?.textContent)).toEqual(["v4", "v3", "v2", "v1"]);
  fireEvent.click(versions[3]);
  await waitFor(() => expect(view.getByTestId("report-older").textContent).toContain("이전 버전 v1을 보는 중"));
  expect(window.location.hash).toBe(`#/reports/${REPORT_IDS.long}?v=1`);
  expect(view.getByTestId("report").textContent).not.toContain("가상 기기 디스크 사용");
  fireEvent.click(within(view.getByTestId("report-older")).getByRole("button", { name: "최신 보기" }));
  await waitFor(() => expect(view.queryByTestId("report-older")).toBeNull());
});

test("a work card's detail shows the same card for the report that belongs to it", async () => {
  const { view } = await open("#/cards/k-101", true);
  const box = await waitFor(() => view.getByTestId("card-reports"));
  await waitFor(() => expect(within(box).getByTestId("report-card").textContent).toContain("가상 릴리스 변경 정리 · 중간 보고"));
});

test("on a phone the card opens a sheet at half height over the chat; its close returns to the chat", async () => {
  const { view } = await open("#/talk/ag-1", false);
  const card = await waitFor(() => view.getAllByTestId("report-card")[0]);
  fireEvent.click(card);
  const sheet = await waitFor(() => view.getByTestId("detail-frame"));
  expect(sheet.classList.contains("is-report")).toBe(true);
  expect(sheet.dataset.height).toBe("half");
  await waitFor(() => expect(within(sheet).getByRole("heading", { level: 1 }).textContent).toBe("가상 릴리스 변경 정리 · 중간 보고"));
  expect(within(sheet).queryByTestId("report-close")).toBeNull();
  fireEvent.dblClick(view.getByTestId("report-sheet-bar"));
  expect(view.getByTestId("detail-frame").dataset.height).toBe("full");
  fireEvent.click(view.getByTestId("frame-close"));
  await waitFor(() => expect(view.queryByTestId("detail-frame")).toBeNull());
  expect(window.location.hash).toBe("#/talk/ag-1");
});

test("on a phone every report opens its sheet at half height again, however the last one was left", async () => {
  const { view } = await open("#/talk/ag-1", false);
  const cards = () => view.getAllByTestId("report-card");
  await waitFor(() => expect(cards()).toHaveLength(2));
  fireEvent.click(cards()[0]);
  await waitFor(() => expect(view.getByTestId("detail-frame").dataset.height).toBe("half"));
  fireEvent.dblClick(view.getByTestId("report-sheet-bar"));
  expect(view.getByTestId("detail-frame").dataset.height).toBe("full");
  fireEvent.click(view.getByTestId("frame-close"));
  await waitFor(() => expect(view.queryByTestId("detail-frame")).toBeNull());
  fireEvent.click(cards()[1]);
  await waitFor(() => expect(within(view.getByTestId("detail-frame")).getByRole("heading", { level: 1 }).textContent).toBe("가상 백업 점검 메모"));
  expect(view.getByTestId("detail-frame").dataset.height).toBe("half");
  fireEvent.dblClick(view.getByTestId("report-sheet-bar"));
  fireEvent.click(view.getByTestId("frame-close"));
  await waitFor(() => expect(view.queryByTestId("detail-frame")).toBeNull());
  fireEvent.click(cards()[1]);
  await waitFor(() => expect(view.getByTestId("detail-frame").dataset.height).toBe("half"));
});

test("a reports event that replaces only a report's images redraws them and releases the ones it drew before (lina-app#114)", async () => {
  const released: string[] = [];
  const { view, source } = await open(`#/reports/${REPORT_IDS.long}`, true, (synthetic) => {
    const read = synthetic.reportImage.bind(synthetic);
    synthetic.reportImage = async (id: string, position: number) => {
      const image = await read(id, position);
      return image.ok ? { ...image, release: () => released.push(image.url) } : image;
    };
  });
  const shown = () => [...view.getByTestId("report").querySelectorAll(".report-body img")].map((image) => image.getAttribute("src") ?? "");
  await waitFor(() => expect(shown()).toHaveLength(3));
  const before = shown();
  expect(source.reportImagesChangedElsewhere(REPORT_IDS.long)).toBe(true);
  await waitFor(() => expect(shown().every((src, index) => src !== before[index])).toBe(true));
  expect(view.getByTestId("report").dataset.version).toBe("3");
  expect(decodeURIComponent(shown()[0])).toContain("교체 1");
  expect(new Set(released)).toEqual(new Set(before));
});

test("the inspector marks an edit after going back to the newest version, and a report that replaces it starts with no mark and its history shut", async () => {
  const { view, source } = await open("#/talk/ag-1", true);
  const card = await waitFor(() => view.getAllByTestId("report-card")[0]);
  fireEvent.click(card);
  const inspector = () => view.getByTestId("report-inspector");
  await waitFor(() => expect(within(inspector()).getByTestId("report").dataset.version).toBe("3"));
  fireEvent.click(within(inspector()).getByTestId("report-history"));
  fireEvent.click(within(within(inspector()).getByTestId("report-versions")).getAllByRole("button")[2]);
  await waitFor(() => expect(within(inspector()).getByTestId("report-older")).toBeTruthy());
  fireEvent.click(within(within(inspector()).getByTestId("report-older")).getByRole("button", { name: "최신 보기" }));
  await waitFor(() => expect(within(inspector()).queryByTestId("report-older")).toBeNull());
  source.reportEditedElsewhere(REPORT_IDS.long);
  await waitFor(() => expect(within(inspector()).getByTestId("report").dataset.version).toBe("4"));
  expect(within(inspector()).getByTestId("report-updated")).toBeTruthy();
  // The history list stays open across its own version choices in the inspector.
  expect(within(inspector()).getByTestId("report-history").getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(view.getAllByTestId("report-card")[1]);
  await waitFor(() => expect(within(inspector()).getByRole("heading", { level: 1 }).textContent).toBe("가상 백업 점검 메모"));
  expect(within(inspector()).queryByTestId("report-updated")).toBeNull();
  expect(within(inspector()).queryByTestId("report-versions")).toBeNull();
});

test("a click on a report page link's own text opens the viewer, as a click on the link does", async () => {
  const { view } = await open("#/talk/ag-1", true);
  const link = await waitFor(() => view.getByRole("link", { name: "오류 예시" }));
  const text = link.firstChild as Text;
  expect(text.nodeType).toBe(Node.TEXT_NODE);
  text.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  await waitFor(() => expect(window.location.hash).toBe(`#/reports/${REPORT_IDS.broken}`));
});

test("an earlier version's head reads that version's own time, not the newest one", async () => {
  const { view, source } = await open(`#/reports/${REPORT_IDS.long}?v=1`, true);
  const v1 = source.scene.reports[REPORT_IDS.long].versions[0];
  const newest = source.scene.reports[REPORT_IDS.long].versions.at(-1);
  await waitFor(() => expect(view.getByTestId("report").dataset.version).toBe("1"));
  const time = view.getByTestId("report-time");
  expect(time.getAttribute("dateTime")).toBe(new Date(v1.at * 1000).toISOString());
  expect(time.getAttribute("dateTime")).not.toBe(new Date((newest?.at ?? 0) * 1000).toISOString());
});

test("Escape closes the large image first, then the inspector; the conversation stays", async () => {
  const { view } = await open("#/talk/ag-1", true);
  fireEvent.click(await waitFor(() => view.getAllByTestId("report-card")[0]));
  const inspector = await waitFor(() => view.getByTestId("report-inspector"));
  const image = await waitFor(() => within(inspector).getAllByRole("button", { name: /^그림 크게 보기/ })[0]);
  fireEvent.click(image);
  expect(document.querySelector("[data-testid=report-lightbox]")).not.toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.querySelector("[data-testid=report-lightbox]")).toBeNull();
  expect(view.getByTestId("report-inspector")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(view.queryByTestId("report-inspector")).toBeNull());
  expect(window.location.hash).toBe("#/talk/ag-1");
  expect(view.getByTestId("agent-talk")).toBeTruthy();
});

test("the nested-image report also holds an image the core does not give, shown as one line", async () => {
  const { view } = await open(`#/reports/${REPORT_IDS.nested}`, true);
  await waitFor(() => expect(view.getByTestId("report-image-failed").textContent).toBe("[그림: 불러오지 못하는 그림] 그림을 불러오지 못함"));
  expect(view.getByTestId("report").querySelectorAll(".report-body img")).toHaveLength(3);
});

test("the viewer's Escape leaves a large image's layer to close itself, whenever the key comes", async () => {
  const { view } = await open("#/talk/ag-1", true);
  fireEvent.click(await waitFor(() => view.getAllByTestId("report-card")[0]));
  await waitFor(() => expect(view.getByTestId("report-inspector")).toBeTruthy());
  // A layer in the page that has not taken the key yet, as the large image right after it is drawn.
  const layer = document.createElement("div");
  layer.setAttribute("data-testid", "report-lightbox");
  document.body.append(layer);
  // The viewer marks an Escape it acts on as taken; one it leaves to the layer stays untaken.
  const left = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.dispatchEvent(left);
  expect(left.defaultPrevented).toBe(false);
  layer.remove();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(view.queryByTestId("report-inspector")).toBeNull());
});
