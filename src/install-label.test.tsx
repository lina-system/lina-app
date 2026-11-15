import { render, waitFor } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import type { AppLabel } from "./data/http-source";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// lina-app#181: the head says which install the app is open on, in the words the page carries.
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, label: AppLabel | null) {
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(new SyntheticSource({ now: Math.floor(Date.now() / 1000) }))} label={label} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe("실시간"));
  return view;
}

/** The chip in the head's tools, right before the bell. */
function chipBeforeBell(head: Element): HTMLElement {
  const tools = head.querySelector(".toolbar-tools")!;
  const chip = tools.querySelector<HTMLElement>("[data-testid=install-label]")!;
  expect(chip, "chip in the head's tools").toBeTruthy();
  expect(chip.nextElementSibling?.querySelector("[data-testid=bell]"), "the bell right after it").toBeTruthy();
  return chip;
}

test("on a wide window the chip stands before the bell in the toolbar of 작업, 상태 and 대화", async () => {
  setWide(true);
  for (const hash of ["#/running", "#/status", "#/talk/ag-1"]) {
    const view = await open(hash, { text: "시험 사본", kind: "test" });
    const chip = chipBeforeBell(view.container.querySelector(".toolbar")!);
    expect(chip.textContent, hash).toBe("시험 사본");
    expect(chip.classList.contains("is-test"), hash).toBe(true);
    expect(view.getAllByTestId("install-label"), hash).toHaveLength(1);
    view.unmount();
  }
});

test("at 390 the chip is in the navbar on a tab root, a pushed screen and under a detail sheet", async () => {
  setWide(false);
  for (const hash of ["#/talk", "#/status", "#/running", "#/items/T4"]) {
    const view = await open(hash, { text: "실제 · 읽기 전용", kind: "real" });
    const chip = chipBeforeBell(view.container.querySelector(".navbar")!);
    expect(chip.textContent, hash).toBe("실제 · 읽기 전용");
    expect(chip.classList.contains("is-test"), hash).toBe(false);
    view.unmount();
  }
});

test("a label without a kind is neutral, and no label draws no element at all", async () => {
  setWide(false);
  const neutral = await open("#/running", { text: "사본", kind: null });
  expect(neutral.getByTestId("install-label").className).toBe("install-label");
  neutral.unmount();
  for (const wide of [false, true]) {
    setWide(wide);
    const view = await open("#/items/T4", null);
    expect(view.queryByTestId("install-label")).toBeNull();
    expect(view.container.querySelector(".install-label")).toBeNull();
    view.unmount();
  }
});
