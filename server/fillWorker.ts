/**
 * Grid construction off the main thread: a fill can search for seconds, and
 * the HTTP server must keep answering meanwhile. One job at a time per worker.
 */

import { fillGrid } from "./fill";
import { generateLayout, seededRng, type Layout } from "./generator";

declare const self: Worker;

export interface FillRequest {
  size: number;
  /** Entry pools in preference order, strictest first. */
  pools: string[][];
  seed: string;
  /** Search time per pool for a fully crossed (American) grid. */
  budgetsMs: number[];
}

export interface FillResponse {
  layout: Layout | null;
  style: "american" | "freeform";
  /** Index of the pool the grid was built from. */
  pool: number;
}

self.onmessage = (event: MessageEvent<FillRequest>) => {
  const { size, pools, seed, budgetsMs } = event.data;
  const rng = seededRng(seed);
  for (let i = 0; i < pools.length; i++) {
    const layout = fillGrid(pools[i]!, size, rng, budgetsMs[i] ?? 0);
    if (layout) return self.postMessage({ layout, style: "american", pool: i } satisfies FillResponse);
  }
  // No fully crossed fill: pack the widest pool as tightly as possible instead.
  const widest = pools.length - 1;
  self.postMessage({ layout: generateLayout(pools[widest] ?? [], size, rng), style: "freeform", pool: widest } satisfies FillResponse);
};
