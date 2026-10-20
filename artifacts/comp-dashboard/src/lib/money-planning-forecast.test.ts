import test from "node:test";
import assert from "node:assert/strict";
import { clinicianSettingSchema, emptyWorkspace, forecast, type Context, type PaceCoverage } from "@workspace/practice/hub";
import { moneyPlanningForecast } from "./money-planning-forecast.ts";
import { profitFirstPlanning } from "./profit-first-planning.ts";

function fixture() {
  const workspace = emptyWorkspace("2026-09-01");
  Object.assign(workspace.settings, { teamId: 7, baselineMode: "historical", historicalStart: "2026-09-01", historicalEnd: "2026-09-30", defaultInPersonPct: 0, familyW2ClinicianId: 2, overheadFloorMonthly: 4338.05, overheadFloorOverride: true, processingPct: 3 });
  const context: Context = { clinicians: [], staff: [], sessions: [] };
  const coverage: PaceCoverage[] = [];
  for (let id = 1; id <= 6; id++) {
    context.clinicians.push({ id, goalId: 7, label: `Synthetic clinician ${id}`, classification: id === 1 ? "owner" : "w2", sessionRate: 100 + id * 10, sessionsPerWeek: 50, weeksWorkedPerYear: 52.1786, capEnabled: false, capAmount: 0, preCapClinicianSplit: id === 1 ? 0 : 60, preCapPracticeSplit: id === 1 ? 100 : 40, postCapClinicianSplit: 60, postCapPracticeSplit: 40, w2EmployerFicaPct: 7.65, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 });
    workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: id, start: "2026-01-01", desiredWeeklySessions: 50, inPersonPct: 0, ...(id === 2 ? { payMode: "salary", payAmount: 90000 } : {}) }));
    context.sessions.push({ id: -id, clinicianId: id, start: "2026-10-07", end: "2026-10-07", completed: id * 8, desired: 0, scheduled: null, cancelled: null, noShow: null, inPerson: null, telehealth: null, sourceAttachmentId: null });
    coverage.push({ clinicianId: id, start: "2026-09-24", end: "2026-10-07" });
  }
  context.importedBillingActuals = ["2026-09-24", "2026-10-10"].flatMap(serviceDate => [100000, 200000].map(totalFeeCharged => ({ clinicianId: 3, serviceDate, totalFeeCharged, sourceRowHash: `synthetic-conflict-${serviceDate}` })));
  return { workspace, context, coverage };
}
const close = (actual: number | null | undefined, expected: number) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test("six observed clinicians replace stale stored month and contaminated general forecast with a full current-month planning scenario", () => {
  const { workspace, context, coverage } = fixture();
  // Synthetic explicit quarterly tax plan of $9,000, stored as its monthly /3 estimate.
  workspace.moneyPlanning = { estimatedMonthlyValues: { taxObligations: 9000 / 3 } };
  const original = structuredClone({ workspace, context, coverage });
  assert.equal(forecast(workspace, context)[0].values.revenue, null);
  const report = moneyPlanningForecast(workspace, context, "2026-10-18", coverage);
  assert.deepEqual(report.clinicianPace.map(p => p.usedWeekly), [4, 8, 12, 16, 20, 24]);
  const month = report.months[0];
  assert.equal(month.date, "2026-10-01");
  assert.equal(month.periodEnd, "2026-10-31");
  close(month.values.sessions, 84 * 31 / 7);
  close(month.values.revenue, context.clinicians.reduce((n, c) => n + c.id * 4 * c.sessionRate, 0) * 31 / 7);
  close(month.values.coOwnerSalaryPretax, 7500);
  close(month.values.ownerClinicalPay, 0);
  for (const key of ["clinicianPay", "employerBurden", "fees"]) assert.ok(Number.isFinite(month.values[key]));
  const { overhead, ...values } = month.values;
  const planning = profitFirstPlanning({ workspace, context, asOf: month.date, estimatedMonthlyValues: values, estimateSourcePeriod: report.basis });
  assert.notEqual(planning.income, null);
  assert.notEqual(planning.totalMonthly, null);
  close(planning.costs.find(cost => cost.key === "taxObligations")!.monthly, 3000);
  close(planning.protectedErinMonthly, 7500);
  assert.deepEqual(planning.reasons, []);
  assert.match(report.basis, /current-month planning scenario.*observed sessions through 2026-10-07/);
  assert.deepEqual({ workspace, context, coverage }, original);
});

test("supported current-month income and payroll do not supply a missing tax planning estimate", () => {
  const { workspace, context, coverage } = fixture();
  const report = moneyPlanningForecast(workspace, context, "2026-10-18", coverage);
  const { overhead, ...values } = report.months[0].values;
  const planning = profitFirstPlanning({ workspace, context, asOf: report.months[0].date, estimatedMonthlyValues: values, estimateSourcePeriod: report.basis });
  assert.notEqual(planning.income, null);
  close(planning.protectedErinMonthly, 7500);
  assert.equal(planning.costs.find(cost => cost.key === "taxObligations")!.monthly, null);
  assert.equal(planning.totalMonthly, null);
  assert.equal(planning.status, "incomplete");
});

test("missing provider coverage stays unknown despite desired cards; no ledger or imported fee can establish attendance", () => {
  const { workspace, context, coverage } = fixture();
  const report = moneyPlanningForecast(workspace, context, "2026-10-18", coverage.filter(p => p.clinicianId !== 6));
  assert.deepEqual(report.months, []);
  assert.match(report.unavailableReasons.join(" "), /common complete.*unavailable/);
});

test("quiet covered clinicians preserve zero while imported billing changes cannot alter the planning scenario", () => {
  const { workspace, context, coverage } = fixture();
  context.sessions = context.sessions.filter(row => row.clinicianId !== 6);
  const first = moneyPlanningForecast(workspace, context, "2026-10-18", coverage);
  assert.equal(first.clinicianPace.find(p => p.id === 6)?.usedWeekly, 0);
  context.importedBillingActuals = [];
  const second = moneyPlanningForecast(workspace, context, "2026-10-18", coverage);
  assert.deepEqual(second.months.map(m => m.values), first.months.map(m => m.values));
});
