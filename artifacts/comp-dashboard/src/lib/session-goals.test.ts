import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import {
  desiredSessionsForPeriod,
  desiredSessionsForRecordYear,
  sessionGoalUpdateForPeriod,
  sessionGoalYear,
  sessionRecordGoalDisplay,
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
const clinicianGoal = (
  clinicianId: number,
  year: number,
  sessionsPerWeek: number,
) => ({
  clinicianId,
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

test("reloaded annual goals update historical current and future periods for one clinician only", () => {
  const otherClinician = { id: 2, sessionsPerWeek: 30 };
  const records = [
    record("2026-01-01", "2026-01-14", 10, 44, 1),
    record("2026-06-04", "2026-06-17", 12, 44, 2),
    record("2026-12-17", "2026-12-30", 14, 44, 3),
    { ...record("2026-06-04", "2026-06-17", 22, 66, 4), clinicianId: 2 },
  ];
  const goalsFromReload = [
    clinicianGoal(1, 2026, 15),
    clinicianGoal(2, 2026, 9),
  ];

  assert.deepEqual(
    withAnnualDesiredSessions(
      records,
      [clinician, otherClinician],
      goalsFromReload,
    ).map((item) => [item.clinicianId, item.desired]),
    [
      [1, 30],
      [1, 30],
      [1, 30],
      [2, 18],
    ],
  );
  assert.deepEqual(records.map((item) => item.desired), [44, 44, 44, 66]);
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

test("imported completed-equals-desired placeholders display actuals only, never self-certified goals or fullness", () => {
  const imported = record("2026-10-08", "2026-10-08", 3, 3, -1);
  const before = structuredClone(imported);
  Object.freeze(imported);
  assert.deepEqual(sessionRecordGoalDisplay(imported, []), {
    desired: null, fullness: null, source: "imported-actual-only",
  });
  assert.deepEqual(imported, before);
  assert.equal(imported.desired, 3, "Stored source facts are preserved");
  assert.equal(sessionRecordGoalDisplay({ ...imported, desired: 99 }, []).desired, null,
    "Negative import IDs identify actual-only provenance even when the placeholder differs from actual");
});

test("only a matching explicit annual goal permits imported history comparison; other years and clinicians do not", () => {
  const imported = record("2026-10-01", "2026-10-14", 8, 8, -1);
  assert.deepEqual(sessionRecordGoalDisplay(imported, [goal(2026, 7)]), {
    desired: 14, fullness: 8 / 14 * 100, source: "annual-goal",
  });
  assert.equal(sessionRecordGoalDisplay(imported, [goal(2025, 7)]).desired, null);
  assert.equal(sessionRecordGoalDisplay(imported, [clinicianGoal(2, 2026, 7)]).desired, null);
  assert.deepEqual(sessionRecordGoalDisplay(imported, [goal(2026, 0)]), {
    desired: 0, fullness: null, source: "annual-goal",
  });
});

test("manual period goals remain visible and their display helper never rewrites totals", () => {
  const manual = record("2026-10-01", "2026-10-14", 10, 20);
  const before = structuredClone(manual);
  assert.deepEqual(sessionRecordGoalDisplay(manual, []), { desired: 20, fullness: 50, source: "manual-period-goal" });
  assert.deepEqual(sessionRecordGoalDisplay(manual, [goal(2026, 7)]), {
    desired: 14, fullness: 10 / 14 * 100, source: "annual-goal",
  });
  assert.deepEqual(manual, before);
});
