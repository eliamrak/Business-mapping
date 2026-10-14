import test from "node:test";
import assert from "node:assert/strict";
import { moneyBridgeSummary } from "./money-bridge.ts";
import { emptyWorkspace, forecast, type Context } from "@workspace/practice/hub";

const values = { revenue: 10000, clinicianPay: 3500, employerBurden: 350, staffCost: 500, overhead: 1000, marketing: 600, fees: 400, ownerPayroll: 1000, profit: 2550 };

test("display bridge includes every operating cost exactly once and reconciles profit", () => {
  const summary = moneyBridgeSummary(values, 10);
  assert.equal(summary.otherCosts, 3950);
  assert.equal(summary.revenue! + summary.adjustments! - summary.clinicianPay! - summary.otherCosts!, summary.profit);
  assert.deepEqual(summary.components.map((item) => item.label), ["Employer burden", "Support staff + burden", "Operating overhead", "Marketing", "Processing fees", "Separate owner payroll", "Owner payroll burden"]);
  assert.equal(moneyBridgeSummary({ ...values, taxReserve: 2000, reserves: 3000, distributions: 4000, ownerClinicalPay: 3500 }, 10).otherCosts, 3950);
});

test("other income is separately disclosed instead of hidden in a cost label", () => {
  const summary = moneyBridgeSummary({ ...values, profit: 2750 }, 10);
  assert.equal(summary.adjustments, 200);
  assert.equal(summary.revenue! + summary.adjustments! - summary.clinicianPay! - summary.otherCosts!, summary.profit);
});

test("missing cost facts remain unknown rather than becoming zero or an inferred cost", () => {
  const summary = moneyBridgeSummary({ ...values, fees: null }, 10);
  assert.equal(summary.otherCosts, null);
  assert.equal(summary.adjustments, null);
});

test("display reconciliation uses the engine's exact forecast month without changing financial inputs", () => {
  const workspace = emptyWorkspace("2026-01-01");
  Object.assign(workspace.settings, { baselineMode: "manual", baselineWeeklySessions: 20, baselineRetentionPct: 100, defaultInPersonPct: 0, horizonMonths: 1, ownerPayrollMonthly: 1000, ownerPayrollOverride: true, ownerPayrollBurdenPct: 10, overheadFloorMonthly: 800, overheadFloorOverride: true });
  const context: Context = { clinicians: [{ id: 1, label: "Synthetic clinician", goalId: null, classification: "w2", sessionRate: 150, sessionsPerWeek: 20, weeksWorkedPerYear: 52, capEnabled: false, capAmount: 0, preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 60, postCapPracticeSplit: 40, w2EmployerFicaPct: 7.65, futaSutaPct: 1, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
  workspace.settings.processingPct = 3;
  workspace.settings.collectionPct = 100;
  const before = structuredClone({ workspace, context });
  const month = forecast(workspace, context)[0];
  const summary = moneyBridgeSummary(month.values, workspace.settings.ownerPayrollBurdenPct);
  assert.ok(summary.components.find((item) => item.label === "Employer burden")!.value! > 0);
  assert.ok(summary.components.find((item) => item.label === "Processing fees")!.value! > 0);
  assert.ok(Math.abs(summary.adjustments!) < 1e-6, "a forecast without other income must not hide missing costs in an adjustment");
  assert.ok(Math.abs(summary.revenue! + summary.adjustments! - summary.clinicianPay! - summary.otherCosts! - month.values.profit!) < 1e-6);
  assert.deepEqual({ workspace, context }, before);
});
