import { useEffect, useRef, useState } from "preact/hooks";
import type { ItemDetail } from "../api/client";
import type { TalkResult } from "../data/source";
import { KoreanInput } from "../korean-input";
import { AgentMark, agentName, Box, ErrorLine, useApp } from "../ui/parts";
import { W } from "../words";

interface Turn {
  readonly key: number;
  readonly mine: string;
  readonly reply: string;
  readonly agent: string | null;
  readonly state: "streaming" | "done" | "failed";
}

/** The one line a refused turn shows; the message stays in the field. */
export function talkError(result: Extract<TalkResult, { ok: false }>): string {
  switch (result.status) {
    case 429:
      return W.talkBusy;
    case 503:
      return W.talkDown;
    case 409:
      return W.talkNoAgent;
    case 413:
      return W.talkTooLong;
    case 404:
      return W.notFound;
    case 0:
      return W.offline;
    default:
      return W.writeFailed;
  }
}

/**
 * 대화 on a goal or to-do: the owner talks with the agent that owns it, in that agent's app conversation. The page
 * shows only the turns since it opened (the core has no route to read that conversation back). The owner's words sit
 * on the right, the reply streams in on the left under the agent's mark, and once the core carries the exchange into
 * the agent's own chat one line says so under the latest reply.
 */
export function Talk({ detail }: { detail: ItemDetail }) {
  const { model, store } = useApp();
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [carried, setCarried] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextKey = useRef(1);
  const running = useRef<AbortController | null>(null);

  useEffect(() => () => running.current?.abort(), []);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError(null);
    setCarried(null);
    const result = await store.source.talk(detail.id, { message }, controller.signal);
    if (controller.signal.aborted) return;
    if (!result.ok) {
      setBusy(false);
      setError(talkError(result));
      return;
    }
    const key = nextKey.current++;
    const update = (patch: (turn: Turn) => Partial<Turn>) => setTurns((all) => all.map((turn) => (turn.key === key ? { ...turn, ...patch(turn) } : turn)));
    setText("");
    setTurns((all) => [...all, { key, mine: message, reply: "", agent: detail.agent, state: "streaming" }]);
    let completed = false;
    let failed = false;
    try {
      for await (const event of result.events) {
        switch (event.event) {
          case "talk.started":
            update(() => ({ agent: event.data.agent }));
            break;
          case "assistant.delta":
            update((turn) => ({ reply: turn.reply + event.data.delta }));
            break;
          case "assistant.completed":
            completed = true;
            update(() => ({ reply: event.data.content, state: "done" }));
            break;
          case "talk.carried":
            setCarried(key);
            break;
          case "error":
          case "run.failed":
          case "run.cancelled":
            failed = true;
            break;
        }
      }
    } catch (reason) {
      if (controller.signal.aborted) return;
      failed = true;
      console.warn("talk stream ended early", reason);
    }
    if (!completed || failed) {
      update(() => ({ state: "failed" }));
      setError(W.talkFailed);
    }
    setBusy(false);
  };

  const last = turns.at(-1)?.key;
  return (
    <Box title={W.talk} testid="talk">
      {turns.length ? (
        <ol class="talk" aria-label={W.talk}>
          {turns.map((turn) => {
            const name = agentName(model, turn.agent) || turn.agent || "";
            return [
              <li key={`${turn.key}-mine`} class="talk-turn is-mine" data-testid="talk-mine">
                <p class="talk-bubble">{turn.mine}</p>
              </li>,
              turn.reply || turn.state === "streaming" ? (
                <li key={`${turn.key}-reply`} class="talk-turn is-agent" data-testid="talk-reply" aria-busy={turn.state === "streaming" ? "true" : undefined}>
                  <AgentMark id={turn.agent} />
                  <div class="talk-lines">
                    <p class="talk-bubble">
                      {turn.reply}
                      {turn.state === "streaming" ? (
                        <span class="talk-live" data-testid="talk-live">
                          <span class="visually-hidden">{W.replying}</span>
                        </span>
                      ) : null}
                    </p>
                    {carried === turn.key && turn.key === last ? (
                      <span class="sub" role="status" data-testid="talk-carried">
                        {W.carried(name)}
                      </span>
                    ) : null}
                  </div>
                </li>
              ) : null,
            ];
          })}
        </ol>
      ) : null}
      <div class="comment-form talk-form">
        <KoreanInput label={W.talkField} value={text} onValue={setText} onEnter={() => void send()} inline />
        <button type="button" class="text-button" disabled={busy || !text.trim()} onClick={() => void send()}>
          {W.send}
        </button>
      </div>
      <ErrorLine line={error ?? undefined} />
    </Box>
  );
}
