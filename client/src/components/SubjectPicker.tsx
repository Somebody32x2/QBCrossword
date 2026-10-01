import { useState } from "react";
import { TAXONOMY } from "../../../shared/taxonomy";
import { Modal } from "./Modal";

/** Selected subjects as `category/subcategory` keys plus alternate subcategory names. */
export interface SubjectSelection {
  subcategories: string[];
  alternates: string[];
}

const ALL_SUBS = Object.entries(TAXONOMY).flatMap(([cat, subs]) => Object.keys(subs).map((s) => `${cat}/${s}`));
const ALL_ALTS = [...new Set(Object.values(TAXONOMY).flatMap((subs) => Object.values(subs).flat()))];

export const ALL_SUBJECTS: SubjectSelection = { subcategories: ALL_SUBS, alternates: ALL_ALTS };

/** Server filter for a selection; everything selected means no filter at all. */
export function subjectFilter(sel: SubjectSelection) {
  const everything = sel.subcategories.length === ALL_SUBS.length && sel.alternates.length === ALL_ALTS.length;
  if (everything) return { categories: [], subcategories: [], alternateSubcategories: [] };
  const pairs = sel.subcategories.map((k) => k.split("/") as [string, string]);
  return {
    categories: [...new Set(pairs.map(([c]) => c))],
    subcategories: [...new Set(pairs.map(([, s]) => s))],
    alternateSubcategories: sel.alternates,
  };
}

export function describeSubjects(sel: SubjectSelection): string {
  if (sel.subcategories.length === ALL_SUBS.length && sel.alternates.length === ALL_ALTS.length) return "All subjects";
  const cats = Object.entries(TAXONOMY).filter(([cat, subs]) => Object.keys(subs).some((s) => sel.subcategories.includes(`${cat}/${s}`)));
  const whole = cats.filter(([cat, subs]) => Object.keys(subs).every((s) => sel.subcategories.includes(`${cat}/${s}`)));
  if (cats.length === 0) return "No subjects";
  if (cats.length <= 3) return cats.map(([c]) => (whole.some(([w]) => w === c) ? c : `${c} (part)`)).join(", ");
  return `${cats.length} categories`;
}

/** Literature alternates are genres shared by every literature subcategory. */
const genresOf = (cat: string) => (cat === "Literature" ? Object.values(TAXONOMY.Literature!)[0]! : []);

export function SubjectPicker({
  value,
  counts,
  onChange,
  onClose,
}: {
  value: SubjectSelection;
  counts: Record<string, number> | null;
  onChange: (v: SubjectSelection) => void;
  onClose: () => void;
}) {
  const [subs, setSubs] = useState(() => new Set(value.subcategories));
  const [alts, setAlts] = useState(() => new Set(value.alternates));

  const toggle = <T,>(set: Set<T>, items: T[], on: boolean) => {
    const next = new Set(set);
    for (const i of items) {
      if (on) next.add(i);
      else next.delete(i);
    }
    return next;
  };
  const count = (key: string) => (counts?.[key] ? <span className="text-body-secondary small ms-1">{counts[key]!.toLocaleString()}</span> : null);

  const apply = () => {
    onChange({ subcategories: ALL_SUBS.filter((s) => subs.has(s)), alternates: ALL_ALTS.filter((a) => alts.has(a)) });
    onClose();
  };

  return (
    <Modal
      title="Subjects"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary me-auto" onClick={() => (setSubs(new Set(ALL_SUBS)), setAlts(new Set(ALL_ALTS)))}>
            Select all
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => (setSubs(new Set()), setAlts(new Set()))}>
            Clear
          </button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={subs.size === 0}>
            Apply
          </button>
        </>
      }
    >
      <p className="small text-body-secondary">Numbers are clue sentences in the database. Narrow subjects may fall back to a looser grid.</p>
      <div className="qbx-subjects">
        {Object.entries(TAXONOMY).map(([cat, subMap]) => {
          const catSubs = Object.keys(subMap).map((s) => `${cat}/${s}`);
          const catAlts = [...new Set(Object.values(subMap).flat())];
          const allOn = catSubs.every((s) => subs.has(s));
          const someOn = catSubs.some((s) => subs.has(s));
          const single = catSubs.length === 1;
          return (
            <fieldset key={cat} className="qbx-subject-group">
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`cat-${cat}`}
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = someOn && !allOn;
                  }}
                  onChange={(e) => {
                    setSubs(toggle(subs, catSubs, e.target.checked));
                    setAlts(toggle(alts, catAlts, e.target.checked));
                  }}
                />
                <label className="form-check-label fw-semibold" htmlFor={`cat-${cat}`}>
                  {cat}
                  {count(cat)}
                </label>
              </div>
              {!single &&
                Object.keys(subMap).map((s) => (
                  <div className="form-check ms-3" key={s}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`sub-${cat}-${s}`}
                      checked={subs.has(`${cat}/${s}`)}
                      onChange={(e) => setSubs(toggle(subs, [`${cat}/${s}`], e.target.checked))}
                    />
                    <label className="form-check-label" htmlFor={`sub-${cat}-${s}`}>
                      {s}
                      {count(`${cat}/${s}`)}
                    </label>
                  </div>
                ))}
              {Object.entries(subMap)
                .filter(([, a]) => a.length > 0 && cat !== "Literature")
                .map(([s, altList]) =>
                  altList.map((a) => (
                    <div className="form-check ms-4" key={`${s}-${a}`}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`alt-${s}-${a}`}
                        checked={alts.has(a)}
                        disabled={!subs.has(`${cat}/${s}`)}
                        onChange={(e) => setAlts(toggle(alts, [a], e.target.checked))}
                      />
                      <label className="form-check-label small" htmlFor={`alt-${s}-${a}`}>
                        {a}
                        {count(`${cat}/${s}/${a}`)}
                      </label>
                    </div>
                  )),
                )}
              {genresOf(cat).length > 0 && (
                <div className="mt-2 ms-3">
                  <div className="small text-body-secondary mb-1">Genres</div>
                  {genresOf(cat).map((g) => (
                    <div className="form-check form-check-inline" key={g}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`genre-${g}`}
                        checked={alts.has(g)}
                        disabled={!someOn}
                        onChange={(e) => setAlts(toggle(alts, [g], e.target.checked))}
                      />
                      <label className="form-check-label small" htmlFor={`genre-${g}`}>
                        {g}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>
          );
        })}
      </div>
    </Modal>
  );
}
