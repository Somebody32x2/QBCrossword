/**
 * Free-form crossword construction: entries are laid across/down inside a
 * size x size bound, every new entry crossing at least one placed entry.
 * Adjacent parallel letters are never allowed, so every run of 2+ letters in
 * the result is exactly one placed entry.
 */

import type { Direction } from "../shared/types";

export interface Placement {
  entry: string;
  row: number;
  col: number;
  dir: Direction;
}

export interface Layout {
  width: number;
  height: number;
  placements: Placement[];
}

export type Rng = () => number;

/** mulberry32 seeded from a string, so a daily seed always builds the same grid. */
export function seededRng(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** Word-count cap per grid size for free-form grids; dense packing rarely gets this far. */
export function targetWordCount(size: number): number {
  return Math.round(size * size * 0.3);
}

const ACROSS = 1;
const DOWN = 2;

interface Spot extends Placement {
  crossings: number;
  /** Perpendicular runs the word would form with neighbouring letters; each must itself be an entry. */
  incidental: Placement[];
}

class Grid {
  readonly letters: Uint8Array;
  readonly used: Uint8Array;
  readonly placements: Placement[] = [];
  readonly entries = new Set<string>();
  /** Filled cell indices per letter (A = 0), the only places a new word can cross. */
  private readonly byLetter: number[][] = Array.from({ length: 26 }, () => []);
  filled = 0;

  /** `valid`: entries that may appear as incidental runs. */
  constructor(
    readonly size: number,
    private readonly valid: ReadonlySet<string>,
  ) {
    this.letters = new Uint8Array(size * size);
    this.used = new Uint8Array(size * size);
  }

  private at(r: number, c: number): number {
    return r < 0 || c < 0 || r >= this.size || c >= this.size ? 0 : this.letters[r * this.size + c]!;
  }

  /** The placement with its crossings and incidental runs, or null if illegal. */
  check(word: string, row: number, col: number, dir: Direction): Spot | null {
    const dr = dir === "down" ? 1 : 0;
    const dc = dir === "across" ? 1 : 0;
    const endR = row + dr * (word.length - 1);
    const endC = col + dc * (word.length - 1);
    if (row < 0 || col < 0 || endR >= this.size || endC >= this.size) return null;
    if (this.at(row - dr, col - dc) || this.at(endR + dr, endC + dc)) return null;
    const mask = dir === "across" ? ACROSS : DOWN;
    const cross: Direction = dir === "across" ? "down" : "across";
    const crossMask = dir === "across" ? DOWN : ACROSS;
    let crossings = 0;
    const incidental: Placement[] = [];
    for (let i = 0; i < word.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      const cell = this.letters[r * this.size + c]!;
      if (cell) {
        if (cell !== word.charCodeAt(i) || this.used[r * this.size + c]! & mask) return null;
        crossings++;
        continue;
      }
      // Letters beside a new square would form a perpendicular run; allow it only if that run is an entry.
      let a = 0;
      while (this.at(r - dc * (a + 1), c - dr * (a + 1))) a++;
      let b = 0;
      while (this.at(r + dc * (b + 1), c + dr * (b + 1))) b++;
      if (a === 0 && b === 0) continue;
      let run = "";
      for (let k = -a; k <= b; k++) {
        const rr = r + dc * k;
        const cc = c + dr * k;
        if (k === 0) run += word[i];
        else {
          if (this.used[rr * this.size + cc]! & crossMask) return null;
          run += String.fromCharCode(this.letters[rr * this.size + cc]!);
        }
      }
      if (run.length < 3 || !this.valid.has(run) || this.entries.has(run) || run === word || incidental.some((p) => p.entry === run)) {
        return null;
      }
      incidental.push({ entry: run, row: r - dc * a, col: c - dr * a, dir: cross });
    }
    if (crossings === word.length) return null;
    return { entry: word, row, col, dir, crossings, incidental };
  }

  place(p: Placement): void {
    const dr = p.dir === "down" ? 1 : 0;
    const dc = p.dir === "across" ? 1 : 0;
    const mask = p.dir === "across" ? ACROSS : DOWN;
    for (let i = 0; i < p.entry.length; i++) {
      const idx = (p.row + dr * i) * this.size + p.col + dc * i;
      if (!this.letters[idx]) {
        this.filled++;
        this.byLetter[p.entry.charCodeAt(i) - 65]!.push(idx);
      }
      this.letters[idx] = p.entry.charCodeAt(i);
      this.used[idx]! |= mask;
    }
    this.placements.push({ entry: p.entry, row: p.row, col: p.col, dir: p.dir });
    this.entries.add(p.entry);
  }

  /** Best legal crossing placement for `word`, favouring crossings, incidental entries and a centred grid. */
  bestPlacement(word: string, rng: Rng): Spot | null {
    let best: Spot | null = null;
    let bestScore = -Infinity;
    const mid = (this.size - 1) / 2;
    for (let i = 0; i < word.length; i++) {
      for (const idx of this.byLetter[word.charCodeAt(i) - 65]!) {
        const used = this.used[idx]!;
        // A cell already crossed both ways cannot take another word.
        if (used === (ACROSS | DOWN)) continue;
        const dir: Direction = used === ACROSS ? "down" : "across";
        const r = Math.floor(idx / this.size);
        const c = idx % this.size;
        const spot = this.check(word, dir === "down" ? r - i : r, dir === "across" ? c - i : c, dir);
        if (!spot || spot.crossings < 1) continue;
        const centreR = spot.row + (dir === "down" ? (word.length - 1) / 2 : 0);
        const centreC = spot.col + (dir === "across" ? (word.length - 1) / 2 : 0);
        const spread = Math.abs(centreR - mid) + Math.abs(centreC - mid);
        const score = (spot.crossings + spot.incidental.length) * 10 - spread * 0.4 + rng();
        if (score > bestScore) {
          bestScore = score;
          best = spot;
        }
      }
    }
    return best;
  }
}

/** Greedy build; `pool[0]` is the spine, placed across the middle row. */
function buildOnce(pool: string[], size: number, target: number, valid: ReadonlySet<string>, rng: Rng): Grid | null {
  const [first, ...remaining] = pool;
  if (!first) return null;
  const grid = new Grid(size, valid);
  grid.place({ entry: first, row: Math.floor(size / 2), col: Math.floor(rng() * (size - first.length + 1)), dir: "across" });

  // Each step considers the next WINDOW placeable words and keeps the one that
  // adds the most crossings and incidental entries, which packs grids tightly.
  const WINDOW = 24;
  while (grid.placements.length < target) {
    let bestIdx = -1;
    let bestSpot: Spot | null = null;
    let bestScore = -Infinity;
    let seen = 0;
    for (let i = 0; i < remaining.length && seen < WINDOW; i++) {
      if (grid.entries.has(remaining[i]!)) continue;
      const spot = grid.bestPlacement(remaining[i]!, rng);
      if (!spot) continue;
      seen++;
      const score = (spot.crossings + spot.incidental.length * 1.5) * 4 - spot.entry.length * 0.15 + rng();
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
        bestSpot = spot;
      }
    }
    if (!bestSpot) break;
    grid.place(bestSpot);
    for (const p of bestSpot.incidental) grid.place(p);
    remaining.splice(bestIdx, 1);
  }
  return grid;
}

