import test from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import { completePeriodSessionSummary, completeSessionHistoryStart } from "./complete-session-summary.ts";

const row = (id: number, start: string, end: string, completed: number): SessionRecord => ({ id, clinicianId: 1, start, end, completed, desired: 0, cancelled: null, noShow: null, scheduled: null, inPerson: completed, telehealth: 0, sourceAttachmentId: null, revision: 1, updatedAt: "2026-10-14T00:00:00Z" });
test("an incomplete current pay period is excluded from both total and weekly denominator", () => {
  const rows = [row(1, "2026-09-24", "2026-10-07", 28), row(2, "2026-10-08", "2026-10-14", 700)];
  const before = structuredClone(rows);
  const result = completePeriodSessionSummary(rows, [1], { start: "2026-09-24", end: "2026-10-14" }, [], "2026-10-14");
  assert.equal(result.observedCompleted, 28);
  assert.equal(result.completedWeekly, 14);
  assert.equal(result.observedCoverageDays, 14);
  assert.equal(result.calendarWindowWeeklyEstimate, null);
  assert.equal(result.excludedRecordsCount, 1);
  assert.deepEqual(rows, before);
});
test("occupied imported dates alone are excluded, not treated as complete period proof", () => {
  const rows = Array.from({ length: 14 }, (_, index) => row(-index - 1, `2026-01-${String(index + 1).padStart(2, "0")}`, `2026-01-${String(index + 1).padStart(2, "0")}`, 2));
  const range = { start: "2026-01-01", end: "2026-01-14" };
  assert.equal(completePeriodSessionSummary(rows, [1], range, [], "2026-01-15").observedCompleted, null);
  assert.equal(completePeriodSessionSummary(rows, [1], range, [{ clinicianId: 1, ...range }], "2026-01-15").completedWeekly, 14);
});
test("a query can use exact daily facts from a complete source period, but never prorate an aggregate", () => {
  const range = { start: "2026-01-01", end: "2026-01-14" };
  const query = { start: "2026-01-05", end: "2026-01-07" };
  const rows = [row(-1, "2026-01-05", "2026-01-05", 3)];
  assert.equal(completePeriodSessionSummary(rows, [1], query, [{ clinicianId: 1, ...range }], "2026-01-15").completedWeekly, 7);
  assert.equal(completePeriodSessionSummary([row(1, range.start, range.end, 28)], [1], query, [], "2026-01-15").observedCompleted, null);
});

test("Overall includes eligible manual report proof, never earlier raw endpoints or partial current history", () => {
  const rows = [row(-1, "2025-01-01", "2025-01-01", 900), row(1, "2026-09-24", "2026-10-07", 28), row(2, "2026-10-08", "2026-10-14", 700)];
  const before = structuredClone(rows);
  const start = completeSessionHistoryStart(rows, [1], [], "2026-10-14");
  assert.equal(start, "2026-09-24");
  const summary = completePeriodSessionSummary(rows, [1], { start: start!, end: "2026-10-14" }, [], "2026-10-14");
  assert.equal(summary.observedCompleted, 28);
  assert.equal(summary.completedWeekly, 14);
  assert.equal(summary.observedCoverageDays, 14);
  assert.equal(completeSessionHistoryStart(rows.filter((item) => item.id !== 1), [1], [], "2026-10-14"), null);
  assert.deepEqual(rows, before);
});

test("Overall bounds respect selected IDs and only core-eligible imported proof", () => {
  const rows = [row(1, "2026-09-24", "2026-10-07", 28)];
  const coverage = [{ clinicianId: 1, start: "2026-01-01", end: "2026-01-14" },
    { clinicianId: 2, start: "2025-01-02", end: "2025-01-15" },
    { clinicianId: 1, start: "2025-02-01", end: "2025-02-03" }];
  const before = structuredClone({ rows, coverage });
  assert.equal(completeSessionHistoryStart(rows, [1], coverage, "2026-10-14"), "2026-01-01");
  assert.equal(completeSessionHistoryStart([], [1], [{ clinicianId: 1, start: "2026-10-08", end: "2026-10-21" }], "2026-10-14"), null);
  assert.deepEqual({ rows, coverage }, before);
});

test("aggregate pruning reaches a fixed point independent of clinician and record order", () => {
  const rows = [
    { ...row(-1, "2026-01-10", "2026-01-14", 5), clinicianId: 1 },
    { ...row(-2, "2026-01-05", "2026-01-12", 8), clinicianId: 2 },
    { ...row(-3, "2026-01-01", "2026-01-05", 5), clinicianId: 3 },
  ];
  const proof = [1, 2, 3].map((clinicianId) => ({ clinicianId, start: "2026-01-01", end: "2026-01-14" }));
  const query = { start: "2026-01-03", end: "2026-01-14" };
  const before = structuredClone({ rows, proof, query });
  for (const ids of [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]) {
    for (const ordered of [rows, [...rows].reverse()]) {
      const summary = completePeriodSessionSummary(ordered, ids, query, proof, "2026-01-15");
      assert.equal(summary.observedCompleted, null, "Unallocatable aggregate remnants must not become known zero sessions");
      assert.equal(summary.observedCoverageDays, 0);
      assert.equal(summary.completedWeekly, null);
      assert.equal(summary.inPersonWeekly, null);
    }
  }
  const full = completePeriodSessionSummary(rows, [1, 2, 3], { start: "2026-01-01", end: "2026-01-14" }, proof, "2026-01-15");
  assert.equal(full.observedCompleted, 18, "Fully contained aggregates remain available without proration");
  assert.equal(full.completedWeekly, 9);
  assert.deepEqual({ rows, proof, query }, before);
});
