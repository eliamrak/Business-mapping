import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, periodSchema, type Context } from "@workspace/practice/hub";
import { practiceFinancialRange, financialRangeBridge } from "./practice-financial-range.ts";
import type { LocalSnapshot } from "./retention-local.ts";

const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
function fixture() {
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { defaultInPersonPct: 0, baselineRetentionPct: 100, organicClientsPerMonth: 0, processingPct: 0, processingFixedPerTransaction: 0, ownerPayrollMonthly: 0, overheadFloorMonthly: 0 });
  const context: Context = { clinicians: [{ id: 1, label: "Synthetic", goalId: null, classification: "owner", sessionRate: 100, sessionsPerWeek: 7, weeksWorkedPerYear: 52, capEnabled: false, capAmount: 0, preCapClinicianSplit: 0, preCapPracticeSplit: 100, postCapClinicianSplit: 0, postCapPracticeSplit: 100, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [{ id: 1, clinicianId: 1, start: "2026-10-01", end: "2026-10-14", completed: 14, desired: 14 }] };
  const snapshots: LocalSnapshot[] = [{ id: "billing", kind: "billing", sourceHash: "synthetic", importedAt: "2026-10-14T00:00:00Z", coverageStart: "2026-01-05", coverageEnd: "2026-02-06", rows: [{ clientId: "January client", clinician: "Synthetic", serviceDate: "2026-01-05", totalFeeCharged: 100, billingCode: "90837", sourceRowHash: "january" }, { clientId: "February client", clinician: "Synthetic", serviceDate: "2026-02-06", totalFeeCharged: 300, billingCode: "90837", sourceRowHash: "february" }] }];
  return { workspace, context, snapshots };
}

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
  assert.equal(february.values.revenue, null, "billing facts do not certify full earned financial coverage");
  assert.deepEqual({ workspace, context, snapshots }, before);
});

test("current year composes finalized actual YTD and dated forward remainder once, never a next-twelve-month replacement", () => {
  const { workspace, context, snapshots } = fixture();
  workspace.periods.push(periodSchema.parse({ id: crypto.randomUUID(), name: "Actual YTD", start: "2026-01-01", end: "2026-10-14", status: "finalized", earnedRevenue: 1000, revenue: 1000, clinicianPay: 0, employerBurden: 0, staffPay: 0, ownerPay: 0, expensesComplete: true }));
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-14", { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(report.actual.complete, true);
  assert.deepEqual(report.actual.range, { start: "2026-01-01", end: "2026-10-14" });
  assert.deepEqual(report.forward.range, { start: "2026-10-15", end: "2026-12-31" });
  near(report.actual.values.revenue, 1000);
  near(report.forward.values.revenue, 7800);
  near(report.values.revenue, 8800);
  near(report.values.profit, 8800);
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
  assert.equal(report.actual.report.months[0].charges, 100);
  assert.equal(report.actual.reportedCharges, null);
  assert.ok(report.warnings.some((warning) => warning.includes("Invalid service dates")));
});

test("gaps and overlaps in historical financial coverage cannot become complete annual totals", () => {
  const { workspace, context, snapshots } = fixture();
  workspace.periods.push(periodSchema.parse({ id: crypto.randomUUID(), name: "January", start: "2026-01-01", end: "2026-01-31", status: "finalized", earnedRevenue: 1000, revenue: 1000, clinicianPay: 0, employerBurden: 0, staffPay: 0, ownerPay: 0, expensesComplete: true }));
  const report = practiceFinancialRange(workspace, context, snapshots, "2026-10-14", { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(report.actual.complete, false);
  assert.equal(report.actual.values.revenue, null);
  assert.equal(report.values.profit, null);
  near(report.forward.values.revenue, 7800);
  assert.equal(report.actual.reportedCharges, 400);
  assert.ok(report.warnings.some((warning) => warning.includes("not filled")));
});
