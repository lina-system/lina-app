import { WORK_ONLY } from "../mode";
import { APP_VERSION } from "../version";
import { HttpSource } from "./http-source";
import type { Source } from "./source";

/** One route as the store last read it: its answer and when it landed. */
export interface StoredRoute {
  readonly data: unknown;
  readonly receivedAt?: number;
}

/**
 * The store's last good routes and the change stream's cursor they are current at (lina-app#194): the routes hold
 * everything the stream sent up to the cursor, never less, so resuming from it misses nothing. `owner` is the
 * signed-in owner the routes belong to.
 */
export interface StoredSnapshot {
  readonly cursor: string;
  readonly owner: string | null;
  readonly routes: Readonly<Record<string, StoredRoute>>;
}

/** The copy of the store kept on this device, for one core and its owner. */
export interface StoredCopy {
  load(): StoredSnapshot | null;
  save(snapshot: StoredSnapshot): void;
  clear(): void;
}

/** The shape of the kept copy; a copy of another shape, or written by another app version, is dropped unread. */
export const STORED_FORMAT = 1;
/** The kept copy's largest size in characters; a store that would write more keeps nothing (web storage holds about 5 M). */
export const STORED_MAX_CHARS = 2_000_000;

export type StoredMode = "work" | "full";

interface Kept extends StoredSnapshot {
  readonly format: number;
  readonly app: string;
  /** Absent on copies written before work-only existed; those are the full app. */
  readonly mode?: StoredMode;
}

export function storedMode(workOnly: boolean = WORK_ONLY): StoredMode {
  return workOnly ? "work" : "full";
}

/** One key per core: the page's origin and the core's base path. A work-only install has its own key, so switching dist does not restore the other product's lists. */
export function storedKey(origin: string, basePath: string, workOnly: boolean = WORK_ONLY): string {
  const key = `lina-app:stored:${origin}${basePath}`;
  return workOnly ? `${key}:work` : key;
}

export interface StoredOptions {
  /** The device's web storage; reading it can throw (a private window, storage turned off). */
  readonly storage?: () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readonly origin?: string;
  readonly basePath?: string;
  readonly app?: string;
  /** When set, this copy is for that product; otherwise the build's `WORK_ONLY` flag. */
  readonly workOnly?: boolean;
}

/**
 * The kept copy for the screens' source, or none: only the core's own HTTP source is kept, never the synthetic scene
 * or a test's source. Every storage call may fail (quota, private mode, storage turned off); a failure keeps nothing
 * and the app reads the core as it would without a copy.
 */
export function storedCopy(source: Source, options: StoredOptions = {}): StoredCopy | null {
  if (!(source instanceof HttpSource)) return null;
  const storage = options.storage ?? (() => window.localStorage);
  const workOnly = options.workOnly ?? WORK_ONLY;
  const mode = storedMode(workOnly);
  const key = storedKey(options.origin ?? window.location.origin, options.basePath ?? source.basePath, workOnly);
  const app = options.app ?? APP_VERSION;
  const remove = () => {
    try {
      storage().removeItem(key);
    } catch {
      // Storage that cannot be reached holds nothing to remove.
    }
  };
  return {
    load() {
      let kept: Partial<Kept> | null;
      try {
        const text = storage().getItem(key);
        kept = text === null ? null : (JSON.parse(text) as Partial<Kept>);
      } catch {
        // Unreadable storage or a broken copy: no copy, a full read.
        remove();
        return null;
      }
      if (kept === null) return null;
      const keptMode: StoredMode = kept.mode === "work" ? "work" : "full";
      if (kept.format !== STORED_FORMAT || kept.app !== app || keptMode !== mode || typeof kept.cursor !== "string" || typeof kept.routes !== "object" || kept.routes === null) {
        remove();
        return null;
      }
      return { cursor: kept.cursor, owner: typeof kept.owner === "string" ? kept.owner : null, routes: kept.routes };
    },
    save(snapshot) {
      const text = JSON.stringify({ format: STORED_FORMAT, app, mode, ...snapshot } satisfies Kept);
      if (text.length > STORED_MAX_CHARS) {
        remove();
        return;
      }
      try {
        storage().setItem(key, text);
      } catch {
        // Full or refused: an older copy is still consistent, but it would only grow staler, so none is kept.
        remove();
      }
    },
    clear: remove,
  };
}
