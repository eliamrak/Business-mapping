import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicianSettingSchema, emptyWorkspace, forecast, monthFlow, type Context } from "@workspace/practice/hub";
import { buildPracticeProjection } from "./practice-projection.ts";
import { firstHiringReviewMonth } from "./session-overview.ts";

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

const calendarDays = (start: string, end: string) =>
  (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
const closeTo = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-8, `${actual} should equal ${expected}`);
};

test("existing-caseload attrition changes the modeled hiring review month", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  Object.assign(workspace.settings, {
    forecastStart: "2026-10-01",
    baselineMode: "manual",
    baselineWeeklySessions: 8,
    organicClientsPerMonth: 3,
    sessionsPerClientMonth: 4,
    retentionMonths: 6,
    attendancePct: 100,
    defaultInPersonPct: 0,
    horizonMonths: 24,
  });
  workspace.settings.baselineRetentionPct = 100;
  const noAttrition = firstHiringReviewMonth(forecast(workspace, context), [1], 80);
  workspace.settings.baselineRetentionPct = 90;
  const higherAttrition = firstHiringReviewMonth(forecast(workspace, context), [1], 80);
  assert.ok(noAttrition);
  assert.ok(higherAttrition);
  assert.ok(higherAttrition > noAttrition);
});

test("plan uses desired sessions while an unknown clinician prevents an actual practice forecast", () => {
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
  assert.equal(actual.projectionWorkspace.settings.forecastStart, "2026-09-01");
  assert.equal(plan.planWeekly, 40);
  assert.equal(actual.projectedWeekly, null);
  assert.equal(actual.clinicianPace[0].recordedWeekly, 4);
  assert.equal(actual.clinicianPace[0].usedWeekly, 4);
  assert.equal(actual.clinicianPace[1].recordedWeekly, null);
  assert.equal(actual.recentPeriods[0].recorded, 8);
  assert.equal(actual.recentPeriods[0].estimated, 0);
  assert.equal(actual.recentPeriods[0].total, 8);
  assert.equal(actual.clinicianPace[1].usedWeekly, null);
  assert.equal(actual.projectionWorkspace.settings.baselineWeeklySessions, null);
  assert.deepEqual(actual.months, []);
  assert.ok(plan.months.length > 0);
});

test("a recorded zero stays zero and latest available history never substitutes desired sessions", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  context.sessions = [record(0)];
  const zero = buildPracticeProjection(
    workspace,
    context,
    "actual",
    "2026-09-22",
  );
  assert.equal(zero.clinicianPace[0].recordedWeekly, 0);
  assert.equal(zero.clinicianPace[0].usedWeekly, 0);
  assert.equal(zero.projectedWeekly, 0);
  assert.equal(zero.months[0].clinicians["1"].sessions, 0);
  assert.match(zero.clinicianPace[0].basis, /2026-09-01 to 2026-09-14:.*rolling three months \(14 calendar days\)/);

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
  assert.equal(stale.projectedWeekly, 0);
  assert.equal(stale.clinicianPace[0].recordedWeekly, 0);
  assert.match(stale.clinicianPace[0].basis, /2026-07-29 to 2026-09-22:.*rolling three months \(56 calendar days\)/);
  assert.equal(workspace.settings.baselineMode, "historical");
});

test("known manual period averages preserve observed clinician mix and start the actual forecast this month", () => {
  const { workspace, context } = setup();
  context.sessions = [record(8), { ...record(16), id: 12, clinicianId: 2 }];
  const before = structuredClone({ workspace, context });
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-09-22");
  assert.equal(actual.projectedWeekly, 12);
  assert.deepEqual(actual.clinicianPace.map((person) => person.usedWeekly), [4, 8]);
  assert.deepEqual(actual.clinicianPace.map((person) => person.recordedDays), [14, 14]);
  assert.equal(actual.projectionWorkspace.settings.forecastStart, "2026-09-01");
  assert.ok(Math.abs(actual.months[0].clinicians["1"].sessions! - 4 * 30 / 7) < 1e-8);
  assert.ok(Math.abs(actual.months[0].clinicians["2"].sessions! - 8 * 30 / 7) < 1e-8);
  assert.ok(Math.abs(actual.months[0].values.revenue! - (4 * 100 + 8 * 200) * 30 / 7) < 1e-8);
  assert.equal(actual.recentPeriods[0].estimated, 0);
  assert.deepEqual({ workspace, context }, before);
});

test("no observed history cannot turn desired sessions or a manual plan baseline into an actual forecast", () => {
  const { workspace, context } = setup();
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 40;
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(actual.planWeekly, 40);
  assert.equal(actual.projectedWeekly, null);
  assert.ok(actual.clinicianPace.every((person) => person.usedWeekly === null));
  assert.deepEqual(actual.months, []);
});

