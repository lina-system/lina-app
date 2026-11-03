import type { ActionResult, CommentRequest, ItemDetail, ItemSummary, RouteName, Routes } from "../api/client";
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

/** Seconds after an owner's comment before the synthetic agent replies: it lands on the next refresh. */
export const SYNTHETIC_REPLY_AFTER = 5;

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
    this.changed();
    return { ok: true, data: { ok: true, id, state: detail.state, reason: detail.reason, cid, undoUntil: null } };
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
