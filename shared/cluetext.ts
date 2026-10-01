/** Question text processing: sentence splitting, single-sentence hints, answer redaction, clue tokens. */

import { toLetters } from "./answerline";

export const REDACTION = "____";

// Null prototype so words like "constructor" are not found on Object.prototype.
const wordTable = (words: string): Record<string, true> =>
  Object.assign(Object.create(null), Object.fromEntries(words.split(" ").map((w) => [w, true] as const)));

const ABBREVIATIONS = wordTable(
  "mr mrs ms dr st mt jr sr vs etc eg ie no nos vol vols ch gen col lt sgt capt cmdr adm rev prof gov sen rep pres " +
    "ft co corp inc ltd approx ca c fl b d op pp cf al ave blvd jan feb mar apr jun jul aug sep sept oct nov dec " +
    "messrs mme mlle fig figs ed eds trans esp var subsp sp spp dept univ assn bros est",
);

const STOPWORDS = wordTable(
  "the a an of and or in on at to for with from by de la le les el los las du des der die das van von y et",
);

/** Split tossup text into sentences, keeping abbreviations and initials intact. */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let start = 0;
  const boundary = /[.!?]["”’)\]]*\s+(?=["“‘(\[]?[A-Z0-9])/g;
  for (const m of clean.matchAll(boundary)) {
    const end = m.index + m[0].trimEnd().length;
    const before = clean.slice(start, m.index);
    const lastToken = /([A-Za-z.]+)$/.exec(before)?.[1] ?? "";
    const bare = lastToken.replace(/\./g, "").toLowerCase();
    // Initials ("J. S. Bach", "U.S.") and known abbreviations do not end sentences.
    if (clean[m.index] === "." && (/^[A-Z]$/.test(lastToken) || lastToken.includes(".") || ABBREVIATIONS[bare])) continue;
    out.push(clean.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  if (start < clean.length) out.push(clean.slice(start).trim());

  // Fold tiny fragments ("Ha!") into the previous sentence.
  const merged: string[] = [];
  for (const s of out) {
    if (merged.length > 0 && s.split(" ").length < 4) merged[merged.length - 1] += " " + s;
    else merged.push(s);
  }
  return merged.filter(Boolean);
}

/**
 * Blank out words of the answer that appear in the question, so a clue never
 * spells out its own entry. Matching is case- and diacritic-insensitive.
 */
export function redactAnswer(text: string, answerWords: string[]): string {
  const targets = new Set<string>();
  for (const phrase of answerWords) {
    for (const w of phrase.split(/[\s\-–—/]+/)) {
      const letters = toLetters(w);
      if (letters.length >= 3 && !STOPWORDS[w.toLowerCase()]) targets.add(letters);
    }
  }
  if (targets.size === 0) return text;
  return text.replace(/[\p{L}\p{M}'’]+/gu, (word) => {
    const letters = toLetters(word);
    for (const t of targets) {
      if (letters === t || letters === t + "S" || letters === t + "ES") return REDACTION;
      if (letters.startsWith(t) && t.length >= 5) return REDACTION;
    }
    return word;
  });
}

/** Sentences of a question with power marks and bonus part values ("[10]", "[10e]") removed. */
export function questionSentences(text: string): string[] {
  return splitSentences(
    text
      .replace(/\(\s*[*+]\s*\)/g, " ")
      .replace(/^\s*\[\s*\d+\s*[emh]?\s*\]\s*/i, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

const GIVEAWAY =
  /^(?:for\s+(?:10|ten|15|fifteen|20|twenty|5|five)\s+points(?:\s+each)?\s*[,:.-]?\s*|ftp\s*[,:]?\s*)?(?:name|identify|give|what\s+is|who\s+is|who\s+was|what\s+was)\s+(this|these)\b/i;
const POINTS_PREFIX = /^(?:for\s+(?:10|ten|15|fifteen|20|twenty|5|five)\s+points(?:\s+each)?\s*[,:.-]?\s*|ftp\s*[,:]?\s*)/i;
/** Sentences opening like this lean on earlier context ("He also wrote this play"). */
const CONTEXT_OPENER = /^(?:he|she|it|they|his|her|its|their|them|that|those|both|also|then|later|thus|however|another)\b/i;
/** Back-references to something named in an earlier sentence ("in that play", "this other branch"). */
const BACK_REFERENCE =
  /\b(?:that|those)\s+(?:play|novel|work|poem|book|opera|film|movie|painting|story|piece|song|album|battle|war|event|man|woman|person|figure|character|city|country|text|essay|series|show|game|team|ruler|king|queen|god|goddess)\b|\bthe (?:former|latter|aforementioned)\b|\b(?:this|these) other\b|\banother of (?:these|those)\b/i;
export const MIN_HINT_WORDS = 5;
export const MAX_HINT_WORDS = 40;

const MID_GIVEAWAY =
  /\s+for\s+(?:10|ten|15|fifteen|20|twenty|5|five)\s+points(?:\s+each)?\s*,?\s*(?:name|identify|give)\s+(this|these)\b/gi;
/**
 * A sentence as a standalone crossword clue, or null when it cannot stand
 * alone. "For 10 points, name this composer of X." becomes "This composer of X."
 */
export function toHint(sentence: string, answerWords: string[]): string | null {
  let s = sentence.trim();
  const g = GIVEAWAY.exec(s);
  if (g) s = g[1]![0]!.toUpperCase() + g[1]!.slice(1).toLowerCase() + s.slice(g[0].length);
  else s = s.replace(POINTS_PREFIX, "");
  // "Exemplified by X, for 10 points, name these compounds" -> "Exemplified by X, these compounds".
  s = s
    .replace(MID_GIVEAWAY, (_, pointer: string) => ` ${pointer.toLowerCase()}`)
    .replace(/,?\s*for\s+(?:10|ten|15|fifteen|20|twenty|5|five)\s+points(?:\s+each)?\s*,?/gi, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.?!]|$)/g, "$1");
  s = s.replace(/^[a-z]/, (c) => c.toUpperCase());
  if (!/\b(?:this|these)\b/i.test(s) || CONTEXT_OPENER.test(s)) return null;
  const words = s.split(" ").length;
  if (words < MIN_HINT_WORDS || words > MAX_HINT_WORDS) return null;
  if (/description acceptable|before (?:it is )?(?:read|mentioned)|\bprompt\b/i.test(s) || BACK_REFERENCE.test(s)) return null;
  const redacted = redactAnswer(s, answerWords);
  // A blanked-out word reads as a gap rather than a clue; plenty of hints remain without one.
  return redacted.includes(REDACTION) ? null : redacted;
}

/** Words too generic in quizbowl to say two sentences give the same clue. */
const GENERIC = wordTable(
  "this these that those which what who whom whose where when while with without into onto from than then they them their " +
    "there here have has had having been being were was are is be also only after before during about over under between " +
    "name names named points point work works figure man woman one two three first second last other another some such " +
    "called known title titular character characters people thing things time times year years made make makes many much " +
    "more most later early each both same said says used uses using including include includes like well very just even",
);

/** Content tokens for clue similarity: lowercased, generic words dropped, plural "s" folded. */
export function clueTokens(sentence: string): string[] {
  const out = new Set<string>();
  for (const raw of sentence.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || GENERIC[raw] || STOPWORDS[raw]) continue;
    out.add(raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return [...out];
}
