import { useState } from "preact/hooks";
import type { ItemComment, ItemDetail } from "../api/client";
import { KoreanInput } from "../korean-input";
import { ago } from "../time";
import { agentName, Box, useApp } from "../ui/parts";
import { REPLY_RESULT, SEP, W } from "../words";
import { writeError } from "./write-error";

export function firstWords(text: string, count = 4): string {
  const words = text.trim().split(/\s+/);
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : words.join(" ");
}

function waitsOnAgent(comment: ItemComment, owner: string): boolean {
  return comment.by === owner && comment.replies.every((reply) => reply.by === owner);
}

function CommentBody({ comment, agent, owner }: { comment: ItemComment; agent: string; owner: string }) {
  const { model, now } = useApp();
  const pending = waitsOnAgent(comment, owner) && comment.status === "open";
  return (
    <>
      <p class="comment-text">{comment.text}</p>
      <span class="sub" data-testid={pending ? "comment-pending" : undefined}>
        {pending ? [W.sentTo(agent), ago(now - comment.at)].join(SEP) : [agentName(model, comment.by), ago(now - comment.at)].filter(Boolean).join(SEP)}
      </span>
      {comment.replies.length ? (
        <ul class="replies">
          {comment.replies.map((reply, index) => (
            <li key={index} class="comment reply" data-testid="reply">
              <p class="comment-text">{reply.text}</p>
              <span class="sub">{[agentName(model, reply.by), ago(now - reply.at), reply.result ? REPLY_RESULT[reply.result] : null].filter(Boolean).join(SEP)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function Thread({ comments, agent }: { comments: readonly ItemComment[]; agent: string }) {
  const { store } = useApp();
  const owner = store.get("items")?.owner?.id ?? "";
  return (
    <ul class="thread" aria-label={W.comments}>
      {comments.map((comment) =>
        comment.status === "resolved" ? (
          <li key={comment.cid} class="comment" data-testid="comment">
            <details class="fold resolved" data-testid="resolved">
              <summary class="sub">{`${W.resolved}${SEP}${firstWords(comment.text)}`}</summary>
              <CommentBody comment={comment} agent={agent} owner={owner} />
            </details>
          </li>
        ) : (
          <li key={comment.cid} class="comment" data-testid="comment">
            <CommentBody comment={comment} agent={agent} owner={owner} />
          </li>
        ),
      )}
    </ul>
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
      setText(body);
      setError(writeError("comment", result));
    }
  };

  return (
    <Box title={W.comments} testid="comments">
      {shown.length ? <Thread comments={shown} agent={agent} /> : null}
      <form class="comment-form" onSubmit={send}>
        <KoreanInput label={W.commentField} value={text} onValue={setText} inline />
        <button type="submit" class="text-button" disabled={Boolean(sending) || !text.trim()}>
          {W.send}
        </button>
      </form>
      {error ? (
        <p class="write-error" role="alert" data-testid="write-error">
          {error}
        </p>
      ) : null}
    </Box>
  );
}
