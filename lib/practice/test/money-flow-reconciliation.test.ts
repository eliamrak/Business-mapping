import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, clinicianSettingSchema, allocationSchema, categorySchema, budgetSchema, forecast, monthFlow, canonicalServicePeriod, type Context } from "../src/hub/index.ts";

const close = (actual: number | null, expected: number | null) => assert.ok(actual !== null && expected !== null && Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function fixture(month = "2026-10-01") {
  const workspace = emptyWorkspace(month);
  Object.assign(workspace.settings, { baselineRetentionPct: 100, defaultInPersonPct: 0, organicClientsPerMonth: 0, familyW2ClinicianId: 2, overheadFloorMonthly: 200, processingPct: 3, processingFixedPerTransaction: 0.3 });
  const clinicians = ["owner", "w2", "1099"].map((classification, index) => ({
    id: index + 1, goalId: null, label: `Synthetic ${classification}`, classification,
    sessionRate: 100, sessionsPerWeek: 20, weeksWorkedPerYear: 52.1786,
    capEnabled: false, capAmount: 0, preCapClinicianSplit: index === 0 ? 0 : 60, preCapPracticeSplit: index === 0 ? 100 : 40,
    postCapClinicianSplit: 60, postCapPracticeSplit: 40, w2EmployerFicaPct: 7.65, futaSutaPct: 1, workersCompPct: 0.5, otherEmployerBurdenPct: 0,
  }));
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 2, start: "2026-01-01", desiredWeeklySessions: 20, payMode: "salary", payAmount: 90000, inPersonPct: 0 }));
  const end = month.slice(0, 7) + "-14";
  const period = canonicalServicePeriod(month);
  const context: Context = { clinicians, staff: [], sessions: clinicians.map((person) => ({ id: person.id, revision: 1, updatedAt: end + "T12:00:00Z", clinicianId: person.id, ...period, completed: 28, desired: 40, cancelled: null, noShow: null, scheduled: null, inPerson: null, telehealth: null, sourceAttachmentId: null })) };
  return { workspace, context, end };
}

test("projected Money flow and bridge use the same earned costs, not 28-day October checks", () => {
  const { workspace, context, end } = fixture();
  const before = structuredClone({ workspace, context });
  const options = { baselineWeeklyByClinician: { 1: 14, 2: 14, 3: 14 }, useImportedBillingActuals: true, workingForecast: true };
  const engine = forecast(workspace, context, [], 1, true, options)[0];
  const flow = monthFlow(workspace, context, "2026-10-01", end, { fullMonthProjection: true });
  close(flow.revenue, engine.values.revenue);
  close(flow.sessions, engine.values.sessions);
  close(flow.clinicianPay, engine.values.clinicianPay);
  close(flow.employerBurden, engine.values.employerBurden);
  close(flow.staffPay, engine.values.staffCost);
  close(flow.overhead, engine.values.overhead);
  close(flow.processing, engine.values.fees);
  close(flow.profit, engine.values.profit);
  close(flow.familyGrossPay, 7500);
  close(flow.clinicianPay - flow.familyGrossPay, 31 * 2 * 100 * 0.6);
  close(flow.scheduledPayroll!.clinicianPay - flow.scheduledPayroll!.familyGrossPay, 28 * 2 * 100 * 0.6);
  close(flow.clinicianPay - flow.scheduledPayroll!.clinicianPay, 3 * 2 * 100 * 0.6);
  close(flow.revenue, 3 * 31 * 2 * 100);
  assert.deepEqual({ workspace, context }, before);
});

test("earned operating profit stays equal when check counts, capacity, growth, collection timing or salary terms change", () => {
  for (const month of ["2026-01-01", "2026-02-01", "2026-10-01", "2026-12-01"]) {
    const { workspace, context, end } = fixture(month);
    workspace.settings.organicClientsPerMonth = 3;
    workspace.settings.collectionDelayMonths = 1;
    workspace.settings.collectionPct = 80;
    workspace.clinicians[0].desiredWeeklySessions = 2;
    const options = { baselineWeeklyByClinician: { 1: 14, 2: 14, 3: 14 }, useImportedBillingActuals: true, workingForecast: true };
    const engine = forecast(workspace, context, [], 1, true, options)[0];
    const flow = monthFlow(workspace, context, month, end, { fullMonthProjection: true });
    close(flow.profit, engine.values.profit);
    close(flow.revenue, engine.values.revenue);
    close(flow.sessions, engine.values.sessions);
    close(flow.processing, engine.values.fees);
  }
});

