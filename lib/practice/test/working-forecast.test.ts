import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, forecast, clinicianSettingSchema, termSchema, staffTermSchema, roomSchema, categorySchema, budgetSchema, eventSchema, campaignSchema, type Context } from "../src/hub/index.ts";
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
test("working percentage pay uses the same card-fee estimate as projected charges; planning retains expected-fee assumptions", () => {
  const { workspace, context, options } = setup();
  Object.assign(context.clinicians[0], { classification: "1099", preCapClinicianSplit: 60, preCapPracticeSplit: 40 });
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-01-01", desiredWeeklySessions: 7, expectedSessionRevenue: 50 }));
  const before = structuredClone({ workspace, context });
  const working = forecast(workspace, context, [], 1, false, { ...options, useImportedBillingActuals: false })[0];
  near(working.values.sessions, 31);
  near(working.values.revenue, 3100);
  near(working.values.clinicianPay, 31 * 100 * 0.6);
  const plan = forecast(workspace, context, [], 1, false, { ...options, workingForecast: false, useImportedBillingActuals: false })[0];
  near(plan.values.revenue, plan.values.sessions! * 50);
  near(plan.values.clinicianPay, plan.values.sessions! * 50 * 0.6);
  assert.deepEqual({ workspace, context }, before);
  workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: "2026-10-16", sessionRate: 200 }));
  const dated = forecast(workspace, context, [], 1, false, { ...options, useImportedBillingActuals: false })[0];
  near(dated.values.revenue, 15 * 100 + 16 * 200);
  near(dated.values.clinicianPay, (15 * 100 + 16 * 200) * 0.6);
});
test("imported charges replace their matching clinician-date estimate exactly once", () => {
  const { workspace, context, options } = setup();
  const actual = { clinicianId: 1, serviceDate: "2026-10-05", totalFeeCharged: 350, sourceRowHash: "synthetic-fee", replacementSessionCount: 1 };
  context.importedBillingActuals = [actual, { ...actual }];
  near(forecast(workspace, context, [], 1, false, options)[0].values.revenue, 3100 - 100 + 350);
  const before = structuredClone(context);
  context.importedBillingActuals.push({ ...actual, totalFeeCharged: 450 });
  const conflict = forecast(workspace, context, [], 1, false, options)[0];
  assert.equal(conflict.values.revenue, null); assert.equal(conflict.values.profit, null);
  assert.deepEqual(context.importedBillingActuals.slice(0, 2), before.importedBillingActuals);
});

test("percentage pay and cap progress use actual discounted charges rather than card fees", () => {
  const { workspace, context, options } = setup();
  Object.assign(context.clinicians[0], { classification: "1099", preCapClinicianSplit: 60, preCapPracticeSplit: 40, capEnabled: true, capAmount: 100, postCapClinicianSplit: 80, postCapPracticeSplit: 20 });
  context.importedBillingActuals = [{ clinicianId: 1, serviceDate: "2026-10-01", totalFeeCharged: 50, sourceRowHash: "discount", replacementSessionCount: 1 }];
  const before = structuredClone(context);
  const month = forecast(workspace, context, [], 1, false, { ...options, workingRange: { start: "2026-10-01", end: "2026-10-03" } })[0];
  near(month.values.revenue, 250);
  near(month.values.clinicianPay, 150);
  assert.deepEqual(context, before);
});

