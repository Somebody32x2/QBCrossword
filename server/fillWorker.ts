/**
 * Grid construction off the main thread: a fill can search for seconds, and
 * the HTTP server must keep answering meanwhile.
 */

import { fillGrid } from "./fill";
import { generateLayout, seededRng, type Layout } from "./generator";

declare const self: Worker;

export interface FillRequest {
  id: number;
  size: number;
  /** Entry pools in preference order, strictest first. */
  pools: string[][];
  seed: string;
  /** Search time per pool for a fully crossed (American) grid. */
  budgetsMs: number[];
}

export interface FillResponse {
  id: number;
  layout: Layout | null;
  style: "american" | "freeform";
  /** Index of the pool the grid was built from. */
  pool: number;
}

self.onmessage = (event: MessageEvent<FillRequest>) => {
  const { id, size, pools, seed, budgetsMs } = event.data;
  const rng = seededRng(seed);
  let response: FillResponse | null = null;
  for (let i = 0; i < pools.length && !response; i++) {
    const layout = fillGrid(pools[i]!, size, rng, budgetsMs[i] ?? 0);
    if (layout) response = { id, layout, style: "american", pool: i };
  }
  // No fully crossed fill: pack the widest pool as tightly as possible instead.
  const widest = pools.length - 1;
  response ??= { id, layout: generateLayout(pools[widest] ?? [], size, rng), style: "freeform", pool: widest };
  self.postMessage(response);
};
