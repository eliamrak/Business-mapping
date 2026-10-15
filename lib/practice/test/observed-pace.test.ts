import { test } from "node:test";
import assert from "node:assert/strict";
import { observedSessionPace } from "../src/hub/observed-pace.ts";

const visit = (date: string, completed = 1) => ({ id: -1, clinicianId: 1, start: date, end: date, completed });
const coverage = [{ clinicianId: 1, start: "2026-08-20", end: "2026-10-14" }];

test("sparse visits use calendar-window estimates, not visit-date extrapolation", () => {
  const pace = observedSessionPace([visit("2026-09-10", 66)], 1, "2026-10-14");
  assert.equal(pace.weekly, 66 * 7 / 56);
  assert.equal(pace.recordedDays, 0);
  assert.match(pace.basis, /coverage unverified/);
});

test("verified zero service days retain the full reported denominator", () => {
  const pace = observedSessionPace([visit("2026-09-10", 66)], 1, "2026-10-14", undefined, coverage);
  assert.equal(pace.weekly, 66 * 7 / 56);
  assert.equal(pace.recordedDays, 56);
  assert.equal(pace.basis, "reported-calendar average");
});

test("current covered zero is not replaced by stale positive activity", () => {
  const pace = observedSessionPace([visit("2026-06-01", 20)], 1, "2026-10-14", undefined, coverage);
  assert.equal(pace.weekly, 0);
  assert.equal(pace.historicalFallback, false);
});

test("missing observations are unknown while old reports remain labeled fallback", () => {
  assert.equal(observedSessionPace([], 1, "2026-10-14").weekly, null);
  const pace = observedSessionPace([{ id: 1, clinicianId: 1, start: "2026-06-01", end: "2026-06-14", completed: 20 }], 1, "2026-10-14");
  assert.equal(pace.weekly, 10);
  assert.equal(pace.historicalFallback, true);
  assert.equal(pace.basis, "reported-period average");
});

test("overlapping aggregate evidence is withheld rather than summed or prorated", () => {
  const records = [{ id: 1, clinicianId: 1, start: "2026-09-01", end: "2026-09-14", completed: 40 }, visit("2026-09-07")];
  assert.equal(observedSessionPace(records, 1, "2026-10-14").weekly, null);
  const crossing = [{ ...records[0], start: "2026-08-13", end: "2026-08-26" }, visit("2026-09-07")];
  assert.equal(observedSessionPace(crossing, 1, "2026-10-14").weekly, 1 / 8);
});
