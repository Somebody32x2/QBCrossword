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

/** Word-count target per grid size; beyond this grids get cramped and slow to solve. */
export function targetWordCount(size: number): number {
  return Math.round(size * size * 0.14) + 2;
}

const ACROSS = 1;
const DOWN = 2;

interface Spot extends Placement {
  crossings: number;
}

class Grid {
  readonly letters: Uint8Array;
  readonly used: Uint8Array;
  readonly placements: Placement[] = [];
  /** Filled cell indices per letter (A = 0), the only places a new word can cross. */
  private readonly byLetter: number[][] = Array.from({ length: 26 }, () => []);
  filled = 0;

  constructor(readonly size: number) {
    this.letters = new Uint8Array(size * size);
    this.used = new Uint8Array(size * size);
  }

  private at(r: number, c: number): number {
    return r < 0 || c < 0 || r >= this.size || c >= this.size ? 0 : this.letters[r * this.size + c]!;
  }

  /** Crossing count for a legal placement, or -1 if the placement is illegal. */
  crossings(word: string, row: number, col: number, dir: Direction): number {
    const dr = dir === "down" ? 1 : 0;
    const dc = dir === "across" ? 1 : 0;
    const endR = row + dr * (word.length - 1);
    const endC = col + dc * (word.length - 1);
    if (row < 0 || col < 0 || endR >= this.size || endC >= this.size) return -1;
    if (this.at(row - dr, col - dc) || this.at(endR + dr, endC + dc)) return -1;
    const mask = dir === "across" ? ACROSS : DOWN;
    let crossings = 0;
    for (let i = 0; i < word.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      const cell = this.letters[r * this.size + c]!;
      if (cell) {
        if (cell !== word.charCodeAt(i) || this.used[r * this.size + c]! & mask) return -1;
        crossings++;
      } else if (this.at(r - dc, c - dr) || this.at(r + dc, c + dr)) {
        return -1;
      }
    }
    return crossings === word.length ? -1 : crossings;
  }

  place(word: string, row: number, col: number, dir: Direction): void {
    const dr = dir === "down" ? 1 : 0;
    const dc = dir === "across" ? 1 : 0;
    const mask = dir === "across" ? ACROSS : DOWN;
    for (let i = 0; i < word.length; i++) {
      const idx = (row + dr * i) * this.size + col + dc * i;
      if (!this.letters[idx]) {
        this.filled++;
        this.byLetter[word.charCodeAt(i) - 65]!.push(idx);
      }
      this.letters[idx] = word.charCodeAt(i);
      this.used[idx]! |= mask;
    }
    this.placements.push({ entry: word, row, col, dir });
  }

  /** Best legal crossing placement for `word`, favouring many crossings and a centred grid. */
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
        const row = dir === "down" ? r - i : r;
        const col = dir === "across" ? c - i : c;
        const crossings = this.crossings(word, row, col, dir);
        if (crossings < 1) continue;
        const centreR = row + (dir === "down" ? (word.length - 1) / 2 : 0);
        const centreC = col + (dir === "across" ? (word.length - 1) / 2 : 0);
        const spread = Math.abs(centreR - mid) + Math.abs(centreC - mid);
        const score = crossings * 10 - spread * 0.4 + rng();
        if (score > bestScore) {
          bestScore = score;
          best = { entry: word, row, col, dir, crossings };
        }
      }
    }
    return best;
  }
}

function buildOnce(pool: string[], size: number, target: number, rng: Rng): Grid | null {
  const grid = new Grid(size);
  const firstIdx = pool.findIndex((w) => w.length >= Math.ceil(size * 0.55));
  if (firstIdx < 0) return null;
  const first = pool[firstIdx]!;
  const row = Math.floor(size / 2);
  const col = Math.floor(rng() * (size - first.length + 1));
  grid.place(first, row, col, "across");

  // Each step considers the next WINDOW placeable words and keeps the one that
  // crosses the most entries, which packs grids far tighter than first-fit.
  const WINDOW = 24;
  const remaining = pool.filter((_, i) => i !== firstIdx);
  while (grid.placements.length < target) {
    let bestIdx = -1;
    let bestSpot: Spot | null = null;
    let bestScore = -Infinity;
    let seen = 0;
    for (let i = 0; i < remaining.length && seen < WINDOW; i++) {
      const spot = grid.bestPlacement(remaining[i]!, rng);
      if (!spot) continue;
      seen++;
      const score = spot.crossings * 4 - spot.entry.length * 0.15 + rng();
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
        bestSpot = spot;
      }
    }
    if (!bestSpot) break;
    grid.place(bestSpot.entry, bestSpot.row, bestSpot.col, bestSpot.dir);
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
  const sampleSize = Math.min(fitting.length, target * 14);
  let best: Grid | null = null;
  let bestScore = -Infinity;
  for (let a = 0; a < attempts; a++) {
    const sample = shuffle(fitting.slice(0, sampleSize + a * target), rng).slice(0, sampleSize);
    // A long entry first gives the grid a spine; the rest stay in weighted-random order.
    const spine = sample.findIndex((w) => w.length >= Math.ceil(size * 0.55));
    if (spine > 0) sample.unshift(...sample.splice(spine, 1));
    const grid = buildOnce(sample, size, target, rng);
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
