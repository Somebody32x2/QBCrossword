/** Puzzle construction from the hint store, public views, and answer checking. */

import type { AnswerView, ClueView, DailyInfo, PuzzleConfig, PuzzleView } from "../shared/types";
import { ANY_DIFFICULTY, DAILY_SCHEDULE, DAILY_TIMEZONE, DIFFICULTIES } from "../shared/taxonomy";
import type { FillRequest, FillResponse } from "./fillWorker";
import { seededRng } from "./generator";
import type { HintFilter, HintStore } from "./hints";
import type { PuzzleRecord, StoredHint, StoredLayout } from "./store";

export class NotEnoughCluesError extends Error {}

/** Free-form fallbacks with fewer words than this per grid square are too sparse to serve. */
const MIN_WORDS_PER_CELL = 0.08;

/** Seconds of fill search per grid size before falling back, for the requested pool. */
const FILL_BUDGET_MS: Record<number, number> = { 5: 1500, 7: 2000, 9: 2500, 11: 3500, 13: 4500, 15: 6000 };

// ---------------------------------------------------------------------------
// Fill workers

interface FillJob {
  request: FillRequest;
  resolve: (r: FillResponse) => void;
  reject: (e: Error) => void;
}

const WORKERS = 2;
const idle: Worker[] = [];
const busy = new Map<Worker, FillJob>();
const queue: FillJob[] = [];

function finish(worker: Worker, settle: (job: FillJob) => void): void {
  const job = busy.get(worker);
  busy.delete(worker);
  idle.push(worker);
  if (job) settle(job);
  pump();
}

for (let i = 0; i < WORKERS; i++) {
  const worker = new Worker(new URL("./fillWorker.ts", import.meta.url).href);
  worker.onmessage = (e: MessageEvent<FillResponse>) => finish(worker, (job) => job.resolve(e.data));
  worker.onerror = (e: ErrorEvent) => finish(worker, (job) => job.reject(new Error(`Grid fill failed: ${e.message}`)));
  idle.push(worker);
}

function pump(): void {
  while (idle.length && queue.length) {
    const worker = idle.pop()!;
    const job = queue.shift()!;
    busy.set(worker, job);
    worker.postMessage(job.request);
  }
}

const runFill = (request: FillRequest) =>
  new Promise<FillResponse>((resolve, reject) => {
    queue.push({ request, resolve, reject });
    pump();
  });

// ---------------------------------------------------------------------------

/** The requested levels plus `by` levels either side; Pop Culture (0) is only kept if asked for. */
function widen(difficulties: number[], by: number): number[] {
  if (difficulties.length === 0 || by === 0) return difficulties;
  const out = new Set<number>();
  for (const d of difficulties) for (let k = d - by; k <= d + by; k++) if (k >= 1 && k <= 10) out.add(k);
  if (difficulties.includes(0)) out.add(0);
  return [...out].sort((a, b) => a - b);
}

/** Widening steps tried in order, the last lifting the difficulty filter entirely. */
const WIDTHS = [0, 1, 2, ANY_DIFFICULTY];

/**
 * Build a grid for the config. An American fill is tried on the requested
 * pool, then with the difficulty widened step by step; if none fills, the
 * widest pool is packed free-form instead.
 */
