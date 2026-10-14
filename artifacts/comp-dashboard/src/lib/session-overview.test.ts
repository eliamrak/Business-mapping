import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import {
  lastCompleted1099ServicePeriod,
  firstHiringReviewMonth,
  summarizeHiringReadiness,
  summarizeLast1099Period,
  summarizeSessionOverview,
  observedBiweeklySessionRecords,
} from "./session-overview.ts";

const record = (start: string, end: string, completed: number): SessionRecord => ({
  id: 1, revision: 1, updatedAt: "2026-09-26T12:00:00Z",
  clinicianId: 1, start, end, completed, desired: 30,
  cancelled: null, noShow: null, scheduled: null, inPerson: null,
  telehealth: null, sourceAttachmentId: null,
});

test("session overview shows average filled and open weekly capacity against the current goal", () => {
  const overview = summarizeSessionOverview([
    record("2026-04-09", "2026-04-22", 21),
    record("2026-04-23", "2026-05-06", 27),
  ], [record("2026-03-26", "2026-04-08", 16)], 15);
  assert.equal(overview.latest?.completed, 27);
  assert.equal(overview.averageWeekly, 12);
  assert.equal(overview.goalWeekly, 15);
  assert.equal(overview.openWeekly, 3);
  assert.equal(overview.fullness, 80);
  assert.equal(overview.trendWeekly, 4);
  assert.equal(overview.count, 2);
});

test("missing totals stay unknown, while a recorded zero remains zero", () => {
  const empty = summarizeSessionOverview([], [], 15);
  assert.equal(empty.averageWeekly, null);
  assert.equal(empty.openWeekly, null);
  assert.equal(empty.fullness, null);
  assert.equal(empty.trendWeekly, null);
  const zero = summarizeSessionOverview([record("2026-04-09", "2026-04-22", 0)], [], 15);
  assert.equal(zero.averageWeekly, 0);
  assert.equal(zero.openWeekly, 15);
  assert.equal(zero.fullness, 0);
});

test("short periods are normalized to a weekly pace and no goal avoids false openings", () => {
  const overview = summarizeSessionOverview([
    record("2026-04-09", "2026-04-15", 7),
  ], [], 0);
  assert.equal(overview.averageWeekly, 7);
  assert.equal(overview.goalWeekly, 0);
  assert.equal(overview.openWeekly, null);
  assert.equal(overview.fullness, null);
});

test("sessions beyond goal do not report negative room", () => {
  const overview = summarizeSessionOverview([
    record("2026-04-09", "2026-04-22", 24),
  ], [record("2026-03-26", "2026-04-08", 24)], 10);
  assert.equal(overview.openWeekly, 0);
  assert.equal(overview.overGoalWeekly, 2);
  assert.equal(overview.fullness, 120);
  assert.equal(overview.trendWeekly, 0);
});

test("last 1099 period follows the anchored Thursday payroll calendar", () => {
  assert.deepEqual(lastCompleted1099ServicePeriod("2026-10-02"), {
    payDate: "2026-09-24",
    start: "2026-09-10",
    end: "2026-09-23",
  });
  assert.deepEqual(lastCompleted1099ServicePeriod("2026-10-07"), {
    payDate: "2026-09-24",
    start: "2026-09-10",
    end: "2026-09-23",
  });
  assert.deepEqual(lastCompleted1099ServicePeriod("2026-10-08"), {
    payDate: "2026-10-08",
    start: "2026-09-24",
    end: "2026-10-07",
  });
});

test("last 1099 period distinguishes missing data from recorded zero", () => {
  const missing = summarizeLast1099Period([], "2026-10-02");
  assert.equal(missing?.completed, null);
  assert.equal(missing?.recorded, false);
  const zero = summarizeLast1099Period([
    record("2026-09-10", "2026-09-23", 0),
  ], "2026-10-02");
  assert.equal(zero?.completed, 0);
  assert.equal(zero?.recorded, true);
});

