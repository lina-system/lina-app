import { plainText } from "./plain";
import { BANNED_WORDS, STATE_WORDS, W } from "../words";

/**
 * Whether a comment's sentence can show as it is. A comment that would show a path, a command, a hash, an issue
 * number, an address or a cut-off fragment shows as one folded entry instead (the dashboard's rule for comment
 * rewrites, carried over as a rule: the same kinds of text the core refuses in its checked lines, lina#151).
 */
export type FoldReason = "path" | "command" | "hash" | "issue" | "address" | "fragment" | "latin";

/** Latin words the core's checked lines allow (hermes_cli/lina_board_plain.py ALLOWED_LATIN); any other is raw text. */
const ALLOWED_LATIN = new Set(["LINA", "Honcho", "GitHub", "macOS", "iPhone", "Telegram", "Codex"]);

/** The particles a ref or a bracket carries glued after it (`<hash>로`, `#12를`, `(…)을`). */
const PARTICLES = "으로|에서|까지|부터|로|를|을|이|가|은|는|와|과|의|에|도|만";
/**
 * A run of seven digits or more: a hash with no letter in it (lina-app#228), unless a unit is glued after it (`12345678원`,
 * `1234567건`; a particle is no unit) or a thousands comma (`1234567,890`), which make it a number (lina-app#230).
 */
const DIGIT_HASH = String.raw`(?<![\d.,])\d{7,}(?!\d|\.\d|,\d{3}(?!\d)|(?!(?:${PARTICLES})(?!\p{Script=Hangul}))\p{Script=Hangul})`;

