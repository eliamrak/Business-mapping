import { test } from "node:test";
import assert from "node:assert/strict";
import { workingSessionPace, rollingThreeMonthStart } from "../src/hub/working-session-pace.ts";
const row = (date: string, completed: number, clinicianId = 1) => ({ id: -1, clinicianId, start: date, end: date, completed });
const manual = (start: string, end: string, completed: number, clinicianId = 1) => ({ id: 1, clinicianId, start, end, completed });
test("three calendar months use a stable inclusive date window, including month-end clamping", () => {
  assert.equal(rollingThreeMonthStart("2026-10-14"), "2026-07-15");
  assert.equal(rollingThreeMonthStart("2026-05-31"), "2026-03-01");
});
test("occupied visit min/max is not a complete report and cannot become a historical average", () => {
  const pace = workingSessionPace([row("2026-07-15", 5), row("2026-10-14", 15)], 1, "2026-10-14");
  assert.equal(pace.weekly, null);
  assert.equal(pace.denominatorDays, 0);
  assert.equal(pace.through, null);
  assert.equal(pace.excludedRecords.length, 2);
});
test("partial high counts never enter the numerator or denominator of a complete-period average", () => {
  const history = [manual("2026-09-24", "2026-10-07", 14), row("2026-10-08", 1000), row("2026-10-14", 1000)];
  const before = structuredClone(history);
  const pace = workingSessionPace(history, 1, "2026-10-14", [{ clinicianId: 1, start: "2026-10-08", end: "2026-10-14" }]);
  assert.equal(pace.weekly, 7);
  assert.equal(pace.completed, 14);
  assert.equal(pace.denominatorDays, 14);
  assert.equal(pace.recordedDays, 14);
  assert.equal(pace.through, "2026-10-07");
  assert.equal(pace.excludedRecords.length, 2);
  assert.deepEqual(history, before);
});
test("each clinician uses only their complete periods and incomplete gaps are not zero weeks", () => {
  const history = [manual("2026-08-27", "2026-09-09", 14), manual("2026-09-24", "2026-10-07", 42), manual("2026-09-10", "2026-09-23", 7, 2)];
  const first = workingSessionPace(history, 1, "2026-10-14");
  assert.equal(first.weekly, 14);
  assert.equal(first.denominatorDays, 28);
  assert.equal(first.coverageComplete, false);
  assert.equal(workingSessionPace(history, 2, "2026-10-14").weekly, 3.5);
  assert.equal(workingSessionPace(history, 2, "2026-10-14").through, "2026-09-23");
});
test("quiet complete periods are zero and a new complete report advances the average cutoff", () => {
  assert.equal(workingSessionPace([], 1, "2026-10-14").weekly, null);
  const coverage = [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-21" }];
  const quiet = workingSessionPace([], 1, "2026-10-14", coverage);
  assert.equal(quiet.weekly, 0);
  assert.equal(quiet.through, "2026-10-07");
  const complete = workingSessionPace([row("2026-10-08", 28)], 1, "2026-10-22", coverage);
  assert.equal(complete.weekly, 7);
  assert.equal(complete.denominatorDays, 28);
  assert.equal(complete.through, "2026-10-21");
});
test("rolling three months include only whole eligible periods without prorating the boundary aggregate", () => {
  const periods = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(Date.parse("2026-07-02T12:00:00Z") + index * 14 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.parse(start + "T12:00:00Z") + 13 * 86400000).toISOString().slice(0, 10);
    return manual(start, end, index === 0 ? 1000 : 14);
  });
  const pace = workingSessionPace(periods, 1, "2026-10-14");
  assert.equal(pace.lookbackStart, "2026-07-08");
  assert.equal(pace.windowStart, "2026-07-16");
  assert.equal(pace.through, "2026-10-07");
  assert.equal(pace.denominatorDays, 84);
  assert.equal(pace.completed, 84);
  assert.equal(pace.weekly, 7);
  assert.equal(pace.excludedRecordCount, 1);
});
test("conflicting counts and cross-boundary aggregates withhold the affected service period", () => {
  assert.equal(workingSessionPace([manual("2026-09-24", "2026-10-07", 20), row("2026-10-01", 1)], 1, "2026-10-14", [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-07" }]).weekly, null);
  assert.equal(workingSessionPace([manual("2026-09-25", "2026-10-08", 20)], 1, "2026-10-14").weekly, null);
});
test("a later complete manual report replaces retained partial evidence in pace without deleting or summing it", () => {
  const partial = manual("2026-01-01", "2026-01-07", 1000);
  const full = { ...manual("2026-01-01", "2026-01-14", 14), id: 2 };
  const records = [partial, row("2026-01-07", 1000), full];
  const pace = workingSessionPace(records, 1, "2026-01-15");
  assert.equal(pace.completed, 14);
  assert.equal(pace.weekly, 7);
  assert.equal(pace.denominatorDays, 14);
  assert.equal(pace.excludedRecordCount, 2);
  assert.equal(records.length, 3);
});
