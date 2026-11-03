import type { RunCard } from "../api/client";

export type CardKind = "code" | "docs" | "research" | "device";

const DEVICE_WORDS = /백업|복구|기기|서버|디스크|저장소/;
const DOCS_WORDS = /노트|문서|가이드|공지|안내/;

/**
 * The kind of work a card does, for its icon. The client API has no kind field yet, so it is read from the
 * worker runs' mode (research) and then from the title's words; everything else is code.
 */
export function cardKind(title: string, runs: readonly Pick<RunCard, "kind">[]): CardKind {
  if (runs.some((run) => run.kind?.includes("research"))) return "research";
  if (DEVICE_WORDS.test(title)) return "device";
  if (DOCS_WORDS.test(title)) return "docs";
  return "code";
}
