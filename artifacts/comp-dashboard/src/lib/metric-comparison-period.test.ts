import { test } from "node:test";
import assert from "node:assert/strict";
import { metricComparison } from "./metric-comparison.ts";

test("available-history comparisons never mark a different practice period as the benchmark", () => {
  const full = { start: "2025-10-01", end: "2026-09-30" };
  const available = { start: "2026-04-01", end: "2026-09-30" };
  const rows = metricComparison([
    { id: "short", label: "Available six months", value: 60, period: available },
    { id: "full", label: "Full year", value: 65, period: full },
    { id: "practice", label: "Whole Practice", value: 70, period: full, practice: true },
  ], true);
  assert.equal(rows.find(row => row.id === "short")?.benchmarkPosition, null);
  assert.equal(rows.find(row => row.id === "full")?.benchmarkPosition, 70);
  assert.equal(rows.find(row => row.id === "short")?.value, 60);
});

test("unknown comparison periods cannot certify matching dates", () => {
  const rows = metricComparison([{ id: "person", label: "Clinician", value: 0 },
    { id: "practice", label: "Whole Practice", value: 50, practice: true, period: { start: "2026-07-01", end: "2026-09-30" } }], true);
  assert.equal(rows[0].benchmarkPosition, null);
});
