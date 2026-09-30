import { expect, test } from "bun:test";
import { generateLayout, seededRng, type Layout } from "./generator";

const WORDS = (
  "ATLAS HOMER ODIN THOR ZEUS HERA ROME PARIS NILE AMAZON EULER GAUSS NEWTON DARWIN CURIE BOHR KEATS BYRON DANTE " +
  "IBSEN LORCA GOETHE MONET MANET DEGAS GOYA RAVEL VERDI BIZET HANDEL MOZART HAYDN ELGAR OPERA SONATA FUGUE ETUDE " +
  "OXYGEN CARBON NEON ARGON XENON RADON BORON IRON COBALT NICKEL ZINC TIN LEAD GOLD SILVER PLATO KANT HUME LOCKE " +
  "HOBBES MILL RAWLS SARTRE CAMUS KAFKA ORWELL AUSTEN BRONTE DICKENS HARDY ELIOT WOOLF JOYCE BECKETT YEATS"
).split(" ");

/** Every maximal run of 2+ letters, read from the grid, as "row,col,dir:WORD". */
function runs(layout: Layout): string[] {
  const grid: string[][] = Array.from({ length: layout.height }, () => Array(layout.width).fill(""));
  for (const p of layout.placements) {
    for (let i = 0; i < p.entry.length; i++) {
      const r = p.row + (p.dir === "down" ? i : 0);
      const c = p.col + (p.dir === "across" ? i : 0);
      const cell = grid[r]![c]!;
      expect(cell === "" || cell === p.entry[i]).toBe(true);
      grid[r]![c] = p.entry[i]!;
    }
  }
  const out: string[] = [];
  const at = (r: number, c: number) => grid[r]?.[c] ?? "";
  for (let r = 0; r < layout.height; r++) {
    for (let c = 0; c < layout.width; c++) {
      if (!at(r, c)) continue;
      for (const [dir, dr, dc] of [["across", 0, 1], ["down", 1, 0]] as const) {
        if (at(r - dr, c - dc)) continue;
        let word = "";
        for (let k = 0; at(r + dr * k, c + dc * k); k++) word += at(r + dr * k, c + dc * k);
        if (word.length > 1) out.push(`${r},${c},${dir}:${word}`);
      }
    }
  }
  return out.sort();
}

test("grids stay in bounds and contain no accidental words", () => {
  for (const size of [7, 11, 15]) {
    for (const seed of ["a", "b", "c"]) {
      const layout = generateLayout(WORDS, size, seededRng(`${size}${seed}`))!;
      expect(layout).not.toBeNull();
      expect(layout.width).toBeLessThanOrEqual(size);
      expect(layout.height).toBeLessThanOrEqual(size);
      const placed = layout.placements.map((p) => `${p.row},${p.col},${p.dir}:${p.entry}`).sort();
      expect(runs(layout)).toEqual(placed);
      expect(new Set(layout.placements.map((p) => p.entry)).size).toBe(layout.placements.length);
    }
  }
});

test("the same seed builds the same grid", () => {
  const a = generateLayout(WORDS, 15, seededRng("daily:2026-09-30"));
  const b = generateLayout(WORDS, 15, seededRng("daily:2026-09-30"));
  expect(a).toEqual(b);
});
