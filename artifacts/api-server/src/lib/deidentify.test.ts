import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deidentify, type Participant } from "./deidentify";

describe("deidentify", () => {
  test("returns text unchanged when participants is empty", () => {
    const text = "Dear Sasha, thanks for the update.";
    assert.equal(deidentify(text, []), text);
  });

  test("replaces a full name with the role placeholder", () => {
    const p: Participant[] = [{ name: "Sasha Chenoweth", role: "parent" }];
    const out = deidentify("Thanks Sasha Chenoweth for the update.", p);
    assert.equal(out, "Thanks [PARENT_NAME] for the update.");
  });

  test("replaces individual tokens of a multi-word name", () => {
    const p: Participant[] = [{ name: "Sasha Chenoweth", role: "parent" }];
    const out = deidentify("Sasha will bring the form.", p);
    assert.equal(out, "[PARENT_NAME] will bring the form.");
  });

  test("prefers the full-name match over individual tokens (longest-first)", () => {
    // "Sasha" alone would also match; we must still scrub the full name
    // as one unit so we don't get "[PARENT_NAME] [PARENT_NAME]".
    const p: Participant[] = [{ name: "Sasha Chenoweth", role: "parent" }];
    const out = deidentify("Spoke with Sasha Chenoweth today.", p);
    assert.equal(out, "Spoke with [PARENT_NAME] today.");
  });

  test("is case-insensitive but preserves the placeholder casing", () => {
    const p: Participant[] = [{ name: "Mia", role: "patient" }];
    const out = deidentify("MIA is doing well. mia ate breakfast.", p);
    assert.equal(out, "[PATIENT_NAME] is doing well. [PATIENT_NAME] ate breakfast.");
  });

  test("only matches whole words — does not eat substrings", () => {
    // "Sashay" should survive scrubbing of "Sasha".
    const p: Participant[] = [{ name: "Sasha", role: "parent" }];
    const out = deidentify("Sashay across the floor.", p);
    assert.equal(out, "Sashay across the floor.");
  });

  test("uses the correct placeholder for each role", () => {
    const p: Participant[] = [
      { name: "Mia", role: "patient" },
      { name: "Sasha", role: "parent" },
      { name: "Dr Lin", role: "other" },
    ];
    const out = deidentify("Mia, Sasha and Dr Lin met today.", p);
    assert.equal(out, "[PATIENT_NAME], [PARENT_NAME] and [NAME] met today.");
  });

  test("ignores names shorter than 2 characters", () => {
    const p: Participant[] = [{ name: "X", role: "patient" }];
    const out = deidentify("X marks the spot.", p);
    assert.equal(out, "X marks the spot.");
  });

  test("leaves existing placeholder tokens alone", () => {
    const p: Participant[] = [{ name: "Mia", role: "patient" }];
    const out = deidentify("[PATIENT_NAME] is doing well; Mia ate.", p);
    assert.equal(out, "[PATIENT_NAME] is doing well; [PATIENT_NAME] ate.");
  });

  test("handles trailing punctuation around a name", () => {
    const p: Participant[] = [{ name: "Mia", role: "patient" }];
    const out = deidentify("How is Mia? Mia, please reply. (Mia)", p);
    assert.equal(out, "How is [PATIENT_NAME]? [PATIENT_NAME], please reply. ([PATIENT_NAME])");
  });

  test("does not scrub drug names that happen to coincide with non-listed words", () => {
    // Only listed participants are scrubbed; clinical vocabulary is safe.
    const p: Participant[] = [{ name: "James", role: "patient" }];
    const out = deidentify(
      "Continue Ritalin 54mg. Review James at next visit.",
      p,
    );
    assert.equal(out, "Continue Ritalin 54mg. Review [PATIENT_NAME] at next visit.");
  });

  test("returns input unchanged when name does not appear", () => {
    const p: Participant[] = [{ name: "Mia", role: "patient" }];
    const text = "No patient name in this sentence.";
    assert.equal(deidentify(text, p), text);
  });

  test("dedupes overlapping participant entries (same name, same role)", () => {
    const p: Participant[] = [
      { name: "Mia", role: "patient" },
      { name: "Mia", role: "patient" },
    ];
    const out = deidentify("Mia is here.", p);
    assert.equal(out, "[PATIENT_NAME] is here.");
  });

  test("handles a name with regex-special characters safely", () => {
    const p: Participant[] = [{ name: "O'Brien", role: "other" }];
    // Apostrophe is not a word character so \b matches around it normally.
    const out = deidentify("Met with O'Brien today.", p);
    assert.equal(out, "Met with [NAME] today.");
  });
});
