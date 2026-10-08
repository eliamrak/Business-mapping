import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import {
  desiredSessionsForPeriod,
  desiredSessionsForRecordYear,
  sessionGoalUpdateForPeriod,
  sessionGoalYear,
  summarizeSessionsWithAnnualGoals,
  weeklyGoalFromPeriodDesired,
  withAnnualDesiredSessions,
} from "./session-goals.ts";

const clinician = { id: 1, sessionsPerWeek: 7.5 };
const goal = (year: number, sessionsPerWeek: number) => ({
  clinicianId: 1,
  year,
  sessionsPerWeek,
});
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

test("changing a clinician goal re-bases all periods in that year without mutating history", () => {
  const records = [
    record("2026-01-01", "2026-01-14", 12, 22, 1),
    record("2026-02-12", "2026-02-25", 14, 32, 2),
  ];
  const adjusted = withAnnualDesiredSessions(records, [clinician], [goal(2026, 7.5)]);

  assert.deepEqual(adjusted.map((item) => item.desired), [15, 15]);
  assert.deepEqual(records.map((item) => item.desired), [22, 32]);
});

test("period navigation does not move one year's goal onto another year", () => {
  const priorYear = record("2025-12-18", "2025-12-31", 18, 24, 1);
  const currentYear = record("2026-01-01", "2026-01-14", 10, 30, 2);
  const goals = [goal(2026, 7.5)];

  assert.equal(sessionGoalYear({ start: "2026-01-01", end: "2026-01-14" }), 2026);
  assert.equal(desiredSessionsForRecordYear(currentYear, clinician, goals), 15);
  assert.equal(desiredSessionsForRecordYear(priorYear, clinician, goals), 24);
  assert.equal(
    desiredSessionsForRecordYear(priorYear, clinician, [...goals, goal(2025, 6)]),
    12,
  );
});

test("year boundaries preserve unrelated years while summaries compare against stored annual goals", () => {
  const records = [
    record("2025-12-18", "2025-12-31", 20, 24, 1),
    record("2026-01-01", "2026-01-14", 10, 30, 2),
    record("2026-01-15", "2026-01-28", 5, 44, 3),
  ];
  const summary = summarizeSessionsWithAnnualGoals(
    records,
    { start: "2026-01-01", end: "2026-01-28" },
    clinician,
    [goal(2026, 7.5), goal(2025, 6)],
  );

  assert.equal(summary.completed, 15);
  assert.equal(summary.desired, 30);
  assert.equal(summary.utilization, 50);
});

test("persisted annual goals survive reloads and stay independent by year", () => {
  const goalsFromReload = [goal(2025, 6), goal(2026, 7.5)];
  const records = [
    record("2025-01-02", "2025-01-15", 10, 44, 1),
    record("2026-01-01", "2026-01-14", 10, 44, 2),
  ];

  assert.deepEqual(
    withAnnualDesiredSessions(records, [clinician], goalsFromReload).map(
      (item) => item.desired,
    ),
    [12, 15],
  );
});

test("period desired values persist as the matching weekly annual goal for future periods", () => {
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

test("saving an edited historical record uses the edited period year, not the visible page year", () => {
  const editedRecordPeriod = { start: "2025-12-18", end: "2025-12-31" };
  const visiblePageRange = { start: "2026-01-01", end: "2026-01-14" };

  assert.equal(sessionGoalYear(visiblePageRange), 2026);
  assert.deepEqual(
    sessionGoalUpdateForPeriod(
      clinician.id,
      weeklyGoalFromPeriodDesired(24, editedRecordPeriod),
      editedRecordPeriod,
    ),
    { clinicianId: 1, year: 2025, sessionsPerWeek: 12 },
  );
});