test("last 14-day payroll card sums dated imported facts and identifies partial coverage", () => {
  const facts = [record("2026-09-24", "2026-09-24", 3), record("2026-10-07", "2026-10-07", 4)];
  const complete = summarizeLast1099Period(facts, "2026-10-14", [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-07" }], 1);
  assert.equal(complete?.completed, 7);
  assert.equal(complete?.coverageComplete, true);
  const partial = summarizeLast1099Period(facts, "2026-10-14", [], 1);
  assert.equal(partial?.completed, 7);
  assert.equal(partial?.coverageComplete, false);
});
test("overview calendar pace preserves a partial observed total without goal fullness", () => {
  const facts = [record("2026-09-16", "2026-09-16", 36)];
  const period = { start: "2026-09-15", end: "2026-10-14" };
  const options = { period, clinicianId: 1, attendanceCoverage: [{ clinicianId: 1, ...period }] };
  assert.equal(summarizeSessionOverview(facts, [], 15, options).averageWeekly, 8.4);
  const partial = summarizeSessionOverview(facts, [], 15, { ...options, attendanceCoverage: [] });
  assert.equal(partial.averageWeekly, null);
  assert.equal(partial.observedCompleted, 36);
  assert.equal(partial.fullness, null);
});
test("last 14 days excludes crossing manual aggregates without proration", () => {
  const result = summarizeLast1099Period([record("2026-09-20", "2026-10-03", 20)], "2026-10-14", [], 1);
  assert.equal(result?.completed, null);
  assert.equal(result?.recorded, false);
});

test("legacy observed total stays visible while weekly comparisons and fullness stay unknown", () => {
  const facts = [{ ...record("2026-10-02", "2026-10-02", 178), id: -1 }];
  const overview = summarizeSessionOverview(facts, [record("2026-09-03", "2026-09-30", 160)], 20, {
    clinicianId: 1, period: { start: "2026-10-01", end: "2026-10-28" },
    previousPeriod: { start: "2026-09-03", end: "2026-09-30" }, attendanceCoverage: [],
  });
  assert.equal(overview.observedCompleted, 178);
  assert.equal(overview.calendarWindowWeeklyEstimate, 44.5);
  assert.equal(overview.averageWeekly, null);
  assert.equal(overview.fullness, null);
  assert.equal(overview.openWeekly, null);
  assert.equal(overview.trendWeekly, null);
});

test("overlapping totals remain unknown instead of falling back to double-counted observations", () => {
  const facts = [record("2026-10-01", "2026-10-14", 20), record("2026-10-01", "2026-10-14", 20)];
  const overview = summarizeSessionOverview(facts, [], 20, {
    clinicianId: 1, period: { start: "2026-10-01", end: "2026-10-14" }, attendanceCoverage: [],
  });
  assert.equal(overview.observedCompleted, null);
  assert.equal(overview.calendarWindowWeeklyEstimate, null);
});
test("daily import hiring uses four complete payroll windows, not four visit dates", () => {
  const coverage = [{ clinicianId: 1, start: "2026-08-27", end: "2026-10-21" }];
  const facts = [record("2026-08-27", "2026-08-27", 18), record("2026-09-10", "2026-09-10", 18), record("2026-09-24", "2026-09-24", 18), record("2026-10-08", "2026-10-08", 18)];
  const periods = observedBiweeklySessionRecords(facts, 1, "2026-10-22", coverage);
  assert.equal(periods.length, 4);
  assert.equal(summarizeHiringReadiness([{ id: 1, goalWeekly: 10, records: periods }], 80).status, "review_hire");
  assert.equal(observedBiweeklySessionRecords(facts, 1, "2026-10-22", []).length, 0);
});

const fourPeriods = (completed: number) => [
  record("2026-07-30", "2026-08-12", completed),
  record("2026-08-13", "2026-08-26", completed),
  record("2026-08-27", "2026-09-09", completed),
  record("2026-09-10", "2026-09-23", completed),
];

test("hiring review requires four periods from every selected clinician", () => {
  const result = summarizeHiringReadiness([
    { id: 1, goalWeekly: 10, records: fourPeriods(18) },
    { id: 2, goalWeekly: 10, records: fourPeriods(18).slice(1) },
  ], 80);
  assert.equal(result.status, "needs_data");
  assert.deepEqual(result.missing.map((person) => person.id), [2]);
});

test("hiring gap uses each clinician's pace against the chosen threshold", () => {
  const result = summarizeHiringReadiness([
    { id: 1, goalWeekly: 10, records: fourPeriods(12) },
    { id: 2, goalWeekly: 20, records: fourPeriods(32) },
  ], 80);
  assert.equal(result.status, "below_threshold");
  assert.deepEqual(result.below.map((person) => person.id), [1]);
  assert.equal(result.weeklyGap, 2);
  assert.equal(summarizeHiringReadiness([
    { id: 1, goalWeekly: 10, records: fourPeriods(16) },
    { id: 2, goalWeekly: 20, records: fourPeriods(32) },
  ], 80).status, "review_hire");
});

test("zero recorded sessions are below threshold, not missing data", () => {
  const result = summarizeHiringReadiness([
    { id: 1, goalWeekly: 10, records: fourPeriods(0) },
  ], 80);
  assert.equal(result.status, "below_threshold");
  assert.equal(result.weeklyGap, 8);
});

test("stale totals do not trigger a hiring review", () => {
  const result = summarizeHiringReadiness([
    { id: 1, goalWeekly: 10, records: fourPeriods(18) },
  ], 80, 4, true);
  assert.equal(result.status, "stale");
});

test("gaps between periods do not trigger a hiring review", () => {
  const records = fourPeriods(18);
  records[1] = record("2026-08-14", "2026-08-27", 18);
  const result = summarizeHiringReadiness([
    { id: 1, goalWeekly: 10, records },
  ], 80);
  assert.equal(result.status, "needs_data");
  assert.equal(result.missing[0].recordedPeriods, 4);
  assert.equal(result.missing[0].consecutive, false);
});

test("hiring runway waits until all selected clinicians reach the threshold together", () => {
  const months = [
    { date: "2026-10-31", clinicians: { "1": { capacity: 40, utilization: 85 }, "2": { capacity: 60, utilization: 70 } } },
    { date: "2026-11-30", clinicians: { "1": { capacity: 40, utilization: 78 }, "2": { capacity: 60, utilization: 83 } } },
    { date: "2026-12-31", clinicians: { "1": { capacity: 40, utilization: 81 }, "2": { capacity: 60, utilization: 82 } } },
  ];
  assert.equal(firstHiringReviewMonth(months, [1, 2], 80), "2026-12-31");
  assert.equal(firstHiringReviewMonth(months, [1], 80), "2026-10-31");
  assert.equal(firstHiringReviewMonth(months, [], 80), null);
});

test("zero or missing modeled capacity cannot count as full", () => {
  const months = [
    { date: "2026-10-31", clinicians: { "1": { capacity: 0, utilization: 100 } } },
    { date: "2026-11-30", clinicians: { "1": { capacity: 40, utilization: 80 } } },
  ];
  assert.equal(firstHiringReviewMonth(months, [1], 80), "2026-11-30");
  assert.equal(firstHiringReviewMonth(months, [2], 80), null);
});
