import { timesInText } from "../time";
import { ROUND15_WORD } from "../words";

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
/** A commit hash, with the branch named before it (`dev <hash>`): a branch left alone reads as a stray word (lina-app#160). */
const HASH = String.raw`(?:\b(?:dev|main|master)\s+)?\b[0-9a-f]{7,40}\b`;
/** Mixed-case names the screens keep: a camelCase rule would cut them otherwise. */
const CAMEL_NAMES = ["macOS", "iPhone", "iPad", "iOS"];
/**
 * Code-looking tokens a hub title carries (lina-app#160): dotted paths holding a snake or camel name (`a.b_c`,
 * `Record.cardId`), snake_case and UPPER_SNAKE names (`board_lines`, `LINA_KEY`), camelCase names (`apiKeyHelper`), and
 * card numbering (`card 3`, `표지 카드 8`). File names (`notes/a.md`), hyphenated tool names (`omo-task`) and product
 * names stay.
 */
const CODE = String.raw`(?:(?<![0-9A-Za-z_./-])(?:(?=[\w.]*(?:_|[a-z][A-Z]))[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+|_*[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+|(?!(?:${CAMEL_NAMES.join("|")})(?![A-Za-z0-9]))[a-z]+[A-Z][A-Za-z0-9]*)(?![0-9A-Za-z_])|(?:(?:표지\s*)?카드|\b[Cc]ard)\s*\d+(?![\d\p{Script=Hangul}]))`;
/** The particle glued to a ref (`<hash>로`, `#12를`): it goes with the ref, or the sentence keeps a stray particle. */
const PARTICLE = String.raw`(?:(?:으로|에서|까지|부터|로|를|을|이|가|은|는|와|과|의|에|도|만)(?![\p{Script=Hangul}]))?`;
const REF = String.raw`(?:${ISSUE_REF}|${CARD_ID}|${HASH}|${CODE})${PARTICLE}`;
/** A bot's stamp in brackets, its name and a clock time (`[이름 16:52]`). */
const STAMP = /\[[^\]]*\b\d{1,2}:\d{2}\b[^\]]*\]/g;
const HANGUL = /\p{Script=Hangul}/u;
const SEPARATORS = /[\s·,:;/+-]+/g;

/**
 * The punctuation a cut leaves behind, collapsed (lina-app#160): empty quotes and brackets (`""`, `()`, `[ · ]`), a run
 * of separators (`,,`, `· · ·`, `: ,`) down to its first, a separator just inside a bracket, double spaces, a space
 * before a comma, and any separator or dash left at either end. The one place every fold of a hub sentence tidies.
 */
