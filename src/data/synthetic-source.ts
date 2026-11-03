import type { ActionResult, AnswerRequest, AnswerResult, BoardSnapshot, CommentRequest, DoneRequest, ItemDetail, ItemSummary, RouteName, Routes, WorkState } from "../api/client";
import { generateScene, SYNTHETIC_OWNER, SYNTHETIC_SEED, type Scene } from "../fixtures/synthetic";
import { nowSeconds, type ReadResult, type Source, type WriteResult } from "./source";

function bodyOf(scene: Scene, name: RouteName, id?: string): unknown {
  switch (name) {
    case "board":
      return scene.board;
    case "items":
      return scene.items;
    case "item":
      return id ? scene.itemDetails[id] : undefined;
    case "devices":
      return scene.devices;
    case "quota":
      return scene.quota;
    case "goals":
      return scene.goals;
    case "goal":
      return scene.goals.goals.find((goal) => goal.id === id);
    case "cards":
      return scene.cards;
    case "card":
      return id ? scene.cardDetails[id] : undefined;
    case "inbox":
      return scene.inbox;
  }
}

/** The owner's done mark can be taken back for ten minutes (lina#149). */
export const UNDO_SECONDS = 600;

type DueGroup = keyof BoardSnapshot["due"];

/** What one owner's done mark changed, so undo can put it back. */
interface DoneMark {
  readonly id: string;
  readonly at: number;
  readonly undoUntil: number;
  readonly before: readonly { id: string; state: WorkState; reason: string | null; stateSince: number | null; closedAt: number | null }[];
  readonly mine: readonly { index: number; row: BoardSnapshot["inbox"]["mine"][number] }[];
  readonly due: readonly { group: DueGroup; index: number; row: BoardSnapshot["due"][DueGroup][number] }[];
}

/** Seconds after an owner's comment before the synthetic agent replies: it lands on the next refresh. */
export const SYNTHETIC_REPLY_AFTER = 5;

/** The comment retry leaves on a to-do: the core re-runs nothing, the owning agent reads it. */
export const RETRY_TEXT = "다시 시도해 주세요.";

const REPLY_TEXT = { comment: "확인했어요. 반영할게요.", answer: "답을 받았어요. 이어서 할게요." } as const;

function fail(status: number, detail: string): WriteResult<never> {
  return { ok: false, status, detail };
}

/**
 * Serves the synthetic scene like the core does: data on the first read of a route, then "unchanged" until a write
 * changes the scene. It keeps its own copy of the scene and applies the owner's writes to it the way the core applies
 * them to the record, so drives and captures go through the same screens and requests as on a live core.
 */
export class SyntheticSource implements Source {
  readonly scene: Scene;
  private readonly served = new Set<string>();
  private readonly replies: { id: string; cid: string; at: number; kind: "comment" | "answer" }[] = [];
  private nextCid = 1;
  private nextCardComment = 100;
  /** The last record per item: the owner's own done mark, or null once anything else was written after it. */
  private readonly marks = new Map<string, DoneMark | null>();

  constructor(options: { seed?: number; now?: number; sourceError?: boolean } = {}) {
    this.scene = generateScene(options.seed ?? SYNTHETIC_SEED, {
      now: Math.floor(options.now ?? nowSeconds()),
      sourceError: options.sourceError,
    });
  }

  async read<N extends RouteName>(name: N, id?: string): Promise<ReadResult<Routes[N]>> {
    const at = nowSeconds();
    this.deliverReplies(at);
    const body = bodyOf(this.scene, name, id);
    if (body === undefined) return { kind: "missing", at };
    const key = `${name}:${id ?? ""}`;
    if (this.served.has(key)) return { kind: "unchanged", at };
    this.served.add(key);
    return { kind: "data", data: structuredClone(body) as Routes[N], at };
  }

