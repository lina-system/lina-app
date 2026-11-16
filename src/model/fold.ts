import { timesInText } from "../time";
import { ROUND15_WORD } from "../words";
import { withLeadIns } from "./plain";

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
/** The particles a ref or a bracket carries glued after it (`<hash>로`, `#12를`, `(…)을`). */
const PARTICLES = "으로|에서|까지|부터|로|를|을|이|가|은|는|와|과|의|에|도|만";
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
export function cutMark(token: string): string {
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
const CUT_FIRST = /^\s*[\uE000\uE001]/;
const CUT_LAST = /[\uE000\uE001]\s*$/;

/**
 * Whether a cut left a hole in a sentence (lina-app#218), read on the sentence with its cuts marked (CUT, NOUN_CUT): a
 * modifier whose noun was cut (`더 새 <hash>로 충족됨`), a topic or an object whose predicate was cut (`새 판은 <hash>.`),
 * or, between two words, a pair mark that lost an end to a cut (cut on both sides, `#12 ↔ t_1`; glued to a cut,
 * `#12~#14는`, `7봇+<name>`; or with only a cut after it to the end, `(값 = <hash>)`) or a list's `·` beside a cut noun
 * (`#12·#13과 파일이`). A cut at either end of a list, a clause after a spaced pair mark that opens on a cut name
 * (`갱신 + <name> 릴레이 교체`), a ref cut from beside a word it names (`커밋 <hash> 반영`) and a bracket the cut took whole
 * leave none. The one rule every cut follows: withoutRefs and withoutLatin
 * (titles, folded comments, history lines through the fold) and a history line's own cut (firstSentence) draw no
 * sentence that has one; a comment shows its next sentence, a title none.
 */
export function cutLeavesHole(marked: string): boolean {
  if (!/[\uE000\uE001]/.test(marked)) return false;
  if (NOUN_GONE.test(marked) || PREDICATE_GONE.test(marked)) return true;
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
 * colon with only a bracket after it goes (`반영: (앞)` reads `반영 (앞)`). The one place every fold of a hub sentence
 * tidies.
 */
export function tidyFoldedText(text: string): string {
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

/** An emptied bracket, the spaces before it, and the particle glued after it ahead. */
const EMPTY_BEFORE_PARTICLE = new RegExp(String.raw`\s*[([]\s*[·,:;]*\s*[)\]](?=(?:${PARTICLES})(?![\p{Script=Hangul}]))`, "gu");

/**
 * The text with its issue references, card and goal ids, commit hashes, code-looking names and bots' time stamps cut
 * (lina-app#148, #152, #156, #160). Each ref goes with the particle glued to it; a bracket left with nothing readable
 * (no Hangul, or one letter) or with a hole (cutLeavesHole) goes whole, and one left with words keeps them where they
 * stood. The debris left goes too (tidyFoldedText). Empty when nothing else was there, or when the cut left the text a
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
        return HANGUL.test(left) && left.replace(SEPARATORS, "").length > 1 ? `(${left})` : "()";
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

/**
 * The text with each word that is an identifier (isIdentifier: a path, a command, a key with its value, a short id) cut,
 * its sentence end kept, and the debris left tidied: what a history line leaves out of a sentence (firstSentence), so a
 * folded comment keeps the same sentence (`copy/a.json 키 12개를 바꿈` reads `키 12개를 바꿈`, lina-app#142, #222). Empty when
 * the cut left a hole (cutLeavesHole).
 */
function withoutIdentifiers(text: string): string {
  return afterCut(text.split(/\s+/).map((word) => (isIdentifier(wordCore(word)) ? cutMark(wordCore(word)) + (/[.!?。]$/.exec(word)?.[0] ?? "") : word)).join(" "));
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

/** A time of day at the start of a word (22:45, 22:45에). */
export const CLOCK = /^\d{1,2}:\d{2}(?!\d)/;

/** A word without the brackets and quotes around it and the punctuation after it: what isIdentifier and nameKind read. */
export function wordCore(word: string): string {
  return word.replace(/^[(\["'“‘]+|[)\]"'”’.,!?。:;…]+$/g, "");
}

/**
 * An identifier a person does not read: a card, run or to-do id (G73, T264, t_27363156, OT-QAX1113), a key with its
 * value (rc=1), a time of day, and every kind of raw text the fold rule names but an English word (a path, a command, a
 * hash, an issue number, an address).
 */
export function isIdentifier(core: string): boolean {
  if (CLOCK.test(core) || /^[A-Za-z]{1,3}\d+$/.test(core) || /[A-Za-z][\w]*[-_:][\w-]*\d/.test(core) || /#\d/.test(core) || core.includes("=")) return true;
  const reason = foldReason(core);
  return reason !== null && reason !== "latin" && reason !== "fragment";
}

/**
 * An identifier inside a sentence with its particle written apart (`152번 a_b 로`, `번들 \`dist/\` 를`), as the kind of thing
 * it names with that particle (`152번 항목으로`, `번들 폴더를`, lina-app#207): the sentence keeps its meaning and no particle
 * stands alone, so the one rule passes it (lina-app#222). One that opens the sentence has no words of its own around it:
 * withoutRefs and leftAsDebris take that sentence whole.
 */
function withKinds(sentence: string): string {
  const named = new RegExp(String.raw`(?<=\S\s+)(\S+)\s+(${LONE_PARTICLE})`, "gu");
  return sentence.replace(named, (whole: string, name: string, particle: string) => {
    const noun = isIdentifier(wordCore(name)) ? nameKind(name) : null;
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
  return !/\s/.test(cut) && !/[.!?。]$/.test(cut) && /\s/.test(sentence.trim());
}

/** A start inside another sentence: a closing quote or bracket, a separator, an arrow, or a particle alone (never `만 원`). */
const STARTS_INSIDE = new RegExp(String.raw`^(?:[.,:;·…|)\]}\-\u2013\u2014→]|['"\u2019\u201d](?:\s|$)|(?!만\s)${LONE_PARTICLE})`, "u");
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
/** A Latin letter (an English word, a product name, a round label `S2`, a code `rc 0`) or a ref's `#12`. */
const LATIN_OR_CODE = /[A-Za-z]|#\d/;

const count = (text: string, mark: string) => text.split(mark).length - 1;

/** Whether every bracket and quote the text opens it also closes. */
function closes(text: string): boolean {
  return count(text, "(") === count(text, ")") && count(text, "[") === count(text, "]") && count(text, "\u201c") === count(text, "\u201d") && count(text, "\u2018") === count(text, "\u2019") && count(text, '"') % 2 === 0 && count(text, "'") % 2 === 0;
}

/**
 * The one rule a sentence passes to be drawn (lina-app#197, #222): every history line (firstSentence), every sentence of
 * a folded comment (foldedText) and every title (index.ts: cleanTitle, finishedTitle, plainLine). It fails a sentence
 * that (a) starts inside another one (a separator, a closing quote, a particle alone, a bare number with its unit, a
 * list's number), (b) ends open (`:`, `|`, a separator, a particle alone, a bracket or quote left open or closed alone),
 * (c) has a hole (an empty bracket, punctuation alone or doubled, a particle apart from its noun, a modifier with no
 * noun), (d) holds a Latin letter or a ref (`PR`, a product name, `S2`, `D1~D7`, `rc 0`, `#12`), or has no Hangul. A
 * comment draws its next sentence that passes, a title the row's next name; nothing that fails is ever drawn.
 */
export function sentenceMayShow(sentence: string): boolean {
  // A list's number before the sentence is no part of it (`1) 가상 설정이 돌았다.`, `2. 빌드 통과.`).
  const text = sentence.trim().replace(/^\(?\d{1,2}[.)]\s+/, "");
  if (!HANGUL.test(text) || LATIN_OR_CODE.test(text) || NUMBER_ALONE.test(text)) return false;
  if (STARTS_INSIDE.test(text) || ENDS_OUTSIDE.test(text) || EMPTY_BRACKET.test(text) || LONE_PUNCTUATION.test(text)) return false;
  return !PARTICLE_APART.test(text) && !MODIFIER_ALONE.test(text) && closes(text);
}

/**
 * A list's number as the last word of a piece: the item it numbers follows it. A piece that is only the mark (`2.`,
 * `(3)`) always is one; after other words only the first number (`순서는 1.`) is, because a list starts at 1 and a
 * sentence may end on any other count (`실패 건수는 0.`, `대기 3.`), which stays a sentence of its own.
 */
const ENDS_ON_LIST_MARK = /^\(?\d{1,2}[.)]$|\s\(?1[.)]$/;

/**
 * A line's sentences (lina-app#222): split after `.`, `!`, `?` or `。` with a space after it, never after a list's number
 * (`순서는 1. 빌드`), so no half is a sentence alone. A dot inside a number, a version or a file name (`0.5`, `1.2.3`,
 * `a.md`) has no space after it and never splits. The one split of every history line, folded comment and stop reason.
 */
export function sentencesOf(line: string): string[] {
  const sentences: string[] = [];
  for (const piece of line.split(/(?<=[.!?。])\s+/)) {
    const last = sentences.at(-1);
    if (last !== undefined && ENDS_ON_LIST_MARK.test(last)) sentences[sentences.length - 1] = `${last} ${piece}`;
    else sentences.push(piece);
  }
  return sentences;
}

/**
 * A comment or history text as the screens show it (lina-app#161): each sentence through withoutRefs, and a sentence
 * left as debris (leftAsDebris) dropped whole, an empty labelled field cut alone (withoutEmptyFields), so `가 맡는다`,
 * `범위 라 …` or a bare `주소` never shows. A sentence of only fold markers goes too, and so does one whose cut left a hole
 * (withoutRefs, lina-app#218); a list's lead-in line reads with its first item (withLeadIns). A sentence left that the
 * one rule fails (sentenceMayShow, lina-app#222) goes too: the comment keeps the ones that pass. Empty when nothing is
 * left.
 */
export function foldedText(text: string): string {
  return withLeadIns(text)
    .split("\n")
    .map((line) =>
      sentencesOf(line)
        .map((whole) => {
          if (/…|\.\.\./.test(whole) && ONLY_FOLD_MARKERS.test(whole)) return "";
          const fields = withoutEmptyFields(whole);
          if (fields === null) return "";
          const sentence = withKinds(fields);
          // Its ISO times read as every time on the screens once the refs go, so a cut key leaves no `=` (lina-app#207).
          const cut = timesInText(withoutRefs(sentence));
          if (leftAsDebris(timesInText(sentence), cut)) return "";
          if (sentenceMayShow(cut)) return cut;
          const bare = withoutIdentifiers(cut);
          return bare !== cut && sentenceMayShow(bare) ? bare : "";
        })
        .filter(Boolean)
        .join(" "),
    )
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
