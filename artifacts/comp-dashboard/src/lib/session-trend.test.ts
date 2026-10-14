import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import { buildSessionTrend, containedSessionRecords, selectedPeriodSessionSummary } from "./session-trend.ts";

const record = (clinicianId: number, start: string, end: string, completed: number, inPerson: number | null = null): SessionRecord => ({
  id: clinicianId, clinicianId, start, end, completed, inPerson, desired: 20,
  revision: 1, updatedAt: "2026-10-14", cancelled: null, noShow: null,
  scheduled: null, telehealth: null, sourceAttachmentId: null,
});
const period = { start: "2026-09-07", end: "2026-10-04" };
test("shared bounds exclude crossing aggregates and other contributors without proration", () => {
  const records = [record(1, "2026-09-01", "2026-09-14", 100), record(1, "2026-09-07", "2026-09-20", 20), record(2, "2026-09-07", "2026-09-20", 40)];
  assert.deepEqual(containedSessionRecords(records, [1], period).map((item) => item.completed), [20]);
  assert.deepEqual(selectedPeriodSessionSummary(records, [1], period), { completedWeekly: 10, inPersonWeekly: null, observedCoverageDays: 14 });
});
test("Rooms uses actual in-person facts and observed coverage, including recorded zero", () => {
  const records = [record(1, "2026-09-07", "2026-09-20", 20, 8), record(2, "2026-09-07", "2026-09-20", 40, 0)];
  assert.deepEqual(selectedPeriodSessionSummary(records, [1, 2], period), { completedWeekly: 30, inPersonWeekly: 4, observedCoverageDays: 14 });
  assert.equal(selectedPeriodSessionSummary(records, [1, 2, 3], period).completedWeekly, null);
  records[1].inPerson = null;
  assert.equal(selectedPeriodSessionSummary(records, [1, 2], period).inPersonWeekly, null);
});
test("biweekly observations are single period-rate points with a real practice benchmark", () => {
  const records = [record(1, "2026-09-07", "2026-09-20", 20), record(2, "2026-09-07", "2026-09-20", 40)];
  const points = buildSessionTrend(records, [1], [1, 2], period, () => 15, 12);
  assert.ok(points.every((point) => point.completed === null));
  assert.deepEqual(points.filter((point) => point.periodRate !== null).map((point) => [point.periodRate, point.benchmarkPeriodRate]), [[10, 30]]);
  assert.ok(points.every((point) => point.capacity === 15 && point.required === 12));
});
test("calendar weeks require complete coverage and preserve missing weeks as unknown", () => {
  const records = [record(1, "2026-09-07", "2026-09-13", 0), record(1, "2026-09-21", "2026-09-27", 14), record(2, "2026-09-07", "2026-09-13", 7)];
  const points = buildSessionTrend(records, [1], [1, 2], period, () => 15);
  assert.deepEqual(points.filter((point) => point.completed !== null).map((point) => [point.completed, point.benchmark]), [[0, 7], [14, null]]);
  assert.equal(points.find((point) => point.label === "2026-09-14")?.completed, null);
});
test("daily facts can form an actual calendar week; overlapping facts cannot", () => {
  const records = Array.from({ length: 7 }, (_, index) => record(1, `2026-09-${String(index + 7).padStart(2, "0")}`, `2026-09-${String(index + 7).padStart(2, "0")}`, 2));
  assert.equal(buildSessionTrend(records, [1], [1], period, () => 15)[0].completed, 14);
  assert.equal(buildSessionTrend([...records, records[0]], [1], [1], period, () => 15)[0].completed, null);
  assert.equal(selectedPeriodSessionSummary([...records, records[0]], [1], period).completedWeekly, null);
});
test("empty or invalid ranges have no observed coverage or rate", () => {
  assert.deepEqual(selectedPeriodSessionSummary([], [1], period), { completedWeekly: null, inPersonWeekly: null, observedCoverageDays: 0 });
  assert.deepEqual(buildSessionTrend([], [1], [1], { start: period.end, end: period.start }, () => 10), []);
});

