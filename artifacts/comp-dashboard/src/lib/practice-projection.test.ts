import { test } from "node:test";
import assert from "node:assert/strict";
import { clinicianSettingSchema, termSchema, emptyWorkspace, forecast, type Context } from "@workspace/practice/hub";
import { buildPracticeProjection } from "./practice-projection.ts";
import { firstHiringReviewMonth } from "./session-overview.ts";

const clinician = (id: number, sessionRate: number) => ({
  id, goalId: 7, label: `Clinician ${id}`, roleType: "associate", classification: "1099" as const,
  sessionRate, sessionsPerWeek: 20, weeksWorkedPerYear: 52.1786,
  preCapClinicianSplit: 60, preCapPracticeSplit: 40, capEnabled: false, capAmount: 0,
  postCapClinicianSplit: 60, postCapPracticeSplit: 40, w2EmployerFicaPct: 0,
  futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0,
  nonClinicalHoursPerWeek: 0, nonClinicalHourlyRate: 0,
});
const setup = () => {
  const workspace = emptyWorkspace("2026-09-01");
  Object.assign(workspace.settings, { teamId: 7, baselineMode: "historical", baselineRetentionPct: 100, defaultInPersonPct: 0, horizonMonths: 6 });
  const context: Context = { clinicians: [clinician(1, 100), clinician(2, 200)], staff: [], sessions: [] };
  return { workspace, context };
};
const record = (completed: number, clinicianId = 1, start = "2026-09-10", end = "2026-09-23") => ({
  id: clinicianId, revision: 1, updatedAt: "2026-10-14T12:00:00Z", clinicianId, start, end,
  completed, desired: 40, cancelled: null, noShow: null, scheduled: null,
  inPerson: null, telehealth: null, sourceAttachmentId: null,
});
const closeTo = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("plan attrition still changes hiring review while custom plan pace and source workspace remain unchanged", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  Object.assign(workspace.settings, { forecastStart: "2026-10-01", baselineMode: "manual", baselineWeeklySessions: 8, organicClientsPerMonth: 3, sessionsPerClientMonth: 4, retentionMonths: 6, attendancePct: 100, horizonMonths: 24 });
  const noAttrition = firstHiringReviewMonth(forecast(workspace, context), [1], 80);
  workspace.settings.baselineRetentionPct = 90;
  const higherAttrition = firstHiringReviewMonth(forecast(workspace, context), [1], 80);
  assert.ok(noAttrition && higherAttrition && higherAttrition > noAttrition);
  workspace.settings.baselineWeeklySessions = 12;
  const before = structuredClone({ workspace, context });
  const plan = buildPracticeProjection(workspace, context, "plan", "2026-10-14");
  assert.equal(plan.projectionWorkspace.settings.baselineWeeklySessions, 12);
  assert.equal(plan.projectionWorkspace.settings.forecastStart, "2026-10-01");
  assert.ok(plan.months.length > 0);
  assert.deepEqual({ workspace, context }, before);
});
test("one missing provider's complete-period proof withholds the practice forecast, never substitutes desired volume", () => {
  const { workspace, context } = setup();
  context.sessions = [record(8)];
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 40;
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(actual.planWeekly, 40);
  assert.equal(actual.clinicianPace[0].recordedWeekly, 4);
  assert.equal(actual.clinicianPace[1].recordedWeekly, null);
  assert.equal(actual.projectedWeekly, null);
  assert.equal(actual.latestCompleteThrough, null);
  assert.equal(actual.forecastStart, null);
  assert.deepEqual(actual.months, []);
  assert.match(actual.unavailableReasons.join(" "), /common complete.*unavailable/);
});
test("canonical complete manual periods preserve mix and start the exact forecast the next day, not today", () => {
  const { workspace, context } = setup();
  context.sessions = [record(8), record(16, 2)];
  const before = structuredClone({ workspace, context });
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(actual.projectedWeekly, 12);
  assert.deepEqual(actual.clinicianPace.map((person) => person.usedWeekly), [4, 8]);
  assert.deepEqual(actual.clinicianPace.map((person) => person.recordedDays), [14, 14]);
  assert.equal(actual.latestCompleteThrough, "2026-09-23");
  assert.equal(actual.forecastStart, "2026-09-24");
  assert.equal(actual.projectionWorkspace.settings.forecastStart, "2026-09-01");
  assert.equal(actual.months[0].date, "2026-09-24");
  assert.equal(actual.months[0].periodEnd, "2026-09-30");
  closeTo(actual.months[0].clinicians["1"].sessions, 4);
  closeTo(actual.months[0].clinicians["2"].sessions, 8);
  closeTo(actual.months[0].values.revenue, 2000);
  assert.equal(actual.recentPeriods[0].recorded, 24);
  assert.equal(actual.recentPeriods[0].estimated, 0);
  assert.deepEqual({ workspace, context }, before);
});
test("partial high counts remain in source history but never enter complete actual periods or forecast pace", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  context.sessions = [record(14, 1, "2026-09-24", "2026-10-07"), { ...record(1000, 1, "2026-10-08", "2026-10-14"), id: -1 }];
  const before = structuredClone(context);
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14", [{ clinicianId: 1, start: "2026-10-08", end: "2026-10-14" }]);
  assert.equal(actual.projectedWeekly, 7);
  assert.equal(actual.forecastStart, "2026-10-08");
  assert.equal(actual.completePeriodState.excludedRecords.length, 1);
  assert.deepEqual(actual.recentPeriods.map((period) => period.recorded), [14]);
  closeTo(actual.months[0].values.sessions, 24);
  closeTo(actual.months[0].values.revenue, 2400);
  assert.deepEqual(context, before);
});
test("sparse negative-ID visits require complete coverage and cannot certify quiet gaps", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  context.sessions = [{ ...record(7, 1, "2026-09-24", "2026-09-24"), id: -1 }, { ...record(7, 1, "2026-10-07", "2026-10-07"), id: -2 }];
  assert.equal(buildPracticeProjection(workspace, context, "actual", "2026-10-14").projectedWeekly, null);
  assert.equal(buildPracticeProjection(workspace, context, "actual", "2026-10-14", [{ clinicianId: 2, start: "2026-09-24", end: "2026-10-07" }]).projectedWeekly, null);
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14", [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-07" }]);
  assert.equal(actual.projectedWeekly, 7);
  assert.equal(actual.clinicianPace[0].recordedDays, 14);
});
test("quiet proved periods establish true zero; a replacement complete report advances the forecast cutoff", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  const coverage = [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-21" }];
  const quiet = buildPracticeProjection(workspace, context, "actual", "2026-10-14", coverage);
  assert.equal(quiet.projectedWeekly, 0);
  assert.equal(quiet.forecastStart, "2026-10-08");
  assert.equal(quiet.recentPeriods[0].recorded, 0);
  context.sessions = [{ ...record(28, 1, "2026-10-08", "2026-10-08"), id: -1 }];
  const complete = buildPracticeProjection(workspace, context, "actual", "2026-10-22", coverage);
  assert.equal(complete.forecastStart, "2026-10-22");
  assert.equal(complete.projectedWeekly, 7);
  assert.deepEqual(complete.clinicianPace.map((person) => person.recordedThrough), ["2026-10-21"]);
});
test("latest common complete period governs all clinician baselines even when one provider has newer high counts", () => {
  const { workspace, context } = setup();
  context.sessions = [record(8), record(16, 2), record(1000, 1, "2026-09-24", "2026-10-07")];
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(actual.latestCompleteThrough, "2026-09-23");
  assert.equal(actual.forecastStart, "2026-09-24");
  assert.deepEqual(actual.completePeriodState.byClinician.map((row) => row.through), ["2026-10-07", "2026-09-23"]);
  assert.deepEqual(actual.clinicianPace.map((row) => row.recordedThrough), ["2026-09-23", "2026-09-23"]);
  assert.deepEqual(actual.clinicianPace.map((row) => row.usedWeekly), [4, 8]);
  assert.equal(actual.projectedWeekly, 12);
});
test("disjoint complete provider periods cannot invent a common practice forecast start", () => {
  const { workspace, context } = setup();
  context.sessions = [record(8), record(16, 2, "2026-09-24", "2026-10-07")];
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(actual.forecastStart, null);
  assert.deepEqual(actual.months, []);
});
test("future card fees never replace historic charges and are the same estimate used for percentage pay", () => {
  const { workspace, context } = setup();
  context.sessions = [record(8), record(16, 2)];
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-01-01", desiredWeeklySessions: 20, expectedSessionRevenue: 50 }));
  workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: "2026-01-01", expectedSessionRevenue: 25 }));
  workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: "2026-10-01", sessionRate: 120 }));
  context.importedBillingActuals = [100000, 200000].map((totalFeeCharged) => ({ clinicianId: 1, serviceDate: "2026-09-24", totalFeeCharged, sourceRowHash: "historical-conflict" }));
  const before = structuredClone({ workspace, context });
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  closeTo(actual.months[0].values.revenue, 2000);
  closeTo(actual.months[0].values.clinicianPay, 2000 * 0.6);
  closeTo(actual.months[1].values.revenue, (4 * 120 + 8 * 200) * 31 / 7);
  assert.deepEqual({ workspace, context }, before);
});
test("overlapping and noncanonical aggregate counts cannot produce a working baseline", () => {
  for (const records of [[record(8), record(8)], [record(8, 1, "2026-09-01", "2026-09-14")]]) {
    const { workspace, context } = setup();
    context.clinicians = [context.clinicians[0]];
    context.sessions = records;
    const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
    assert.equal(actual.projectedWeekly, null);
    assert.deepEqual(actual.months, []);
  }
});
test("off-team, planned, archived, future-start and ended profiles do not block the current practice", () => {
  for (const profile of [{ onTeam: false }, { status: "planned" }, { status: "archived" }, { start: "2026-11-01" }, { end: "2026-08-31" }]) {
    const { workspace, context } = setup();
    context.sessions = [record(8), record(16, 2)];
    workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 2, start: "2026-01-01", desiredWeeklySessions: 20, ...profile }));
    const before = structuredClone({ workspace, context });
    const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
    assert.equal(actual.projectedWeekly, 4);
    assert.equal(actual.clinicianPace[1].usedWeekly, 0);
    assert.equal(actual.clinicianPace[1].recordedWeekly, 8);
    assert.equal(actual.recentPeriods[0].recorded, 24);
    closeTo(actual.months[0].values.sessions, 4);
    assert.deepEqual({ workspace, context }, before);
  }
});
test("three-calendar-month history includes whole complete periods only and never assumes unreported gaps zero", () => {
  const { workspace, context } = setup();
  context.clinicians = [context.clinicians[0]];
  context.sessions = [record(1000, 1, "2026-07-02", "2026-07-15"), record(14, 1, "2026-07-16", "2026-07-29"), record(14, 1, "2026-09-24", "2026-10-07")];
  const before = structuredClone({ workspace, context });
  const actual = buildPracticeProjection(workspace, context, "actual", "2026-10-14");
  assert.equal(actual.projectedWeekly, 7);
  assert.equal(actual.clinicianPace[0].recordedDays, 28);
  assert.match(actual.clinicianPace[0].basis, /28 calendar days/);
  const later = buildPracticeProjection(workspace, context, "actual", "2026-12-14");
  assert.deepEqual(later.clinicianPace, actual.clinicianPace);
  assert.equal(later.forecastStart, "2026-10-08");
  assert.deepEqual({ workspace, context }, before);
});
test("a later independently proved billing period advances forecast start without extending activity pace", () => {
  const { workspace, context } = setup();
  context.sessions = [record(14, 1, "2026-09-24", "2026-10-07"), record(28, 2, "2026-09-24", "2026-10-07")];
  context.importedBillingActuals = [{ clinicianId: 1, serviceDate: "2026-10-10", totalFeeCharged: 500, sourceRowHash: "actual-billing-only" }];
  const before = structuredClone({ workspace, context });
  const result = buildPracticeProjection(workspace, context, "actual", "2026-10-22", [], "2026-10-21");
  assert.equal(result.latestCompleteThrough, "2026-10-07");
  assert.equal(result.latestReportThrough, "2026-10-21");
  assert.equal(result.forecastStart, "2026-10-22");
  assert.deepEqual(result.clinicianPace.map((person) => person.recordedThrough), ["2026-10-07", "2026-10-07"]);
  assert.equal(result.projectedWeekly, 21);
  assert.equal(result.months[0].date, "2026-10-22");
  closeTo(result.months[0].values.sessions, 30);
  closeTo(result.months[0].values.revenue, 5000);
  const earlier = buildPracticeProjection(workspace, context, "actual", "2026-10-22", [], "2026-09-23");
  assert.equal(earlier.latestReportThrough, "2026-10-07");
  assert.equal(earlier.forecastStart, "2026-10-08");
  assert.deepEqual({ workspace, context }, before);
});
test("billing-only proof supplies a dated boundary but never invents activity or a known forecast", () => {
  const { workspace, context } = setup();
  const result = buildPracticeProjection(workspace, context, "actual", "2026-10-22", [], "2026-10-21");
  assert.equal(result.latestCompleteThrough, null);
  assert.equal(result.latestReportThrough, "2026-10-21");
  assert.equal(result.forecastStart, "2026-10-22");
  assert.equal(result.projectedWeekly, null);
  assert.deepEqual(result.months, []);
  assert.match(result.unavailableReasons.join(" "), /missing activity proof/);
  for (const through of ["2026-10-14", "2026-11-04", "2026-02-30", "invalid"])
    assert.throws(() => buildPracticeProjection(workspace, context, "actual", "2026-10-22", [], through));
});
