import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { App } from "./app";
import { SyntheticSource } from "./data/synthetic-source";
import { Store } from "./data/store";
import { threadOf, type ThreadLine } from "./screens/talk";

// lina-app#187: the 대화 windows read like a chat app: grouped bubbles, a date between days, no state words under
// the field, and a 맨 아래로 button instead of a pull to the bottom while the owner reads up.

async function open(hash: string, wide: boolean, source = new SyntheticSource({ now: Math.floor(Date.now() / 1000) })) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, "", `/app/${hash}`);
  const view = render(<App store={new Store(source)} />);
  await waitFor(() => expect(view.getByTestId("freshness-line").textContent).toBe(""));
  return view;
}

/** Noon today, local time, in seconds: the cases below stay on one day whatever the hour the tests run at. */
function noon(daysBack = 0): number {
  const at = new Date();
  at.setHours(12, 0, 0, 0);
  at.setDate(at.getDate() - daysBack);
  return Math.floor(at.getTime() / 1000);
}

function line(key: string, mine: boolean, at: number | null): ThreadLine {
  return { key, mine, text: key, at, state: "done" };
}

test("consecutive messages of one sender group, a sender change or a pause of over 5 minutes starts a new group, and a date stands between days", () => {
  const today = noon();
  const parts = threadOf(
    [
      line("a", true, noon(9) + 0),
      line("b", false, noon(1)),
      line("c", true, today),
      line("d", true, today + 30),
      line("e", false, today + 60),
      line("f", false, today + 90),
      line("g", false, today + 90 + 301),
    ],
    today + 400,
  );
  expect(parts.map((part) => (part.kind === "day" ? `[${part.label}]` : `${part.mine ? "me" : "agent"}:${part.lines.map((each) => each.key).join("")}`))).toEqual(["[" + dayOf(noon(9)) + "]", "me:a", "[어제]", "agent:b", "[오늘]", "me:cd", "agent:ef", "agent:g"]);
  const groups = parts.filter((part) => part.kind === "group");
  expect(groups.map((group) => group.at)).toEqual([noon(9), noon(1), today + 30, today + 90, today + 391]);
});

function dayOf(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

test("a date of another year carries its year; a message with no time joins the group before it", () => {
  const lastYear = new Date(noon() * 1000);
  lastYear.setFullYear(lastYear.getFullYear() - 1);
  const old = Math.floor(lastYear.getTime() / 1000);
  const parts = threadOf([line("a", false, old), line("b", false, null)], noon());
  expect(parts.map((part) => (part.kind === "day" ? part.label : part.lines.length))).toEqual([`${lastYear.getFullYear()}년 ${lastYear.getMonth() + 1}월 ${lastYear.getDate()}일`, 2]);
});

test("the agent's window: earlier turns under a date, the agent's mark and name once at the top of its group, the time once at its end", async () => {
  const view = await open("#/talk/ag-1", true);
  const box = within(view.getByTestId("agent-talk"));
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(1));
  expect(box.getAllByTestId("talk-day").map((day) => day.textContent)).toEqual(["어제"]);
  const groups = box.getAllByTestId("talk-group");
  expect(groups).toHaveLength(2);
  const [mine, theirs] = groups;
  expect(mine.querySelector(".mark")).toBeNull();
  expect(theirs.querySelectorAll(".mark")).toHaveLength(1);
  expect(theirs.querySelector("[data-testid=talk-name]")?.textContent).toBe(view.getByTestId("agent-talk-name").textContent);
  expect([...groups].map((group) => group.querySelectorAll("[data-testid=talk-time]").length)).toEqual([1, 1]);
  expect(theirs.querySelector("[data-testid=talk-time]")?.textContent).toMatch(/^\d\d:\d\d$/);
});

/** Gives an element a fixed scroll box: its scrollTop moves within it, and a scroll event tells the window. */
function scrollBox(element: HTMLElement, height: number, view: number) {
  let top = 0;
  element.style.overflowY = "auto";
  Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => view });
  Object.defineProperty(element, "scrollTop", { configurable: true, get: () => top, set: (value: number) => (top = Math.max(0, Math.min(value, height - view))) });
  return {
    get top() {
      return top;
    },
    to(value: number) {
      element.scrollTop = value;
      fireEvent.scroll(element);
    },
  };
}