test("tax and household distributions stay after operating profit; owner clinical revenue is not paid twice", () => {
  const { workspace, context, end } = fixture();
  const original = monthFlow(workspace, context, "2026-10-01", end, { fullMonthProjection: true });
  workspace.allocations.push(allocationSchema.parse({ id: crypto.randomUUID(), name: "Elia distribution", kind: "distribution", household: true, percent: 25, start: "2026-01-01" }));
  workspace.settings.estimatedIncomeTaxPct = 30;
  const adjusted = monthFlow(workspace, context, "2026-10-01", end, { fullMonthProjection: true });
  close(adjusted.profit, original.profit);
  close(adjusted.familyGrossPay, 7500);
  close(adjusted.distribution, Math.max(0, adjusted.profit!) * 0.25);
  close(adjusted.familyTakeHome, adjusted.estimatedNetPay! + adjusted.distribution!);
  close(adjusted.clinicianPay, 7500 + 31 * 2 * 100 * 0.6);
});

test("projected allocations and family distribution use shared cash surplus, not uncollected earned profit", () => {
  const { workspace, context, end } = fixture();
  workspace.settings.collectionDelayMonths = 1;
  workspace.allocations.push(allocationSchema.parse({ id: crypto.randomUUID(), name: "Owner cash distribution", kind: "distribution", household: true, percent: 50, start: "2026-01-01" }));
  const before = structuredClone({ workspace, context });
  const options = { baselineWeeklyByClinician: { 1: 14, 2: 14, 3: 14 }, useImportedBillingActuals: true, workingForecast: true };
  const engine = forecast(workspace, context, [], 1, true, options)[0];
  const flow = monthFlow(workspace, context, "2026-10-01", end, { fullMonthProjection: true });
  assert.ok(flow.profit! > 0);
  close(flow.profit, engine.values.profit);
  close(flow.distribution, 0);
  close(flow.distribution, engine.values.distributions);
  close(flow.retained, engine.values.retainedCash);
  close(flow.familyTakeHome, engine.values.familyTakeHome);
  assert.equal(flow.allocationBasis, "cash-surplus");
  close(flow.allocationSurplus, 0);
  assert.deepEqual({ workspace, context }, before);
});

test("projected allocation rows reconcile explicit tax and reserve budgets and capped household distributions", () => {
  const { workspace, context, end } = fixture();
  for (const kind of ["tax", "reserve"] as const) {
    const category = categorySchema.parse({ id: crypto.randomUUID(), name: `Synthetic ${kind}`, kind });
    workspace.categories.push(category);
    workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: category.name, categoryId: category.id, start: "2026-01-01", amount: kind === "tax" ? 100 : 200, cadence: "monthly" }));
  }
  for (const [kind, percent, household] of [["tax", 20, false], ["reserve", 20, false], ["distribution", 100, true], ["distribution", 100, false], ["retained", 10, false]] as const)
    workspace.allocations.push(allocationSchema.parse({ id: crypto.randomUUID(), name: `${kind} ${household}`, kind, percent, household, start: "2026-10-16" }));
  const options = { baselineWeeklyByClinician: { 1: 14, 2: 14, 3: 14 }, useImportedBillingActuals: true, workingForecast: true };
  const engine = forecast(workspace, context, [], 1, true, options)[0];
  const before = structuredClone({ workspace, context });
  assert.ok(engine.values.distributions! < engine.values.profit! * 2 * 16 / 31, "the engine must actually cap the requested distributions in this control");
  const flow = monthFlow(workspace, context, "2026-10-01", end, { fullMonthProjection: true });
  for (const [kind, metric] of [["tax", "taxReserve"], ["reserve", "reserves"], ["distribution", "distributions"]] as const)
    close(flow.allocations.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.amount, 0), engine.values[metric]);
  close(flow.distribution, engine.values.distributions);
  close(flow.retained, engine.values.retainedCash);
  close(flow.familyTakeHome, engine.values.familyTakeHome);
  close(flow.familyTakeHome! - flow.estimatedNetPay!, flow.distribution! / 2);
  close(flow.allocationSurplus!, engine.values.profit);
  assert.deepEqual({ workspace, context }, before);
});

