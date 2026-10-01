/** QB Reader's difficulty scale and category taxonomy, plus puzzle presets. */

export const DIFFICULTIES: ReadonlyArray<readonly [number, string]> = [
  [0, "Pop Culture"],
  [1, "Middle School"],
  [2, "Easy High School"],
  [3, "Regular High School"],
  [4, "Hard High School"],
  [5, "National High School"],
  [6, "● / Easy College"],
  [7, "●● / Medium College"],
  [8, "●●● / Regionals College"],
  [9, "●●●● / Nationals College"],
  [10, "Open"],
];

export const DIFFICULTY_PRESETS: ReadonlyArray<{ label: string; difficulties: number[] }> = [
  { label: "Easy", difficulties: [1, 2] },
  { label: "Medium", difficulties: [3, 4] },
  { label: "Hard", difficulties: [5, 6] },
  { label: "Collegiate", difficulties: [7, 8] },
  { label: "Expert", difficulties: [9, 10] },
];

/** Category -> subcategory -> alternate subcategories (empty when the subcategory has none). */
export const TAXONOMY: Record<string, Record<string, string[]>> = {
  Literature: Object.fromEntries(
    [
      "American Literature",
      "British Literature",
      "Classical Literature",
      "European Literature",
      "World Literature",
      "Other Literature",
    ].map((s) => [s, ["Drama", "Long Fiction", "Poetry", "Short Fiction", "Misc Literature"]]),
  ),
  History: {
    "American History": [],
    "Ancient History": [],
    "European History": [],
    "World History": [],
    "Other History": [],
  },
  Science: {
    Biology: [],
    Chemistry: [],
    Physics: [],
    "Other Science": ["Math", "Astronomy", "Computer Science", "Earth Science", "Engineering", "Misc Science"],
  },
  "Fine Arts": {
    "Visual Fine Arts": [],
    "Auditory Fine Arts": [],
    "Other Fine Arts": ["Architecture", "Dance", "Film", "Jazz", "Musicals", "Opera", "Photography", "Misc Arts"],
  },
  Religion: { Religion: [] },
  Mythology: { Mythology: [] },
  Philosophy: { Philosophy: [] },
  "Social Science": {
    "Social Science": ["Anthropology", "Economics", "Linguistics", "Psychology", "Sociology", "Other Social Science"],
  },
  "Current Events": { "Current Events": [] },
  Geography: { Geography: [] },
  "Other Academic": { "Other Academic": [] },
  "Pop Culture": {
    Movies: [],
    Music: [],
    Sports: [],
    Television: [],
    "Video Games": [],
    "Other Pop Culture": [],
  },
};

export const SIZES: ReadonlyArray<{ size: number; label: string }> = [
  { size: 5, label: "Mini" },
  { size: 7, label: "Small" },
  { size: 9, label: "Medium" },
  { size: 11, label: "Large" },
  { size: 13, label: "X-Large" },
  { size: 15, label: "Full" },
];

export interface DailyRule {
  size: number;
  difficulties: number[];
  label: string;
}

/** Daily puzzle rules by weekday (0 = Sunday), ramping up through the week. */
export const DAILY_SCHEDULE: readonly DailyRule[] = [
  { size: 15, difficulties: [4, 5], label: "Hard High School" },
  { size: 11, difficulties: [2], label: "Easy High School" },
  { size: 11, difficulties: [3], label: "Regular High School" },
  { size: 13, difficulties: [4], label: "Hard High School" },
  { size: 13, difficulties: [5], label: "National High School" },
  { size: 13, difficulties: [6], label: "Easy College" },
  { size: 15, difficulties: [7, 8], label: "Regionals College" },
];

export const DAILY_TIMEZONE = "America/New_York";

/** Widening step that drops the difficulty filter: any level may be used. */
export const ANY_DIFFICULTY = 10;
