import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { describe, expect, test, vi } from "vitest";
import type { ReportImage } from "./data/source";
import { imagesOnly } from "./markdown";
import { ownImage, ReportBody } from "./report/body";

// lina-app#114: a report reads as a document: real heading steps, tables whose numbers align right and whose rows can
// fold into cards, and only the report's own images, wide, captioned, side by side and large on a tap.

const ID = "rep_5e1f0a7c2b90";
const url = (position: number) => `/test-images/${position}.svg`;
const loaded = async (position: number): Promise<ReportImage> => ({ ok: true, url: url(position), release() {} });

function body(text: string, loadImage: (position: number, signal: AbortSignal) => Promise<ReportImage> = loaded) {
  return render(<ReportBody reportId={ID} body={text} loadImage={loadImage} />);
}

test("a report without blocks reads as it always did: headings at their levels, lists, quotes, code, links and a table", () => {
  const view = body(["# 점검한 것", "", "가상 백업 세 곳을 [안내](https://example.invalid/guide)대로 봤다.", "", "## 결과", "", "### 자세히", "", "- 하나", "- 둘", "", "> 인용", "", "```", "restore --dry-run", "```", "", "| 백업 | 크기 |", "| --- | --- |", "| A | 1,240 GB |"].join("\n"));
  expect(view.container.querySelector("h2")?.textContent).toBe("점검한 것");
  expect(view.container.querySelector("h3")?.textContent).toBe("결과");
  expect(view.container.querySelector("h4")?.textContent).toBe("자세히");
  expect(view.getByRole("link", { name: "안내" }).getAttribute("href")).toBe("https://example.invalid/guide");
  expect(view.container.querySelectorAll("li")).toHaveLength(2);
  expect(view.container.querySelector("blockquote")?.textContent).toBe("인용");
  expect(view.container.querySelector("pre code")?.textContent).toBe("restore --dry-run");
  expect(view.queryByTestId("report-block-broken")).toBeNull();
});

test("a number column aligns right and every cell carries its column's name for the folded row", () => {
  const view = body(["| 묶음 | 추가 줄 | 비율 | 검토 |", "| --- | --- | --- | --- |", "| 가상 1 | 1,200 | 7% | 통과 |", "| 가상 2 | 88 | 14% | 대기 |"].join("\n"));
  const table = view.getByRole("table");
  const headers = within(table).getAllByRole("columnheader");
  expect(headers.map((cell) => cell.classList.contains("is-number"))).toEqual([false, true, true, false]);
  const cells = within(table).getAllByRole("cell");
  expect(cells.slice(0, 4).map((cell) => cell.getAttribute("data-label"))).toEqual(["묶음", "추가 줄", "비율", "검토"]);
  expect(cells[1].classList.contains("is-number")).toBe(true);
  expect(cells[3].classList.contains("is-number")).toBe(false);
});

test("only the report's own images are drawn; any other address is a note and is never fetched", async () => {
  expect(ownImage(ID, "images/2")).toBe(2);
  expect(ownImage(ID, `/reports/${ID}/images/0`)).toBe(0);
  expect(ownImage(ID, "/reports/rep_000000000000/images/0")).toBeNull();
  expect(ownImage(ID, "https://example.invalid/a.png")).toBeNull();
  expect(ownImage(ID, "file:///etc/passwd")).toBeNull();
  expect(ownImage(ID, "data:image/png;base64,AAAA")).toBeNull();
  expect(ownImage(ID, "../images/1")).toBeNull();
  const load = vi.fn(loaded);
  const view = body(["![밖](https://example.invalid/a.png) 그리고 ![다른 보고서](/reports/rep_000000000000/images/0)", "", '![화면](images/1 "첫 화면")'].join("\n"), load);
  await waitFor(() => expect(view.container.querySelectorAll("img")).toHaveLength(1));
  expect(load.mock.calls.map(([position]) => position)).toEqual([1]);
  const sources = [...view.container.querySelectorAll("img")].map((image) => image.getAttribute("src"));
  expect(sources).toEqual(["/test-images/1.svg"]);
  expect(view.getAllByTestId("report-image-outside")).toHaveLength(2);
  expect(view.getByText("첫 화면")).toBeTruthy();
});