test("scrolled up to read, a new reply does not pull the owner down: 맨 아래로 shows with the count of new messages and returns to the bottom", async () => {
  let answer: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (answer = resolve));
  class Held extends SyntheticSource {
    override async agentTalk(agent: string, body: { message: string }, signal?: AbortSignal) {
      await gate;
      return super.agentTalk(agent, body, signal);
    }
  }
  const view = await open("#/talk/ag-1", true, new Held({ now: Math.floor(Date.now() / 1000) }));
  const talk = view.getByTestId("agent-talk");
  const box = within(talk);
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(1));
  const turns = talk.querySelector(".agent-talk-turns") as HTMLElement;
  const scroll = scrollBox(turns, 2000, 500);
  expect(box.queryByTestId("talk-jump")).toBeNull();

  const field = box.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement;
  field.value = "하나 더";
  fireEvent.input(field);
  fireEvent.keyDown(field, { key: "Enter" });
  // The owner's own message always goes to the bottom.
  await waitFor(() => expect(box.getAllByTestId("talk-mine")).toHaveLength(2));
  expect(scroll.top).toBe(1500);

  scroll.to(200);
  await waitFor(() => expect(box.getByTestId("talk-jump")).toBeTruthy());
  expect(box.getByTestId("talk-jump").getAttribute("aria-label")).toBe("맨 아래로");
  answer();
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(2));
  expect(scroll.top).toBe(200);
  await waitFor(() => expect(box.getByTestId("talk-jump").getAttribute("aria-label")).toBe("맨 아래로 1"));
  expect(box.getByTestId("talk-jump").textContent).toBe("1");

  fireEvent.click(box.getByTestId("talk-jump"));
  expect(scroll.top).toBe(1500);
  await waitFor(() => expect(box.queryByTestId("talk-jump")).toBeNull());
});

test("scrolled up while a reply streams, the history read that confirms the owner's message does not pull the window down (lina-app#209)", async () => {
  let answer: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (answer = resolve));
  let reads = 0;
  class Held extends SyntheticSource {
    override async agentTalk(agent: string, body: { message: string }, signal?: AbortSignal) {
      await gate;
      return super.agentTalk(agent, body, signal);
    }
    override async agentTalkHistory(agent: string) {
      reads += 1;
      return super.agentTalkHistory(agent);
    }
  }
  const source = new Held({ now: Math.floor(Date.now() / 1000) });
  const view = await open("#/talk/ag-1", true, source);
  const talk = view.getByTestId("agent-talk");
  const box = within(talk);
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(1));
  const scroll = scrollBox(talk.querySelector(".agent-talk-turns") as HTMLElement, 2000, 500);

  const field = box.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement;
  field.value = "하나 더";
  fireEvent.input(field);
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(box.getAllByTestId("talk-mine")).toHaveLength(2));
  expect(scroll.top).toBe(1500);
  scroll.to(200);
  await waitFor(() => expect(box.getByTestId("talk-jump")).toBeTruthy());

  answer();
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(2));
  // The completion makes the window read the history again: that read holds the turn, so the line's key changes from
  // the local one to the history's, though nothing new was sent.
  await waitFor(() => expect(box.getAllByTestId("talk-reply")[1].getAttribute("aria-busy")).toBeNull(), { timeout: 8000 });
  // Another read begins at the stream's end: it holds the turn.
  const settled = reads;
  (source as unknown as { talked: (agent: string) => void }).talked("ag-1");
  await waitFor(() => expect(reads).toBeGreaterThan(settled), { timeout: 8000 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(box.getAllByTestId("talk-mine")).toHaveLength(2);
  expect(scroll.top).toBe(200);
});

test("at the bottom, a new reply keeps the window at the bottom", async () => {
  const view = await open("#/talk/ag-1", true);
  const talk = view.getByTestId("agent-talk");
  const box = within(talk);
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(1));
  const scroll = scrollBox(talk.querySelector(".agent-talk-turns") as HTMLElement, 2000, 500);
  scroll.to(1500);
  const field = box.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement;
  field.value = "하나 더";
  fireEvent.input(field);
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(2));
  expect(scroll.top).toBe(1500);
  expect(box.queryByTestId("talk-jump")).toBeNull();
});