export function tidyFoldedText(text: string): string {
  let out = text.replace(/(["'`\u201c\u2018])\s*(["'`\u201d\u2019])/g, " ");
  for (let before = ""; before !== out; ) {
    before = out;
    out = out
      .replace(/[([]\s*[·,:;]*\s*[)\]]/g, " ")
      .replace(/([([])\s*[·,:;]+/g, "$1")
      .replace(/[·,:;]+\s*([)\]])/g, "$1")
      .replace(/(\s*)([·,:;])(?:\s*[·,:;])+/g, "$1$2");
  }
  return out
    .replace(/([([])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+([,:;])/g, "$1")
    .replace(/^[\s·,:;\-\u2013\u2014]+|[\s·,:;\-\u2013\u2014]+$/g, "");
}

/**
 * The text with its issue references, card and goal ids, commit hashes, code-looking names and bots' time stamps cut
 * (lina-app#148, #152, #156, #160). Each ref goes with the particle glued to it; a bracket left with nothing readable
 * (no Hangul, or one letter) goes whole, and one left with words keeps them. The debris left goes too (tidyFoldedText).
 * Empty when nothing else was there.
 */
export function withoutRefs(text: string): string {
  const ref = new RegExp(REF, "gu");
  return tidyFoldedText(
    text
      .replace(STAMP, " ")
      .replace(/\(([^()]*)\)/g, (whole, inner: string) => {
        if (!new RegExp(REF, "u").test(inner)) return whole;
        const left = tidyFoldedText(inner.replace(ref, " "));
        return HANGUL.test(left) && left.replace(SEPARATORS, "").length > 1 ? ` (${left}) ` : " ";
      })
      .replace(ref, " "),
  );
}

/**
 * A Latin word with what it holds but Hangul (`gate-check`, `notes/a.md`, `9AB`), the particle glued after it and a
 * `·` glued before it.
 */
const LATIN_WORD = String.raw`·?(?<![A-Za-z0-9_])[\w.\-/]*[A-Za-z][\w.\-/]*${PARTICLE}`;

/**
 * The text with its Latin words cut, each with the particle glued to it, and the debris left tidied (tidyFoldedText,
 * and an arrow left at either end): the looser reading of a finished card's own title the row rule refuses (lina-app#214).
 */
export function withoutLatin(text: string): string {
  return tidyFoldedText(text.replace(new RegExp(LATIN_WORD, "gu"), " ")).replace(/^→\s*|\s*→$/g, "");
}

/** A Korean particle standing as its own word: a ref written apart from its particle (`t_e6e0f90a 가`) leaves it alone. */
const LONE_PARTICLE = String.raw`(?:으로|에서|까지|부터|이라|라고|가|은|는|을|를|라|로|와|과|도|의|만|에)(?=[\s.,!?。]|$)`;
/** A particle's two forms, after a noun with a final consonant and after one without (을/를, 이/가, 은/는, 과/와, 이라/라). */
const PARTICLE_FORMS: readonly (readonly [string, string])[] = [
  ["을", "를"],
  ["이", "가"],
  ["은", "는"],
  ["과", "와"],
  ["으로", "로"],
  ["이라고", "라고"],
  ["이라", "라"],
];

/** The particle in the form the noun before it takes: `항목으로`, `파일로` (ㄹ takes 로), `폴더를`. */
export function withParticle(noun: string, particle: string): string {
  const code = noun.charCodeAt(noun.length - 1) - 0xac00;
  const coda = code >= 0 && code < 11172 ? code % 28 : 0;
  const pair = PARTICLE_FORMS.find((forms) => forms.includes(particle));
  if (!pair) return noun + particle;
  const consonant = pair[0] === "으로" ? coda !== 0 && coda !== 8 : coda !== 0;
  return noun + (consonant ? pair[0] : pair[1]);
}

/** The ids a ref is made of, each alone: an issue, a card, goal or to-do id, a hash, a code-looking name. */
const REF_NAME = String.raw`(?:${ISSUE_REF}|${CARD_ID}|${HASH}|${CODE})`;

/**
 * What kind of thing a name a person does not read names (ROUND15_WORD.nameKind), said where it stood (lina-app#207); null
 * for a time of day, which has no noun to stand in.
 */
export function nameKind(name: string): string | null {
  const kind = ROUND15_WORD.nameKind;
  const core = name.replace(/^[`'"\u201c\u2018]+|[`'"\u201d\u2019]+$/g, "");
  const whole = (pattern: string) => new RegExp(`^(?:${pattern})$`, "u").test(core);
  if (/^\d{1,2}:\d{2}/.test(core)) return null;
  if (whole(ISSUE_REF)) return kind.issue;
  if (/^G\d+$/.test(core)) return kind.goal;
  if (/^T\d+$/.test(core)) return kind.todo;
  if (whole(CARD_ID) || /^(?:(?:표지\s*)?카드|[Cc]ard)\s*\d+$/u.test(core)) return kind.card;
  if (whole(HASH)) return kind.commit;
  if (core.includes("=")) return kind.value;
  const reason = foldReason(core);
  if (reason === "address") return kind.address;
  if (reason === "path" || core.endsWith("/")) return /\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(core) ? kind.file : kind.folder;
  return kind.item;
}

/**
 * A ref inside a sentence with its particle written apart (`152번 a_b 로`), as the kind of thing it names with that
 * particle (`152번 항목으로`, lina-app#207): the sentence keeps its meaning and no particle stands alone. A ref that opens
 * the sentence has no words of its own around it: withoutRefs and leftAsDebris take that sentence whole.
 */
function withKinds(sentence: string): string {
  const named = new RegExp(String.raw`(?<=\S\s+)([\u0060'"]?)(${REF_NAME})\1\s+(${LONE_PARTICLE})`, "gu");
  return sentence.replace(named, (whole: string, _quote: string, name: string, particle: string) => {
    const noun = nameKind(name);
    return noun ? withParticle(noun, particle) : whole;
  });
}

/** A label: a word ending in `:` before a space or the end (`주소:`, never the `http:` of an address). */
const LABEL = /\S+:(?=\s|$)/g;

/** A field value that held refs or fold markers and nothing else once they are cut: `✅` or `네` never counts. */
function fieldEmptied(value: string): boolean {
  if (/…|\.\.\./.test(value) && ONLY_FOLD_MARKERS.test(value)) return true;
  // What a cut ref leaves of the sentence end (`a1b2c3d.` leaves `.`) is not a value either.
  return new RegExp(REF, "u").test(value) && !withoutRefs(value).replace(/[\s.,;:·!?。\-]+/g, "");
}

/**
 * The sentence without its labelled fields whose value was nothing but refs (`커밋: a1b2c3d`): the label alone says
 * nothing. A field with words in it stays, and so does every other field of the sentence. Null when such a label sits
 * inside a phrase rather than starting a field: that sentence is debris whole (lina-app#161).
 */
function withoutEmptyFields(whole: string): string | null {
  // The sentence end belongs to the sentence, not to its last field: it stays when that field goes.
  const end = /[.!?。]+\s*$/.exec(whole)?.[0].trim() ?? "";
  const sentence = end ? whole.slice(0, whole.lastIndexOf(end)) : whole;
  const labels = [...sentence.matchAll(LABEL)];
  let out = sentence;
  let cut = false;
  for (const [index, label] of [...labels.entries()].reverse()) {
    const fieldEnd = labels[index + 1]?.index ?? sentence.length;
    const value = sentence.slice(label.index + label[0].length, fieldEnd);
    if (!value.trim() || !fieldEmptied(value)) continue;
    // A label standing inside a phrase (`되돌릴 커밋: <hash>`) has no field of its own to cut: the sentence goes.
    if (!/(?:^|[,;·.!?。/+-])\s*$/.test(sentence.slice(0, label.index))) return null;
    out = out.slice(0, label.index) + " " + out.slice(fieldEnd);
    cut = true;
  }
  if (!cut) return whole;
  const kept = out.replace(/[\s·,:;\-\u2013\u2014]+$/, "");
  return kept && end ? kept + end : kept;
}

/** A sentence of nothing but the hub's fold markers (`(…)`, `…`, `...`) and the brackets and separators around them. */
const ONLY_FOLD_MARKERS = /^[\s()[\]….,·:;]*$/;

/**
 * Whether what withoutRefs left of a sentence is debris (lina-app#161): a particle the cut ref stood before, or one
 * bare word with no sentence end where more words stood. A sentence that lost no ref is never debris.
 */
function leftAsDebris(sentence: string, cut: string): boolean {
  if (cut === tidyFoldedText(sentence)) return false;
  if (!cut) return true;
  if (new RegExp(`(?:${REF})\\s+${LONE_PARTICLE}`, "u").test(sentence)) return true;
  return (!/\s/.test(cut) && !/[.!?。]$/.test(cut) && /\s/.test(sentence.trim())) || readsBroken(cut);
}

/** A start inside another sentence: a closing quote or bracket, a separator, or a particle alone (never `만 원`). */
const STARTS_INSIDE = new RegExp(String.raw`^(?:[.,:;·…|)\]}\-\u2013\u2014]|['"\u2019\u201d](?:\s|$)|(?!만\s)${LONE_PARTICLE})`, "u");
/** An end outside a sentence: a separator, an opening bracket or a particle alone, with or without the hub's `…`. */
const ENDS_OUTSIDE = new RegExp(String.raw`(?:[|·,:;/+\-\u2013\u2014([{]|\s${LONE_PARTICLE})\s*(?:…|\.\.\.)?$`, "u");
/** Punctuation standing alone (` , `) or doubled where a cut word stood (`,.`, `:,`); an ellipsis is no double. */
const LONE_PUNCTUATION = /[,:;][.,:;]|\.[,:;]|(?:^|\s)[.,:;|]+(?=\s|$)/;
/** A bracket pair with nothing readable inside (`()`, `(…)`, `[ , ]`). */
const EMPTY_BRACKET = /[([{][^\p{L}\p{N}]*[)\]}]/u;

const count = (text: string, mark: string) => text.split(mark).length - 1;

/**
 * Whether a sentence no longer reads as one once cleaned (lina-app#197): an empty bracket pair or a bracket left open or
 * closed alone, punctuation standing alone or doubled, a separator or a particle alone at either end, or a start inside
 * a clause (a closing quote, a particle). Every history and comment line is drawn only from a sentence that does not
 * (firstSentence, foldedText); a lower-case English word is no word of a history line either (firstSentence).
 */
export function readsBroken(sentence: string): boolean {
  const text = sentence.trim();
  if (!text || EMPTY_BRACKET.test(text) || LONE_PUNCTUATION.test(text) || STARTS_INSIDE.test(text) || ENDS_OUTSIDE.test(text)) return true;
  return count(text, "(") !== count(text, ")") || count(text, "[") !== count(text, "]");
}

/**
 * A comment or history text as the screens show it (lina-app#161): each sentence through withoutRefs, and a sentence
 * left as debris (leftAsDebris) dropped whole, an empty labelled field cut alone (withoutEmptyFields), so `가 맡는다`,
 * `범위 라 …` or a bare `주소` never shows. A sentence of only fold markers goes too. Empty when nothing is left. List titles keep withoutRefs alone: a row never loses its whole title.
 */
export function foldedText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?。])\s+/)
        .map((whole) => {
          if (/…|\.\.\./.test(whole) && ONLY_FOLD_MARKERS.test(whole)) return "";
          const fields = withoutEmptyFields(whole);
          if (fields === null) return "";
          const sentence = withKinds(fields);
          // Its ISO times read as every time on the screens once the refs go, so a cut key leaves no `=` (lina-app#207).
          const cut = timesInText(withoutRefs(sentence));
          return leftAsDebris(timesInText(sentence), cut) ? "" : cut;
        })
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join("\n");
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
