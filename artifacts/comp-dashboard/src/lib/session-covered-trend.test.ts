import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import { buildSessionTrend, withCoveredWeeklyAverage } from "./session-trend.ts";
import { buildCompleteSessionTrend, completePeriodSessionSummary } from "./complete-session-summary.ts";

const stamp = (date: string) => Date.parse(date + "T12:00:00Z");
const dateAt = (date: number) => new Date(date).toISOString().slice(0, 10);
const day = 86400000;
const period = { start: "2026-07-23", end: "2026-10-20" }; // 90 days
const coverage = [{ clinicianId: 1, start: "2026-07-16", end: "2026-10-21" }];
const record = (start: string, end = start, completed = 2): SessionRecord => ({
  id: -stamp(start), clinicianId: 1, start, end, completed, desired: 20,
  revision: 1, updatedAt: end, inPerson: null, cancelled: null, noShow: null,
  scheduled: null, telehealth: null, sourceAttachmentId: null,
});
const daily = Array.from({ length: 98 }, (_, index) => record(dateAt(stamp(coverage[0].start) + index * day)));

test("90-day selection retains actual total, calendar-day denominator and weekly capacity", () => {
  const summary = completePeriodSessionSummary(daily, [1], period, coverage, "2026-10-21");
  assert.equal(summary.observedCompleted, 180);
  assert.equal(summary.observedCoverageDays, 90);
  assert.equal(summary.completedWeekly, 14);
  const points = withCoveredWeeklyAverage(buildCompleteSessionTrend(daily, [1], [1], period, () => 20, 18, coverage));
  assert.ok(points.every((point) => point.capacity === 20 && point.required === 18));
  assert.ok(points.every((point) => point.date >= stamp(period.start) && point.date <= stamp(period.end)));
  assert.equal(points[0].completed, null);
  assert.equal(points[0].trailingWeeklyAverage, null);
  assert.equal(points.find((point) => point.date === stamp("2026-08-17"))?.trailingWeeklyAverage, 14);
  assert.ok(points.filter((point) => point.trailingWeeklyAverage !== null).every((point) => point.trailingWeeklyAverage === 14));
});

test("four-week average uses consecutive weeks, preserves covered zero, and recovers only after four covered weeks", () => {
  const values = [4, 8, 0, 12, null, 20, 24, 28, 32];
  const points = values.map((completed, index) => ({ date: stamp("2026-07-27") + index * 7 * day, completed }));
  const result = withCoveredWeeklyAverage(points);
  assert.deepEqual(result.map((point) => point.trailingWeeklyAverage), [null, null, null, 6, null, null, null, null, 26]);
  assert.deepEqual(points.map((point) => point.completed), values);
  assert.equal(withCoveredWeeklyAverage(points.filter((_, index) => index !== 4))[4].trailingWeeklyAverage, null);
});

test("coverage proof cannot spread a biweekly aggregate into zero-count weeks or a trend", () => {
  const range = { start: "2026-07-27", end: "2026-08-23" };
  const points = withCoveredWeeklyAverage(buildSessionTrend([
    record("2026-07-27", "2026-08-09", 40), record("2026-08-10", "2026-08-23", 60),
  ], [1], [1], range, () => 30, undefined, [{ clinicianId: 1, ...range }]));
  assert.ok(points.every((point) => point.completed === null && point.trailingWeeklyAverage === null));
  assert.deepEqual(points.filter((point) => point.periodRate !== null).map((point) => point.periodRate), [20, 30]);
});

test("missing contributor coverage withholds weekly actual and trailing trend", () => {
  const points = withCoveredWeeklyAverage(buildCompleteSessionTrend(daily, [1, 2], [1, 2], period, () => 40, undefined, coverage));
  assert.ok(points.every((point) => point.completed === null && point.trailingWeeklyAverage === null));
});
