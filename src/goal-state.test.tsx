import { render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RouteName, Routes } from "./api/client";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import type { ReadResult, Source } from "./data/source";
import { Store } from "./data/store";

// lina-app#231 item 5: a goal's row and its page's head read one state, the lists' snapshot (lina-app#157).

function setWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
}

async function open(hash: string, wide: boolean, source: Source) {
  setWide(wide);
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

/** Each listed goal's state line on the goals tab, by its page's hash: its words and its data-state. */
async function rowStates(wide: boolean, source: Source): Promise<Map<string, { words: string; state: string | null }>> {
  const view = await open("#/goals", wide, source);
  const rows = new Map<string, { words: string; state: string | null }>();
  await waitFor(() => expect(view.container.querySelectorAll("[data-testid=goal-state]").length).toBeGreaterThan(0));
  for (const row of view.container.querySelectorAll(".goal-row")) {
    const href = row.querySelector("a")?.getAttribute("href");
    const state = row.querySelector("[data-testid=goal-state] .state");
    if (href && state) rows.set(href, { words: state.textContent ?? "", state: state.getAttribute("data-state") });
  }
  view.unmount();
  return rows;
}

async function headState(hash: string, wide: boolean, source: Source): Promise<{ words: string; state: string | null }> {
  const view = await open(hash, wide, source);
  const page = await waitFor(() => {
    const found = view.container.querySelector("[data-testid=screen-goal]");
    expect(found).not.toBeNull();
    return found as Element;
  });
  const state = await waitFor(() => {
    const found = page.querySelector(".head-check [data-testid=state]");
    expect(found).not.toBeNull();
    return found as Element;
  });
  const head = { words: state.textContent ?? "", state: state.getAttribute("data-state") };
  view.unmount();
  return head;
}

/** A goal whose own page payload says done while its list row is open: a fold keeps done, so only the snapshot reads open. */
class DriftedGoal extends SyntheticSource {
  constructor(private readonly drifted: string) {
    super();
  }
  override async read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>> {
    const result = await super.read(name, id);
    if (name !== "item" || id !== this.drifted || result.kind !== "data") return result;
    const detail = result.data as Routes["item"];
    return { ...result, data: { ...detail, state: "done", reason: null, workCards: [] } satisfies Routes["item"] as unknown as Routes[N] };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/app/");
});

describe("a goal's row and its page read the same state (lina-app#231)", () => {
  test.each([true, false])("every listed goal's head reads its row's state words (wide %s)", async (wide) => {
    const rows = await rowStates(wide, new SyntheticSource());
    expect(rows.size).toBeGreaterThanOrEqual(3);
    for (const [hash, row] of rows) {
      expect({ hash, ...(await headState(hash, wide, new SyntheticSource())) }).toEqual({ hash, ...row });
    }
  });

  test("a goal whose page payload says another state reads its row's state from the lists' snapshot", async () => {
    const rows = await rowStates(true, new SyntheticSource());
    const [hash, row] = [...rows].find(([, each]) => each.state !== "done") ?? [];
    expect(hash).toBeDefined();
    const id = (hash as string).replace("#/goals/", "");
    const head = await headState(hash as string, true, new DriftedGoal(id));
    expect(head).toEqual(row);
    expect(head.state).not.toBe("done");
  });
});
