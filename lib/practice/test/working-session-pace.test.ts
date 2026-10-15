import { test } from "node:test";
import assert from "node:assert/strict";
import { workingSessionPace, rollingThreeMonthStart } from "../src/hub/working-session-pace.ts";
const row = (date: string, completed: number, clinicianId = 1) => ({ id: -1, clinicianId, start: date, end: date, completed });
test("three calendar months use a stable inclusive date window, including month-end clamping", () => {
  assert.equal(rollingThreeMonthStart("2026-10-14"), "2026-07-15");
  assert.equal(rollingThreeMonthStart("2026-05-31"), "2026-03-01");
});
test("working pace divides available calendar weeks including quiet weeks, not visit dates", () => {
  const pace = workingSessionPace([row("2026-07-15", 5), row("2026-10-14", 15)], 1, "2026-10-14");
  assert.equal(pace.denominatorDays, 92);
  assert.equal(pace.weekly, 20 * 7 / 92);
  assert.equal(pace.coverageComplete, false);
});
test("each clinician uses their available history and later available report through-date", () => {
  const history = [row("2026-09-15", 5), row("2026-10-14", 25), row("2026-10-01", 7, 2), row("2026-10-07", 7, 2)];
  assert.equal(workingSessionPace(history, 1, "2026-10-14").weekly, 7);
  assert.equal(workingSessionPace(history, 2, "2026-10-14").weekly, 14);
  const reported = workingSessionPace(history, 2, "2026-10-14", [{ clinicianId: 2, start: "2026-10-01", end: "2026-10-14" }]);
  assert.equal(reported.weekly, 7);
});
test("proved quiet reporting periods are zero; absent history and conflicting overlap are unknown", () => {
  assert.equal(workingSessionPace([], 1, "2026-10-14").weekly, null);
  assert.equal(workingSessionPace([], 1, "2026-10-14", [{ clinicianId: 1, start: "2026-07-15", end: "2026-10-14" }]).weekly, 0);
  const manual = { id: 1, clinicianId: 1, start: "2026-10-01", end: "2026-10-14", completed: 20 };
  assert.equal(workingSessionPace([manual, row("2026-10-07", 1)], 1, "2026-10-14").weekly, null);
});
test("a rolling boundary never silently discards an unallocatable part of an aggregate", () => {
  const periods = Array.from({ length: 7 }, (_, index) => {
    const start = new Date(Date.parse("2026-07-09T12:00:00Z") + index * 14 * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.parse(start + "T12:00:00Z") + 13 * 86400000).toISOString().slice(0, 10);
    return { id: index + 1, clinicianId: 1, start, end, completed: 14 };
  });
  const pace = workingSessionPace(periods, 1, "2026-10-14");
  assert.equal(pace.weekly, null);
});
