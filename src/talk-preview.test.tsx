import { render, waitFor } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";

// lina-app#162: the live hub lists 9 agents and a gateway that does not answer holds each history read about 30 s. A
// browser keeps 6 connections to one host, so the rows' reads all at once left none for the change stream and the
// store: the head read 갱신 지연 until they gave up. The rows read at most 2 at a time; the open window does not wait.
class HeldHistory extends SyntheticSource {
  readonly out = new Map<string, number>();
  readonly started: string[] = [];
  most = 0;
  private readonly held: (() => void)[] = [];

  constructor() {
    super({ now: Math.floor(Date.now() / 1000) });
    const agents = this.scene.items.agents;
    for (let index = agents.length; index < 9; index += 1) agents.push({ id: `ag-${index + 1}`, name: `에이전트${index + 1}` });
  }

  override async agentTalkHistory(agent: string) {
    this.started.push(agent);
    this.out.set(agent, (this.out.get(agent) ?? 0) + 1);
    this.most = Math.max(this.most, [...this.out.values()].reduce((sum, count) => sum + count, 0));
    await new Promise<void>((resolve) => this.held.push(resolve));
    this.out.set(agent, this.out.get(agent)! - 1);
    return super.agentTalkHistory(agent);
  }

  release(): void {
    this.held.shift()?.();
  }
}

function open(hash: string, wide: boolean, source: SyntheticSource) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  return render(<App store={new Store(source)} />);
}

test("the agent rows read their histories at most 2 at a time and every row still gets its line (lina-app#162)", async () => {
  const source = new HeldHistory();
  const view = open("#/talk", false, source);
  await waitFor(() => expect(view.getAllByTestId(/^talk-agent-/)).toHaveLength(9));
  await waitFor(() => expect(source.started).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(source.started).toHaveLength(2);
  for (let answered = 0; answered < 9; answered += 1) {
    source.release();
    await waitFor(() => expect(view.getAllByTestId("talk-preview")).toHaveLength(answered + 1));
  }
  expect(source.most).toBe(2);
  expect(new Set(source.started).size).toBe(9);
});

test("the open window reads its history at once, not behind the rows' reads (lina-app#162)", async () => {
  const source = new HeldHistory();
  const view = open("#/talk", true, source);
  await waitFor(() => expect(view.getAllByTestId(/^nav-talk-/)).toHaveLength(9));
  await waitFor(() => expect(source.started.length).toBeGreaterThanOrEqual(2));
  const before = source.started.filter((agent) => agent === "ag-9").length;
  (view.getByTestId("nav-talk-8").querySelector("a") as HTMLAnchorElement).click();
  await waitFor(() => expect(view.getByTestId("talk-loading")).toBeTruthy());
  await waitFor(() => expect(source.started.filter((agent) => agent === "ag-9")).toHaveLength(before + 1));
});