test("six sparse clinician histories use all available calendar days through the latest record, not desired capacity", () => {
  const { workspace, context } = setup();
  const totals = [66, 73, 34, 12, 104, 62];
  const desired = [15, 16, 20, 5, 23, 15];
  const fees = [150, 185, 150, 150, 175, 175];
  const dates = ["2026-08-20", "2026-08-27", "2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24", "2026-10-09"];
  context.clinicians = totals.map((_, index) => ({ ...clinician(index + 1, fees[index]), sessionsPerWeek: desired[index], weeksWorkedPerYear: 48 }));
  context.sessions = totals.flatMap((total, index) => dates.map((date, day) => ({
    ...record(Math.floor(total / dates.length) + Number(day < total % dates.length)),
    id: -(index * dates.length + day + 1), clinicianId: index + 1, start: date, end: date,
  })));
  const before = structuredClone({ workspace, context });
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(context.sessions.reduce((sum, session) => sum + session.completed, 0), 351);
  const days = calendarDays("2026-08-20", "2026-10-09");
  assert.equal(days, 51, "Quiet days count; neither seven visit dates nor the obsolete 56 days is the denominator");
  assert.equal(actual.recentStart, "2026-07-15");
  closeTo(actual.projectedWeekly, 351 * 7 / days);
  actual.clinicianPace.forEach((person, index) => closeTo(person.usedWeekly, totals[index] * 7 / days));
  assert.ok(actual.clinicianPace.every((person) => /2026-08-20 to 2026-10-09:.*\(51 calendar days\)/.test(person.basis)));
  assert.ok(actual.clinicianPace.every((person) => !/limited history/i.test(person.basis)));
  assert.ok(actual.clinicianPace.every((person) => person.recordedDays === 0));
  closeTo(actual.months[0].values.sessions, 351 * 31 / days);
  const weightedFees = totals.reduce((sum, total, index) => sum + total * fees[index], 0);
  closeTo(actual.months[0].values.revenue, weightedFees * 31 / days);
  assert.ok(actual.months[0].values.revenue! < 40000, "Observed projection must not become the prior 61542.47 capacity projection");
  const changed = structuredClone(context);
  changed.clinicians.forEach((person) => { person.sessionsPerWeek += 10; });
  const higherDesired = buildPracticeProjection(workspace, changed, "actual", "2026-10-14");
  closeTo(higherDesired.projectedWeekly, 351 * 7 / days);
  assert.deepEqual(higherDesired.clinicianPace.map((person) => person.usedWeekly), actual.clinicianPace.map((person) => person.usedWeekly));
  assert.ok(Math.abs(higherDesired.months[0].values.revenue! - actual.months[0].values.revenue!) < 1e-8);
  assert.deepEqual({ workspace, context }, before);
});

test("working pace includes quiet calendar days and only matching report coverage extends its bounds", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  context.sessions = [{ ...record(14), id: -1, start: "2026-09-20", end: "2026-09-20" },
    { ...record(14), id: -2, start: "2026-10-09", end: "2026-10-09" }];
  const sparse = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  closeTo(sparse.projectedWeekly, 28 * 7 / calendarDays("2026-09-20", "2026-10-09"));
  assert.equal(sparse.clinicianPace[0].recordedDays, 0);
  assert.match(sparse.clinicianPace[0].basis, /2026-09-20 to 2026-10-09:.*\(20 calendar days\)/);
  const coverage = [{ clinicianId: 1, start: "2026-09-17", end: "2026-10-14" }];
  const covered = buildPracticeProjection(workspace, context, "actual", "2026-10-14", coverage);
  assert.equal(covered.projectedWeekly, 7);
  assert.equal(covered.clinicianPace[0].recordedDays, 28);
  assert.match(covered.clinicianPace[0].basis, /2026-09-17 to 2026-10-14:.*\(28 calendar days\)/);
  const otherProvider = buildPracticeProjection(workspace, context, "actual", "2026-10-14", [{ ...coverage[0], clinicianId: 2 }]);
  assert.equal(otherProvider.projectedWeekly, sparse.projectedWeekly);
  assert.equal(otherProvider.clinicianPace[0].recordedDays, 0);
  const movedDates = structuredClone(context);
  movedDates.sessions[0].start = movedDates.sessions[0].end = "2026-10-08";
  closeTo(buildPracticeProjection(workspace, movedDates, "actual", "2026-10-14").projectedWeekly,
    28 * 7 / calendarDays("2026-10-08", "2026-10-09"));
});

