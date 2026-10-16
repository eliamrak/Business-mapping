import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, periodSchema, type Context } from "@workspace/practice/hub";
import { practiceFinancialRange, financialRangeBridge } from "./practice-financial-range.ts";
import type { LocalSnapshot } from "./retention-local.ts";

const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function fixture() {
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { defaultInPersonPct: 0, baselineRetentionPct: 100, organicClientsPerMonth: 0, processingPct: 0, processingFixedPerTransaction: 0, ownerPayrollMonthly: 0, overheadFloorMonthly: 0 });
  const context: Context = { clinicians: [{ id: 1, label: "Synthetic", goalId: null, classification: "owner", sessionRate: 100, sessionsPerWeek: 7, weeksWorkedPerYear: 52, capEnabled: false, capAmount: 0, preCapClinicianSplit: 0, preCapPracticeSplit: 100, postCapClinicianSplit: 0, postCapPracticeSplit: 100, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [{ id: 1, clinicianId: 1, start: "2026-09-24", end: "2026-10-07", completed: 14, desired: 14 }, { id: 2, clinicianId: 1, start: "2026-10-08", end: "2026-10-14", completed: 700, desired: 14 }] };
  const snapshots: LocalSnapshot[] = [{ id: "billing", kind: "billing", sourceHash: "synthetic", importedAt: "2026-10-14T00:00:00Z", coverageStart: "2026-01-05", coverageEnd: "2026-02-06", rows: [{ clientId: "January client", clinician: "Synthetic", serviceDate: "2026-01-05", totalFeeCharged: 100, billingCode: "90837", sourceRowHash: "january" }, { clientId: "February client", clinician: "Synthetic", serviceDate: "2026-02-06", totalFeeCharged: 300, billingCode: "90837", sourceRowHash: "february" }] }];
  snapshots[0].reportCoverage = { start: "2026-01-01", end: "2026-10-14", complete: true };
  return { workspace, context, snapshots };
}

test("cross-team name ambiguity withholds billed actuals and billing boundary before financial scope", () => {
  const { workspace, context, snapshots } = fixture();
  context.sessions = [];
  context.clinicians.push({ ...context.clinicians[0], id: 99, goalId: 999, label: " synthetic " });
  const result = practiceFinancialRange(workspace, context, snapshots, "2026-10-22", { start: "2026-01-01", end: "2026-10-21" });
  assert.equal(result.reports.billingThrough, null);
  assert.equal(result.dataThrough, null);
  assert.equal(result.actual.reportedCharges, null);
  assert.equal(result.values.revenue, null);
  context.clinicians[1].label = "Unrelated";
  const unique = practiceFinancialRange(workspace, context, snapshots, "2026-10-22", { start: "2026-01-01", end: "2026-10-07" });
  assert.equal(unique.reports.billingThrough, "2026-10-07");
  assert.equal(unique.actual.reportedCharges, 400);
  assert.equal(unique.actual.values.revenue, 400);
});

test("shared January versus February dates select different actual fees and never reuse the October forecast", () => {
  const { workspace, context, snapshots } = fixture();
  const before = structuredClone({ workspace, context, snapshots });
  const january = practiceFinancialRange(workspace, context, snapshots, "2026-10-14", { start: "2026-01-01", end: "2026-01-31" });
  const february = practiceFinancialRange(workspace, context, snapshots, "2026-10-14", { start: "2026-02-01", end: "2026-02-28" });
  assert.equal(january.actual.reportedCharges, 100);
  assert.equal(february.actual.reportedCharges, 300);
  assert.equal(january.forward.range, null);
  assert.equal(february.forward.range, null);
  assert.equal(january.values.profit, null);
  assert.equal(february.values.revenue, 300, "complete billed source establishes historical income independently of missing costs");
  assert.deepEqual({ workspace, context, snapshots }, before);
});

test("current year composes finalized actual YTD and dated forward remainder once, never a next-twelve-month replacement", () => {
  const { workspace, context, snapshots } = fixture();
  workspace.periods.push(periodSchema.parse({ id: crypto.randomUUID(), name: "Actual YTD", start: "2026-01-01", end: "2026-10-07", status: "finalized", earnedRevenue: 1000, revenue: 1000, clinicianPay: 0, employerBurden: 0, staffPay: 0, ownerPay: 0, expensesComplete: true }));
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-14", { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(report.actual.complete, true);
  assert.deepEqual(report.actual.range, { start: "2026-01-01", end: "2026-10-07" });
  assert.deepEqual(report.forward.range, { start: "2026-10-08", end: "2026-12-31" });
  near(report.actual.values.revenue, 400);
  near(report.forward.values.revenue, 8500);
  near(report.values.revenue, 8900);
  near(report.values.profit, 8900);
  near(financialRangeBridge(report).otherCosts, 0);
  near(financialRangeBridge(report).adjustments, 0);
  assert.equal(report.actual.values.fees, null, "an aggregate actual ledger does not invent a separate zero processing fee");
  assert.equal(report.forward.months.at(-1)?.date.slice(0, 7), "2026-12");
});

test("an unassignable billing date keeps selected charges unknown rather than summing only valid buckets", () => {
  const { workspace, context, snapshots } = fixture();
  if (snapshots[0].kind !== "billing") throw new Error("fixture");
  snapshots[0].rows.push({ ...snapshots[0].rows[0], clientId: "Bad date", serviceDate: "invalid", totalFeeCharged: 50, sourceRowHash: "invalid-date" });
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-14", { start: "2026-01-01", end: "2026-01-31" });
  assert.equal(report.actual.report.months.length, 0, "a contradictory complete-report declaration is not admitted");
  assert.equal(report.actual.reportedCharges, null);
  assert.ok(report.reports.incompletePeriods.some((period) => /invalid|outside/i.test(period.reason)));
});

test("gaps and overlaps in historical financial coverage cannot become complete annual totals", () => {
  const { workspace, context, snapshots } = fixture();
  workspace.periods.push(periodSchema.parse({ id: crypto.randomUUID(), name: "January", start: "2026-01-01", end: "2026-01-31", status: "finalized", earnedRevenue: 1000, revenue: 1000, clinicianPay: 0, employerBurden: 0, staffPay: 0, ownerPay: 0, expensesComplete: true }));
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-14", { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(report.actual.complete, false);
  assert.equal(report.actual.values.revenue, 400);
  assert.equal(report.values.profit, null);
  near(report.forward.values.revenue, 8500);
  assert.equal(report.actual.reportedCharges, 400);
  assert.ok(report.warnings.some((warning) => warning.includes("incomplete")));
});

test("forecast starts after the latest complete covered period, not the upload or current date", () => {
  const { workspace, context, snapshots } = fixture();
  const before = structuredClone({ workspace, context, snapshots });
  snapshots[0].importedAt = "2026-10-20T23:00:00Z";
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-20", { start: "2026-10-08", end: "2026-10-14" });
  assert.equal(report.dataThrough, "2026-10-07");
  assert.equal(report.forecastStart, "2026-10-08");
  assert.equal(report.actual.range, null);
  near(report.values.sessions, 7);
  near(report.values.revenue, 700);
  assert.deepEqual(context, before.context, "partial high counts are retained without influencing the forecast");
});

test("partial rows remain excluded until a full report extends actual coverage, with no deletion or double counting", () => {
  const { workspace, context, snapshots } = fixture();
  if (snapshots[0].kind !== "billing") throw new Error("fixture");
  snapshots[0].rows.push({ clientId: "Partial only", clinician: "Synthetic", serviceDate: "2026-10-10", totalFeeCharged: 99999, billingCode: "90837", sourceRowHash: "partial-high-fee" });
  const partial = structuredClone(snapshots[0]);
  const before = practiceFinancialRange(workspace, context, snapshots, "2026-10-14", { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(before.dataThrough, "2026-10-07");
  assert.equal(before.actual.reportedCharges, 400);
  near(before.forward.values.revenue, 8500);
  context.sessions.push({ id: 3, clinicianId: 1, start: "2026-10-08", end: "2026-10-21", completed: 14, desired: 14 });
  snapshots.push({ ...structuredClone(snapshots[0]), id: "full-later", sourceHash: "full-later", importedAt: "2026-10-22T23:00:00Z", reportCoverage: { start: "2026-01-01", end: "2026-10-21", complete: true }, rows: [...snapshots[0].rows.slice(0, 2), { clientId: "Complete later", clinician: "Synthetic", serviceDate: "2026-10-20", totalFeeCharged: 50, billingCode: "90837", sourceRowHash: "complete-later-fee" }] });
  const after = practiceFinancialRange(workspace, context, snapshots, "2026-10-22", { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(after.dataThrough, "2026-10-21");
  assert.equal(after.forecastStart, "2026-10-22");
  assert.equal(after.actual.reportedCharges, 450);
  near(after.forward.values.revenue, 7100);
  assert.deepEqual(snapshots[0], partial, "the old partial snapshot remains unchanged for reconciliation");
  assert.equal(context.sessions[1].completed, 700, "the excluded partial session record is retained");
});

test("Overall begins at explicit complete coverage, not the first occupied or excluded service date", () => {
  const { workspace, context, snapshots } = fixture();
  snapshots.push({ id: "unverified-earlier", kind: "billing", importedAt: "2026-10-14T00:00:00Z", sourceHash: "unverified-earlier", rows: [{ clientId: "Earlier partial", clinician: "Synthetic", serviceDate: "2025-02-01", totalFeeCharged: 999, billingCode: "90837", sourceRowHash: "earlier-partial" }] });
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-14", { start: "0000-01-01", end: "9999-12-31" });
  assert.deepEqual(report.range, { start: "2026-01-01", end: "2026-10-14" });
  assert.equal(report.actual.reportedCharges, 400);
});

test("a later complete billing report keeps billed actuals visible without inventing activity or overlapping forecast", () => {
  const { workspace, context, snapshots } = fixture();
  if (snapshots[0].kind !== "billing") throw new Error("fixture");
  snapshots[0].reportCoverage = { start: "2026-01-01", end: "2026-10-21", complete: true };
  snapshots[0].rows.push({ clientId: "Later billed", clinician: "Synthetic", serviceDate: "2026-10-10", totalFeeCharged: 500, billingCode: "90837", sourceRowHash: "later-complete-bill" });
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-22", { start: "2026-10-08", end: "2026-10-21" });
  assert.equal(report.dataThrough, "2026-10-21");
  assert.equal(report.forecastStart, "2026-10-22");
  assert.equal(report.actual.reportedCharges, 500);
  assert.equal(report.actual.values.revenue, 500);
  assert.equal(report.actual.values.sessions, null);
  assert.equal(report.actual.values.profit, null);
  assert.equal(report.forward.range, null);
  assert.ok(report.sourceHistoryWarnings.some((warning) => warning.includes("Source dates differ")));
  const future = practiceFinancialRange(workspace, context, snapshots, "2026-10-22", { start: "2026-10-22", end: "2026-10-28" });
  near(future.values.revenue, 700);
});

test("later complete activity does not certify missing billing fees or forecast-fill an actual evidence gap", () => {
  const { workspace, context, snapshots } = fixture();
  context.sessions.push({ id: 3, clinicianId: 1, start: "2026-10-08", end: "2026-10-21", completed: 14, desired: 14 });
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-22", { start: "2026-10-08", end: "2026-10-21" });
  assert.equal(report.dataThrough, "2026-10-21");
  assert.equal(report.actual.values.sessions, 14);
  assert.equal(report.actual.values.revenue, null);
  assert.equal(report.forward.range, null);
});

test("historical selections separate unrelated source gaps and current forecast bases from selected limitations", () => {
  const { workspace, context, snapshots } = fixture();
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-16", { start: "2026-01-01", end: "2026-01-31" });
  assert.equal(report.actual.reportedCharges, 100);
  assert.equal(report.actual.billingComplete, true);
  assert.equal(report.forward.range, null);
  assert.ok(!report.warnings.some(w => /has not ended|three-month average/.test(w)));
  assert.ok(report.sourceHistoryWarnings.some(w => /2026-10-08.*has not ended/.test(w)));
  assert.ok(report.forecastWarnings.some(w => w.includes("three-month average")));
  assert.ok(report.warnings.some(w => w.includes("financial-cost coverage is incomplete")), "missing selected actual costs stay disclosed");
  const { values, actual, forward } = report;
  assert.equal(values.revenue, 100); assert.equal(actual.values.profit, null); assert.deepEqual(forward.values, {});
});

test("a proof gap overlapping the selected dates stays in selected limitations", () => {
  const { workspace, context, snapshots } = fixture();
  snapshots[0].reportCoverage = { start: "2026-01-05", end: "2026-10-14", complete: true };
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-16", { start: "2026-01-01", end: "2026-01-31" });
  assert.equal(report.actual.billingComplete, false); assert.equal(report.values.revenue, null);
  assert.ok(report.warnings.some(w => /2026-01-01 to 2026-01-14.*No individual provider report proof/.test(w)));
});
