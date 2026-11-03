import { createContext } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import type { Store } from "../data/store";
import type { CardRow, DecisionTarget, MineSource, Pending } from "../model";
import { writeError } from "../screens/write-error";
import { W } from "../words";

/** How long a toast stays, and how long an answer waits before it is sent. */
export const TOAST_MS = 5000;

interface Toast {
  readonly id: number;
  readonly text: string;
  /** The item whose done mark the toast can take back; the detail page hides its own 되돌리기 meanwhile. */
  readonly owner: string | null;
  readonly onUndo: () => void;
  readonly onEnd: (() => void) | null;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface WriteError {
  readonly line: string;
  readonly text?: string;
}

/**
 * The owner's writes and what the screen shows while they run: rows hidden behind a pending answer, done marks
 * drawn before the core answers, lines that last until the next refresh, the one-line errors and the toast.
 * Every effect here is undone when the core refuses, so the screen falls back to the record's own state.
 */
export class Actions {
  private readonly hiddenKeys = new Set<string>();
  private readonly doneOverride = new Map<string, boolean>();
  private readonly undoUntilById = new Map<string, number>();
  private readonly busyKeys = new Set<string>();
  private readonly errors = new Map<string, WriteError>();
  private readonly requestedAt = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly readKeys = new Set<string>();
  private allRead = false;
  private noticeError: string | null = null;
  private readonly held = new Map<string, { row: MineSource; index: number }>();
  private current: Toast | null = null;
  private nextToast = 1;
  /** Bumped on every change, so the model is rebuilt with what the writes in flight change. */
  version = 0;

  constructor(
    private readonly store: Store,
    private readonly onChange: () => void,
    private readonly timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = globalThis,
  ) {}

  private notify(): void {
    this.version += 1;
    this.onChange();
  }

  /** The model's view of the writes in flight: rows hidden for an answer's toast, done rows held for theirs. */
  pending(): Pending {
    return { hidden: this.hiddenKeys, held: [...this.held.values()] };
  }

  private hold(id: string): void {
    const mine = this.store.get("board")?.inbox.mine ?? [];
    const index = mine.findIndex((row) => row.id === id);
    if (index >= 0) this.held.set(id, { row: mine[index], index });
  }

  private release(id: string): void {
    if (this.held.delete(id)) this.notify();
  }

  get toast(): { readonly id: number; readonly text: string; readonly owner: string | null } | null {
    return this.current;
  }

  isDone(id: string, recordDone: boolean): boolean {
    return this.doneOverride.get(id) ?? recordDone;
  }

  undoUntil(id: string, fromRecord: number | null | undefined): number | null {
    return this.undoUntilById.get(id) ?? fromRecord ?? null;
  }

  busy(key: string): boolean {
    return this.busyKeys.has(key);
  }

  error(key: string): WriteError | undefined {
    return this.errors.get(key);
  }

  requested(key: string): boolean {
    const at = this.requestedAt.get(key);
    return at !== undefined && (at < 0 || at === this.store.refreshes);
  }

  /** A notice is read when the core says so, or while this device's read mark is on its way. */
  isRead(key: string, fromCore: boolean): boolean {
    return fromCore || this.allRead || this.readKeys.has(key);
  }

  get noticesError(): string | null {
    return this.noticeError;
  }

  async readNotices(keys: readonly string[] | "all"): Promise<void> {
    if (keys === "all") this.allRead = true;
    else for (const key of keys) this.readKeys.add(key);
    this.noticeError = null;
    this.busyKeys.add("notices");
    this.notify();
    const result = await this.store.write((source) => source.readNotices(keys === "all" ? { all: true } : { keys }));
    this.busyKeys.delete("notices");
    if (keys === "all") this.allRead = false;
    else for (const key of keys) this.readKeys.delete(key);
    if (!result.ok) this.noticeError = writeError("read", result);
    this.notify();
  }

  private showToast(text: string, owner: string | null, onUndo: () => void, onEnd: (() => void) | null = null): void {
    this.endToast();
    const id = this.nextToast++;
    const timer = this.timers.setTimeout(() => {
      if (this.current?.id === id) this.endToast();
    }, TOAST_MS);
    this.current = { id, text, owner, onUndo, onEnd, timer };
    this.notify();
  }

  /** The toast ran out (or another replaced it, or the page is going): what it held back goes ahead now. */
  endToast(): void {
    const toast = this.current;
    if (!toast) return;
    this.timers.clearTimeout(toast.timer);
    this.current = null;
    toast.onEnd?.();
    this.notify();
  }