const RULES: readonly (readonly [FoldReason, RegExp])[] = [
  ["address", /https?:|www\./i],
  ["issue", /(?<![0-9A-Za-z])(?:[\w.-]+\/[\w.-]+)?#\d+/],
  ["hash", new RegExp(String.raw`\b(?=[0-9]*[a-f])[0-9a-f]{7,40}\b|${DIGIT_HASH}`, "u")],
  ["path", /[\w-]\.[A-Za-z][A-Za-z0-9]{0,4}\b|[\w.-]+\/[\w.-]+|(?:^|[\s(])(?:~|\.{1,2})?\/[\w.-]|\\[\w.-]/],
  ["command", /`|(?:^|\s)--?[A-Za-z]|(?:^|\s)\$\s|\s(?:\||&&|>>?|<)\s/],
  ["fragment", /(?:…|\.\.\.)\s*$/],
];

/** An issue reference: `#123`, `lina#49`, `owner/repo#7`, `lina-app #131`. */
const ISSUE_REF = String.raw`(?<![0-9A-Za-z])(?:[\w.-]+\/[\w.-]+|[A-Za-z][\w.-]*|[a-z][\w.-]*\s)?#\d+`;
/** A card, goal or task id the hub writes into titles (lina-app#152): `t93`, `G106`, `T7`, `OT-12`, `t_586c9120`. */
const CARD_ID = String.raw`(?<![0-9A-Za-z_])(?:t\d+|[GT]\d+|OT-[A-Z]*\d+|t_[0-9a-f]+)(?![0-9A-Za-z_])`;
/**
 * A commit hash, with the branch named before it (`dev <hash>`): a branch left alone reads as a stray word (lina-app#160). A run
 * of digits only is a hash by the same rule the sentence gate uses (DIGIT_HASH): a number with a unit glued is no hash (lina-app#233 review).
 */
const HASH = String.raw`(?:\b(?:dev|main|master)\s+)?(?:\b(?=[0-9]*[a-f])[0-9a-f]{7,40}\b|${DIGIT_HASH})`;
/** Mixed-case names the screens keep: a camelCase rule would cut them otherwise. */
const CAMEL_NAMES = ["macOS", "iPhone", "iPad", "iOS"];
/**
 * Code-looking tokens a hub title carries (lina-app#160): dotted paths holding a snake or camel name (`a.b_c`,
 * `Record.cardId`), snake_case and UPPER_SNAKE names (`board_lines`, `LINA_KEY`), camelCase names (`apiKeyHelper`), and
 * card numbering (`card 3`, `표지 카드 8`). File names (`notes/a.md`), hyphenated tool names (`omo-task`) and product
 * names stay.
 */
const CODE = String.raw`(?:(?<![0-9A-Za-z_./-])(?:(?=[\w.]*(?:_|[a-z][A-Z]))[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+|_*[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+|(?!(?:${CAMEL_NAMES.join("|")})(?![A-Za-z0-9]))[a-z]+[A-Z][A-Za-z0-9]*)(?![0-9A-Za-z_])|(?:(?:표지\s*)?카드|\b[Cc]ard)\s*\d+(?![\d\p{Script=Hangul}]))`;
/** The particle glued to a ref: it goes with the ref, or the sentence keeps a stray particle. */
const PARTICLE = String.raw`(?:(?:${PARTICLES})(?![\p{Script=Hangul}]))?`;
/** A ref, a call's empty brackets after a code name (`fake_owner()`) and the particle glued to it. */
const REF = String.raw`(?:${ISSUE_REF}|${CARD_ID}|${HASH}|${CODE})(?:\(\))?${PARTICLE}`;
/** A bot's stamp in brackets, its name and a clock time (`[이름 16:52]`). */
const STAMP = /\[[^\]]*\b\d{1,2}:\d{2}\b[^\]]*\]/g;
const HANGUL = /\p{Script=Hangul}/u;
const SEPARATORS = /[\s·,:;/+-]+/g;

/**
 * Where a cut took a token (CUT), and where it took one with the particle glued to it (NOUN_CUT: the token was a noun of
 * the sentence, `<hash>로`). Only cutLeavesHole reads them; they are spaces before any text is tidied.
 */
const CUT = "\uE000";
const NOUN_CUT = "\uE001";
const CUTS = /[\uE000\uE001]/g;

/** The mark a cut token leaves: NOUN_CUT when the particle glued to it went with it, else CUT. */
function cutMark(token: string): string {
  return /\p{Script=Hangul}$/u.test(token) ? NOUN_CUT : CUT;
}

/** A word that only modifies the noun after it: a determiner (`새`, `모든`, `이`) or a verb's modifier form (`노출된`, `있는`). */
const MODIFIER = String.raw`(?:^|[\s(])(?:새|헌|옛|각|모든|온갖|여러|이|그|저|이런|그런|저런|어떤|무슨|다른|몇|\p{Script=Hangul}*(?:된|될|던|하는|되는|있는|없는|같은))`;
/** A cut at the end of a sentence or a bracket, with only its end mark after it. */
const CUT_AT_END = String.raw`[\uE000\uE001](?:\s*[\uE000\uE001])*\s*(?:[.!?。)\]]|$)`;
const NOUN_GONE = new RegExp(String.raw`${MODIFIER}\s*(?:\uE000\s*)*(?:\uE001|${CUT_AT_END}|[\uE000\uE001]\s*[~/↔→=+&·,])`, "u");
/** A word that ends on the particle of an object or a topic (`판은`, `빌드를`) with the cut that was its predicate after it. */
const PREDICATE_GONE = new RegExp(String.raw`\p{Script=Hangul}(?:은|는|을|를|에서|으로)\s*${CUT_AT_END}`, "u");
/** A run of cuts, spaces and joining marks between two words; a pair mark joins two ends, `·` one list item to the next. */
const JOINED_RUN = /[\s·~/↔→=+&\uE000\uE001]+/g;
const PAIR_MARK = /[~/↔→=+&]/g;
/**
 * A cut between a separator (or the start) and a bracket that holds Hangul words and has words after it: the bracket
 * was an aside on the cut token, now on nothing (a bracket the cut emptied goes with it). One that ends the text reads as the colon's aside (tidyFoldedText: `반영: (앞)` reads `반영 (앞)`).
 */
const ASIDE_GONE = /(?:^|[:;,·])\s*[\uE000\uE001](?:\s*[\uE000\uE001])*\s*[([][^()[\]]*\p{Script=Hangul}[^()[\]]*[)\]](?!\s*[.!?。]?\s*$)/u;
const CUT_FIRST = /^\s*[\uE000\uE001]/;
const CUT_LAST = /[\uE000\uE001]\s*$/;

/**
 * Whether a cut left a hole in a sentence (lina-app#218), read on the sentence with its cuts marked (CUT, NOUN_CUT): a
 * modifier whose noun was cut (`더 새 <hash>로 충족됨`), a topic or an object whose predicate was cut (`새 판은 <hash>.`),
 * or, between two words, a pair mark that lost an end to a cut (cut on both sides, `#12 ↔ t_1`; glued to a cut,
 * `#12~#14는`, `7봇+<name>`; or with only a cut after it to the end, `(값 = <hash>)`) or a list's `·` beside a cut noun
 * (`#12·#13과 파일이`), or a bracket that was an aside on a token cut from between a separator (or the start) and it, so it
 * would open the clause (`손보기: <ref>(지난 판) 이후`, lina-app#228). A cut at either end of a list, a clause after a spaced pair mark that opens on a cut name
 * (`갱신 + <name> 릴레이 교체`), a ref cut from beside a word it names (`커밋 <hash> 반영`) and a bracket the cut took whole
 * leave none. The rule the title cuts follow (withoutRefs, withoutLatin): a title with one is drawn by none of them. No
 * history line or comment is cut at all (unitMayShow, lina-app#226, #241).
 */
function cutLeavesHole(marked: string): boolean {
  if (!/[\uE000\uE001]/.test(marked)) return false;
  if (NOUN_GONE.test(marked) || PREDICATE_GONE.test(marked) || ASIDE_GONE.test(marked)) return true;
  // A key's `=` goes with the key cut before it (`fake_until=<time>`): it joins nothing.
  const joined = marked.replace(/\uE000=/g, CUT);
  for (const run of joined.matchAll(JOINED_RUN)) {
    const end = run.index + run[0].length;
    if (run.index === 0 || end === joined.length || !/[\uE000\uE001]/.test(run[0])) continue;
    if (run[0].includes("·") && run[0].includes(NOUN_CUT)) return true;
    const toEnd = /^[.!?。)\]]*$/.test(joined.slice(end));
    for (const mark of run[0].matchAll(PAIR_MARK)) {
      const before = run[0].slice(0, mark.index);
      const after = run[0].slice(mark.index + 1);
      const glued = /[\uE000\uE001]$/.test(before) || /^[\uE000\uE001]/.test(after);
      if (glued || (CUT_LAST.test(before) && CUT_FIRST.test(after)) || (CUT_FIRST.test(after) && toEnd)) return true;
    }
  }
  return false;
}

