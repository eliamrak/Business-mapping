import test from "node:test";
import assert from "node:assert/strict";
import { financialEstimateBridge, financialEstimateDisplay } from "./financial-estimate-display.ts";
import type { PracticeFinancialRange } from "./practice-financial-range.ts";
import type { PracticeFinancialEstimate } from "./practice-financial-estimate.ts";
import { emptyWorkspace, forecast, type Context } from "@workspace/practice/hub";
import { practiceFinancialRange } from "./practice-financial-range.ts";

const values = { revenue: 100, clinicianPay: 60, profit: 30, employerBurden: 0, staffCost: 0, overhead: 10, marketing: 0, fees: 0, ownerPayroll: 0, ownerPayrollBurden: 0, collections: null };
const history = { range: { start: "2026-01-01", end: "2026-01-14" }, values, components: [], unavailableReasons: [] } as unknown as PracticeFinancialEstimate;
const report = () => ({ actual: { range: history.range, values: { profit: null }, complete: false }, forward: { range: { start: "2026-01-15", end: "2026-01-31" }, values: { ...values, collections: 100 } }, values, ownerPayrollBurdenPct: 0, forecastWarnings: [] }) as unknown as PracticeFinancialRange;
const ownerContext: Context = {
  clinicians: [{ id: 1, label: "Synthetic", goalId: null, classification: "other", sessionRate: 100,
    sessionsPerWeek: 20, weeksWorkedPerYear: 52.1786, capEnabled: false, capAmount: 0,
    preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 60, postCapPracticeSplit: 40,
    w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }],
  staff: [], sessions: [],
};

test("estimate composition sums disjoint segments without changing recorded actuals or certifying cash", () => {
  const source = report();
  const before = JSON.stringify(source);
  const result = financialEstimateDisplay(source, history);
  assert.equal(result.values.revenue, 200);
  assert.equal(result.values.profit, 60);
  assert.equal(result.values.collections, null);
  assert.equal(JSON.stringify(source), before);
  assert.equal(source.actual.complete, false);
  assert.equal(source.actual.values.profit, null);
  assert.equal(financialEstimateBridge(source, result).otherCosts, 20);
});

test("missing or mismatched historical segment never falls back to forecast or zero", () => {
  assert.equal(financialEstimateDisplay(report(), null).values.profit, null);
  assert.equal(financialEstimateDisplay(report(), { ...history, range: { start: "2026-01-02", end: "2026-01-14" } }).values.profit, null);
});

test("overlap and unsupported boundaries withhold estimated totals", () => {
  const source = report();
  source.forward.range!.start = "2026-01-14";
  assert.equal(financialEstimateDisplay(source, history).values.profit, null);
  source.forward.range = null;
  source.actual.range = null;
  assert.equal(financialEstimateDisplay(source, null).values.profit, null);
});

test("history-only and future-only estimates preserve their own bases", () => {
  const source = report();
  source.forward.range = null;
  assert.equal(financialEstimateDisplay(source, history).values.profit, 30);
  source.actual.range = null;
  source.forward = report().forward;
  assert.equal(financialEstimateDisplay(source, null).values.profit, 30);
});

test("partial marketing subtotal remains separate from profit, actuals and overlapping date segments", () => {
  const source = report();
  const partial = { ...history, values: { ...history.values, profit: null, marketing: null, surplusBeforeUnconfiguredMarketing: 20 } };
  const result = financialEstimateDisplay(source, partial);
  assert.equal(result.values.profit, null);
  assert.equal(result.surplusBeforeUnconfiguredMarketing, 50);
  assert.equal(source.actual.complete, false);
  source.forward.range!.start = "2026-01-14";
  assert.equal(financialEstimateDisplay(source, partial).surplusBeforeUnconfiguredMarketing, null);
  source.forward.range = null;
  const zero = { ...partial, values: { ...partial.values, surplusBeforeUnconfiguredMarketing: 0 } };
  assert.equal(financialEstimateDisplay(source, zero).surplusBeforeUnconfiguredMarketing, 0);
});

test("mixed historical and forecast owner distributions preserve known zero and unknown segments", () => {
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { baselineMode: "manual", baselineWeeklySessions: 7, baselineRetentionPct: 100, defaultInPersonPct: 0, horizonMonths: 1, distributionPct: 0 });
  const forwardRange = { start: "2026-10-08", end: "2026-10-31" };
  const future = forecast(workspace, ownerContext, [], 1, false, { workingForecast: true, workingRange: forwardRange, useImportedBillingActuals: false, baselineWeeklyByClinician: { 1: 7 } })[0];
  assert.ok(future.values.profit! > 0);
  assert.equal(future.values.distributions, 0);
  assert.equal(future.values.ownerDistributionsPretax, 0);
  const source = report();
  source.actual.range = { start: "2026-10-01", end: "2026-10-07" };
  source.forward.range = forwardRange;
  source.forward.values = future.values;
  const known = { ...history, range: source.actual.range, values: { ...history.values, distributions: 0, ownerDistributionsPretax: 0 } };
  assert.equal(financialEstimateDisplay(source, known).values.ownerDistributionsPretax, 0);
  const positiveKnown = { ...known, values: { ...known.values, distributions: 50, ownerDistributionsPretax: 50 } };
  assert.equal(financialEstimateDisplay(source, positiveKnown).values.ownerDistributionsPretax, 50);
  const unknown = { ...known, values: { ...known.values, ownerDistributionsPretax: null } };
  assert.equal(financialEstimateDisplay(source, unknown).values.ownerDistributionsPretax, null);
  assert.equal(financialEstimateDisplay(source, null).values.ownerDistributionsPretax, null);
  source.forward.values = { ...future.values, distributions: 100, ownerDistributionsPretax: null };
  assert.equal(financialEstimateDisplay(source, known).values.ownerDistributionsPretax, null);
  source.forward.values = { ...future.values, distributions: null, ownerDistributionsPretax: null };
  assert.equal(financialEstimateDisplay(source, known).values.ownerDistributionsPretax, null);
});

test("absent report coverage cannot become a known zero owner estimate", () => {
  const workspace = emptyWorkspace("2026-10-01");
  workspace.settings.distributionPct = 0;
  const source = practiceFinancialRange(workspace, ownerContext, [], "2026-10-18", { start: "2026-10-01", end: "2026-10-31" });
  assert.equal(source.dataThrough, null);
  assert.equal(source.values.distributions, null);
  assert.equal(source.values.ownerDistributionsPretax, null);
  assert.equal(financialEstimateDisplay(source, null).values.ownerDistributionsPretax, null);
});
