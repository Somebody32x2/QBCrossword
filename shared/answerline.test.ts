import { describe, expect, test } from "bun:test";
import { parseAnswerline } from "./answerline";
import { redactAnswer, splitSentences, toHint } from "./cluetext";

describe("parseAnswerline", () => {
  const entry = (html: string) => parseAnswerline(html)?.entry ?? null;

  test("takes the required part of the main answer only", () => {
    expect(entry("Johann Sebastian <b><u>Bach</u></b> [or J. S. <b><u>Bach</u></b>]")).toBe("BACH");
    expect(entry("George <b><u>Orwell</u></b> [or Eric Arthur <b><u>Blair</u></b>]")).toBe("ORWELL");
  });

  test("drops plural suffixes but keeps other word continuations", () => {
    expect(entry("<b><u>doctor</u></b>s [or <b><u>physician</u></b>s]")).toBe("DOCTOR");
    expect(entry("<b><u>Jain</u></b>ism")).toBe("JAINISM");
  });

  test("ignores parentheticals and cuts at an unrequired 'or'", () => {
    expect(entry("(Battle of) <b><u>Wounded Knee</u></b> (Massacre)")).toBe("WOUNDEDKNEE");
    expect(entry("<b><u>Hadid</u></b> or Zaha")).toBe("HADID");
  });

  test("merges split tags and reports word lengths", () => {
    const p = parseAnswerline("<b><u>Peter</u></b> <b><u>and the Wolf</u></b>");
    expect(p?.entry).toBe("PETERANDTHEWOLF");
    expect(p?.enumeration).toBe("5,3,3,4");
  });

  test("transliterates diacritics and rejects numbers and regnal numerals", () => {
    expect(entry("Albrecht <b><u>Dürer</u></b>")).toBe("DURER");
    expect(entry("<b><u>1812</u></b> Overture")).toBeNull();
    expect(entry("<b><u>Edward I</u></b>")).toBeNull();
  });

  test("falls back to bold when nothing is underlined, and to plain text when neither is", () => {
    expect(entry("Martin<b> Luther</b>")).toBe("LUTHER");
    expect(entry("Mesopotamia")).toBe("MESOPOTAMIA");
  });
});

describe("clue text", () => {
  test("sentence splitting keeps initials and abbreviations inside sentences", () => {
    expect(splitSentences("J. S. Bach wrote this in St. Louis. For 10 points, name this work by Dr. Seuss.")).toEqual([
      "J. S. Bach wrote this in St. Louis.",
      "For 10 points, name this work by Dr. Seuss.",
    ]);
  });

  test("redaction blanks answer words and their plural/derived forms only", () => {
    expect(redactAnswer("Newton's laws and Newtonian mechanics, unlike Leibniz.", ["Isaac Newton"])).toBe(
      "____ laws and ____ mechanics, unlike Leibniz.",
    );
    expect(redactAnswer("The king of the constructor guild.", ["King of the constructor"])).toBe("The ____ of the ____ guild.");
  });
});

describe("toHint", () => {
  test("turns a giveaway into a standalone clue", () => {
    expect(toHint("For 10 points, name this composer of the Brandenburg Concertos.", ["Bach"])).toBe(
      "This composer of the Brandenburg Concertos.",
    );
    expect(toHint("Name these particles that come in six flavors.", ["quark"])).toBe("These particles that come in six flavors.");
    expect(toHint("Exemplified by cholesterol, for 10 points, name these compounds commonly called fats.", ["lipid"])).toBe(
      "Exemplified by cholesterol, these compounds commonly called fats.",
    );
    expect(toHint("This poet wrote The Waste Land and other poems, for 10 points.", ["Eliot"])).toBe(
      "This poet wrote The Waste Land and other poems.",
    );
  });

  test("rejects sentences that lean on earlier context or blank out the answer", () => {
    expect(toHint("He also wrote this play about a salesman.", ["Miller"])).toBeNull();
    expect(toHint("Lucky appears in that play by this author.", ["Beckett"])).toBeNull();
    expect(toHint("This other branch of Buddhism stresses meditation.", ["Zen"])).toBeNull();
    expect(toHint("This Wittig reaction uses a phosphonium ylide.", ["Wittig"])).toBeNull();
    expect(toHint("Wolves raised the twins in a cave.", ["Rome"])).toBeNull();
  });
});