test("several images in one paragraph stand side by side; a tap opens one large with previous and next within the document", async () => {
  const view = body(['![가](images/0 "첫째")', "", '![나](images/1 "둘째") ![다](images/2 "셋째")'].join("\n"));
  await waitFor(() => expect(view.container.querySelectorAll("img")).toHaveLength(3));
  const gallery = view.container.querySelector(".report-gallery");
  expect(gallery?.querySelectorAll("img")).toHaveLength(2);
  fireEvent.click(view.getByRole("button", { name: "그림 크게 보기: 둘째" }));
  const box = within(view.getByTestId("report-lightbox"));
  expect(box.getByTestId("report-lightbox-count").textContent).toBe("2 / 3");
  fireEvent.click(box.getByRole("button", { name: "다음 그림" }));
  expect(box.getByTestId("report-lightbox-count").textContent).toBe("3 / 3");
  expect((box.getByRole("button", { name: "다음 그림" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(box.getByTestId("report-lightbox-count").textContent).toBe("1 / 3");
  expect(box.getByRole("img").getAttribute("src")).toBe("/test-images/0.svg");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(view.queryByTestId("report-lightbox")).toBeNull();
});

test("an image waits for its load, a refused one says so, and every loaded address is released when the body goes", async () => {
  const releases: number[] = [];
  let answer: (image: ReportImage) => void = () => {};
  const late = new Promise<ReportImage>((resolve) => (answer = resolve));
  const load = (position: number): Promise<ReportImage> => (position === 2 ? late : position === 1 ? Promise.resolve({ ok: false, status: 401 }) : Promise.resolve({ ok: true, url: url(position), release: () => releases.push(position) }));
  const view = body(['![가](images/0 "첫째")', "", '![나](images/1 "둘째")', "", '![다](images/2 "셋째")'].join("\n"), load);
  await waitFor(() => expect(view.container.querySelectorAll("img")).toHaveLength(1));
  expect(view.getByTestId("report-image-failed").textContent).toBe("[그림: 둘째] 그림을 불러오지 못함");
  expect(view.getAllByTestId("report-image-loading")).toHaveLength(1);
  view.unmount();
  // Preact runs an effect's cleanup after unmount returns.
  await waitFor(() => expect(releases).toEqual([0]));
  // An answer that comes after the body went is released at once, never drawn.
  answer({ ok: true, url: url(2), release: () => releases.push(2) });
  await waitFor(() => expect(releases).toEqual([0, 2]));
});

test("a new revision reads the images again: the drawn one stays until its answer, a superseded answer is released unseen, the old one is released after", async () => {
  const released: string[] = [];
  const answers = new Map<string, (image: ReportImage) => void>();
  const load = (revision: string) => (position: number) =>
    new Promise<ReportImage>((resolve) => answers.set(`${revision}:${position}`, resolve));
  const give = (revision: string) => answers.get(`${revision}:0`)?.({ ok: true, url: `/r/${revision}.svg`, release: () => released.push(revision) });
  const text = '![가](images/0 "첫째")';
  const view = render(<ReportBody reportId={ID} body={text} revision="a" loadImage={load("a")} />);
  give("a");
  await waitFor(() => expect(view.container.querySelector("img")?.getAttribute("src")).toBe("/r/a.svg"));
  view.rerender(<ReportBody reportId={ID} body={text} revision="b" loadImage={load("b")} />);
  await waitFor(() => expect(answers.has("b:0")).toBe(true));
  view.rerender(<ReportBody reportId={ID} body={text} revision="c" loadImage={load("c")} />);
  await waitFor(() => expect(answers.has("c:0")).toBe(true));
  expect(view.container.querySelector("img")?.getAttribute("src")).toBe("/r/a.svg");
  give("b");
  await waitFor(() => expect(released).toEqual(["b"]));
  expect(view.container.querySelector("img")?.getAttribute("src")).toBe("/r/a.svg");
  give("c");
  await waitFor(() => expect(view.container.querySelector("img")?.getAttribute("src")).toBe("/r/c.svg"));
  expect(released).toEqual(["b", "a"]);
  view.unmount();
  await waitFor(() => expect(released).toEqual(["b", "a", "c"]));
});

// lina-app#274 review: an image written only inside a fold, a callout or a table cell is one of the report's own images
// like any other: it is read, drawn, opened large in document order, read again on a new revision and released.
describe("an image inside a block", () => {
  const nested = [
    '![밖](images/0 "본문")',
    "",
    "````lina:fold 접힌 부분",
    '![접힘](images/1 "접힌 곳")',
    "````",
    "",
    "```lina:callout note 상자",
    '![상자](images/2 "상자 안")',
    "```",
    "",
    "| 이름 | 화면 |",
    "| --- | --- |",
    '| 가 | ![칸](images/3 "칸 안") |',
  ].join("\n");

  test("a fold, a callout and a table cell each read and draw their image", async () => {
    const load = vi.fn(loaded);
    const view = body(nested, load);
    await waitFor(() => expect(view.container.querySelectorAll("img")).toHaveLength(4));
    expect(load.mock.calls.map(([position]) => position).sort()).toEqual([0, 1, 2, 3]);
    expect(view.queryAllByTestId("report-image-loading")).toHaveLength(0);
    expect(view.container.querySelector("details.report-fold img")?.getAttribute("src")).toBe("/test-images/1.svg");
    expect(view.container.querySelector(".report-callout img")?.getAttribute("src")).toBe("/test-images/2.svg");
    expect(view.container.querySelector(".report-table td img")?.getAttribute("src")).toBe("/test-images/3.svg");
  });

  test("their large view steps through them in document order", async () => {
    const view = body(nested);
    await waitFor(() => expect(view.container.querySelectorAll("img")).toHaveLength(4));
    fireEvent.click(view.getByRole("button", { name: "그림 크게 보기: 상자 안" }));
    const box = within(view.getByTestId("report-lightbox"));
    expect(box.getByTestId("report-lightbox-count").textContent).toBe("3 / 4");
    fireEvent.click(box.getByRole("button", { name: "다음 그림" }));
    expect(box.getByRole("img").getAttribute("src")).toBe("/test-images/3.svg");
  });

  test("a new revision replaces them and every drawn address is released", async () => {
    const released: string[] = [];
    const load = (revision: string) => async (position: number): Promise<ReportImage> => ({ ok: true, url: `/${revision}/${position}.svg`, release: () => released.push(`${revision}/${position}`) });
    const view = render(<ReportBody reportId={ID} body={nested} revision="a" loadImage={load("a")} />);
    await waitFor(() => expect(view.container.querySelectorAll("img")).toHaveLength(4));
    view.rerender(<ReportBody reportId={ID} body={nested} revision="b" loadImage={load("b")} />);
    await waitFor(() => expect([...view.container.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual(["/b/0.svg", "/b/1.svg", "/b/2.svg", "/b/3.svg"]));
    expect(released.sort()).toEqual(["a/0", "a/1", "a/2", "a/3"]);
    view.unmount();
    await waitFor(() => expect(released).toHaveLength(8));
  });
});

// lina-app#274 (CodeQL): the scan that tells a paragraph of images alone from any other must read a long run of
// near-images once, not backtrack over it.
test("a paragraph of images alone is told from any other in one pass, also a very long malicious one", () => {
  expect(imagesOnly('![가](images/0 "첫째")  ![나](images/1)')).toEqual([{ alt: "가", src: "images/0", title: "첫째" }, { alt: "나", src: "images/1", title: null }]);
  expect(imagesOnly("![가](images/0) 그리고")).toBeNull();
  expect(imagesOnly("   ")).toBeNull();
  const near = "![](!)" + " ![](!)".repeat(50_000);
  expect(imagesOnly(near + " x")).toBeNull();
  expect(imagesOnly(near)).toHaveLength(50_001);
  const view = body(near.slice(0, 2_000) + " x");
  expect(view.container.querySelector(".report-gallery")).toBeNull();
});

// lina-app#274 Aside run5: the large image covers the whole window, never just the viewer or under the phone's bar.
test("the large image is drawn in the page's body, outside the report, and its Escape closes only itself", async () => {
  const view = body(['![가](images/0 "첫째")'].join("\n"));
  await waitFor(() => expect(view.container.querySelectorAll("img")).toHaveLength(1));
  fireEvent.click(view.getByRole("button", { name: "그림 크게 보기: 첫째" }));
  const box = document.querySelector("[data-testid=report-lightbox]");
  expect(box?.parentElement).toBe(document.body);
  expect(view.container.contains(box)).toBe(false);
  const outside = vi.fn();
  document.addEventListener("keydown", outside);
  fireEvent.keyDown(window, { key: "Escape" });
  document.removeEventListener("keydown", outside);
  expect(document.querySelector("[data-testid=report-lightbox]")).toBeNull();
  expect(outside).not.toHaveBeenCalled();
});
