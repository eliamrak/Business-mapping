import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, type Context } from "@workspace/practice/hub";
import { reviewedGrowthFromSources } from "./reviewed-growth-source.ts";
import { DEFAULT_GROWTH_SETTINGS } from "./reviewed-growth-observations.ts";
import type { LocalSnapshot } from "./retention-local.ts";
const person = {
  id: 1,
  goalId: null,
  label: "Synthetic",
  roleType: "associate",
  classification: "1099" as const,
  sessionRate: 100,
  sessionsPerWeek: 20,
  weeksWorkedPerYear: 48,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  capEnabled: false,
  capAmount: 0,
  postCapClinicianSplit: 60,
  postCapPracticeSplit: 40,
  w2EmployerFicaPct: 0,
  futaSutaPct: 0,
  workersCompPct: 0,
  otherEmployerBurdenPct: 0,
  nonClinicalHoursPerWeek: 0,
  nonClinicalHourlyRate: 0,
};
const row = (date: string, status: "show" | "cancelled" = "show") => ({
  clientId: "synthetic",
  clinician: "Synthetic",
  serviceDate: date,
  status,
  location: null,
  sourceRowHash: date + status,
  billingCode: "90837",
});
function base() {
  const workspace = emptyWorkspace("2026-10-27");
  const context: Context = { clinicians: [person], staff: [], sessions: [] };
  const snapshot: LocalSnapshot = {
    id: "source",
    kind: "attendance",
    importedAt: "2026-10-22",
    coverageStart: "2025-01-01",
    coverageEnd: "2026-10-21",
    sourceHash: "synthetic",
    reportCoverage: { start: "2025-01-01", end: "2026-10-21", complete: true },
    rows: [row("2026-01-05"), row("2026-05-01"), row("2026-09-15")],
  };
  return {
    workspace,
    context,
    snapshots: [snapshot],
    overrides: {},
    today: "2026-10-27",
    settings: { ...DEFAULT_GROWTH_SETTINGS },
    scenario: false,
  };
}
test("canonical conflict before latest90days cannot silently redefine current qualification", () => {
  const input = base(),
    baseline = reviewedGrowthFromSources(input);
  assert.equal(baseline.stock?.established, 1);
  input.snapshots.push({
    ...input.snapshots[0]!,
    id: "conflicting",
    sourceHash: "different",
    rows: [
      row("2026-01-05", "cancelled"),
      row("2026-05-01"),
      row("2026-09-15"),
    ],
  } as LocalSnapshot);
  const result = reviewedGrowthFromSources(input);
  assert.equal(result.stock, null);
  assert.match(result.reason!, /Unresolved treatment/);
});
test("source revision changes with records, capacity and assumptions; original sources are preserved", () => {
  const input = base(),
    original = JSON.stringify(input),
    a = reviewedGrowthFromSources(input);
  const b = reviewedGrowthFromSources({
    ...input,
    context: {
      ...input.context,
      clinicians: [{ ...person, sessionsPerWeek: 25 }],
    },
  });
  assert.notEqual(a.inputRevision, b.inputRevision);
  const c = reviewedGrowthFromSources({
    ...input,
    settings: { ...input.settings, occupancy: 0.7 },
  });
  assert.notEqual(a.inputRevision, c.inputRevision);
  assert.equal(JSON.stringify(input), original);
});

test("July source-boundary shows remain unadmitted without suppressing unaffected stock or recent history", () => {
  const input = base();
  const snapshot = input.snapshots[0]!;
  snapshot.coverageStart = "2025-07-01";
  snapshot.reportCoverage = { start: "2025-07-01", end: "2026-10-21", complete: true };
  snapshot.rows = Array.from({ length: 7 }, (_, i) =>
    ["2025-07-01", "2025-07-10", i === 6 ? "2025-10-01" : "2025-07-20",
      i === 6 ? "2025-11-05" : "2025-08-01", "2026-09-15"].map(date => ({
        ...row(date), clientId: `synthetic-boundary-${i}`, sourceRowHash: `${i}-${date}`,
      }))).flat();
  const original = JSON.stringify(input);
  const result = reviewedGrowthFromSources(input);
  assert.equal(result.reason, null);
  assert.deepEqual(result.stock, { established: 7, early: 0 });
  assert.equal(result.families[0]!.evidenceValid, true);
  assert.equal(result.families[1]!.evidenceValid, false);
  assert.match(result.families[1]!.reason!, /historical treatment evidence/);
  // Third dates stay admitted November/earlier dates, not counterfactual October.
  const withoutBoundary = structuredClone(input);
  withoutBoundary.snapshots[0]!.rows = withoutBoundary.snapshots[0]!.rows.filter(r => r.serviceDate !== "2025-07-01");
  const clean = reviewedGrowthFromSources(withoutBoundary);
  assert.equal(result.families[1]!.establishedDays, clean.families[1]!.establishedDays);
  assert.equal(result.families[1]!.attendedSessions, clean.families[1]!.attendedSessions);
  assert.equal(clean.families[1]!.evidenceValid, true);
  assert.equal(JSON.stringify(input), original);
});
