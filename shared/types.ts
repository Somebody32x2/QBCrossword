/** Wire types shared by the server and the client. */

export type Direction = "across" | "down";

export interface PuzzleConfig {
  size: number;
  difficulties: number[];
  categories: string[];
  subcategories: string[];
  alternateSubcategories: string[];
}

export interface ClueView {
  /** e.g. "12-across" */
  key: string;
  number: number;
  dir: Direction;
  row: number;
  col: number;
  length: number;
  /** A single sentence from a quizbowl question about the answer. */
  text: string;
  category: string;
  subcategory: string;
  alternateSubcategory: string | null;
  /** Effective difficulty of this sentence (source level shifted by its position). */
  difficulty: number;
  setName: string;
  sourceType: "tossup" | "bonus";
  /** QB Reader id of the source question. */
  sourceId: string;
}

export interface PuzzleView {
  id: string;
  kind: "daily" | "custom";
  /** Daily puzzles only: YYYY-MM-DD in the daily time zone. */
  date: string | null;
  difficultyLabel: string;
  /** Difficulty levels added on each side of the request to find a full fill (0 = as asked). */
  widened: number;
  /** "american": every square crossed both ways; "freeform": packed fallback. */
  style: "american" | "freeform";
  config: PuzzleConfig;
  width: number;
  height: number;
  /** Row-major; null = block, 0 = open unnumbered, n = clue number. */
  cells: Array<number | null>;
  clues: ClueView[];
}

export interface AnswerView {
  entry: string;
  display: string;
  answer: string;
}

export interface SessionView {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  assisted: boolean;
  claimed: boolean;
  serverNow: number;
}

export interface DailyInfo {
  date: string;
  weekday: string;
  puzzleId: string;
  size: number;
  width: number;
  height: number;
  wordCount: number;
  difficulties: number[];
  difficultyLabel: string;
}

export interface LeaderboardEntry {
  rank: number;
  initials: string;
  ms: number;
}

export interface Leaderboard {
  date: string;
  puzzleId: string | null;
  entries: LeaderboardEntry[];
}

export interface SubmitResult {
  solved: boolean;
  answers?: Record<string, AnswerView>;
  /** Ranked daily sessions only. */
  ms?: number;
  assisted?: boolean;
  qualifies?: boolean;
  claimed?: boolean;
}

export interface MetaView {
  clueCount: number;
  counts: Record<string, number>;
}
