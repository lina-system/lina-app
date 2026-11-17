import { fireEvent, render, waitFor, within } from "@testing-library/preact";
import { expect, test, vi } from "vitest";
import { App } from "./app";
import { SyntheticSource, syntheticAgentTalkFrames } from "./data/synthetic-source";
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

// lina-app#190: while a reply streamed, the agent's row read the owner's own message (at 1280) or, re-read on the
// phone's list, whatever the core held mid-turn. A turn going reads 답하는 중 on its row; the reply's first line
// replaces it when the reply ends, and the owner's message when it breaks off.
class HeldReply extends SyntheticSource {
  private release: () => void = () => undefined;
  private cut = false;
  private sent = "";
  private reply = "";
  private readonly held = new Promise<void>((resolve) => (this.release = resolve));

  constructor() {
    super({ now: Math.floor(Date.now() / 1000) });
  }

  /** History reads begun, and those not yet taken in by whoever asked. */
  started = 0;
  pending = 0;

  override agentTalkHistory(agent: string) {
    this.started += 1;
    this.pending += 1;
    const read = this.history(agent);
    // The reader's own handler is queued after this one, so the count drops once it has run.
    void read.then(() => queueMicrotask(() => (this.pending -= 1)));
    return read;
  }

  /** The core mid-turn: the owner's message is the conversation's last one; once the reply ends, the reply is. */
  private async history(agent: string) {
    const result = await super.agentTalkHistory(agent);
    const at = Date.now() / 1000;
    if (this.sent && result.kind === "data") result.data.messages.push({ role: "user", content: this.sent, timestamp: at });
    if (this.reply && result.kind === "data") result.data.messages.push({ role: "assistant", content: this.reply, timestamp: at });
    return result;
  }

  override async agentTalk(agent: string, body: { message: string }) {
    const source = this;
    source.sent = body.message;
    async function* held() {
      let first = true;
      for (const event of syntheticAgentTalkFrames(agent, body.message, Date.now() / 1000)) {
        if (event.event === "assistant.completed") source.reply = event.data.content;
        yield event;
        if (!first || event.event !== "assistant.delta") continue;
        first = false;
        await source.held;
        if (source.cut) throw new Error("stream cut");
      }
    }
    return { ok: true as const, events: held() };
  }

  finish(cut = false): void {
    this.cut = cut;
    this.release();
  }
}

async function sendHeld(wide: boolean) {
  const source = new HeldReply();
  const view = open("#/talk/ag-1", wide, source);
  const talk = within(await waitFor(() => view.getByTestId("agent-talk")));
  const field = (await waitFor(() => talk.getByRole("textbox", { name: "메시지" }))) as HTMLTextAreaElement;
  field.value = "하나 더 알려 주세요";
  fireEvent.input(field);
  fireEvent.keyDown(field, { key: "Enter" });
  // The first piece of the reply is in its bubble: the reply is streaming.
  await waitFor(() => expect(talk.getAllByTestId("talk-reply").at(-1)!.textContent).toContain("네, "));
  if (!wide) {
    view.getByTestId("back").click();
    await waitFor(() => expect(view.getByTestId("talk-agents")).toBeTruthy());
  }
  const preview = () => view.getByTestId(wide ? "nav-talk-0" : "talk-agent-0").querySelector("[data-testid=talk-preview]")?.textContent;
  return { source, preview, view };
}

test.each([
  ["1280", true],
  ["390", false],
])("at %s the agent's row reads 답하는 중 while its reply streams, then the reply's first line (lina-app#190)", async (_width, wide) => {
  const { source, preview } = await sendHeld(wide);
  await waitFor(() => expect(preview()).toBe("답하는 중"));
  source.finish();
  await waitFor(() => expect(preview()).toBe("네, 보고 있어요. 지금 하는 일을 정리해서 바로 알려 드릴게요."));
});

test.each([
  ["1280", true],
  ["390", false],
])("at %s a reply that breaks off leaves the owner's message on the row, not 답하는 중 (lina-app#190)", async (_width, wide) => {
  const { source, preview, view } = await sendHeld(wide);
  await waitFor(() => expect(preview()).toBe("답하는 중"));
  source.finish(true);
  await waitFor(() => expect(preview()).toBe("하나 더 알려 주세요"));
  if (wide) return;
  // The phone's list reads the history again, which holds the owner's message last: the turn that broke off is read.
  view.getByTestId("talk-agent-0").querySelector("a")!.click();
  await waitFor(() => expect(view.queryByTestId("talk-agents")).toBeNull());
  const before = source.started;
  view.getByTestId("back").click();
  await waitFor(() => expect(Boolean(view.queryByTestId("talk-agents")) && source.started > before && source.pending === 0).toBe(true));
  expect(preview()).toBe("하나 더 알려 주세요");
});

test.each([
  ["1280", true],
  ["390", false],
])("at %s the agent's row reads 답하는 중 while a send waits for the core, not the owner's message (lina-app#190)", async (_width, wide) => {
  class Unanswered extends SyntheticSource {
    override async agentTalk(_agent: string, _body: { message: string }, _signal?: AbortSignal) {
      return new Promise<never>(() => undefined);
    }
  }
  const view = open("#/talk/ag-1", wide, new Unanswered({ now: Math.floor(Date.now() / 1000) }));
  const talk = within(await waitFor(() => view.getByTestId("agent-talk")));
  const field = (await waitFor(() => talk.getByRole("textbox", { name: "메시지" }))) as HTMLTextAreaElement;
  field.value = "하나 더 알려 주세요";
  fireEvent.input(field);
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(talk.getAllByTestId("talk-mine").at(-1)!.getAttribute("data-state")).toBe("sending"));
  if (!wide) view.getByTestId("back").click();
  const preview = () => view.getByTestId(wide ? "nav-talk-0" : "talk-agent-0").querySelector("[data-testid=talk-preview]")?.textContent;
  await waitFor(() => expect(preview()).toBe("답하는 중"));
});

// lina-app#190: a row that reads the history while a turn sent from another device goes found the owner's message
// last, the core holding it before the reply: the row read the owner's own words until the reply ended. It reads the
// agent's last message, or `아직 나눈 대화 없음` when the agent has said nothing yet.
test.each([
  ["1280", true],
  ["390", false],
])("at %s a row read while another device's turn goes reads the agent's last message, not the owner's (lina-app#190)", async (_width, wide) => {
  class OtherDeviceTurn extends SyntheticSource {
    override async agentTalkHistory(agent: string) {
      const result = await super.agentTalkHistory(agent);
      if (result.kind === "data") result.data.messages.push({ role: "user", content: "다른 기기에서 보낸 말", timestamp: Date.now() / 1000 });
      return result;
    }
  }
  const view = open("#/talk", wide, new OtherDeviceTurn({ now: Math.floor(Date.now() / 1000) }));
  const preview = (index: number) => view.getByTestId(wide ? `nav-talk-${index}` : `talk-agent-${index}`).querySelector("[data-testid=talk-preview]")?.textContent;
  await waitFor(() => expect(preview(0)).toBe("변경 목록을 모으는 중이에요. 배포 순서는 답을 기다려요."));
  await waitFor(() => expect(preview(1)).toBe("아직 나눈 대화 없음"));
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
