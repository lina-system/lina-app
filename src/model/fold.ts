/**
 * Whether a comment's sentence can show as it is. A comment that would show a path, a command, a hash, an issue
 * number, an address or a cut-off fragment shows as one folded entry instead (the dashboard's rule for comment
 * rewrites, carried over as a rule: the same kinds of text the core refuses in its checked lines, lina#151).
 */
export type FoldReason = "path" | "command" | "hash" | "issue" | "address" | "fragment" | "latin";

/** Latin words the core's checked lines allow (hermes_cli/lina_board_plain.py ALLOWED_LATIN); any other is raw text. */
const ALLOWED_LATIN = new Set(["LINA", "Honcho", "GitHub", "macOS", "iPhone", "Telegram", "Codex"]);

const RULES: readonly (readonly [FoldReason, RegExp])[] = [
  ["address", /https?:|www\./i],
  ["issue", /(?<![0-9A-Za-z])(?:[\w.-]+\/[\w.-]+)?#\d+/],
  ["hash", /\b[0-9a-f]{7,40}\b/],
  ["path", /[\w-]\.[A-Za-z][A-Za-z0-9]{0,4}\b|[\w.-]+\/[\w.-]+|(?:^|[\s(])(?:~|\.{1,2})?\/[\w.-]|\\[\w.-]/],
  ["command", /`|(?:^|\s)--?[A-Za-z]|(?:^|\s)\$\s|\s(?:\||&&|>>?|<)\s/],
  ["fragment", /(?:…|\.\.\.)\s*$/],
];

/** An issue reference: `#123`, `lina#49`, `owner/repo#7`, `lina-app #131`. */
const ISSUE_REF = String.raw`(?<![0-9A-Za-z])(?:[\w.-]+\/[\w.-]+|[A-Za-z][\w.-]*|[a-z][\w.-]*\s)?#\d+`;
/** A card, goal or task id the hub writes into titles (lina-app#152): `t93`, `G106`, `T7`, `OT-12`, `t_586c9120`. */
const CARD_ID = String.raw`(?<![0-9A-Za-z_])(?:t\d+|[GT]\d+|OT-[A-Z]*\d+|t_[0-9a-f]+)(?![0-9A-Za-z_])`;
const HASH = String.raw`\b[0-9a-f]{7,40}\b`;
/** The particle glued to a ref (`<hash>로`, `#12를`): it goes with the ref, or the sentence keeps a stray particle. */
const PARTICLE = String.raw`(?:(?:으로|에서|까지|부터|로|를|을|이|가|은|는|와|과|의|에|도|만)(?![\p{Script=Hangul}]))?`;
const REF = String.raw`(?:${ISSUE_REF}|${CARD_ID}|${HASH})${PARTICLE}`;
/** A bot's stamp in brackets, its name and a clock time (`[이름 16:52]`). */
const STAMP = /\[[^\]]*\b\d{1,2}:\d{2}\b[^\]]*\]/g;
const HANGUL = /\p{Script=Hangul}/u;
const SEPARATORS = /[\s·,:;/+-]+/g;

/**
 * The text with its issue references, card and goal ids, commit hashes and bots' time stamps cut (lina-app#148, #152,
 * #156). Each ref goes with the particle glued to it; a bracket left with nothing readable (no Hangul, or one letter)
 * goes whole, and one left with words keeps them. Double spaces, empty brackets and the separators left at the ends
 * go too. Empty when nothing else was there.
 */
export function withoutRefs(text: string): string {
  const ref = new RegExp(REF, "gu");
  return text
    .replace(STAMP, " ")
    .replace(/\(([^()]*)\)/g, (whole, inner: string) => {
      if (!new RegExp(REF, "u").test(inner)) return whole;
      const left = inner.replace(ref, " ").replace(/\s+/g, " ").replace(/^[\s·,:;-]+|[\s·,:;-]+$/g, "");
      return HANGUL.test(left) && left.replace(SEPARATORS, "").length > 1 ? ` (${left}) ` : " ";
    })
    .replace(ref, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .replace(/\s+([,:;])/g, "$1")
    .replace(/^[\s·,:;-]+|[\s·,:;-]+$/g, "");
}

/**
 * Whether a title, its refs already cut, may be drawn on a row (lina-app#156): only one with no Hangul, or with a run
 * of three Latin words (an English sentence), is hidden. Product and tool names and short abbreviations (PR, QA, gh,
 * OCX) stay.
 */
export function titleMayDraw(title: string): boolean {
  if (!HANGUL.test(title)) return false;
  let run = 0;
  for (const word of title.split(/\s+/)) {
    run = /[A-Za-z]/.test(word) && !HANGUL.test(word) ? run + 1 : 0;
    if (run >= 3) return false;
  }
  return true;
}

export function foldReason(text: string): FoldReason | null {
  const body = text.trim();
  if (!body) return "fragment";
  for (const [reason, rule] of RULES) if (rule.test(body)) return reason;
  // An English word of three letters or more is raw text the screen never shows (the core's rule for its lines).
  const latin = (body.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).filter((word) => (word.match(/[A-Za-z]/g) ?? []).length >= 3 && !ALLOWED_LATIN.has(word));
  return latin.length ? "latin" : null;
}
