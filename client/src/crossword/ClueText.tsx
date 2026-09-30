import { useEffect, useRef } from "react";

/** A clue's words and the word counts at which each sentence ends. */
export interface ClueWords {
  words: string[];
  ends: number[];
}

export function clueWords(sentences: string[]): ClueWords {
  const words: string[] = [];
  const ends: number[] = [];
  for (const s of sentences) {
    words.push(...s.split(" ").filter(Boolean));
    ends.push(words.length);
  }
  return { words, ends };
}

/** Sentences shorter than this are joined with the next one when revealing. */
const SHORT_SENTENCE_WORDS = 12;

/** Word count after revealing "a sentence or two" beyond `shown`. */
export function nextStop({ ends }: ClueWords, shown: number): number {
  const i = ends.findIndex((e) => e > shown);
  if (i < 0) return shown;
  const first = ends[i]!;
  return first - shown < SHORT_SENTENCE_WORDS && i + 1 < ends.length ? ends[i + 1]! : first;
}

/** Words visible before any interaction: the first sentence or two. */
export const initialWords = (cw: ClueWords) => nextStop(cw, 0);

/** Word count for "the first n sentences". */
export const wordsForSentences = ({ ends, words }: ClueWords, n: number) =>
  n <= 0 ? 0 : (ends[Math.min(n, ends.length) - 1] ?? words.length);

// Hover reading speed: starts slow, accelerates to rapid.
const FIRST_DELAY_MS = 320;
const ACCELERATION = 0.86;
const MIN_DELAY_MS = 22;

export interface ClueReader {
  /** Attach to the element whose hover keeps reading. */
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  /** Reveal another sentence or two. */
  more: () => void;
}

/**
 * Quizbowl-style reading: hovering reveals further word by word, slowly at
 * first and then rapidly; `more` reveals another sentence or two.
 */
export function useClueReader(cw: ClueWords, shown: number, onShow: (words: number) => void): ClueReader {
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const timer = useRef<number | undefined>(undefined);

  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stop, []);

  return {
    onMouseEnter: () => {
      stop();
      let delay = FIRST_DELAY_MS;
      const tick = () => {
        if (shownRef.current >= cw.words.length) return stop();
        shownRef.current += 1;
        onShow(shownRef.current);
        delay = Math.max(MIN_DELAY_MS, delay * ACCELERATION);
        timer.current = window.setTimeout(tick, delay);
      };
      timer.current = window.setTimeout(tick, delay);
    },
    onMouseLeave: stop,
    more: () => {
      stop();
      if (shownRef.current < cw.words.length) onShow(nextStop(cw, shownRef.current));
    },
  };
}

export function ClueText({ cw, shown }: { cw: ClueWords; shown: number }) {
  const visible = Math.min(shown, cw.words.length);
  const done = visible >= cw.words.length;
  const remaining = cw.ends.filter((e) => e > visible).length;
  return (
    <span className="qbx-clue-text">
      {cw.words.slice(0, visible).join(" ")}
      {!done && (
        <span className="text-body-secondary">
          {" "}
          <i className="bi bi-three-dots" aria-hidden="true" />
          <span className="visually-hidden">
            {remaining} more {remaining === 1 ? "sentence" : "sentences"}
          </span>
        </span>
      )}
    </span>
  );
}