test("rejected replacement evidence cannot certify split pay or later cap progress, but salary remains known", () => {
  const { workspace, context, options } = setup();
  Object.assign(context.clinicians[0], { classification: "1099", preCapClinicianSplit: 60, preCapPracticeSplit: 40, capEnabled: true, capAmount: 100, postCapClinicianSplit: 80, postCapPracticeSplit: 20 });
  context.importedBillingActuals = [{ clinicianId: 1, serviceDate: "2026-10-01", totalFeeCharged: 50, sourceRowHash: "rejected-discount", replacementSessionCount: 2 }];
  const months = forecast(workspace, context, [], 1, false, options);
  assert.equal(months[0].values.revenue, null);
  assert.equal(months[0].values.clinicianPay, null);
  assert.equal(months[0].clinicians["1"].clinicianPay, null);
  assert.equal(months[1].values.clinicianPay, null, "Unknown prior cap progress cannot certify a later split");
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-01-01", desiredWeeklySessions: 7, payMode: "salary", payAmount: 12000, inPersonPct: 0 }));
  near(forecast(workspace, context, [], 1, false, options)[0].values.clinicianPay, 1000);
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

test("working headcount and daily goal measures exclude onTeam false without rewriting historical counts", () => {
  const { workspace, context, options } = setup();
  context.clinicians.push({ ...context.clinicians[0], id: 2, label: "Former" });
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 2, start: "2026-01-01", onTeam: false, desiredWeeklySessions: 7 }));
  const before = structuredClone({ workspace, context });
  const working = forecast(workspace, context, [], 1, false, { ...options, baselineWeeklyByClinician: { 1: 7, 2: 0 } })[0];
  assert.equal(working.values.activeClinicalHeadcount, 1);
  assert.equal(working.goalMeasureDaily!["2026-10-05"].activeClinicalHeadcount, 1);
  assert.equal(forecast(workspace, context, [], 1, false)[0].values.activeClinicalHeadcount, 2);
  assert.deepEqual({ workspace, context }, before);
});
test("working room utilization is unknown without dated use, never a fabricated zero", () => {
  const { workspace, context, options } = setup();
  workspace.settings.defaultInPersonPct = 100;
  workspace.rooms.push(roomSchema.parse({ id: crypto.randomUUID(), name: "Synthetic room", start: "2026-01-01", weeklyHours: 14, sessionMinutes: 60, usablePct: 100 }));
  const month = forecast(workspace, context, [], 1, false, options)[0];
  near(month.values.sessions, 31);
  near(month.values.roomCapacity, 62);
  assert.equal(month.values.roomUtilization, null);
});
test("working range clips exact service dates with calendar-month salary, overhead and owner-pay denominators", () => {
  const { workspace, context, options } = setup();
  workspace.settings.ownerPayrollMonthly = 3100;
  workspace.settings.familyW2ClinicianId = 1;
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-01-01", desiredWeeklySessions: 7, payMode: "salary", payAmount: 37200, inPersonPct: 0 }));
  const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Synthetic overhead", kind: "expense" });
  workspace.categories.push(category);
  workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: "Monthly cost", categoryId: category.id, amount: 3100, cadence: "monthly", start: "2026-01-01" }));
  workspace.events.push(eventSchema.parse({ id: crypto.randomUUID(), name: "Dated cost", date: "2026-10-20", field: "custom", value: 0, monthlyCost: 310, oneTimeCost: 500 }));
  workspace.campaigns.push(campaignSchema.parse({ id: crypto.randomUUID(), name: "Synthetic campaign", method: "cpl", monthlySpend: 310, cpl: 10, start: "2026-01-01" }));
  const before = structuredClone({ workspace, context });
  const months = forecast(workspace, context, [], 1, true, { ...options, useImportedBillingActuals: false, workingRange: { start: "2026-10-15", end: "2026-10-31" } });
  assert.equal(months.length, 1);
  assert.equal(months[0].date, "2026-10-15");
  assert.equal(months[0].periodEnd, "2026-10-31");
  near(months[0].values.sessions, 17);
  near(months[0].values.revenue, 1700);
  near(months[0].values.clinicianPay, 1700);
  near(months[0].values.coOwnerSalaryPretax, 1700);
  near(months[0].values.ownerPayroll, 1700);
  near(months[0].values.overhead, 1700 + 120 + 500);
  near(months[0].values.marketing, 170);
  assert.deepEqual({ workspace, context }, before);
});
test("a partial working start cannot invent delayed receipts from absent or partial prior months", () => {
  const { workspace, context, options } = setup();
  workspace.settings.collectionDelayMonths = 1;
  workspace.settings.processingPct = 3;
  const months = forecast(workspace, context, [], 1, false, { ...options, useImportedBillingActuals: false, workingRange: { start: "2026-10-15", end: "2026-12-31" } });
  near(months[0].values.revenue, 1700);
  assert.equal(months[0].values.collections, null);
  assert.equal(months[1].values.collections, null, "October's partial revenue is not a complete previous-month source");
  near(months[2].values.collections, 3000);
  assert.equal(months[2].values.cash, null);
});
test("working range skips outside months and preserves daily variable-budget boundaries", () => {
  const { workspace, context, options } = setup();
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-01-01", end: "2026-11-19", desiredWeeklySessions: 7 }));
  const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Dated overhead", kind: "expense" });
  workspace.categories.push(category);
  for (const cadence of ["per_session", "percent_revenue"] as const)
    workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: cadence, categoryId: category.id, amount: 10, cadence, start: "2026-11-20" }));
  const months = forecast(workspace, context, [], 1, false, { ...options, useImportedBillingActuals: false, workingRange: { start: "2026-11-15", end: "2026-12-05" } });
  assert.deepEqual(months.map((month) => [month.date, month.periodEnd]), [["2026-11-15", "2026-11-30"], ["2026-12-01", "2026-12-05"]]);
  near(months[0].values.sessions, 5);
  near(months[0].values.revenue, 500);
  near(months[0].values.overhead, 0);
  near(months[1].values.sessions, 0);
  assert.throws(() => forecast(workspace, context, [], 1, false, { ...options, workingRange: { start: "2026-02-30", end: "2026-12-05" } }));
});
test("working attribution metrics stay unknown with marketing budgets and no campaign rows", () => {
  const { workspace, context, options } = setup();
  const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Marketing", kind: "marketing" });
  workspace.categories.push(category);
  workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: "Marketing cost", categoryId: category.id, amount: 100, cadence: "monthly", start: "2026-01-01" }));
  assert.equal(workspace.campaigns.length, 0);
  for (const compareMarketing of [false, true]) {
    const month = forecast(workspace, context, [], 1, compareMarketing, options)[0];
    near(month.values.revenue, 3100);
    near(month.values.marketing, 100);
    for (const key of ["roas", "contributionRoas", "netRoi"]) assert.equal(month.values[key], null, key);
  }
});