export async function buildLayout(hints: HintStore, config: PuzzleConfig, seed: string, budgetScale = 1): Promise<StoredLayout> {
  const rng = seededRng(`${seed}:pool`);
  const widths = config.difficulties.length ? WIDTHS : [0];
  const filters: HintFilter[] = widths.map((w) => ({ ...config, difficulties: widen(config.difficulties, w) }));
  const candidates = filters.map((f) => hints.candidates(f, config.size, rng));
  const budget = (FILL_BUDGET_MS[config.size] ?? 6000) * budgetScale;
  const result = await runFill({
    size: config.size,
    pools: candidates.map((c) => c.order),
    seed,
    budgetsMs: widths.map((w) => (w === 0 ? budget : budget * 0.5)),
  });
  const { layout } = result;
  if (!layout || layout.placements.length < config.size * config.size * MIN_WORDS_PER_CELL) {
    throw new NotEnoughCluesError(
      `Only ${candidates[result.pool]!.order.length} distinct answers match these subjects, not enough for a ${config.size}x${config.size} grid.`,
    );
  }
  const pool = candidates[result.pool]!;
  return {
    width: layout.width,
    height: layout.height,
    style: result.style,
    widened: widths[result.pool]!,
    placements: layout.placements.map((p) => {
      const h = hints.get(hints.pick(pool.hints.get(p.entry)!, rng))!;
      const hint: StoredHint = {
        text: h.text,
        category: h.category,
        subcategory: h.subcategory,
        alternateSubcategory: h.alternate_subcategory,
        difficulty: h.difficulty,
        setName: h.set_name,
        sourceType: h.source_type,
        sourceId: h.source_id,
        display: h.display,
        answer: h.answer,
      };
      return { ...p, hint };
    }),
  };
}

export function newPuzzleId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString("base64url");
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

export function puzzleView(p: PuzzleRecord, label?: string): PuzzleView {
  const { cells, numberAt } = numberLayout(p.layout);
  const views: ClueView[] = p.layout.placements.map(({ hint, ...pl }) => {
    const number = numberAt(pl.row, pl.col);
    return {
      key: `${number}-${pl.dir}`,
      number,
      dir: pl.dir,
      row: pl.row,
      col: pl.col,
      length: pl.entry.length,
      text: hint.text,
      category: hint.category,
      subcategory: hint.subcategory,
      alternateSubcategory: hint.alternateSubcategory,
      difficulty: hint.difficulty,
      setName: hint.setName,
      sourceType: hint.sourceType,
      sourceId: hint.sourceId,
    };
  });
  views.sort((a, b) => (a.dir === b.dir ? a.number - b.number : a.dir === "across" ? -1 : 1));
  return {
    id: p.id,
    kind: p.kind,
    date: p.date,
    difficultyLabel: label ?? difficultyLabel(p.config.difficulties),
    widened: p.layout.widened,
    style: p.layout.style,
    config: p.config,
    width: p.layout.width,
    height: p.layout.height,
    cells,
    clues: views,
  };
}

export function answers(p: PuzzleRecord): Record<string, AnswerView> {
  const { numberAt } = numberLayout(p.layout);
  const out: Record<string, AnswerView> = {};
  for (const pl of p.layout.placements) {
    out[`${numberAt(pl.row, pl.col)}-${pl.dir}`] = { entry: pl.entry, display: pl.hint.display, answer: pl.hint.answer };
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

/** The daily is built once; this budget multiplier gives it far longer to find a fill. */
const DAILY_BUDGET_SCALE = 3;
const dailyBuilds = new Map<string, Promise<PuzzleRecord>>();

export function getOrCreateDaily(
  date: string,
  hints: HintStore,
  store: { getDaily(date: string): PuzzleRecord | null; insertPuzzle(p: PuzzleRecord): void },
): Promise<PuzzleRecord> {
  const existing = store.getDaily(date);
  if (existing) return Promise.resolve(existing);
  // Concurrent first requests share one build.
  let build = dailyBuilds.get(date);
  if (!build) {
    const rule = DAILY_SCHEDULE[weekdayOf(date)]!;
    const config: PuzzleConfig = { size: rule.size, difficulties: rule.difficulties, categories: [], subcategories: [], alternateSubcategories: [] };
    build = buildLayout(hints, config, `daily:${date}`, DAILY_BUDGET_SCALE)
      .then((layout) => {
        store.insertPuzzle({ id: `daily-${date}`, kind: "daily", date, config, layout });
        return store.getDaily(date)!;
      })
      .finally(() => dailyBuilds.delete(date));
    dailyBuilds.set(date, build);
  }
  return build;
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