/**
 * Build the densest grid found within `attempts` tries. `pool` holds distinct
 * entries in preference order; each attempt samples from its head.
 */
export function generateLayout(pool: string[], size: number, rng: Rng, attempts = 16): Layout | null {
  const target = targetWordCount(size);
  const fitting = pool.filter((w) => w.length <= size);
  const valid = new Set(fitting);
  const sampleSize = Math.min(fitting.length, target * 14);
  let best: Grid | null = null;
  let bestScore = -Infinity;
  for (let a = 0; a < attempts; a++) {
    const sample = shuffle(fitting.slice(0, sampleSize + a * target), rng).slice(0, sampleSize);
    // A long entry first gives the grid a spine (the longest word if none is long);
    // the rest stay in weighted-random order.
    let spine = sample.findIndex((w) => w.length >= Math.ceil(size * 0.55));
    if (spine < 0) spine = sample.reduce((best, w, i) => (w.length > sample[best]!.length ? i : best), 0);
    if (spine > 0) sample.unshift(...sample.splice(spine, 1));
    const grid = buildOnce(sample, size, target, valid, rng);
    if (!grid) continue;
    const score = grid.placements.length * 3 + grid.filled;
    if (score > bestScore) {
      bestScore = score;
      best = grid;
    }
    if (grid.placements.length >= target) break;
  }
  if (!best || best.placements.length < 2) return null;
  return crop(best);
}

function crop(grid: Grid): Layout {
  let minR = grid.size;
  let minC = grid.size;
  let maxR = 0;
  let maxC = 0;
  for (const p of grid.placements) {
    const endR = p.row + (p.dir === "down" ? p.entry.length - 1 : 0);
    const endC = p.col + (p.dir === "across" ? p.entry.length - 1 : 0);
    minR = Math.min(minR, p.row);
    minC = Math.min(minC, p.col);
    maxR = Math.max(maxR, endR);
    maxC = Math.max(maxC, endC);
  }
  return {
    width: maxC - minC + 1,
    height: maxR - minR + 1,
    placements: grid.placements.map((p) => ({ ...p, row: p.row - minR, col: p.col - minC })),
  };
}