  async comment(id: string, body: CommentRequest): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, "no such goal or to-do");
    const text = body.text.trim();
    if (!text || text.length > 2000) return fail(422, "comment text must be 1-2000 characters");
    if (body.answer && (!detail.decision || detail.decision.answered)) return fail(409, "no open decision on this item");
    const at = Math.floor(nowSeconds());
    const cid = `n${this.nextCid++}`;
    const kind = body.answer ? "answer" : "comment";
    detail.comments.push({ cid, by: SYNTHETIC_OWNER.id, at, text, status: "open", kind, replies: [] });
    this.patchItem(id, { commentCount: detail.comments.length, lastActivityAt: at });
    if (body.answer && detail.decision) {
      detail.decision.answered = true;
      detail.decision.cid = cid;
      for (const row of this.scene.board.inbox.decide) if (row.target === id) row.answered = true;
    }
    this.replies.push({ id, cid, at, kind });
    if (this.marks.has(id)) this.marks.set(id, null);
    this.changed();
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid, undoUntil: null } };
  }

  async done(id: string, body: DoneRequest): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, "no such goal or to-do");
    if (detail.state === "done") return fail(409, "already done");
    const open = detail.kind === "goal" ? detail.children.filter((child) => child.state !== "done").map((child) => child.id) : [];
    if (open.length && !body.withOpen) return fail(409, "the goal has open to-dos");
    const at = Math.floor(nowSeconds());
    const ids = [id, ...open];
    const mark: DoneMark = {
      id,
      at,
      undoUntil: at + UNDO_SECONDS,
      before: ids.map((each) => {
        const item = this.scene.itemDetails[each];
        return { id: each, state: item.state, reason: item.reason, stateSince: item.stateSince, closedAt: item.closedAt };
      }),
      mine: this.scene.board.inbox.mine.map((row, index) => ({ index, row })).filter(({ row }) => ids.includes(row.id)),
      due: (Object.keys(this.scene.board.due) as DueGroup[]).flatMap((group) => this.scene.board.due[group].map((row, index) => ({ group, index, row })).filter(({ row }) => ids.includes(row.id))),
    };
    for (const each of ids) this.patchItem(each, { state: "done", reason: null, stateSince: at, closedAt: at, lastActivityAt: at });
    this.scene.board.inbox.mine = this.scene.board.inbox.mine.filter((row) => !ids.includes(row.id));
    for (const group of Object.keys(this.scene.board.due) as DueGroup[]) this.scene.board.due[group] = this.scene.board.due[group].filter((row) => !ids.includes(row.id));
    detail.ownerDone = { at, undoUntil: mark.undoUntil, with: open };
    this.marks.set(id, mark);
    this.recount(ids);
    this.changed();
    return { ok: true, data: { ok: true, id, state: "done", reason: null, cid: null, undoUntil: mark.undoUntil } };
  }

  async undo(id: string): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, "no such goal or to-do");
    const mark = this.marks.get(id);
    if (!mark) return fail(409, "the last record is not the owner's done mark");
    if (nowSeconds() > mark.undoUntil) return fail(409, "ten minutes have passed");
    for (const before of mark.before) this.patchItem(before.id, { state: before.state, reason: before.reason, stateSince: before.stateSince, closedAt: before.closedAt });
    for (const { index, row } of mark.mine) this.scene.board.inbox.mine.splice(index, 0, row);
    for (const { group, index, row } of mark.due) this.scene.board.due[group].splice(index, 0, row);
    detail.ownerDone = null;
    this.marks.delete(id);
    this.recount(mark.before.map((before) => before.id));
    this.changed();
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid: null, undoUntil: null } };
  }

  async retry(id: string): Promise<WriteResult<ActionResult>> {
    const detail = this.scene.itemDetails[id];
    if (!detail) return fail(404, "no such goal or to-do");
    const at = Math.floor(nowSeconds());
    const cid = `n${this.nextCid++}`;
    detail.comments.push({ cid, by: SYNTHETIC_OWNER.id, at, text: RETRY_TEXT, status: "open", kind: "comment", replies: [] });
    this.patchItem(id, { commentCount: detail.comments.length, lastActivityAt: at });
    if (this.marks.has(id)) this.marks.set(id, null);
    this.changed();
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid, undoUntil: null } };
  }

  async answerCard(cardId: string, body: AnswerRequest): Promise<WriteResult<AnswerResult>> {
    const card = this.scene.cardDetails[cardId];
    if (!card) return fail(404, "no such card");
    const text = body.text.trim();
    if (!text) return fail(400, "empty text");
    const commentId = this.nextCardComment++;
    card.comments.push({ id: commentId, author: SYNTHETIC_OWNER.id, body: text, createdAt: Math.floor(nowSeconds()) });
    this.scene.inbox.questions = this.scene.inbox.questions.filter((question) => question.cardId !== cardId);
    this.changed();
    return { ok: true, data: { ok: true, cardId, commentId, unblocked: false, state: card.state, reason: card.reason } };
  }

  /** Goals' to-do counts follow their to-dos' states. */
  private recount(ids: readonly string[]): void {
    const goals = new Set(ids.map((id) => this.scene.itemDetails[id]).map((item) => (item?.kind === "goal" ? item.id : item?.parent)).filter((id): id is string => Boolean(id)));
    for (const goal of goals) {
      const children = this.scene.itemDetails[goal]?.children ?? [];
      this.patchItem(goal, { todos: { done: children.filter((child) => child.state === "done").length, total: children.length } });
    }
  }

  /** The owning agent answers each owner comment once it is SYNTHETIC_REPLY_AFTER seconds old. */
  private deliverReplies(now: number): void {
    const due = this.replies.filter((reply) => now - reply.at >= SYNTHETIC_REPLY_AFTER);
    if (!due.length) return;
    for (const reply of due) {
      this.replies.splice(this.replies.indexOf(reply), 1);
      const detail = this.scene.itemDetails[reply.id];
      const comment = detail?.comments.find((entry) => entry.cid === reply.cid);
      if (!detail || !comment) continue;
      comment.replies.push({ by: detail.agent ?? "", at: Math.floor(now), text: REPLY_TEXT[reply.kind], result: "applied" });
      if (reply.kind === "answer") {
        detail.decision = null;
        const decide = this.scene.board.inbox.decide;
        for (let index = decide.length - 1; index >= 0; index -= 1) if (decide[index].target === reply.id) decide.splice(index, 1);
      }
    }
    this.changed();
  }

  /** The same fields on the item's list entry, its detail and its row in its goal's children. */
  protected patchItem(id: string, patch: Partial<ItemSummary>): void {
    const targets: (ItemSummary | ItemDetail | undefined)[] = [this.scene.items.items.find((item) => item.id === id), this.scene.itemDetails[id]];
    const parent = this.scene.itemDetails[id]?.parent;
    if (parent) targets.push(this.scene.itemDetails[parent]?.children.find((child) => child.id === id));
    for (const target of targets) if (target) Object.assign(target, patch);
  }

  /** The scene changed: every route answers with data again on its next read. */
  protected changed(): void {
    this.served.clear();
  }
}