  undoToast(): void {
    const toast = this.current;
    if (!toast) return;
    this.timers.clearTimeout(toast.timer);
    this.current = null;
    toast.onUndo();
    this.notify();
  }

  private dropToast(owner: string): void {
    if (this.current?.owner !== owner) return;
    this.timers.clearTimeout(this.current.timer);
    this.current = null;
  }

  /** The row leaves at once; the answer is sent only when the toast ends, so 되돌리기 in the toast sends nothing. */
  answer(key: string, target: DecisionTarget, text: string): void {
    this.hiddenKeys.add(key);
    this.errors.delete(key);
    this.showToast(
      W.answered,
      null,
      () => {
        this.hiddenKeys.delete(key);
      },
      () => {
        void this.sendAnswer(key, target, text);
      },
    );
  }

  private async sendAnswer(key: string, target: DecisionTarget, text: string): Promise<void> {
    this.busyKeys.add(key);
    const result = await this.store.write<unknown>((source) => (target.kind === "item" ? source.comment(target.id, { text, answer: true }) : source.answerCard(target.id, { text })));
    this.busyKeys.delete(key);
    if (!result.ok) {
      this.hiddenKeys.delete(key);
      this.errors.set(key, { line: writeError("answer", result), text });
    }
    this.notify();
  }

  async markDone(id: string, withOpen: readonly string[] = []): Promise<void> {
    const ids = [id, ...withOpen];
    for (const each of ids) {
      this.doneOverride.set(each, true);
      this.hold(each);
    }
    this.errors.delete(`done:${id}`);
    this.busyKeys.add(`done:${id}`);
    const sent = this.store.write((source) => source.done(id, withOpen.length ? { withOpen: true } : {}));
    this.inflight.set(id, sent);
    this.showToast(
      W.markedDone,
      id,
      () => void this.undoDone(id, withOpen),
      () => {
        for (const each of ids) this.release(each);
      },
    );
    const result = await sent;
    this.inflight.delete(id);
    this.busyKeys.delete(`done:${id}`);
    if (result.ok) {
      if (result.data.undoUntil !== null) this.undoUntilById.set(id, result.data.undoUntil);
      for (const each of ids) if (this.doneOverride.get(each) === true) this.doneOverride.delete(each);
    } else {
      for (const each of ids) {
        this.doneOverride.delete(each);
        this.held.delete(each);
      }
      this.dropToast(id);
      this.errors.set(`done:${id}`, { line: writeError("done", result) });
    }
    this.notify();
  }

  async undoDone(id: string, withOpen: readonly string[] = []): Promise<void> {
    const ids = [id, ...withOpen];
    for (const each of ids) this.doneOverride.set(each, false);
    this.errors.delete(`done:${id}`);
    this.busyKeys.add(`done:${id}`);
    this.dropToast(id);
    this.notify();
    await this.inflight.get(id);
    const result = await this.store.write((source) => source.undo(id));
    this.busyKeys.delete(`done:${id}`);
    if (result.ok) this.undoUntilById.delete(id);
    else this.errors.set(`done:${id}`, { line: writeError("undo", result) });
    for (const each of ids) {
      if (this.doneOverride.get(each) === false) this.doneOverride.delete(each);
      this.held.delete(each);
    }
    this.notify();
  }

  /** Asks the card's owning agent to try again; `<agent>에게 요청함` stays until the next refresh after that. */
  async retry(card: CardRow): Promise<void> {
    this.requestedAt.set(card.key, -1);
    this.errors.delete(`retry:${card.key}`);
    this.notify();
    const result = await this.store.write<unknown>((source) => (card.todo ? source.retry(card.todo) : source.answerCard(card.id, { text: W.retryText })), { refresh: false });
    if (result.ok) this.requestedAt.set(card.key, this.store.refreshes);
    else {
      this.requestedAt.delete(card.key);
      this.errors.set(`retry:${card.key}`, { line: writeError("retry", result) });
    }
    this.notify();
  }
}

export const ActionsCtx = createContext<Actions | null>(null);

export function useActions(): Actions {
  const value = useContext(ActionsCtx);
  if (!value) throw new Error("useActions outside the app shell");
  return value;
}

export function useActionsFor(store: Store): Actions {
  const [, setTick] = useState(0);
  const actions = useMemo(() => new Actions(store, () => setTick((value) => value + 1)), [store]);
  useEffect(() => {
    const flush = () => actions.endToast();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [actions]);
  return actions;
}
