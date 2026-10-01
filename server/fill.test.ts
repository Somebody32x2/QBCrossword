import { expect, test } from "bun:test";
import { fillGrid, makePattern } from "./fill";
import { seededRng } from "./generator";

/** Every 3-5 letter string over a tiny alphabet: a dictionary dense enough that small grids always fill. */
function dictionary(): string[] {
  const letters = "AEIOST";
  let level = [""];
  const out: string[] = [];
  for (let len = 1; len <= 5; len++) {
    level = level.flatMap((p) => [...letters].map((l) => p + l));
    if (len >= 3) out.push(...level);
  }
  return out;
}

test("patterns are symmetric, connected, and have no runs shorter than three", () => {
  for (const seed of ["a", "b", "c", "d"]) {
    const n = 9;
    const black = makePattern(n, 0.2, seededRng(seed));
    if (!black) continue;
    for (let i = 0; i < n * n; i++) expect(black[i]).toBe(black[n * n - 1 - i]!);
    for (let r = 0; r < n; r++) {
      for (const horizontal of [true, false]) {
        const line = Array.from({ length: n }, (_, k) => (black[horizontal ? r * n + k : k * n + r] ? "#" : "."))
          .join("")
          .split("#")
          .filter(Boolean);
        for (const run of line) expect(run.length).toBeGreaterThanOrEqual(3);
      }
    }
  }
});

test("a filled grid crosses every white square both ways with distinct, real entries", () => {
  const words = dictionary();
  const known = new Set(words);
  const layout = fillGrid(words, 5, seededRng("fill"), 5000)!;
  expect(layout).not.toBeNull();
  const n = layout.width;
  const grid: string[] = Array(n * n).fill("");
  const across = new Set<number>();
  const down = new Set<number>();
  for (const p of layout.placements) {
    expect(known.has(p.entry)).toBe(true);
    for (let i = 0; i < p.entry.length; i++) {
      const idx = (p.row + (p.dir === "down" ? i : 0)) * n + p.col + (p.dir === "across" ? i : 0);
      expect(grid[idx] === "" || grid[idx] === p.entry[i]).toBe(true);
      grid[idx] = p.entry[i]!;
      (p.dir === "across" ? across : down).add(idx);
    }
  }
  for (let i = 0; i < n * n; i++) if (grid[i]) expect(across.has(i) && down.has(i)).toBe(true);
  expect(new Set(layout.placements.map((p) => p.entry)).size).toBe(layout.placements.length);
});
