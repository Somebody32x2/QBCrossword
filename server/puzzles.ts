/** Puzzle construction from the clue store, public views, and answer checking. */

import type { AnswerView, ClueView, DailyInfo, PuzzleConfig, PuzzleView } from "../shared/types";
import { DAILY_SCHEDULE, DAILY_TIMEZONE, DIFFICULTIES } from "../shared/taxonomy";
import type { ClueRow, ClueStore } from "./clues";
import { generateLayout, seededRng, targetWordCount, type Rng } from "./generator";
import type { PuzzleRecord, StoredLayout } from "./store";

export class NotEnoughCluesError extends Error {}

/** Grids under this share of the word target read as sparse; ask for broader filters instead. */
const MIN_FILL = 0.45;

export function buildLayout(clues: ClueStore, config: PuzzleConfig, rng: Rng): StoredLayout {
  const { order, rowids } = clues.candidates(config, config.size, rng);
  const layout = generateLayout(order, config.size, rng);
  if (!layout || layout.placements.length < targetWordCount(config.size) * MIN_FILL) {
    throw new NotEnoughCluesError(
      `Only ${order.length} distinct answers match these settings, not enough for a ${config.size}x${config.size} grid.`,
    );
  }
  return {
    width: layout.width,
    height: layout.height,
    placements: layout.placements.map((p) => {
      const ids = rowids.get(p.entry)!;
      const row = clues.byRowid(ids[Math.floor(rng() * ids.length)]!)!;
      return { ...p, clueId: row.id };
    }),
  };
}

export function newPuzzleId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Buffer.from(bytes).toString("base64url");
}

/** Cell numbers in reading order, shared by the view and the checker. */
function numberLayout(layout: StoredLayout) {
  const { width, height } = layout;
  const open = new Array<boolean>(width * height).fill(false);
  const solution = new Array<string>(width * height).fill("");
  for (const p of layout.placements) {
    for (let i = 0; i < p.entry.length; i++) {
      const idx = (p.row + (p.dir === "down" ? i : 0)) * width + p.col + (p.dir === "across" ? i : 0);
      open[idx] = true;
      solution[idx] = p.entry[i]!;
    }
  }
  const starts = new Map<string, number>();
  for (const p of layout.placements) starts.set(`${p.row},${p.col}`, 0);
  const cells: Array<number | null> = open.map((o) => (o ? 0 : null));
  let n = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (starts.has(`${r},${c}`)) {
        cells[r * width + c] = ++n;
        starts.set(`${r},${c}`, n);
      }
    }
  }
  return { cells, solution, numberAt: (r: number, c: number) => starts.get(`${r},${c}`)! };
}

export function difficultyLabel(difficulties: number[]): string {
  if (difficulties.length === 0) return "All difficulties";
  const names = difficulties.map((d) => DIFFICULTIES.find(([v]) => v === d)?.[1] ?? String(d));
  return names.length <= 2 ? names.join(" + ") : `${names[0]} to ${names[names.length - 1]}`;
}

export function puzzleView(p: PuzzleRecord, clues: ClueStore, label?: string): PuzzleView {
  const { cells, numberAt } = numberLayout(p.layout);
  const views: ClueView[] = [];
  for (const pl of p.layout.placements) {
    const row = clues.get(pl.clueId);
    if (!row) continue;
    const number = numberAt(pl.row, pl.col);
    views.push({
      key: `${number}-${pl.dir}`,
      number,
      dir: pl.dir,
      row: pl.row,
      col: pl.col,
      length: pl.entry.length,
      enumeration: row.enumeration,
      sentences: JSON.parse(row.sentences) as string[],
      category: row.category,
      subcategory: row.subcategory,
      alternateSubcategory: row.alternate_subcategory,
      difficulty: row.difficulty,
      setName: row.set_name,
      qbreaderId: row.id,
    });
  }
  views.sort((a, b) => (a.dir === b.dir ? a.number - b.number : a.dir === "across" ? -1 : 1));
  return {
    id: p.id,
    kind: p.kind,
    date: p.date,
    difficultyLabel: label ?? difficultyLabel(p.config.difficulties),
    config: p.config,
    width: p.layout.width,
    height: p.layout.height,
    cells,
    clues: views,
  };
}

export function answers(p: PuzzleRecord, clues: ClueStore): Record<string, AnswerView> {
  const { numberAt } = numberLayout(p.layout);
  const out: Record<string, AnswerView> = {};
  for (const pl of p.layout.placements) {
    const row: ClueRow | null = clues.get(pl.clueId);
    out[`${numberAt(pl.row, pl.col)}-${pl.dir}`] = {
      entry: pl.entry,
      display: row?.display ?? pl.entry,
      answer: row?.answer ?? pl.entry,
    };
  }
  return out;
}

export function solutionOf(p: PuzzleRecord): string[] {
  return numberLayout(p.layout).solution;
}

/** Indices of filled cells that are wrong. Empty cells are never reported. */
export function wrongCells(p: PuzzleRecord, letters: string[], indices?: number[]): number[] {
  const solution = solutionOf(p);
  const check = indices ?? solution.map((_, i) => i);
  return check.filter((i) => solution[i] && letters[i] && letters[i] !== solution[i]);
}

export function isSolved(p: PuzzleRecord, letters: string[]): boolean {
  return solutionOf(p).every((s, i) => !s || letters[i] === s);
}

// ---------------------------------------------------------------------------
// Daily puzzle

const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: DAILY_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function dailyDate(now = new Date()): string {
  return dateFormat.format(now);
}

export function weekdayOf(date: string): number {
  // Noon UTC keeps the calendar date stable regardless of the server's zone.
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function getOrCreateDaily(
  date: string,
  clues: ClueStore,
  store: { getDaily(date: string): PuzzleRecord | null; insertPuzzle(p: PuzzleRecord): void },
): PuzzleRecord {
  const existing = store.getDaily(date);
  if (existing) return existing;
  const rule = DAILY_SCHEDULE[weekdayOf(date)]!;
  const config: PuzzleConfig = {
    size: rule.size,
    difficulties: rule.difficulties,
    categories: [],
    subcategories: [],
    alternateSubcategories: [],
  };
  const layout = buildLayout(clues, config, seededRng(`daily:${date}`));
  store.insertPuzzle({ id: `daily-${date}`, kind: "daily", date, config, layout });
  // A concurrent request may have inserted first; the stored row wins either way.
  return store.getDaily(date)!;
}

export function dailyInfo(p: PuzzleRecord): DailyInfo {
  const date = p.date!;
  const rule = DAILY_SCHEDULE[weekdayOf(date)]!;
  return {
    date,
    weekday: WEEKDAYS[weekdayOf(date)]!,
    puzzleId: p.id,
    size: p.config.size,
    width: p.layout.width,
    height: p.layout.height,
    wordCount: p.layout.placements.length,
    difficulties: p.config.difficulties,
    difficultyLabel: rule.label,
  };
}
