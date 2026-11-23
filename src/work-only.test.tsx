/**
 * The work-only build (`VITE_LINA_MODE=work`): no talk, status or agent-ops in the UI or in the reads.
 * Isolated from the default-build tests by mocking `./mode`.
 */
import { cleanup, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./mode", () => ({
  WORK_ONLY: true,
  APP_NAME: "LINA 작업",
  stampManifest: (json: string, name: string) => {
    const manifest = JSON.parse(json) as { name: string; short_name: string; description: string };
    manifest.name = name;
    manifest.short_name = name;
    manifest.description = `${name} on the phone Home Screen.`;
    return `${JSON.stringify(manifest, null, 2)}\n`;
  },
}));

import { App } from "./app";
import { AGENT_OPS_ROUTES, LIST_ROUTES, SLOW_ROUTES, Store } from "./data/store";
import { SyntheticSource } from "./data/synthetic-source";
import type { RouteName } from "./api/client";
import { WORK_ONLY } from "./mode";
import { href, parse } from "./router";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", "/app/#/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function asked(source: SyntheticSource): { reads: string[]; talks: string[]; retries: string[]; answers: string[] } {
  const reads: string[] = [];
  const talks: string[] = [];
  const retries: string[] = [];
  const answers: string[] = [];
  const read = source.read.bind(source);
  source.read = ((name: RouteName, id?: string) => {
    reads.push(id === undefined ? name : `${name}:${id}`);
    return read(name, id);
  }) as SyntheticSource["read"];
  const talk = source.talk.bind(source);
  source.talk = (async (...args: Parameters<SyntheticSource["talk"]>) => {
    talks.push(args[0]);
    return talk(...args);
  }) as SyntheticSource["talk"];
  const agentTalk = source.agentTalk.bind(source);
  source.agentTalk = (async (...args: Parameters<SyntheticSource["agentTalk"]>) => {
    talks.push(`agent:${args[0]}`);
    return agentTalk(...args);
  }) as SyntheticSource["agentTalk"];
  const history = source.agentTalkHistory.bind(source);
  source.agentTalkHistory = (async (...args: Parameters<SyntheticSource["agentTalkHistory"]>) => {
    talks.push(`history:${args[0]}`);
    return history(...args);
  }) as SyntheticSource["agentTalkHistory"];
  const retry = source.retry.bind(source);
  source.retry = (async (...args: Parameters<SyntheticSource["retry"]>) => {
    retries.push(args[0]);
    return retry(...args);
  }) as SyntheticSource["retry"];
  const answer = source.answerCard.bind(source);
  source.answerCard = (async (...args: Parameters<SyntheticSource["answerCard"]>) => {
    answers.push(args[0]);
    return answer(...args);
  }) as SyntheticSource["answerCard"];
  return { reads, talks, retries, answers };
}

async function open(hash: string, source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) })) {
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return { view, source };
}

