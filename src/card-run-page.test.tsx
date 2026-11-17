import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";

// A card's worker run page on the synthetic scene (lina-app#110, #61): a run with no record says so in one line however
// it is opened, and a run that has ended reads its own end, not its card's state. Every text is made up.

const NOW = Math.floor(Date.now() / 1000);

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function open(hash: string, wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(new SyntheticSource({ now: NOW }))} />);
  await waitFor(() => expect(view.getByTestId("freshness").hasAttribute("data-quiet")).toBe(true));
  return view;
}

const failedLines = (view: Awaited<ReturnType<typeof open>>) => view.getByTestId("screen-run").querySelectorAll("[data-testid=timeline-error]");

for (const wide of [true, false]) {
  const width = wide ? "1280" : "390";

  test(`a card's worker run with no record reads one record failure line when opened by its address (${width})`, async () => {
    for (const card of ["k-103", "k-104", "k-105"]) {
      const view = await open(`#/cards/${card}/runs/1`, wide);
      await waitFor(() => expect(failedLines(view)).toHaveLength(1));
      expect(failedLines(view)[0].textContent).toBe("읽기 실패: 기록");
      view.unmount();
    }
  });

  test(`a card's worker run with no record reads one record failure line when opened from the card's run line (${width})`, async () => {
    const view = await open("#/cards/k-104", wide);
    await waitFor(() => expect(view.getByTestId("worker-runs")).toBeTruthy());
    fireEvent.click(within(view.getByTestId("worker-runs")).getAllByRole("link")[0]);
    await waitFor(() => expect(window.location.hash).toBe("#/cards/k-104/runs/1"));
    await waitFor(() => expect(failedLines(view)).toHaveLength(1));
    expect(failedLines(view)[0].textContent).toBe("읽기 실패: 기록");
  });

  test(`a finished worker run of a running card reads its own end, not the card's state (${width})`, async () => {
    // k-101 still runs; r9, its first worker run, ended with round 1.
    const view = await open("#/cards/k-101/runs/1", wide);
    await waitFor(() => expect(view.getByTestId("screen-run").querySelector(".detail-title")?.textContent).toBe("릴리스 노트 정리"));
    await waitFor(() => expect(view.getByTestId("run-state").textContent).toBe("완료"));
    view.unmount();
    // The run going now still reads 진행 중.
    const going = await open("#/cards/k-101/runs/3", wide);
    await waitFor(() => expect(going.getByTestId("run-state").textContent).toBe("진행 중"));
  });
}
