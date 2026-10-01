/**
 * American-style ("NYT") crossword fill: a rotationally symmetric black-square
 * pattern in which every white square belongs to an across and a down entry of
 * at least three letters, filled by depth-first search over entries.
 */

import type { Direction } from "../shared/types";
import { shuffle, type Layout, type Placement, type Rng } from "./generator";

const MIN_LEN = 3;

interface Slot {
  dir: Direction;
  row: number;
  col: number;
  cells: number[];
  /** For each cell, the crossing slot index. */
  crossers: number[];
}

/** Bitsets over the words of one length: all words, and words with letter L at position P. */
class LengthIndex {
  readonly blocks: number;
  readonly all: Uint32Array;
  readonly byLetter: Uint32Array[];

  constructor(readonly words: string[], readonly length: number) {
    this.blocks = Math.ceil(words.length / 32);
    this.all = new Uint32Array(this.blocks);
    this.byLetter = Array.from({ length: length * 26 }, () => new Uint32Array(this.blocks));
    words.forEach((w, i) => {
      const bit = 1 << (i & 31);
      const block = i >>> 5;
      this.all[block]! |= bit;
      for (let p = 0; p < length; p++) this.byLetter[p * 26 + w.charCodeAt(p) - 65]![block]! |= bit;
    });
  }
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export class WordIndex {
  private readonly byLength = new Map<number, LengthIndex>();

  /** `words` in preference order; earlier words are tried first. */
  constructor(words: string[], maxLength: number) {
    const groups = new Map<number, string[]>();
    for (const w of words) {
      if (w.length < MIN_LEN || w.length > maxLength) continue;
      const g = groups.get(w.length);
      if (g) g.push(w);
      else groups.set(w.length, [w]);
    }
    for (const [len, ws] of groups) this.byLength.set(len, new LengthIndex(ws, len));
  }

  get(length: number): LengthIndex | undefined {
    return this.byLength.get(length);
  }
}

/** Random symmetric pattern (true = black) where every white run is 3+ long and all whites connect. */
export function makePattern(n: number, blackShare: number, rng: Rng): boolean[] | null {
  const black = new Array<boolean>(n * n).fill(false);
  const target = Math.round(n * n * blackShare);
  const runsOk = () => {
    for (let r = 0; r < n; r++) {
      for (const horizontal of [true, false]) {
        let run = 0;
        for (let k = 0; k <= n; k++) {
          const isBlack = k === n || black[horizontal ? r * n + k : k * n + r]!;
          if (isBlack) {
            if (run > 0 && run < MIN_LEN) return false;
            run = 0;
          } else run++;
        }
      }
    }
    return true;
  };
  const order = shuffle(
    Array.from({ length: n * n }, (_, i) => i),
    rng,
  );
  let count = 0;
  for (const i of order) {
    if (count >= target) break;
    const twin = n * n - 1 - i;
    if (black[i]) continue;
    black[i] = black[twin] = true;
    if (runsOk()) count += i === twin ? 1 : 2;
    else black[i] = black[twin] = false;
  }
  if (!runsOk()) return null;
  // Connectivity of the white squares.
  const start = black.indexOf(false);
  if (start < 0) return null;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const r = Math.floor(i / n);
    const c = i % n;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const rr = r + dr;
      const cc = c + dc;
      const j = rr * n + cc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n && !black[j] && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === black.filter((b) => !b).length ? black : null;
}

function slotsOf(black: boolean[], n: number): Slot[] {
  const slots: Slot[] = [];
  const owner: number[][] = Array.from({ length: n * n }, () => []);
  for (const dir of ["across", "down"] as const) {
    for (let a = 0; a < n; a++) {
      let b = 0;
      while (b < n) {
        const at = (k: number) => (dir === "across" ? a * n + k : k * n + a);
        if (black[at(b)]) {
          b++;
          continue;
        }
        const cells: number[] = [];
        while (b < n && !black[at(b)]) cells.push(at(b++));
        if (cells.length >= MIN_LEN) {
          for (const c of cells) owner[c]!.push(slots.length);
          slots.push({ dir, row: Math.floor(cells[0]! / n), col: cells[0]! % n, cells, crossers: [] });
        }
      }
    }
  }
  for (const [si, s] of slots.entries()) s.crossers = s.cells.map((c) => owner[c]!.find((o) => o !== si) ?? -1);
  return slots;
}

/**
 * Fill a pattern by depth-first search: always the slot with the fewest
 * candidates next, each choice checked so no crossing slot is left empty.
 * Gives up after `budget` placements.
 */
function fillPattern(black: boolean[], n: number, index: WordIndex, budget: number): Placement[] | null {
  const slots = slotsOf(black, n);
  const letters = new Uint8Array(n * n); // 0 = empty, else char code
  const assigned = new Int32Array(slots.length).fill(-1);
  const used = new Set<string>();
  let nodes = 0;
  const scratch = new Map<number, Uint32Array>();

  const candidates = (si: number): Uint32Array | null => {
    const s = slots[si]!;
    const idx = index.get(s.cells.length);
    if (!idx) return null;
    let bits = scratch.get(si);
    if (!bits || bits.length !== idx.blocks) {
      bits = new Uint32Array(idx.blocks);
      scratch.set(si, bits);
    }
    bits.set(idx.all);
    s.cells.forEach((cell, p) => {
      const l = letters[cell]!;
      if (!l) return;
      const mask = idx.byLetter[p * 26 + l - 65]!;
      for (let b = 0; b < bits!.length; b++) bits![b]! &= mask[b]!;
    });
    return bits;
  };
  const count = (bits: Uint32Array) => {
    let n = 0;
    for (let b = 0; b < bits.length; b++) if (bits[b]) n += popcount(bits[b]!);
    return n;
  };

  const solve = (): boolean => {
    let best = -1;
    let bestCount = Infinity;
    for (let si = 0; si < slots.length; si++) {
      if (assigned[si] !== -1) continue;
      const bits = candidates(si);
      const c = bits ? count(bits) : 0;
      if (c < bestCount) {
        bestCount = c;
        best = si;
        if (c === 0) return false;
      }
    }
    if (best === -1) return true;
    const slot = slots[best]!;
    const idx = index.get(slot.cells.length)!;
    const bits = Uint32Array.from(candidates(best)!);
    // Try the most preferred few candidates; random restarts cover the rest.
    let tried = 0;
    for (let b = 0; b < bits.length && tried < 8; b++) {
      let word = bits[b]!;
      while (word && tried < 8) {
        const bit = 31 - Math.clz32(word & -word);
        word &= word - 1;
        const w = idx.words[b * 32 + bit]!;
        if (used.has(w)) continue;
        if (++nodes > budget) return false;
        tried++;
        const before = slot.cells.map((c) => letters[c]!);
        slot.cells.forEach((c, p) => (letters[c] = w.charCodeAt(p)));
        assigned[best] = 1;
        used.add(w);
        const dead = slot.crossers.some((x) => x !== -1 && assigned[x] === -1 && count(candidates(x) ?? new Uint32Array()) === 0);
        if (!dead && solve()) {
          assigned[best] = b * 32 + bit;
          return true;
        }
        used.delete(w);
        assigned[best] = -1;
        slot.cells.forEach((c, p) => (letters[c] = before[p]!));
        if (nodes > budget) return false;
      }
    }
    return false;
  };

  if (!solve()) return null;
  return slots.map((s) => ({
    entry: s.cells.map((c) => String.fromCharCode(letters[c]!)).join(""),
    row: s.row,
    col: s.col,
    dir: s.dir,
  }));
}

/** Black-square share by grid size; small grids can be nearly open, big ones need more blocks. */
export function blackShare(n: number): number {
  return n <= 5 ? 0.12 : n <= 7 ? 0.18 : n <= 9 ? 0.2 : n <= 11 ? 0.22 : 0.24;
}

/** Try fresh patterns until one fills or the time runs out. */
export function fillGrid(words: string[], n: number, rng: Rng, timeMs: number): Layout | null {
  const index = new WordIndex(words, n);
  const deadline = Date.now() + timeMs;
  let share = blackShare(n);
  while (Date.now() < deadline) {
    const pattern = makePattern(n, share, rng);
    if (!pattern) continue;
    const placements = fillPattern(pattern, n, index, 4000);
    if (placements) return { width: n, height: n, placements };
    // Drift toward more blocks: shorter slots are easier to fill.
    share = Math.min(share + 0.005, 0.34);
  }
  return null;
}