test("default projected allocations share engine taxes and reserves while month-to-date remains unchanged", () => {
  const { workspace, context, end } = fixture();
  Object.assign(workspace.settings, { taxPct: 20, reservePct: 10, distributionPct: 90 });
  const options = { baselineWeeklyByClinician: { 1: 14, 2: 14, 3: 14 }, useImportedBillingActuals: true, workingForecast: true };
  const engine = forecast(workspace, context, [], 1, true, options)[0];
  const flow = monthFlow(workspace, context, "2026-10-01", end, { fullMonthProjection: true });
  close(flow.distribution, engine.values.distributions);
  close(flow.retained, engine.values.retainedCash);
  close(flow.familyTakeHome, engine.values.familyTakeHome);
  const actual = monthFlow(workspace, context, "2026-10-01", end);
  assert.equal(actual.scheduledPayroll, null);
  assert.equal(actual.allocationBasis, "positive-profit");
  close(actual.distribution, Math.max(0, actual.profit!) * 0.9);
});

test("actual percentage pay uses discounted charge and rejected day evidence withholds it", () => {
  const { workspace, context } = fixture("2026-01-01");
  context.clinicians = [{ ...context.clinicians[2], classification: "other" }];
  context.sessions = context.sessions.filter((row) => row.clinicianId === 3);
  workspace.settings.familyW2ClinicianId = null;
  context.importedBillingActuals = [{ clinicianId: 3, serviceDate: "2026-01-02", clientId: "synthetic", billingCode: "90837", totalFeeCharged: 50, sourceRowHash: "discount", replacementSessionCount: 2 }];
  const flow = monthFlow(workspace, context, "2026-01-01", "2026-01-14");
  close(flow.revenue, 2650);
  close(flow.clinicianPay, 1590);
  context.importedBillingActuals[0].replacementSessionCount = 3;
  const invalid = monthFlow(workspace, context, "2026-01-01", "2026-01-14");
  assert.equal(invalid.revenue, null);
  assert.equal(invalid.clinicianPay, null);
  assert.equal(invalid.profit, null);
});

test("W2 service-day billing is validated before the next paycheck, without withholding fixed salary", () => {
  const { workspace, context } = fixture("2026-01-01");
  context.clinicians = [{ ...context.clinicians[1] }];
  context.sessions = context.sessions.filter((row) => row.clinicianId === 2);
  workspace.clinicians = [];
  context.sessions = context.sessions.map((row) => ({ ...row, start: "2026-01-01", end: "2026-01-01", completed: 1 }));
  context.importedBillingActuals = [{ clinicianId: 2, serviceDate: "2026-01-01", clientId: "synthetic", billingCode: "90837", totalFeeCharged: 50, sourceRowHash: "bad-before-payday", replacementSessionCount: 3 }];
  const invalid = monthFlow(workspace, context, "2026-01-01", "2026-01-01");
  assert.equal(invalid.revenue, null);
  assert.equal(invalid.clinicianPay, null);
  assert.ok(invalid.unavailableReasons.some((reason) => reason.includes("Percentage compensation")));
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 2, start: "2026-01-01", desiredWeeklySessions: 14, payMode: "salary", payAmount: 12000, inPersonPct: 0 }));
  const salary = monthFlow(workspace, context, "2026-01-01", "2026-01-01");
  assert.equal(salary.revenue, null);
  close(salary.clinicianPay, 0);
});

test("legacy actual billing cannot bypass an explicitly supplied replacement-session count", () => {
  const { workspace, context } = fixture("2026-01-01");
  context.clinicians = [{ ...context.clinicians[1] }];
  workspace.clinicians = [];
  context.sessions = context.sessions.filter((row) => row.clinicianId === 2).map((row) => ({ ...row, start: "2026-01-01", end: "2026-01-01", completed: 1 }));
  for (const replacementSessionCount of [2, -1, Number.NaN]) {
    context.importedBillingActuals = [{ clinicianId: 2, serviceDate: "2026-01-01", totalFeeCharged: 50, sourceRowHash: "legacy-count", replacementSessionCount }];
    const invalid = monthFlow(workspace, context, "2026-01-01", "2026-01-01");
    assert.equal(invalid.revenue, null);
    assert.equal(invalid.clinicianPay, null);
  }
});
