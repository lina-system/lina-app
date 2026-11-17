import { useRef, useState } from "preact/hooks";
import type { ItemComment, ItemDetail } from "../api/client";
import { KoreanInput } from "../korean-input";
import { STATE_ONLY, wholeText } from "../model/fold";
import { ownerWrote, type HeldText } from "../model/timeline";
import { ago, clockAt } from "../time";
import { agentName, Box, useApp } from "../ui/parts";
import { DETAIL_WORD, REPLY_RESULT, SEP, W } from "../words";
import { writeError } from "./write-error";

export function firstWords(text: string, count = 4): string {
  const words = text.trim().split(/\s+/);
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : words.join(" ");
}

/** A comment's text in the thread: the owner's as saved (lina-app#226), a bot's whole or nothing (wholeText, lina-app#236). */
function shownText(text: string, by: string, owner: string): string {
  return ownerWrote(by, owner) ? text : (wholeText(text) ?? "");
}

/**
 * A folded line (lina-app#241): a button that opens what it holds, each text whole and as written, in the order of the
 * history around it, with its time and its author's name (none for a record row or an author the app has no name for,
 * never an id). On a history it reads `time · words` as every line does (`at`). The gate does not read an opened text: the owner chose to read it. 접기 at its end closes it and puts
 * focus back on the line, so the reader is where they opened it.
 */
export function FoldLine({ label, held, at = null }: { label: string; held: readonly HeldText[]; at?: number | null }) {
  const { model, now } = useApp();
  const [open, setOpen] = useState(false);
  const line = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={line} type="button" class="fold-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {at === null ? label : [clockAt(at, now), label].join(SEP)}
      </button>
      {open ? (
        <div class="fold-held" data-testid="fold-held">
          <ol class="held-list">
            {held.map((text, index) => (
              <li key={`${text.at}:${index}`} class="held">
                <span class="sub" data-testid="held-head">
                  {[text.at === null ? "" : clockAt(text.at, now), agentName(model, text.by)].filter(Boolean).join(SEP)}
                </span>
                <p class="held-text" data-testid="held-text">
                  {text.text}
                </p>
              </li>
            ))}
          </ol>
          <button
            type="button"
            class="text-button fold-close"
            onClick={() => {
              setOpen(false);
              line.current?.focus();
            }}
          >
            {DETAIL_WORD.close}
          </button>
        </div>
      ) : null}
    </>
  );
}

const heldOf = (comment: ItemComment): HeldText => ({ at: comment.at, by: comment.by, text: comment.text });

function waitsOnAgent(comment: ItemComment, owner: string): boolean {
  return comment.by === owner && comment.replies.every((reply) => reply.by === owner);
}

/** A comment's own text: as shown (shownText), `×n` when it stands for n of the same state word in a row, or its fold. */
function OwnText({ comment, owner, count = 1 }: { comment: ItemComment; owner: string; count?: number }) {
  const text = shownText(comment.text, comment.by, owner);
  if (!text) return <FoldLine label={W.foldedRun(1)} held={[heldOf(comment)]} />;
  return <p class="comment-text">{count > 1 ? `${text} ${W.repeated(count)}` : text}</p>;
}

