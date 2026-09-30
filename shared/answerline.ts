/**
 * Turns a QB Reader answerline (HTML, e.g. `Johann Sebastian <b><u>Bach</u></b> [or ...]`)
 * into a crossword entry: the required (bold/underlined) part of the main answer.
 */

export interface ParsedAnswer {
  /** Grid letters, A-Z only. */
  entry: string;
  /** Word lengths of the entry as written, e.g. "5,3,3,4" or "4-4". */
  enumeration: string;
  /** The required part as written, e.g. "Peter and the Wolf". */
  canonical: string;
  /** The main answerline without alternates, e.g. "Johann Sebastian Bach". */
  display: string;
}

export const MIN_ENTRY_LENGTH = 3;
export const MAX_ENTRY_LENGTH = 21;

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-",
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const LETTER_MAP: Record<string, string> = {
  ß: "SS", æ: "AE", Æ: "AE", œ: "OE", Œ: "OE", ø: "O", Ø: "O", ł: "L", Ł: "L",
  đ: "D", Đ: "D", þ: "TH", Þ: "TH", ð: "D", Ð: "D", ı: "I",
};

/** Uppercase A-Z transliteration; everything else is dropped. */
export function toLetters(s: string): string {
  return s
    .replace(/[ßæÆœŒøØłŁđĐþÞðÐı]/g, (c) => LETTER_MAP[c] ?? c)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

const isLetter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);

interface FlaggedChar {
  ch: string;
  u: boolean;
  b: boolean;
}

function flagChars(html: string): FlaggedChar[] {
  const out: FlaggedChar[] = [];
  let u = 0;
  let b = 0;
  const re = /<\s*(\/?)\s*([a-z]+)[^>]*>|([^<]+)|(<)/gi;
  for (const m of html.matchAll(re)) {
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const delta = m[1] ? -1 : 1;
      if (tag === "u") u = Math.max(0, u + delta);
      else if (tag === "b" || tag === "strong") b = Math.max(0, b + delta);
      continue;
    }
    const text = decodeEntities(m[3] ?? m[4] ?? "");
    for (const ch of text) out.push({ ch: /\s/.test(ch) ? " " : ch, u: u > 0, b: b > 0 });
  }
  return out;
}

const ROMAN = /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVIII|XIX|XX)$/;

export function parseAnswerline(html: string): ParsedAnswer | null {
  if (!html) return null;
  const all = flagChars(html);

  // Main answer: everything before the first "[" (alternates, prompts, notes).
  let main = all;
  const bracket = main.findIndex((c) => c.ch === "[" || c.ch === "{");
  if (bracket >= 0) main = main.slice(0, bracket);

  // Drop parentheticals such as "(Dame) Zaha Hadid" or "(geo)magnetic poles".
  const kept: FlaggedChar[] = [];
  let depth = 0;
  for (const c of main) {
    if (c.ch === "(") depth++;
    else if (c.ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) kept.push(c);
  }
  main = kept;

  const useU = main.some((c) => c.u);
  const useB = !useU && main.some((c) => c.b);
  const req = (c: FlaggedChar) => (useU ? c.u : useB ? c.b : true);

  // Cut at a separator that sits outside a required run (" or ", ";", ",").
  const text = main.map((c) => c.ch).join("");
  for (const sep of [/ or /i, /;/, /,/]) {
    const m = sep.exec(text);
    if (!m) continue;
    const inside = main.slice(m.index, m.index + m[0].length).some(req);
    if (!inside && main.slice(0, m.index).some(req)) {
      main = main.slice(0, m.index);
      break;
    }
  }

  const display = main.map((c) => c.ch).join("").replace(/\s+/g, " ").replace(/^[\s"“”'‘’]+|[\s"“”'‘’]+$/g, "");
  if (!display) return null;

  // Required runs: maximal spans of required chars. Runs separated only by
  // spaces or punctuation (split tags) are merged.
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < main.length; i++) {
    const c = main[i]!;
    if (!req(c) || (c.ch === " " && (runs.length === 0 || runs[runs.length - 1]![1] !== i))) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else if (last && !main.slice(last[1], i).some((g) => isLetter(g.ch))) last[1] = i + 1;
    else runs.push([i, i + 1]);
  }
  if (runs.length === 0) return null;

  // Extend each run to whole words, except for plural suffixes ("doctor|s").
  const extended = runs.map(([s, e]) => {
    while (s > 0 && isLetter(main[s - 1]!.ch) && isLetter(main[s]!.ch)) s--;
    let end = e;
    while (end < main.length && isLetter(main[end]!.ch) && isLetter(main[end - 1]!.ch)) end++;
    const suffix = main.slice(e, end).map((c) => c.ch).join("").toLowerCase();
    if (suffix === "s" || suffix === "es") end = e;
    return main.slice(s, end).map((c) => c.ch).join("").trim();
  });

  let best = "";
  for (const run of extended) if (toLetters(run).length >= toLetters(best).length) best = run;
  best = best.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!best || /\d/.test(best)) return null;

  const words = best.split(/[\s]+/).filter(Boolean);
  if (words.slice(1).some((w) => ROMAN.test(w.replace(/[^A-Za-z]/g, "")))) return null;

  const entry = toLetters(best);
  if (entry.length < MIN_ENTRY_LENGTH || entry.length > MAX_ENTRY_LENGTH) return null;

  const enumeration = words
    .map((w) => w.split("-").map(toLetters).filter(Boolean).map((p) => p.length).join("-"))
    .filter(Boolean)
    .join(",");

  return { entry, enumeration, canonical: best, display };
}
