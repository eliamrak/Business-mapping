import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, type Context } from "@workspace/practice/hub";
import { buildPracticeProjection } from "./practice-projection.ts";

const clinician = (id: number, sessionRate: number) => ({
  id,
  goalId: 7,
  label: `Clinician ${id}`,
  roleType: "associate",
  classification: "1099" as const,
  sessionRate,
  sessionsPerWeek: 20,
  weeksWorkedPerYear: 52.1786,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  capEnabled: false,
  capAmount: 0,
  postCapClinicianSplit: 60,
  postCapPracticeSplit: 40,
  w2EmployerFicaPct: 0,
  futaSutaPct: 0,
  workersCompPct: 0,
  otherEmployerBurdenPct: 0,
  nonClinicalHoursPerWeek: 0,
  nonClinicalHourlyRate: 0,
});

const setup = () => {
  const workspace = emptyWorkspace("2026-09-01");
  Object.assign(workspace.settings, {
    teamId: 7,
    baselineMode: "historical",
    baselineRetentionPct: 100,
    defaultInPersonPct: 0,
    horizonMonths: 6,
  });
  const context: Context = {
    clinicians: [clinician(1, 100), clinician(2, 200)],
    staff: [],
    sessions: [],
  };
  return { workspace, context };
};

const record = (completed: number) => ({
  id: 11,
  revision: 1,
  updatedAt: "2026-09-15T12:00:00Z",
  clinicianId: 1,
  start: "2026-09-01",
  end: "2026-09-14",
  completed,
  desired: 40,
  cancelled: null,
  noShow: null,
  scheduled: null,
  inPerson: null,
  telehealth: null,
  sourceAttachmentId: null,
});

test("plan uses desired sessions while actual forecast uses recorded clinician mix", () => {
  const { workspace, context } = setup();
  context.sessions = [record(8)];
  const plan = buildPracticeProjection(
    workspace,
    context,
    "plan",
    "2026-09-22",
  );
  const actual = buildPracticeProjection(
    workspace,
    context,
    "actual",
    "2026-09-22",
  );

  assert.equal(plan.projectionWorkspace.settings.forecastStart, "2026-09-01");
  assert.equal(actual.projectionWorkspace.settings.forecastStart, "2026-10-01");
  assert.equal(plan.planWeekly, 40);
  assert.equal(actual.projectedWeekly, 36);
  assert.equal(actual.clinicianPace[0].recordedWeekly, 4);
  assert.equal(actual.clinicianPace[0].usedWeekly, 16);
  assert.equal(actual.clinicianPace[1].recordedWeekly, null);
  assert.equal(actual.recentPeriods[0].recorded, 8);
  assert.equal(actual.recentPeriods[0].estimated, 40);
  assert.ok(
    (plan.months[0].values.sessions ?? 0) >
      (actual.months[0].values.sessions ?? 0),
  );
  assert.ok(
    Math.abs((actual.months[0].clinicians["1"].sessions ?? 0) - (16 * 31) / 7) <
      0.001,
  );
  assert.ok(
    Math.abs((actual.months[0].clinicians["2"].sessions ?? 0) - (20 * 31) / 7) <
      0.001,
  );
  assert.ok(
    (actual.months[0].clinicians["2"].revenue ?? 0) >
      (actual.months[0].clinicians["1"].revenue ?? 0),
  );
});

test("a recorded zero is kept as zero; missing or stale records use desired sessions", () => {
  const { workspace, context } = setup();
  context.sessions = [record(0)];
  const zero = buildPracticeProjection(
    workspace,
    context,
    "actual",
    "2026-09-22",
  );
  assert.equal(zero.clinicianPace[0].recordedWeekly, 0);
  assert.equal(zero.clinicianPace[0].usedWeekly, 15);
  assert.equal(zero.clinicianPace[1].usedWeekly, 20);
  assert.ok(
    Math.abs((zero.months[0].clinicians["1"].sessions ?? 0) - (15 * 31) / 7) <
      0.001,
  );

  context.sessions = [
    ["2026-07-29", "2026-08-11"],
    ["2026-08-12", "2026-08-25"],
    ["2026-08-26", "2026-09-08"],
    ["2026-09-09", "2026-09-22"],
  ].map(([start, end], index) => ({
    ...record(0),
    id: index + 11,
    start,
    end,
  }));
  const fullyRecorded = buildPracticeProjection(
    workspace,
    context,
    "actual",
    "2026-09-22",
  );
  assert.equal(fullyRecorded.clinicianPace[0].usedWeekly, 0);
  assert.equal(fullyRecorded.months[0].clinicians["1"].sessions, 0);

  const stale = buildPracticeProjection(
    workspace,
    context,
    "actual",
    "2026-12-22",
  );
  assert.equal(stale.projectedWeekly, 40);
  assert.equal(stale.clinicianPace[0].recordedWeekly, null);
  assert.equal(workspace.settings.baselineMode, "historical");
});

test("an intentional custom plan pace remains available", () => {
  const { workspace, context } = setup();
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 12;
  const plan = buildPracticeProjection(
    workspace,
    context,
    "plan",
    "2026-09-22",
  );
  assert.equal(plan.projectionWorkspace.settings.baselineWeeklySessions, 12);
  assert.ok(
    Math.abs((plan.months[0].values.sessions ?? 0) - (12 * 30) / 7) < 0.001,
  );
});

test("recent periods only show records used in the eight-week pace", () => {
  const { workspace, context } = setup();
  context.sessions = [
    { ...record(18), id: 12, start: "2026-07-20", end: "2026-08-02" },
    { ...record(8), id: 13, start: "2026-09-01", end: "2026-09-14" },
  ];
  const actual = buildPracticeProjection(
    workspace,
    context,
    "actual",
    "2026-09-22",
  );
  assert.deepEqual(
    actual.recentPeriods.map((period) => period.start),
    ["2026-09-01"],
  );
  assert.equal(actual.clinicianPace[0].recordedDays, 14);
});
