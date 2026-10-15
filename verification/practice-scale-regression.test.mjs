import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { practiceScaleFixture } from "./practice-scale-fixture.ts";
import { loadScaleModel } from "./practice-scale-model.mjs";
const baseline = await loadScaleModel(true), candidate = await loadScaleModel();

function measure(model, input) {
  const before = performance.now();
  const roster = input.context.clinicians.filter((row) => row.goalId === 1);
  const coverage = model.completeReportCoverage(input.snapshots, roster, input.asOf, input.context.clinicians, { declarations: input.declarations, teamId: 1 });
  const coverageMs = performance.now() - before;
  const overlayStart = performance.now();
  const overlay = model.buildImportedSessionOverlay(input.context, coverage.eligibleSnapshots, 1, {}, { declarations: input.declarations });
  return { coverage, overlay, timings: { coverageMs: Math.round(coverageMs), overlayMs: Math.round(performance.now() - overlayStart) } };
}
for (const conflicts of [false, true]) test(`full-scale output matches frozen deployed calculations, conflicts=${conflicts}`, () => {
  const input = practiceScaleFixture();
  if (conflicts) {
    const billing = input.snapshots.find((row) => row.kind === "billing");
    const row = billing.rows.find((row) => row.billingCode === "90837");
    billing.rows[billing.rows.length - 1] = { ...row, totalFeeCharged: row.totalFeeCharged + 25 };
    const attendance = input.snapshots.find((row) => row.kind === "attendance");
    const other = input.snapshots.find((row) => row.kind === "attendance" && row !== attendance);
    other.rows[other.rows.length - 1] = { ...attendance.rows.find((row) => row.serviceDate === "2026-01-02"), status: "cancelled" };
  }
  const original = structuredClone(input);
  const old = measure(baseline, input), next = measure(candidate, input);
  assert.deepEqual(next.coverage, old.coverage);
  assert.deepEqual(next.overlay, old.overlay);
  assert.deepEqual(input, original);
  assert.equal(input.snapshots.reduce((n, row) => n + row.rows.length, 0), 7593);
  if (conflicts) {
    assert.ok(next.coverage.attendanceStatusConflictCount > 0);
    assert.ok(next.overlay.diagnostic.billingConflictCount > 0);
  } else {
    assert.equal(next.coverage.dataThrough, "2026-10-07");
    assert.equal(next.overlay.conflictedManualSessions.length, 0);
    assert.equal(next.overlay.diagnostic.manualImportConflictCount, 0);
    assert.equal(next.overlay.diagnostic.manualOverlapCount, 107);
    const raw = candidate.buildImportedSessionOverlay(input.context, input.snapshots, 1, {}, { declarations: input.declarations });
    assert.ok(raw.diagnostic.manualImportConflictCount > 0, "Raw unproved diagnostic differs from admitted complete-source-set reconciliation");
    const range = { start: "2026-09-16", end: "2026-10-15" };
    const financial = candidate.practiceFinancialRange(input.workspace, next.overlay.context, input.snapshots, input.asOf, range, next.coverage.completeAttendanceCoverage, input.declarations);
    const originalFinancial = baseline.practiceFinancialRange(input.workspace, old.overlay.context, input.snapshots, input.asOf, range, old.coverage.completeAttendanceCoverage, input.declarations);
    assert.deepEqual(financial, originalFinancial);
    assert.equal(financial.actual.range.end, "2026-10-07");
    assert.equal(financial.forward.range.start, "2026-10-08");
    assert.equal(financial.values.revenue, financial.actual.values.revenue + financial.forward.values.revenue);
    assert.equal(financial.actual.values.clinicianPay, null);
    assert.equal(financial.actual.values.profit, null);
    assert.equal(financial.values.collections, null);
    assert.deepEqual(input, original);
  }
  console.log(JSON.stringify({ syntheticOnly: true, conflicts, baseline: old.timings, candidate: next.timings }));
});

test("coverage clones admitted rows only, never amplifies full-source rows per period/provider", () => {
  const input = practiceScaleFixture();
  const clone = globalThis.structuredClone;
  let sourceRowsCloned = 0, derivedRowsCloned = 0;
  globalThis.structuredClone = (value, options) => {
    if (value && typeof value === "object" && Array.isArray(value.rows)) sourceRowsCloned += value.rows.length;
    if (Array.isArray(value)) derivedRowsCloned += value.length;
    return clone(value, options);
  };
  try {
    const result = measure(candidate, input);
    assert.equal(sourceRowsCloned, 0);
    assert.ok(derivedRowsCloned <= 7593);
    assert.ok(result.coverage.eligibleSnapshots.length > 700);
  } finally { globalThis.structuredClone = clone; }
});
