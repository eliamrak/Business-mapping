import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import { firstHiringReviewMonth, summarizeHiringReadiness, summarizeSessionOverview } from "./session-overview.ts";

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
