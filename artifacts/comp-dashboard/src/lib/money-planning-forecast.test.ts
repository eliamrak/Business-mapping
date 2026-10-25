import test from "node:test";
import assert from "node:assert/strict";
import { clinicianSettingSchema, emptyWorkspace, eventSchema, forecast, hiringSchema, type Context, type PaceCoverage } from "@workspace/practice/hub";
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
  assert.deepEqual(planning.reasons, ["Quarterly tax planning estimate is missing."]);
});

test("October 10 salary start retains the dated $5,500 monthly result when Money uses October 1", () => {
  const { workspace, context, coverage } = fixture();
  const recipient = workspace.clinicians.find(person => person.clinicianId === 2)!;
  recipient.start = "2026-10-10";
  recipient.payAmount = 93000;
  for (const record of context.sessions) record.start = record.end = "2026-10-21";
  for (const proof of coverage) { proof.start = "2026-10-08"; proof.end = "2026-10-21"; }
  workspace.moneyPlanning = { estimatedMonthlyValues: { taxObligations: 0 } };
  const original = structuredClone({ workspace, context, coverage });
  const report = moneyPlanningForecast(workspace, context, "2026-10-22", coverage);
  const month = report.months[0];
  assert.equal(month.date, "2026-10-01");
  close(month.values.coOwnerSalaryPretax, 5500);
  const { overhead, ...values } = month.values;
  const planning = profitFirstPlanning({ workspace, context, asOf: month.date, estimatedMonthlyValues: values, estimateSourcePeriod: report.basis });
  close(planning.protectedErinMonthly, 5500);
  close(planning.rows.find(row => row.key === "owner-payroll")!.costMonthly, 5500);
  close(planning.costs.find(cost => cost.key === "therapistPay")!.monthly, values.clinicianPay! - values.ownerClinicalPay! - 5500);
  assert.notEqual(planning.rows.find(row => row.key === "therapist-payroll")!.requiredMonthly, null);
  assert.notEqual(planning.totalMonthly, null);
  assert.deepEqual(planning.reasons, []);
  assert.deepEqual({ workspace, context, coverage }, original);
});

test("selected previous month caps observations, flags unavailable historical assumptions and models its full month", () => {
  const { workspace, context, coverage } = fixture();
  const current = moneyPlanningForecast(workspace, context, "2026-10-18", coverage);
  const unavailable = moneyPlanningForecast(workspace, context, "2026-10-18", coverage, "2026-09");
  assert.equal(unavailable.observedAsOf, "2026-09-30");
  assert.deepEqual(unavailable.months, [], "October proof cannot establish a September baseline");
  assert.equal(unavailable.historicalAssumptionsAvailable, false);
  assert.match(unavailable.warnings.join(" "), /historical assumption snapshot is unavailable/);
  for (const person of context.clinicians) {
    context.sessions.push({ ...context.sessions.find(row => row.clinicianId === person.id)!, start: "2026-09-23", end: "2026-09-23", completed: person.id * 4 });
    coverage.push({ clinicianId: person.id, start: "2026-09-10", end: "2026-09-23" });
  }
  const before = structuredClone({ workspace, context, coverage });
  const selected = moneyPlanningForecast(workspace, context, "2026-10-18", coverage, "2026-09-01");
  assert.equal(selected.start, "2026-09-01");
  assert.equal(selected.end, "2026-09-30");
  assert.equal(selected.selectedMonth, "2026-09");
  assert.equal(selected.months[0].date, "2026-09-01");
  assert.equal(selected.months[0].periodEnd, "2026-09-30");
  assert.deepEqual(selected.clinicianPace.map(p => p.usedWeekly), [2, 4, 6, 8, 10, 12]);
  close(selected.months[0].values.sessions, 42 * 30 / 7);
  assert.match(selected.basis, /observations capped at 2026-09-30/);
  assert.notDeepEqual(selected.months[0].values, current.months[0].values);
  assert.deepEqual({ workspace, context, coverage }, before);
});

test("future month uses observations only through today and invalid months fail explicitly", () => {
  const { workspace, context, coverage } = fixture();
  const report = moneyPlanningForecast(workspace, context, "2026-10-18", coverage, "2026-11");
  assert.equal(report.observedAsOf, "2026-10-18");
  assert.equal(report.months[0].periodEnd, "2026-11-30");
  assert.deepEqual(report.clinicianPace.map(p => p.usedWeekly), [4, 8, 12, 16, 20, 24]);
  assert.throws(() => moneyPlanningForecast(workspace, context, "2026-10-18", coverage, "2026-13"), /valid planning month/);
});

test("planned, archived and future clinicians and hiring scenarios never enter the Money baseline", () => {
  const { workspace, context, coverage } = fixture();
  const base = moneyPlanningForecast(workspace, context, "2026-10-18", coverage);
  for (const [index, status] of ["planned", "archived", "active"].entries()) {
    const id = 10 + index;
    context.clinicians.push({ ...context.clinicians[0], id });
    workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: id, status, start: status === "active" ? "2026-11-01" : "2026-01-01", desiredWeeklySessions: 100 }));
  }
  workspace.hiring.push(hiringSchema.parse({ id: crypto.randomUUID(), name: "Planned hire", start: "2026-10-01", templateClinicianId: 3, desiredWeeklySessions: 100, monthlySupport: 10000 }));
  workspace.events.push(eventSchema.parse({ id: crypto.randomUUID(), name: "Hire scenario", date: "2026-10-01", field: "clinician.hire", targetId: "3", value: 80 }));
  const original = structuredClone({ workspace, context, coverage });
  const report = moneyPlanningForecast(workspace, context, "2026-10-18", coverage);
  assert.deepEqual(report.clinicianPace.map(p => p.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(report.months.map(m => m.values), base.months.map(m => m.values));
  assert.deepEqual({ workspace, context, coverage }, original);
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

test("confirmed billed-rate split remains unchanged by collection and processor fee assumptions", () => {
  const { workspace, context, coverage } = fixture();
  const baseline = moneyPlanningForecast(workspace, context, "2026-10-25", coverage, "2026-10").months[0].values;
  workspace.settings.collectionPct = 70;
  workspace.settings.processingPct = 9;
  workspace.settings.processingFixedPerTransaction = 0.4;
  const adjusted = moneyPlanningForecast(workspace, context, "2026-10-25", coverage, "2026-10").months[0].values;
  close(adjusted.revenue, baseline.revenue!);
  close(adjusted.clinicianPay, baseline.clinicianPay!);
  assert.notEqual(adjusted.fees, baseline.fees);
  close(baseline.profit! - adjusted.profit!, adjusted.fees! - baseline.fees!);
});
