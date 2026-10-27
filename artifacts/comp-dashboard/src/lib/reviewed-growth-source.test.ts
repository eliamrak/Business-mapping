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