/** What a cut left of a text, its cuts marked: tidied (tidyFoldedText), or empty when the cut left a hole (cutLeavesHole). */
function afterCut(marked: string): string {
  return cutLeavesHole(marked) ? "" : tidyFoldedText(marked.replace(CUTS, " "));
}

/**
 * The punctuation a cut leaves behind, collapsed (lina-app#160): empty quotes and brackets (`""`, `()`, `[ · ]`), a run
 * of separators (`,,`, `· · ·`, `: ,`) down to its first, a separator just inside a bracket, double spaces, a space
 * before a comma or the sentence end, and any separator or dash left at either end. An emptied bracket with a particle glued after it gives
 * the particle to the word before it (`관문(…)을` reads `관문을`: the bracket was an aside on that word, lina-app#218), and a
 * colon with only a bracket after it goes (`반영: (앞)` reads `반영 (앞)`). What the title cuts leave, tidied.
 */
function tidyFoldedText(text: string): string {
  let out = text.replace(/(["'`\u201c\u2018])\s*(["'`\u201d\u2019])/g, " ");
  for (let before = ""; before !== out; ) {
    before = out;
    out = out
      .replace(EMPTY_BEFORE_PARTICLE, "")
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
    .replace(/\s+([.!?。]+)$/, "$1")
    .replace(/:\s*(?=[([][^()[\]]*[)\]][.!?。]?$)/, " ")
    .replace(/^[\s·,:;\-\u2013\u2014]+|[\s·,:;\-\u2013\u2014]+$/g, "");
}

/** A word that only leans on the refs beside it in a bracket (`lina#456 뒷일`, `#12 관련 건`): it names nothing once they are cut (lina-app#246). */
const LEANS_ON_REF = /^(?:뒷일|후속|관련|건)$/u;

/** An emptied bracket, the spaces before it, and the particle glued after it ahead. */
const EMPTY_BEFORE_PARTICLE = new RegExp(String.raw`\s*[([]\s*[·,:;]*\s*[)\]](?=(?:${PARTICLES})(?![\p{Script=Hangul}]))`, "gu");

/**
 * The text with its issue references, card and goal ids, commit hashes, code-looking names and bots' time stamps cut
 * (lina-app#148, #152, #156, #160). Each ref goes with the particle glued to it; a bracket left with nothing readable
 * (no Hangul, or one letter), with only words that leaned on its refs (LEANS_ON_REF, lina-app#246) or with a hole
 * (cutLeavesHole) goes whole, and one left with words keeps them where they stood. The debris left goes too (tidyFoldedText). Empty when nothing else was there, or when the cut left the text a
 * hole (lina-app#218).
 */
export function withoutRefs(text: string): string {
  const ref = new RegExp(REF, "gu");
  return afterCut(
    text
      .replace(STAMP, " ")
      .replace(/\(([^()]*)\)/g, (whole, inner: string) => {
        if (!new RegExp(REF, "u").test(inner)) return whole;
        const left = afterCut(`(${inner.replace(ref, cutMark)})`).replace(/^\(|\)$/g, "");
        // An emptied bracket stays `()` until tidied, so the particle glued after it finds its word (lina-app#218).
        const words = left.split(SEPARATORS).filter(Boolean);
        return HANGUL.test(left) && left.replace(SEPARATORS, "").length > 1 && !words.every((word) => LEANS_ON_REF.test(word)) ? `(${left})` : "()";
      })
      .replace(ref, cutMark),
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
 * Empty when the cut left a hole (cutLeavesHole, lina-app#218).
 */
export function withoutLatin(text: string): string {
  return afterCut(text.replace(new RegExp(LATIN_WORD, "gu"), cutMark)).replace(/^→\s*|\s*→$/g, "");
}

/** A Korean particle standing as its own word: a ref written apart from its particle (`t_e6e0f90a 가`) leaves it alone. */
const LONE_PARTICLE = String.raw`(?:으로|에서|까지|부터|이라|라고|가|은|는|을|를|라|로|와|과|도|의|만|에)(?=[\s.,!?。]|$)`;
/** A start inside another sentence: a closing quote or bracket, a separator, a range's tail (`~26초`), an arrow, or a particle alone (never `만 원`). */
const STARTS_INSIDE = new RegExp(String.raw`^(?:[.,:;·…|)\]}~\-\u2013\u2014→]|['"\u2019\u201d](?:\s|$)|(?!만\s)${LONE_PARTICLE})`, "u");
/** An end outside a sentence: a separator, an opening bracket or a particle alone, with or without the hub's `…`. */
const ENDS_OUTSIDE = new RegExp(String.raw`(?:[|·,:;/+\-\u2013\u2014([{]|\s${LONE_PARTICLE})\s*(?:…|\.\.\.)?$`, "u");
/** Punctuation standing alone (` , `) or doubled where a cut word stood (`,.`, `:,`); an ellipsis is no double. */
const LONE_PUNCTUATION = /[,:;][.,:;]|\.[,:;]|(?:^|\s)[.,:;|]+(?=\s|$)/;
/** A bracket pair with nothing readable inside (`()`, `(…)`, `[ , ]`). */
const EMPTY_BRACKET = /[([{][^\p{L}\p{N}]*[)\]}]/u;
/** A number with at most a short unit after it and nothing else (`2.`, `5초.`, `(3)`): a list's number or a number's tail. */
const NUMBER_ALONE = /^\(?\d+(?:[.,]\d+)*\)?\s*\p{Script=Hangul}{0,2}[.!?。…]*$/u;
/**
 * A particle with a space before it, its noun gone (`파일 를 고쳤다`). 이, 가, 도, 만 and 에 are words of their own too (`이
 * 카드`, `오늘 가 볼`): they are a hole only before the end of a clause.
 */
const PARTICLE_APART = /\s(?:(?:으로|에서|을|를|은|는|의|로|와|과)(?=[\s.,!?。:;)…]|$)|(?:이|가|도|만|에)(?=[.,!?。:;)…]|$))/u;
/** A modifier with no noun after it, at the end of a clause (`설정은 노출된.`, `묶음은 이.`). */
const MODIFIER_ALONE = new RegExp(String.raw`${MODIFIER}\s*(?:[.,!?。:;)…]|$)`, "u");
/** A Latin letter (an English word, a product name, a round label `S2`, a code `rc 0`), a ref's `#12`, or a DIGIT_HASH. */
const LATIN_OR_CODE = new RegExp(String.raw`[A-Za-z]|#\d|${DIGIT_HASH}`, "u");

const count = (text: string, mark: string) => text.split(mark).length - 1;

/**
 * A list's mark (`1)`, `2)` with a space after it), or a round bracket. The mark is no bracket of the text unless it
 * closes one opened before it (`가짜 묶음(항목 각 6) 기준`, lina-app#244).
 */
const LIST_PAREN = /((?<!\S)\d{1,2}\)(?=\s))|[()]/gu;

/** Whether every round bracket the text opens it also closes, a list's mark closing none it did not open. */
function parensClose(text: string): boolean {
  let opened = 0;
  let closed = 0;
  for (const [paren, mark] of text.matchAll(LIST_PAREN)) {
    if (paren === "(") opened += 1;
    else if (!mark || opened > closed) closed += 1;
  }
  return opened === closed;
}

/** Whether every bracket and quote the text opens it also closes. */
function closes(text: string): boolean {
  return parensClose(text) && count(text, "[") === count(text, "]") && count(text, "\u201c") === count(text, "\u201d") && count(text, "\u2018") === count(text, "\u2019") && count(text, '"') % 2 === 0 && count(text, "'") % 2 === 0;
}

/**
 * The checks a sentence passes to be drawn (lina-app#197, #222): every title (index.ts: cleanTitle, finishedTitle,
 * plainLine), and every text the one gate reads (unitMayShow, lina-app#241). It fails a sentence that (a) starts
 * inside another one (a separator, a closing quote, a particle alone, a bare number with its unit, a list's number),
 * (b) ends open (`:`, `|`, a separator, a particle alone, a bracket or quote left open or closed alone), (c) has a hole
 * (an empty bracket, punctuation alone or doubled, a particle apart from its noun, a modifier with no noun), (d) holds a
 * Latin letter, a ref or a digits-only hash (`PR`, a product name, `S2`, `D1~D7`, `rc 0`, `#12`, `4815162342`), or has
 * no Hangul.
 */
export function sentenceMayShow(sentence: string): boolean {
  // A list's number before the sentence is no part of it (`1) 가상 설정이 돌았다.`, `2. 빌드 통과.`).
  const text = sentence.trim().replace(/^\(?\d{1,2}[.)]\s+/, "");
  if (!HANGUL.test(text) || LATIN_OR_CODE.test(text) || NUMBER_ALONE.test(text)) return false;
  if (STARTS_INSIDE.test(text) || ENDS_OUTSIDE.test(text) || EMPTY_BRACKET.test(text) || LONE_PUNCTUATION.test(text)) return false;
  return !PARTICLE_APART.test(text) && !MODIFIER_ALONE.test(text) && closes(text);
}

/** A bracket that holds only refs, ids or hashes (`(lina#12)`, `(#123·#124)`, `(t_ab12cd34)`, `(a1b2c3d)`), with the space before it. */
const REF_BRACKET = /[ \t]*[([]([^()[\]\n]*)[)\]]/g;
const ONE_REF = new RegExp(String.raw`${ISSUE_REF}|${CARD_ID}|${HASH}`, "gu");
/** The bracketed tags of who wrote a text and when, which it opens with: no words of it. */
const LINE_TAGS = /^(?:\s*\[[^\]\n]*\])*\s*/;
/**
 * Marks no drawn sentence holds (lina-app#226): a slash (a path, an `a/b` list), an arrow, a code mark (`\``, `=`, `\\`), a
 * table's `|` and the hub's own cut (`…`, `...`) anywhere in it.
 */
const NEVER_DRAWN = /[/\\`=|→←↔⇒⇄…]|->|\.\.\./;
/** A time of day (`12:50`, `9:05`, with seconds `12:50:33`); a ratio (`3.55:1`) is none. */
const CLOCK = /(?<![\d:.])\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g;

/**
 * Whether a sentence holds what no drawn sentence holds (NEVER_DRAWN), or a time of day that reads as a log's (lina-app#153,
 * #230): two or more, one with seconds, or one with no Korean particle or word glued after it (`12:50 · 시작`, `… 12:50`,
 * `12:50.`, `12:50 배포 시작`, a log line's head). Exactly one time with a particle or word glued after it (`12:50에`,
 * `9:05부터`, `12:50경`, `12:50쯤`) is a plain fact: the row's own time beside it is another time, and the two read side by
 * side.
 */
function holdsNeverDrawn(sentence: string): boolean {
  if (NEVER_DRAWN.test(sentence)) return true;
  const times = [...sentence.matchAll(CLOCK)];
  if (!times.length) return false;
  const [time] = times;
  return times.length > 1 || time[0].split(":").length > 2 || !/^\p{Script=Hangul}/u.test(sentence.slice(time.index + time[0].length));
}
/** A line that is a state word and nothing else (완료, 진행 중, 검토 통과): an event of a known kind, read as that word. */
export const STATE_ONLY = new Set<string>([...STATE_WORDS, ...Object.values(W.outcome)]);

/**
 * A unit's sentences and lines, each up to its end mark or its line break, never after a number (a list's `2.`, a count's
 * `0.`): what the checks and the limit read, never what is drawn.
 */
const PIECES = /(?<=[^\d\s][.!?。])\s+|\n/;
/**
 * A piece cut off before its verb (lina-app#241): it ends on the particle of an object, a place, a subject or a topic
 * (`세부를`, `화면에서`, `고치는 중이`, `작업은`), with or without an end mark. Never `가`: so many nouns end on it (`추가`,
 * `평가`) that it says nothing.
 */
const CUT_OFF = new RegExp(String.raw`\p{Script=Hangul}(?:을|를|에서|으로|은|는|이)[.!?。]?["'\u2019\u201d)\]]*$`, "u");
/** A list's first mark as the last word of a text (`순서는 1.`), or a text that is only a mark (`2.`): the item it opens is not in it. */
const ENDS_ON_MARK = /^\(?\d{1,2}[.)]$|\s\(?1[.)]$/;

/**
 * A text of anyone but the owner as the one unit the screens draw or fold (lina-app#241): as written, less its markdown
 * markers (plainText), the stamp it opens with (`[이름 16:52]`) and every bracket that holds only refs, ids or hashes, with
 * the space before it. Its lines stay.
 */
export function unitOf(text: string | null | undefined): string {
  return withoutRefBrackets(plainText(text ?? "").replace(LINE_TAGS, ""));
}

/**
 * The one gate (lina-app#241): whether a unit may be drawn as its own text. It passes the checks every title passes
 * (sentenceMayShow over the whole unit: no Latin letter, ref or hash, no start inside another sentence, no open end, no
 * hole), holds no word the screens never use (BANNED_WORDS), no mark of NEVER_DRAWN or a log's time in any sentence, no
 * sentence cut off before its verb (CUT_OFF), and does not end on a list's first mark. Nothing else: no sentence, list
 * or lead-in is drawn apart from its unit. A unit that fails is folded whole, and opens as written.
 */
export function unitMayShow(unit: string): boolean {
  if (!unit || BANNED_WORDS.some((word) => unit.includes(word)) || !sentenceMayShow(unit) || ENDS_ON_MARK.test(unit)) return false;
  return unit.split(PIECES).every((piece) => !holdsNeverDrawn(piece) && !CUT_OFF.test(piece));
}

/**
 * How long a unit may be to stand closed as one history or comment line (lina-app#236, #241): one line of two sentences
 * and 120 letters. On the hub's long card every bot comment that is no machine notice holds a ref, an id or a Latin word,
 * so it folds whatever the limit; a longer unit that passes the gate folds too, and opens whole (features/card-detail.md).
 */
const WHOLE_SENTENCES = 2;
const WHOLE_LETTERS = 120;

/**
 * A bot's text as one closed history or comment line: its unit (unitOf) when it passes the gate (unitMayShow) and the
 * limit, or a state word alone; else null, and it folds into the history's 접힌 line, which holds it whole.
 */
export function wholeText(text: string | null | undefined): string | null {
  const unit = unitOf(text);
  if (STATE_ONLY.has(unit)) return unit;
  const fits = !unit.includes("\n") && unit.split(PIECES).length <= WHOLE_SENTENCES && [...unit].length <= WHOLE_LETTERS;
  return fits && unitMayShow(unit) ? unit : null;
}

/** A Latin word as a history sentence may hold it: a tool's, a product's or a device's name (`Playwright`, `PR`, `npm`). */
const NAME_WORD = /[A-Za-z][A-Za-z0-9.+-]*/g;
/** English text, never drawn: three Latin words or more in a row (`Fake Review Bot`), or a Latin lead-in (`For you:`). */
const ENGLISH = /[A-Za-z][\w.+-]*(?:[\s,]+[A-Za-z][\w.+-]*){2,}|^[A-Za-z][A-Za-z ]*:/;
/**
 * What a person never reads in a sentence: an issue ref, a card or run id, a hash, a code name, and a Latin word with a
 * digit glued to it, an internal label or name (`N1`, `D1~D7`, `land-app233b`, `23px`).
 */
const INTERNAL = new RegExp(String.raw`${ISSUE_REF}|${CARD_ID}|${HASH}|${CODE}|[A-Za-z]\d|\d[A-Za-z]`, "u");
/** A list's mark before an item (`- `, `• `, `2) `, `(3) `, `1. `): no part of the sentence after it. */
const ITEM_MARK = /^(?:[-*•]|\(?\d{1,2}[.)])\s+/;
/**
 * The end of a sentence that says it did not happen (`하지 않았다`, `안 함`, `못 열음`, `없음`, `아님`), that it is still to come
 * (`하겠다`), or that it may be (`실패할 수 있다`) or is guessed (`짐작이다`).
 */
const NOT_DONE = /(?:^|\s)(?:안|못)\s+\S+$|(?:않|아니|아님|없)\p{Script=Hangul}*$|겠\p{Script=Hangul}*$|수\s+있\p{Script=Hangul}*$|짐작\p{Script=Hangul}*$/u;
/** A noun that names a finished act on its own at a sentence's end (`검사 통과`, `직접 확인`). */
const DONE_NOUN = /(?:통과|완료|성공|확인)$/u;

/** The final consonant of a Hangul syllable (0 when none; ㅆ is 20, ㅁ is 16). */
const finalOf = (syllable: string) => (syllable.charCodeAt(0) - 0xac00) % 28;

/**
 * Whether a sentence says what came of the work: it ends on a past predicate (`합쳤다`, `고쳤습니다`, `남겼음`), a noun of a
 * finished act (`확인함`, `고침`, `읽음`) or one that names it (`통과`), never on a negation or a plan (NOT_DONE).
 */
function saysDone(sentence: string): boolean {
  // Its predicate is the last word before its end mark and an aside that closes it (`더 잘림(문서에 적힘).`), and it is Hangul: a
  // sentence that ends on a Latin word or a number names something and says nothing of it.
  const core = sentence.replace(/[\s.!?。"'\u2019\u201d]+$/u, "").replace(/\s*\([^()]*\)$/u, "").replace(/[\s.!?。"'\u2019\u201d)\]]+$/u, "");
  if (!/\p{Script=Hangul}$/u.test(core) || NOT_DONE.test(core)) return false;
  const ending = core.match(/(\p{Script=Hangul})(?:다|습니다|어요|음)$/u);
  return (ending !== null && finalOf(ending[1]) === 20) || finalOf(core.slice(-1)) === 16 || DONE_NOUN.test(core);
}

/**
 * Whether one sentence may stand as a closed history line (criterion 2): whole, by the one gate (unitMayShow) with each
 * Latin word read as a word, so a tool's or a device's name stays; never with an id, a ref, a hash, a code name, a path,
 * a command or an address in it, never English text (ENGLISH), and only when it says what came of the work (saysDone).
 * Read only by the history's lines: a title keeps its own rule.
 */
export function historyMayShow(sentence: string): boolean {
  if (!HANGUL.test(sentence) || ENGLISH.test(sentence) || INTERNAL.test(sentence)) return false;
  if (RULES.some(([reason, rule]) => reason !== "fragment" && rule.test(sentence))) return false;
  return unitMayShow(sentence.replace(NAME_WORD, "낱말")) && saysDone(sentence);
}

/**
 * The sentences of a bot's text a closed history line may read, in its order, each whole (historyMayShow) and less only a
 * list's mark before it: never a part of one, never two joined. `opens`: the text may open inside a sentence (the tail
 * the core kept of a longer one), so its first piece is none; `ends`: it may end inside one (a note the core cut), so
 * its last piece is one only when it ends on an end mark.
 */
export function historySentences(text: string | null | undefined, { opens = false, ends = false }: { opens?: boolean; ends?: boolean } = {}): string[] {
  const pieces = unitOf(text).split(PIECES);
  return pieces
    .filter((piece, index) => !(opens && index === 0) && !(ends && index === pieces.length - 1 && !/[.!?。]$/.test(piece)))
    .map((piece) => piece.trim().replace(ITEM_MARK, ""))
    .filter(historyMayShow);
}

/** Whether a bracket's inside is refs, ids or hashes and their separators alone: no word, so cutting it leaves no hole (lina-app#233). */
export function holdsRefsOnly(inner: string): boolean {
  return inner.trim() !== "" && !inner.replace(ONE_REF, "").replace(/[\s·,]+/g, "");
}

/** A text less every bracket that holds only refs, ids or hashes, with the space before it (lina-app#226); its lines stay. */
function withoutRefBrackets(text: string): string {
  return text
    .replace(REF_BRACKET, (whole, inner: string) => (holdsRefsOnly(inner) ? "" : whole))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function foldReason(text: string): FoldReason | null {
  const body = text.trim();
  if (!body) return "fragment";
  for (const [reason, rule] of RULES) if (rule.test(body)) return reason;
  // An English word of three letters or more is raw text the screen never shows (the core's rule for its lines).
  const latin = (body.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).filter((word) => (word.match(/[A-Za-z]/g) ?? []).length >= 3 && !ALLOWED_LATIN.has(word));
  return latin.length ? "latin" : null;
}