describe("work-only mode", () => {
  test("the mock is on, lists are the board and items, and no slow agent-ops routes", () => {
    expect(WORK_ONLY).toBe(true);
    expect(LIST_ROUTES).toEqual(["board", "items"]);
    expect(SLOW_ROUTES).toEqual([]);
    expect(AGENT_OPS_ROUTES.has("cards")).toBe(true);
    expect(AGENT_OPS_ROUTES.has("inbox")).toBe(true);
    expect(AGENT_OPS_ROUTES.has("report")).toBe(true);
    expect(AGENT_OPS_ROUTES.has("reports")).toBe(true);
    expect(parse("#/talk")).toEqual({ name: "home" });
    expect(parse("#/status")).toEqual({ name: "home" });
    expect(parse("#/cards/k-101")).toEqual({ name: "home" });
    expect(parse("#/reports/rep_1")).toEqual({ name: "home" });
    expect(href({ name: "home" })).toBe("#/");
  });

  test("the first refresh reads only the board and items, never talk or agent-ops endpoints", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    const spy = asked(source);
    const store = new Store(source, { afterPaint: async () => {} });
    await store.refresh();
    expect(spy.reads).toEqual(["board", "items"]);
    expect(spy.reads.some((name) => name.startsWith("cards") || name === "inbox" || name === "goals" || name === "devices")).toBe(false);
    expect(spy.talks).toEqual([]);
    expect(spy.retries).toEqual([]);
    expect(spy.answers).toEqual([]);
    store.want([["card", "k-101"], ["record", "r1"], ["report", "rep_1"], ["reports", "k-101"], ["item", "T4"]]);
    await waitFor(() => expect(store.get("item", "T4")).toBeTruthy());
    expect(spy.reads.filter((name) => name.startsWith("card") || name.startsWith("record") || name.startsWith("report"))).toEqual([]);
    expect(spy.reads).toContain("item:T4");
  });

  test("the work home has no talk or status tabs, no running or agent rows, and no talk or retry controls", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    const spy = asked(source);
    const { view } = await open("#/", source);
    expect(view.container.querySelector("[data-lina-mode=work]")).toBeTruthy();
    expect(view.queryByTestId("tabs")).toBeNull();
    expect(view.queryByTestId("tab-talk")).toBeNull();
    expect(view.queryByTestId("tab-status")).toBeNull();
    expect(view.queryByTestId("nav-running")).toBeNull();
    expect(view.queryByTestId("nav-status")).toBeNull();
    expect(view.queryByTestId("nav-settings")).toBeNull();
    expect(view.container.querySelector("[data-testid^=nav-agent-]")).toBeNull();
    expect(view.container.querySelector("[data-testid^=nav-talk-]")).toBeNull();
    expect(view.getByTestId("nav-inbox")).toBeTruthy();
    expect(view.getByTestId("nav-due")).toBeTruthy();
    expect(view.getByTestId("nav-done")).toBeTruthy();
    expect(view.getByTestId("nav-goals")).toBeTruthy();
    expect(view.getByTestId("nav-today")).toBeTruthy();
    expect(view.queryByTestId("retry")).toBeNull();
    expect(view.queryByTestId("screen-status")).toBeNull();
    expect(spy.talks).toEqual([]);
    expect(spy.retries).toEqual([]);
    expect(spy.answers).toEqual([]);
    expect(spy.reads.some((name) => name === "inbox" || name.startsWith("cards") || name === "devices")).toBe(false);
  });

  test("deep links to talk, status, running, cards and runs open the work home", async () => {
    for (const hash of ["#/talk", "#/talk/ag-1", "#/status", "#/settings", "#/running", "#/cards/k-101", "#/runs/r1", "#/agents/ag-1", "#/reports/rep_1"]) {
      const { view } = await open(hash);
      expect(view.queryByTestId("tabs"), hash).toBeNull();
      expect(view.queryByTestId("screen-status"), hash).toBeNull();
      expect(view.queryByTestId("pick-agent"), hash).toBeNull();
      expect(view.getByTestId("screen-running"), hash).toBeTruthy();
      expect(parse(window.location.hash).name, hash).toBe("home");
      expect(window.location.hash === "" || window.location.hash === "#/", hash).toBe(true);
      view.unmount();
    }
  });

  test("inbox, due, today, done and goals stay, with no work-card inbox links", async () => {
    const inbox = await open("#/inbox");
    expect(inbox.view.getByTestId("screen-inbox")).toBeTruthy();
    expect(inbox.view.container.querySelector('a[href^="#/cards/"]')).toBeNull();
    inbox.view.unmount();

    const due = await open("#/due");
    expect(due.view.getByTestId("screen-due")).toBeTruthy();
    due.view.unmount();

    const today = await open("#/today");
    expect(today.view.getByTestId("screen-today")).toBeTruthy();
    expect(today.view.queryByTestId("today-running")).toBeNull();
    expect(today.view.getByTestId("today-decide")).toBeTruthy();
    expect(today.view.getByTestId("today-due")).toBeTruthy();
    expect(today.view.getByTestId("today-done")).toBeTruthy();
    today.view.unmount();

    const done = await open("#/done");
    expect(done.view.getByTestId("screen-done")).toBeTruthy();
    expect(done.view.queryByTestId("done-filter")).toBeNull();
    done.view.unmount();

    const goals = await open("#/goals");
    expect(goals.view.getByTestId("screen-goals")).toBeTruthy();
    goals.view.unmount();
  });

  test("a restored snapshot does not keep kanban cards, inbox or worker runs", () => {
    const stored = {
      load: () => ({
        cursor: "s.1",
        owner: "o",
        routes: {
          board: { data: { inbox: { decide: [], mine: [], review: [] } } },
          items: { data: { items: [], agents: [] } },
          cards: { data: { cards: [{ id: "k-1" }] } },
          inbox: { data: { questions: [] } },
          "record:r1": { data: { id: "r1" } },
        },
      }),
      save() {},
      clear() {},
    };
    const store = new Store(new SyntheticSource({ now: Math.floor(Date.now() / 1000) }), { stored, afterPaint: async () => {} });
    expect(store.get("board")).toBeDefined();
    expect(store.get("items")).toBeDefined();
    expect(store.get("cards")).toBeUndefined();
    expect(store.get("inbox")).toBeUndefined();
    expect(store.get("record", "r1")).toBeUndefined();
  });

  test("an item detail keeps comments and 맡은 봇, with no talk, runs or talk SSE", async () => {
    const source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) });
    const spy = asked(source);
    window.history.replaceState(null, "", "/app/#/items/T4");
    const item = render(<App store={new Store(source)} />);
    await waitFor(() => expect(item.container.querySelector("article.detail")).not.toBeNull());
    await waitFor(() => expect(item.container.querySelector("[data-testid=detail-loading]")).toBeNull());
    expect(item.getByTestId("screen-item")).toBeTruthy();
    expect(item.getByTestId("comments")).toBeTruthy();
    expect(item.queryByTestId("talk")).toBeNull();
    expect(item.queryByTestId("agent-talk")).toBeNull();
    expect(item.queryByRole("list", { name: "실행" })).toBeNull();
    expect(item.getByTestId("assigned-bot").textContent).toMatch(/^맡은 봇/);
    expect(spy.talks).toEqual([]);
    expect(spy.retries).toEqual([]);
    expect(spy.answers).toEqual([]);
    expect(spy.reads.some((name) => name === "inbox" || name.startsWith("cards") || name.startsWith("record"))).toBe(false);
  });
});
