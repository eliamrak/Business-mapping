import test from "node:test";
import assert from "node:assert/strict";
import { financialEstimateBridge, financialEstimateDisplay } from "./financial-estimate-display.ts";
import type { PracticeFinancialRange } from "./practice-financial-range.ts";
import type { PracticeFinancialEstimate } from "./practice-financial-estimate.ts";

const values = { revenue: 100, clinicianPay: 60, profit: 30, employerBurden: 0, staffCost: 0, overhead: 10, marketing: 0, fees: 0, ownerPayroll: 0, ownerPayrollBurden: 0, collections: null };
const history = { range: { start: "2026-01-01", end: "2026-01-14" }, values, components: [], unavailableReasons: [] } as unknown as PracticeFinancialEstimate;
const report = () => ({ actual: { range: history.range, values: { profit: null }, complete: false }, forward: { range: { start: "2026-01-15", end: "2026-01-31" }, values: { ...values, collections: 100 } }, values, ownerPayrollBurdenPct: 0, forecastWarnings: [] }) as unknown as PracticeFinancialRange;

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
