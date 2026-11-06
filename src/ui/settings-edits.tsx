import { createContext } from "preact";
import { useContext, useMemo, useState } from "preact/hooks";
import type { Settings, SettingsPatch, SettingsView, SettingsWritten } from "../api/client";
import { SETTINGS_REVISED } from "../data/live";
import type { WriteResult } from "../data/source";
import type { Store } from "../data/store";
import { mergePatch } from "../model/settings";
import { W } from "../words";
import type { Actions } from "./actions";

/** The row a refused rollback says why under. */
export const ROLLBACK_KEY = "rollback";

/** A refused write's one line: the core's own `detail` (422 names the path and why), or the shared lines. */
export function settingsError(result: Extract<WriteResult<unknown>, { ok: false }>): string {
  if (result.status === 429) return W.errTooMany;
  return result.detail ?? W.writeFailed;
}

interface Edit {
  readonly id: number;
  readonly key: string;
  readonly patch: SettingsPatch;
}

/**
 * The owner's changes to the work settings. Each control saves when it changes: its patch is drawn over the settings
 * at once and sent in turn, one write at a time. The changes on their way are drawn over one revision, moved on only
 * by this page's own writes; a change goes only when the settings read last are still that revision, with their ETag.
 * A write the core takes reads the settings again before its patch stops being drawn; a stale one (412, or another
 * writer's revision read before the next change goes) drops every change not sent yet, reads the settings again and
 * says so in one toast; a refused one puts the control back and keeps the reason under its row.
 */
export class SettingsEdits {
  private edits: Edit[] = [];
  private readonly errors = new Map<string, string>();
  private sending: Promise<void> = Promise.resolve();
  private generation = 0;
  private nextId = 1;
  private rolling = false;
  private asking = false;
  /** The revision the changes on their way are drawn over, and how many are on their way. */
  private basis: string | null = null;
  private pending = 0;
  version = 0;

  constructor(
    private readonly store: Store,
    private readonly actions: Pick<Actions, "note">,
    private readonly onChange: () => void,
  ) {}

  get view(): SettingsView | undefined {
    return this.store.get("settings");
  }

  get writable(): boolean {
    return this.view?.writable === true;
  }

  get rollingBack(): boolean {
    return this.rolling;
  }

  /** The one question before a rollback is open. */
  get askingRollback(): boolean {
    return this.asking;
  }

  askRollback(asking: boolean): void {
    this.asking = asking && this.writable && !this.rolling;
    this.notify();
  }

  /** The settings as the core holds them, with the changes on their way drawn over them. */
  settings(): Settings {
    return this.edits.reduce<Settings>((settings, edit) => mergePatch(settings, edit.patch), this.view?.settings ?? {});
  }

  error(key: string): string | undefined {
    return this.errors.get(key);
  }

  change(key: string, patch: SettingsPatch): void {
    if (!this.writable) return;
    const edit: Edit = { id: this.nextId++, key, patch };
    this.edits.push(edit);
    this.errors.delete(key);
    this.notify();
    const send = (revision: string) => this.store.write((source) => source.patchSettings(patch, revision), { refresh: false });
    void this.inTurn(key, send, () => {
      this.edits = this.edits.filter((each) => each.id !== edit.id);
    });
  }

  rollback(): Promise<void> {
    this.asking = false;
    if (!this.writable || this.rolling) return Promise.resolve();
    this.rolling = true;
    this.errors.delete(ROLLBACK_KEY);
    this.notify();
    return this.inTurn(ROLLBACK_KEY, (revision) => this.store.write((source) => source.rollbackSettings(revision), { refresh: false }), () => {}).then(() => {
      this.rolling = false;
      this.notify();
    });
  }

  /** One write after the ones before it, sent only while the settings read last are the revision it was drawn over. */
  private inTurn(key: string, send: (revision: string) => Promise<WriteResult<SettingsWritten>>, sent: () => void): Promise<void> {
    if (this.pending++ === 0) this.basis = this.view?.revision.id ?? null;
    const generation = this.generation;
    const run = async () => {
      try {
        if (generation !== this.generation) return;
        const revision = this.basis;
        if (revision === null || this.view?.revision.id !== revision) await this.stale();
        else await this.settle(key, await send(revision), sent);
        this.notify();
      } finally {
        this.pending -= 1;
      }
    };
    this.sending = this.sending.then(run, run);
    return this.sending;
  }

  private async settle(key: string, result: WriteResult<SettingsWritten>, sent: () => void): Promise<void> {
    if (result.ok) {
      this.basis = result.data.revision.id;
      await this.store.invalidate(SETTINGS_REVISED);
      sent();
    } else if (result.status === 412) {
      await this.stale();
    } else {
      sent();
      this.errors.set(key, settingsError(result));
    }
  }

  /** Every change not sent yet is dropped, the settings are read again, and one toast says so. */
  private async stale(): Promise<void> {
    this.generation += 1;
    this.edits = [];
    await this.store.invalidate(SETTINGS_REVISED);
    this.actions.note(W.settingsStale);
  }

  private notify(): void {
    this.version += 1;
    this.onChange();
  }
}

export const SettingsCtx = createContext<SettingsEdits | null>(null);

export function useSettingsEdits(): SettingsEdits {
  const value = useContext(SettingsCtx);
  if (!value) throw new Error("useSettingsEdits outside the app shell");
  return value;
}

export function useSettingsEditsFor(store: Store, actions: Pick<Actions, "note">): SettingsEdits {
  const [, setTick] = useState(0);
  return useMemo(() => new SettingsEdits(store, actions, () => setTick((value) => value + 1)), [store, actions]);
}
