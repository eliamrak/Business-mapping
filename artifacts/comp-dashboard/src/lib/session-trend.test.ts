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