test("unmatched day charges withhold only their clinician-month while deduplicating evidence and preserving sources", () => {
  const { workspace, context } = setup();
  context.sessions = [record(8), { ...record(16), id: 12, clinicianId: 2 }];
  const baseline = buildPracticeProjection(workspace, context, "actual", "2026-09-22");
  context.importedBillingActuals = [{ clinicianId: 1, serviceDate: "2026-09-10", totalFeeCharged: 99999, sourceRowHash: "synthetic-billing" }];
  const before = structuredClone({ workspace, context });
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-09-22");
  assert.equal(actual.months[0].values.revenue, null, "one known charge does not establish replacement of a fractional modeled treatment day");
  assert.equal(actual.months[0].clinicians["1"].revenue, null);
  assert.equal(actual.months[0].values.sessions, baseline.months[0].values.sessions);
  assert.equal(actual.months[0].clinicians["2"].revenue, baseline.months[0].clinicians["2"].revenue);
  assert.equal(actual.months[1].values.revenue, baseline.months[1].values.revenue);
  const repeated = structuredClone(context);
  repeated.importedBillingActuals!.push({ ...repeated.importedBillingActuals![0] });
  assert.deepEqual(buildPracticeProjection(workspace, repeated, "actual", "2026-09-22").months, actual.months);
  assert.deepEqual({ workspace, context }, before);
});

test("conflicting source hashes make affected charged revenue unknown rather than choosing or summing a payload", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  context.sessions = [record(8)];
  context.importedBillingActuals = [150, 175].map((totalFeeCharged) => ({
    clinicianId: 1, serviceDate: "2026-09-10", sourceRowHash: "synthetic-conflict", totalFeeCharged,
  }));
  const before = structuredClone({ workspace, context });
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-09-22");
  assert.equal(actual.months[0].values.revenue, null);
  assert.ok(actual.months[0].warnings.some((warning) => /billing.*conflict/i.test(warning)));
  closeTo(actual.months[0].values.sessions, 4 * 30 / 7);
  closeTo(actual.months[1].values.revenue, 4 * 31 / 7 * 100);
  assert.deepEqual({ workspace, context }, before);
});

test("only completed contained manual periods contribute to an observed average; overlaps remain unknown", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  context.sessions = [{ ...record(8), start: "2026-10-01", end: "2026-10-08" },
    { ...record(1000), id: 12, start: "2026-10-09", end: "2026-10-22" }];
  const completed = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(completed.clinicianPace[0].usedWeekly, 7);
  assert.equal(completed.clinicianPace[0].recordedDays, 8);
  assert.match(completed.clinicianPace[0].basis, /2026-10-01 to 2026-10-08:.*\(8 calendar days\)/);
  assert.equal(completed.recentPeriods[0].recorded, 8);
  context.sessions.push({ ...context.sessions[0], id: 13 });
  const overlap = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(overlap.clinicianPace[0].usedWeekly, null);
  assert.equal(overlap.projectedWeekly, null);
  assert.deepEqual(overlap.months, []);
});

test("planned, archived, future-start and ended clinicians contribute zero baseline without blocking an active actual projection", () => {
  for (const profile of [
    { status: "planned", start: "2026-01-01", end: null },
    { status: "archived", start: "2026-01-01", end: null },
    { status: "active", start: "2026-10-01", end: null },
    { status: "active", start: "2026-01-01", end: "2026-08-31" },
  ] as const) {
    const { workspace, context } = setup();
    context.sessions = [record(8)];
    workspace.clinicians.push(clinicianSettingSchema.parse({
      id: crypto.randomUUID(), clinicianId: 2, desiredWeeklySessions: 20, ...profile,
    }));
    const before = structuredClone({ workspace, context });
    const actual = buildPracticeProjection(workspace, context, "actual", "2026-09-22");
    assert.equal(actual.clinicianPace[0].usedWeekly, 4);
    assert.equal(actual.clinicianPace[1].recordedWeekly, null);
    assert.equal(actual.clinicianPace[1].usedWeekly, 0, JSON.stringify(profile));
    assert.equal(actual.clinicianPace[1].basis, "not on the current team");
    assert.equal(actual.projectedWeekly, 4);
    assert.ok(actual.months.length > 0);
    assert.ok(Math.abs(actual.months[0].values.sessions! - 4 * 30 / 7) < 1e-8);
    assert.deepEqual({ workspace, context }, before);
  }
});

test("a clinician who ended earlier this month retains their observed baseline within dated engine bounds", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  context.sessions = [{ ...record(7), start: "2026-10-01", end: "2026-10-07" }];
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-10-01", end: "2026-10-07", status: "active", inPersonPct: 0, desiredWeeklySessions: 20 }));
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(actual.projectedWeekly, 7);
  assert.ok(Math.abs(actual.months[0].values.sessions! - 7) < 1e-10);
  assert.ok(Math.abs(actual.months[0].values.revenue! - 700) < 1e-10);
});