test("the agent's reply draws its markdown; the owner's message stays plain text", async () => {
  class Marked extends SyntheticSource {
    override async agentTalkHistory(agent: string) {
      const result = await super.agentTalkHistory(agent);
      if (result.kind === "data") result.data.messages = [
        { role: "user", content: "[LINA app]\n\n**그대로** `둠`", timestamp: noon() },
        { role: "assistant", content: "**굵게** 와 `agents`\n\n- 하나\n- 둘", timestamp: noon() + 10 },
      ];
      return result;
    }
  }
  const view = await open("#/talk/ag-1", true, new Marked({ now: Math.floor(Date.now() / 1000) }));
  const box = within(view.getByTestId("agent-talk"));
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(1));
  const reply = box.getByTestId("talk-reply");
  expect(reply.querySelector("strong")?.textContent).toBe("굵게");
  expect(reply.querySelector("code")?.textContent).toBe("agents");
  expect([...reply.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["하나", "둘"]);
  const mine = box.getByTestId("talk-mine");
  expect(mine.querySelector("strong, code")).toBeNull();
  expect(mine.textContent).toBe("**그대로** `둠`");
});

/** A source whose to-do talk answers at once, each turn as the agent `agents` names for it; a turn waits for its gate. */
function talkingAs(agents: readonly string[], gates: readonly Promise<void>[] = []) {
  let turn = 0;
  return class extends SyntheticSource {
    override async talk(id: string, body: { message: string }) {
      const result = await super.talk(id, body);
      if (!result.ok) return result;
      const index = turn++;
      const agent = agents[Math.min(index, agents.length - 1)];
      const gate = gates[index];
      async function* events() {
        if (gate) await gate;
        yield { event: "talk.started" as const, data: { item: { id, title: "" }, agent, session_id: `app-${agent}` } };
        yield { event: "assistant.completed" as const, data: { session_id: `app-${agent}`, run_id: `r${index}`, seq: 1, ts: 1, message_id: `m${index}`, content: `답 ${index + 1}` } };
        yield { event: "done" as const, data: { session_id: `app-${agent}`, run_id: `r${index}`, seq: 2, ts: 1 } };
      }
      return { ok: true as const, events: events() };
    }
  };
}

function sendFrom(box: ReturnType<typeof within>, message: string) {
  const field = box.getByRole("textbox", { name: "메시지" }) as HTMLTextAreaElement;
  field.value = message;
  fireEvent.input(field);
  fireEvent.keyDown(field, { key: "Enter" });
}

test("a to-do's window names the agent that answered each turn, not the latest one for all", async () => {
  const Source = talkingAs(["ag-1", "ag-2"]);
  const view = await open("#/goals/G2", true, new Source({ now: Math.floor(Date.now() / 1000) }));
  const box = within(view.getByTestId("talk"));
  sendFrom(box, "하나");
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(1));
  await waitFor(() => expect(box.getByTestId("talk-reply").getAttribute("aria-busy")).toBeNull());
  sendFrom(box, "둘");
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(2));
  await waitFor(() => expect(box.getAllByTestId("talk-name")).toHaveLength(2));
  expect(box.getAllByTestId("talk-name").map((name) => name.textContent)).toEqual(["Pesk", "Mirel"]);
});

test("sent from a scrolled-up window, the owner's message and its reply placeholder go to the bottom and count as nothing new", async () => {
  let answer: () => void = () => undefined;
  const second = new Promise<void>((resolve) => (answer = resolve));
  const Source = talkingAs(["ag-1"], [Promise.resolve(), second]);
  const view = await open("#/goals/G2", true, new Source({ now: Math.floor(Date.now() / 1000) }));
  const talk = view.getByTestId("talk");
  const box = within(talk);
  const scroll = scrollBox(talk, 2000, 500);
  sendFrom(box, "하나");
  await waitFor(() => expect(box.getAllByTestId("talk-reply")).toHaveLength(1));
  await waitFor(() => expect(box.getByTestId("talk-reply").getAttribute("aria-busy")).toBeNull());
  scroll.to(200);
  await waitFor(() => expect(box.getByTestId("talk-jump")).toBeTruthy());
  sendFrom(box, "둘");
  await waitFor(() => expect(box.getAllByTestId("talk-mine")).toHaveLength(2));
  expect(box.getAllByTestId("talk-reply")).toHaveLength(2);
  expect(scroll.top).toBe(1500);
  await waitFor(() => expect(box.queryByTestId("talk-jump")).toBeNull());
  answer();
  await waitFor(() => expect(box.getAllByTestId("talk-reply")[1].getAttribute("aria-busy")).toBeNull());
});
