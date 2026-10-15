import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, forecast, clinicianSettingSchema, staffTermSchema, type Context } from "../src/hub/index.ts";
const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function setup() {
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { defaultInPersonPct: 0, baselineRetentionPct: 50, organicClientsPerMonth: 20, attendancePct: 40, horizonMonths: 3 });
  const context: Context = { clinicians: [{ id: 1, label: "Synthetic", goalId: null, classification: "owner", sessionRate: 100, sessionsPerWeek: 5, weeksWorkedPerYear: 20, capEnabled: false, capAmount: 0, preCapClinicianSplit: 0, preCapPracticeSplit: 100, postCapClinicianSplit: 0, postCapPracticeSplit: 100, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
  return { workspace, context, options: { baselineWeeklyByClinician: { 1: 7 }, workingForecast: true, useImportedBillingActuals: true } };
}
test("working forecast is calendar pace times fee, without vacation, caseload, attendance or growth adjustment", () => {
  const { workspace, context, options } = setup();
  const months = forecast(workspace, context, [], 1, false, options);
  near(months[0].values.sessions, 31); near(months[0].values.revenue, 3100);
  near(months[1].values.sessions, 30); near(months[1].values.revenue, 3000);
  near(months[2].values.sessions, 31); near(months[2].values.revenue, 3100);
  assert.ok(months[0].values.sessions! > months[0].values.capacity!);
});
test("imported charges replace their matching clinician-date estimate exactly once", () => {
  const { workspace, context, options } = setup();
  const actual = { clinicianId: 1, serviceDate: "2026-10-05", totalFeeCharged: 350, sourceRowHash: "synthetic-fee" };
  context.importedBillingActuals = [actual, { ...actual }];
  near(forecast(workspace, context, [], 1, false, options)[0].values.revenue, 3100 - 100 + 350);
  const before = structuredClone(context);
  context.importedBillingActuals.push({ ...actual, totalFeeCharged: 450 });
  const conflict = forecast(workspace, context, [], 1, false, options)[0];
  assert.equal(conflict.values.revenue, null); assert.equal(conflict.values.profit, null);
  assert.deepEqual(context.importedBillingActuals.slice(0, 2), before.importedBillingActuals);
});
test("former current-team flag excludes future estimates without changing stored session or billing facts", () => {
  const { workspace, context, options } = setup();
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-01-01", desiredWeeklySessions: 5, onTeam: false }));
  const before = structuredClone({ workspace, context });
  near(forecast(workspace, context, [], 1, false, options)[0].values.sessions, 0);
  assert.deepEqual({ workspace, context }, before);
});
test("unknown selected support pay does not become certified zero staff cost or profit", () => {
  const { workspace, context, options } = setup();
  context.staff = [{ id: 1, goalId: null, label: "Unknown", classification: "w2", annualSalary: null, hourlyRate: null, hoursPerWeek: null, weeksPerYear: 48, w2EmployerFicaPct: 7.65, futaSutaPct: 1, workersCompPct: 0.5, otherEmployerBurdenPct: 0 }];
  const month = forecast(workspace, context, [], 1, false, options)[0];
  near(month.values.revenue, 3100); assert.equal(month.values.staffCost, null); assert.equal(month.values.profit, null); assert.equal(month.values.distributions, null);
});
test("unknown prior costs keep accumulated cash unknown after later staff terms become known", () => {
  const { workspace, context, options } = setup();
  context.staff = [{ id: 1, goalId: null, classification: "w2", annualSalary: null, hourlyRate: null, hoursPerWeek: null, weeksPerYear: 48, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }];
  workspace.staffTerms.push(staffTermSchema.parse({ id: crypto.randomUUID(), staffMemberId: 1, effectiveDate: "2026-11-01", annualSalary: 12000 }));
  const months = forecast(workspace, context, [], 1, false, options);
  assert.equal(months[0].values.profit, null);
  near(months[1].values.profit, 2000);
  assert.equal(months[1].values.cash, null);
  assert.equal(months[2].values.cash, null);
});
test("billing uncertainty follows collections without destroying later known earned revenue", () => {
  const { workspace, context, options } = setup();
  workspace.settings.collectionDelayMonths = 1;
  context.importedBillingActuals = [350, 450].map((totalFeeCharged) => ({ clinicianId: 1, serviceDate: "2026-10-05", totalFeeCharged, sourceRowHash: "conflict" }));
  const months = forecast(workspace, context, [], 1, false, options);
  assert.equal(months[0].values.revenue, null);
  assert.equal(months[0].clinicians["1"].revenue, null);
  assert.equal(months[0].clinicians["1"].profit, null);
  near(months[1].values.revenue, 3000);
  assert.equal(months[1].values.collections, null);
  near(months[2].values.revenue, 3100);
  near(months[2].values.collections, 3000);
  assert.equal(months[2].values.cash, null);
});