test("latest available report anchors working history even when the forecast starts months later", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  context.sessions = [record(8)];
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-12-22");
  assert.equal(actual.projectedWeekly, 4);
  assert.equal(actual.clinicianPace[0].recordedThrough, "2026-09-14");
  assert.match(actual.clinicianPace[0].basis, /2026-09-01 to 2026-09-14:.*rolling three months \(14 calendar days\)/);
  assert.equal(actual.projectionWorkspace.settings.forecastStart, "2026-12-01");
});

test("complete four-period history sets forecast pace without filling trailing days at desired pace", () => {
  const { workspace, context } = setup();
  const periods = [
    ["2026-07-30", "2026-08-12"],
    ["2026-08-13", "2026-08-26"],
    ["2026-08-27", "2026-09-09"],
    ["2026-09-10", "2026-09-23"],
  ];
  context.sessions = periods.flatMap(([start, end], index) =>
    [1, 2].map((clinicianId) => ({
      ...record(clinicianId === 1 ? 8 : 16),
      id: index * 2 + clinicianId,
      clinicianId,
      start,
      end,
    })),
  );
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-09-28");
  assert.equal(actual.clinicianPace[0].usedWeekly, 4);
  assert.equal(actual.clinicianPace[1].usedWeekly, 8);
  assert.equal(actual.projectedWeekly, 12);
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

test("working pace clips a rolling three-calendar-month window and anchors each clinician to their latest report", () => {
  const { workspace, context } = setup();
  context.sessions = [
    { ...record(999), id: -1, start: "2026-05-01", end: "2026-05-01" },
    { ...record(999), id: -2, start: "2026-06-30", end: "2026-06-30" },
    { ...record(28), id: -3, start: "2026-07-01", end: "2026-07-01" },
    { ...record(64), id: -4, start: "2026-09-30", end: "2026-09-30" },
    { ...record(14), id: 15, clinicianId: 2, start: "2026-08-01", end: "2026-08-14" },
  ];
  const before = structuredClone({ workspace, context });
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  // Sep 30 minus three calendar months is Jun 30; the inclusive window
  // therefore starts Jul 1. All 92 days count, including quiet weeks.
  closeTo(actual.clinicianPace[0].usedWeekly, 92 * 7 / calendarDays("2026-07-01", "2026-09-30"));
  assert.equal(actual.clinicianPace[0].recordedThrough, "2026-09-30");
  assert.match(actual.clinicianPace[0].basis, /2026-07-01 to 2026-09-30:.*\(92 calendar days\)/);
  closeTo(actual.clinicianPace[1].usedWeekly, 14 * 7 / calendarDays("2026-08-01", "2026-08-14"));
  assert.equal(actual.clinicianPace[1].recordedDays, 14, "Positive-ID manual records prove every day in their report range");
  const later = buildPracticeProjection(workspace, context, "actual", "2026-12-14");
  assert.deepEqual(later.clinicianPace, actual.clinicianPace, "Advancing today without new reports cannot dilute the latest available history");
  assert.deepEqual({ workspace, context }, before);
});

test("off-team profiles are excluded only from working forecasts while their recorded history is preserved", () => {
  const { workspace, context } = setup();
  context.sessions = [record(8), { ...record(16), id: 12, clinicianId: 2 }];
  workspace.clinicians.push(clinicianSettingSchema.parse({
    id: crypto.randomUUID(), clinicianId: 2, start: "2026-01-01", status: "active", onTeam: false, desiredWeeklySessions: 20,
  }));
  const before = structuredClone({ workspace, context });
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-09-22");
  assert.equal(actual.clinicianPace[1].recordedWeekly, 8);
  assert.equal(actual.clinicianPace[1].usedWeekly, 0);
  assert.equal(actual.projectedWeekly, 4);
  assert.equal(actual.recentPeriods[0].recorded, 24, "Former clinician history is retained, not rewritten");
  closeTo(actual.months[0].values.sessions, 4 * 30 / 7);
  assert.equal(actual.months[0].clinicians["2"]?.sessions ?? 0, 0);
  const historical = monthFlow(workspace, context, "2026-09-01", "2026-09-30");
  closeTo(historical.sessions, 24);
  assert.deepEqual({ workspace, context }, before);
});

test("three-month recent history retains older reports and counts quiet gaps in working pace", () => {
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
    ["2026-09-01", "2026-07-20"],
  );
  assert.equal(actual.clinicianPace[0].recordedDays, 28, "Only the two manual report ranges certify coverage");
  closeTo(actual.clinicianPace[0].usedWeekly, 26 * 7 / calendarDays("2026-07-20", "2026-09-14"));
});