function CommentBody({ comment, agent, owner, count }: { comment: ItemComment; agent: string; owner: string; count?: number }) {
  const { model, now } = useApp();
  const pending = waitsOnAgent(comment, owner) && comment.status === "open";
  return (
    <>
      <OwnText comment={comment} owner={owner} count={count} />
      <span class="sub" data-testid={pending ? "comment-pending" : undefined}>
        {pending ? [W.sentTo(agent), ago(now - comment.at)].join(SEP) : [agentName(model, comment.by), ago(now - comment.at)].filter(Boolean).join(SEP)}
      </span>
      {comment.replies.length ? (
        <ul class="replies">
          {comment.replies.map((reply, index) => (
            <li key={index} class="comment reply" data-testid="reply">
              <OwnText comment={{ ...comment, ...reply }} owner={owner} />
              <span class="sub">{[agentName(model, reply.by), ago(now - reply.at), reply.result ? REPLY_RESULT[reply.result] : null].filter(Boolean).join(SEP)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** A comment with no reply and nothing left once folded (shownText): no sentence of its own to show. */
function nothingLeft(comment: ItemComment, owner: string): boolean {
  return !comment.replies.length && !shownText(comment.text, comment.by, owner).trim();
}

/**
 * The comments in order, each run of comments with nothing left one folded entry that holds them (lina-app#161, #241), and
 * a state word alone that follows the same state word one entry with their count, as a card's history does (lina-app#236).
 */
function threadEntries(comments: readonly ItemComment[], owner: string): ({ readonly comment: ItemComment; count: number } | { readonly held: HeldText[]; readonly key: string })[] {
  const entries: ({ comment: ItemComment; count: number } | { held: HeldText[]; key: string })[] = [];
  const stateWord = (comment: ItemComment) => (comment.replies.length || comment.status === "resolved" ? null : shownText(comment.text, comment.by, owner));
  for (const comment of comments) {
    const last = entries.at(-1);
    const word = stateWord(comment);
    if (nothingLeft(comment, owner)) {
      if (last && "held" in last) last.held.push(heldOf(comment));
      else entries.push({ held: [heldOf(comment)], key: `folded:${comment.cid}` });
    } else if (word && STATE_ONLY.has(word) && last && "comment" in last && stateWord(last.comment) === word) last.count += 1;
    else entries.push({ comment, count: 1 });
  }
  return entries;
}

export function Thread({ comments, agent }: { comments: readonly ItemComment[]; agent: string }) {
  const { store } = useApp();
  const owner = store.get("items")?.owner?.id ?? "";
  return (
    <ul class="thread" aria-label={W.comments}>
      {threadEntries(comments, owner).map((entry) => {
        if ("held" in entry)
          return (
            <li key={entry.key} class="comment folded-records" data-testid="folded-records">
              <FoldLine label={W.foldedRun(entry.held.length)} held={entry.held} />
            </li>
          );
        const { comment, count } = entry;
        return comment.status === "resolved" ? (
          <li key={comment.cid} class="comment" data-testid="comment">
            <details class="fold resolved" data-testid="resolved">
              <summary class="sub">{`${W.resolved}${SEP}${firstWords(shownText(comment.text, comment.by, owner))}`}</summary>
              <CommentBody comment={comment} agent={agent} owner={owner} />
            </details>
          </li>
        ) : (
          <li key={comment.cid} class="comment" data-testid="comment">
            <CommentBody comment={comment} agent={agent} owner={owner} count={count} />
          </li>
        );
      })}
    </ul>
  );
}

/** 보내기, and while it cannot send one line beside it saying why (lina-app#142): the field is empty, or the last one is on its way. */
export function SendButton({ busy, empty }: { busy: boolean; empty: boolean }) {
  const why = busy ? W.sendWhyBusy : empty ? W.sendWhyEmpty : null;
  return (
    <>
      <button type="submit" class="text-button" disabled={why !== null}>
        {W.send}
      </button>
      {why ? (
        <span class="send-why" data-testid="send-why">
          {why}
        </span>
      ) : null}
    </>
  );
}

/**
 * The comment box at the bottom of a goal or to-do: the thread, then a one-line field and 보내기. The sent
 * comment shows at once with `<agent>에게 보냄 · 방금`; the record's own copy replaces it after the core takes it,
 * and a refused one comes back into the field with the core's reason under it.
 */
export function Comments({ detail }: { detail: ItemDetail }) {
  const { model, store, now } = useApp();
  const [text, setText] = useState("");
  const [sending, setSending] = useState<ItemComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const agent = agentName(model, detail.agent);
  const owner = store.get("items")?.owner?.id ?? "";
  const shown = sending ? [...detail.comments, sending] : detail.comments;

  const send = async (event: Event) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setError(null);
    setSending({ cid: "sending", by: owner, at: Math.floor(now), text: body, status: "open", kind: "comment", replies: [] });
    setText("");
    const result = await store.write((source) => source.comment(detail.id, { text: body }));
    setSending(null);
    if (!result.ok) {
      // What the owner typed while it was out stays; the refused comment comes back into an empty field (lina-app#32).
      setText((typed) => (typed.trim() ? typed : body));
      setError(writeError("comment", result));
    }
  };

  return (
    <Box title={W.comments} testid="comments">
      {shown.length ? <Thread comments={shown} agent={agent} /> : null}
      <form class="comment-form" onSubmit={send}>
        <KoreanInput label={W.commentField} value={text} onValue={setText} inline />
        <SendButton busy={Boolean(sending)} empty={!text.trim()} />
      </form>
      {error ? (
        <p class="write-error" role="alert" data-testid="write-error">
          {error}
        </p>
      ) : null}
    </Box>
  );
}
