import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPercentageKpi, normalizePercentage } from "./percentage-kpi.ts";

test("unknown percentages stay unknown while a measured zero stays zero", () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(normalizePercentage(value), null);
    const model = buildPercentageKpi({ value });
    assert.equal(model.valueText, "-");
    assert.equal(model.valueAngle, null);
  }
  assert.equal(buildPercentageKpi({ value: 0 }).valueText, "0%");
});

test("finite percentages clamp to the bounded scale without adding a target", () => {
  assert.equal(normalizePercentage(-10), 0);
  assert.equal(normalizePercentage(125), 100);
  const model = buildPercentageKpi({ value: 72.5 });
  assert.equal(model.valueText, "72.5%");
  assert.equal(model.goal, null);
  assert.equal(model.capacity, null);
  assert.equal(model.benchmark, null);
});

test("practice marker shares the clockwise scale from twelve o'clock", () => {
  for (const [benchmark, angle] of [[0, 0], [25, 90], [50, 180], [75, 270], [100, 360]]) {
    const model = buildPercentageKpi({ value: 20, benchmark });
    assert.equal(model.benchmarkAngle, angle);
    assert.equal(model.benchmarkText, `${benchmark}%`);
    assert.equal(model.valueAngle, 72);
  }
});

test("practice comparisons with different reporting windows are withheld", () => {
  const period = { start: "2026-10-01", end: "2026-10-28" };
  const model = buildPercentageKpi({ value: 60, benchmark: 55, period,
    benchmarkPeriod: { start: "2026-09-01", end: "2026-09-28" } });
  assert.equal(model.benchmark, null);
  assert.equal(model.benchmarkAngle, null);
  assert.equal(model.benchmarkPeriodMatches, false);
  assert.equal(buildPercentageKpi({ value: 60, benchmark: 55, period, benchmarkPeriod: { ...period } }).benchmark, 55);
  assert.equal(buildPercentageKpi({ value: 60, benchmark: 55, benchmarkPeriod: period }).benchmark, null);
});

test("an unknown individual rate can still show a known practice marker and genuine goal", () => {
  const model = buildPercentageKpi({ value: null, benchmark: 52, goal: 65, capacity: 100 });
  assert.equal(model.value, null);
  assert.ok(Math.abs(model.benchmarkAngle! - 187.2) < 1e-10);
  assert.equal(model.goalAngle, 234);
  assert.equal(model.capacityAngle, 360);
  assert.equal(model.goalText, "65%");
});
