import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionProgression } from "./session-progression.ts";
import { progressionCsv } from "./session-progression-export.ts";
import { importAttendanceCsv } from "./retention-local.ts";

test("aggregate export retains unrounded-basis pp changes, nulls and lifetime units without identifiers", () => {
  const snapshot = importAttendanceCsv("Client,Clinician,Date of service,Location,Status\nprivate-a,Lane,2026-01-01,Room,show\nprivate-a,Lane,2026-01-02,Room,show\nprivate-b,Lane,2026-01-03,Room,show\nprivate-c,Lane,2026-01-03,Room,show").snapshot;
  const result = sessionProgression([snapshot], { start: "2026-01-01", end: "2026-01-31", asOf: "2026-03-01" });
  const csv = progressionCsv(result);
  assert.match(csv, /"1","3","3","100",""/);
  assert.match(csv, /"2","3","1","33.3","-66.7"/);
  assert.match(csv, /Mean elapsed days/);
  assert.match(csv, /not all known active/);
  assert.doesNotMatch(csv, /private-a|private-b|private-c/);
  assert.equal(csv, progressionCsv(result));
});

test("empty export keeps unknown percentages empty, not zero, and escapes formula labels", () => {
  const result = sessionProgression([], { start: "2026-01-01", end: "2026-01-31", asOf: "2026-03-01", clinician: '=HYPERLINK("bad")' });
  const csv = progressionCsv(result);
  assert.match(csv, /"1","0","0","",""/);
  assert.match(csv, /"'=hyperlink\(""bad""\)"/);
});
