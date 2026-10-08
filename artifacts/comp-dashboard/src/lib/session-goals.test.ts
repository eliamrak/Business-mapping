import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import {
  desiredSessionsForPeriod,
  desiredSessionsForSelectedYear,
  sessionGoalYear,
  summarizeSessionsForSelectedYear,
  weeklyGoalFromPeriodDesired,
  withSelectedYearDesiredSessions,
} from "./session-goals.ts";

const clinician = { id: 1, sessionsPerWeek: 7.5 };
const record = (
  start: string,
  end: string,
  completed: number,
  desired: number,
  id = 1,
): SessionRecord => ({
  id,
  revision: 1,
  updatedAt: "2026-10-08T12:00:00Z",
  clinicianId: 1,
  start,
  end,
  completed,
  desired,
  cancelled: null,
  noShow: null,
  scheduled: null,
  inPerson: null,
  telehealth: null,
  sourceAttachmentId: null,
});

test("changing a clinician goal re-bases all selected-year periods without mutating history", () => {
  const records = [
    record("2026-01-01", "2026-01-14", 12, 22, 1),
    record("2026-02-12", "2026-02-25", 14, 32, 2),
  ];
  const adjusted = withSelectedYearDesiredSessions(records, [clinician], 2026);

  assert.deepEqual(adjusted.map((item) => item.desired), [15, 15]);
  assert.deepEqual(records.map((item) => item.desired), [22, 32]);
});

test("selected period navigation controls which calendar year uses the shared goal", () => {
  const priorYear = record("2025-12-18", "2025-12-31", 18, 24, 1);
  const currentYear = record("2026-01-01", "2026-01-14", 10, 30, 2);

  assert.equal(sessionGoalYear({ start: "2026-01-01", end: "2026-01-14" }), 2026);
  assert.equal(desiredSessionsForSelectedYear(currentYear, clinician, 2026), 15);
  assert.equal(desiredSessionsForSelectedYear(priorYear, clinician, 2026), 24);
  assert.equal(desiredSessionsForSelectedYear(currentYear, clinician, 2025), 30);
});

test("year boundaries preserve unrelated years while current-year summaries compare against the current goal", () => {
  const records = [
    record("2025-12-18", "2025-12-31", 20, 24, 1),
    record("2026-01-01", "2026-01-14", 10, 30, 2),
    record("2026-01-15", "2026-01-28", 5, 44, 3),
  ];
  const summary = summarizeSessionsForSelectedYear(
    records,
    { start: "2026-01-01", end: "2026-01-28" },
    clinician,
  );

  assert.equal(summary.completed, 15);
  assert.equal(summary.desired, 30);
  assert.equal(summary.utilization, 50);
});

test("period desired values persist as the matching weekly goal for future periods", () => {
  const period = { start: "2026-04-09", end: "2026-04-22" };
  const weekly = weeklyGoalFromPeriodDesired(15, period);

  assert.equal(weekly, 7.5);
  assert.equal(desiredSessionsForPeriod(weekly, period), 15);
  assert.equal(
    desiredSessionsForPeriod(weekly, {
      start: "2026-04-23",
      end: "2026-05-06",
    }),
    15,
  );
});
