import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import { summarizeSessionOverview } from "./session-overview.ts";

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