const importedDates = ["09-16", "09-18", "09-21", "09-23", "09-25", "09-28", "09-30", "10-02", "10-05", "10-07", "10-09", "10-12"];
const importedFacts = importedDates.map((date) => record(1, `2026-${date}`, `2026-${date}`, 3));
const selected30 = { start: "2026-09-15", end: "2026-10-14" };
test("one-day imports show calendar totals and partial observed counts without phantom zeros", () => {
  const coverage = [{ clinicianId: 1, start: "2026-09-16", end: "2026-10-12" }];
  const points = buildSessionTrend(importedFacts, [1], [1, 2], selected30, () => 15, undefined, coverage);
  assert.deepEqual(points.filter((point) => point.completed !== null).map((point) => point.completed), [9, 9, 9]);
  assert.equal(points[0].observedCompleted, 6);
  assert.equal(points[0].completed, null);
  assert.equal(points.find((point) => point.label.startsWith("2026-10-12"))?.observedCompleted, 3);
  assert.ok(points.every((point) => point.benchmark === null));
});
test("selected 30-day calendar pace uses explicit coverage rather than 12 active visit days", () => {
  const complete = [{ clinicianId: 1, ...selected30 }];
  const summary = selectedPeriodSessionSummary(importedFacts, [1], selected30, complete);
  assert.equal(summary.completedWeekly, 36 / 30 * 7);
  assert.equal(summary.observedCompleted, 36);
  assert.equal(summary.coverageComplete, true);
  const partial = selectedPeriodSessionSummary(importedFacts, [1], selected30, [{ clinicianId: 1, start: "2026-09-16", end: "2026-10-12" }]);
  assert.equal(partial.completedWeekly, null);
  assert.equal(partial.observedCompleted, 36);
  assert.equal(partial.observedCoverageDays, 27);
  assert.equal(partial.coverageComplete, false);
});
test("coverage union is per clinician and manual gaps stay unknown", () => {
  const facts = [record(1, "2026-09-21", "2026-09-21", 3)];
  const week = { start: "2026-09-21", end: "2026-09-27" };
  const coverage = [{ clinicianId: 1, start: week.start, end: "2026-09-23" }, { clinicianId: 1, start: "2026-09-24", end: week.end }];
  assert.equal(selectedPeriodSessionSummary(facts, [1], week, coverage).completedWeekly, 3);
  assert.equal(selectedPeriodSessionSummary(facts, [1, 2], week, coverage).completedWeekly, null);
  assert.equal(buildSessionTrend(facts, [1], [1], week, () => 10)[0].completed, null);
  assert.equal(buildSessionTrend(facts, [1], [1], week, () => 10)[0].observedCompleted, 3);
});
test("a covered zero week is zero, an uncovered empty week is unknown", () => {
  const week = { start: "2026-09-21", end: "2026-09-27" };
  assert.equal(buildSessionTrend([], [1], [1], week, () => 10, undefined, [{ clinicianId: 1, ...week }])[0].completed, 0);
  assert.equal(buildSessionTrend([], [1], [1], week, () => 10)[0].observedCompleted, null);
});

test("legacy 36 visits over 28 calendar days expose an estimate without verifying pace", () => {
  const period = { start: "2026-10-01", end: "2026-10-28" };
  const facts = [2, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 27].map((day) => ({
    ...record(1, `2026-10-${String(day).padStart(2, "0")}`, `2026-10-${String(day).padStart(2, "0")}`, 3), id: -day,
  }));
  const summary = selectedPeriodSessionSummary(facts, [1], period, []);
  assert.equal(summary.calendarWindowWeeklyEstimate, 9);
  assert.equal(summary.completedWeekly, null);
  assert.equal(summary.coverageComplete, false);
  assert.equal(summary.observedCompleted, 36);
  const points = buildSessionTrend(facts, [1], [1], period, () => 20);
  assert.ok(points.every((point) => point.completed === null && point.benchmark === null));
  assert.equal(points.reduce((sum, point) => sum + (point.observedCompleted ?? 0), 0), 36);
});

test("an imported aggregate cannot produce a filled period-rate point without coverage proof", () => {
  const imported = { ...record(1, "2026-10-01", "2026-10-28", 36), id: -1 };
  const period = { start: imported.start, end: imported.end };
  assert.ok(buildSessionTrend([imported], [1], [1], period, () => 20).every((point) => point.periodRate === null));
  assert.equal(buildSessionTrend([imported], [1], [1], period, () => 20, undefined, [{ clinicianId: 1, ...period }]).at(-1)?.periodRate, 9);
});
