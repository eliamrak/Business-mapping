import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalRetentionMetrics, estimateLocalClientActivity, type LocalSnapshot } from "./retention-local.ts";

function fixture(): LocalSnapshot {
  return { id: "attendance-synthetic", kind: "attendance", sourceHash: "synthetic", importedAt: "2026-07-01T00:00:00Z",
    coverageStart: "2025-12-02", coverageEnd: "2026-01-10", reportCoverage: { start: "2025-12-01", end: "2026-06-30", complete: true },
    rows: [1, 2, 3].flatMap((client) => ["2025-12-02", "2025-12-09", "2025-12-16", "2026-01-10"].map((serviceDate) => ({
      clientId: `synthetic-${client}`, clinician: "Synthetic clinician", serviceDate, status: "show", location: null, sourceRowHash: `${client}:${serviceDate}`,
    }))),
  };
}

test("Team attrition denominator counts mature calendar months, not established client-months", () => {
  const snapshot = fixture(); const before = structuredClone(snapshot);
  for (const [end, months, average] of [["2026-01-31", 1, 3], ["2026-02-28", 2, 1.5]] as const) {
    const metrics = buildLocalRetentionMetrics([snapshot], {}, {}, 28, "2026-07-01", 90, "2026-01-01", end);
    const clinician = metrics.clientActivityByClinician[0];
    assert.equal(clinician.endingFullMonthClientEnds, 3);
    assert.equal(clinician.endingFullMonthDenominator, months);
    assert.equal(clinician.averageClientEndingsPerFullMonth, average);
    const practice = estimateLocalClientActivity([snapshot], {}, 56, 56, 28, "2026-07-01", 90, "2026-01-01", end)!;
    assert.equal(practice.monthlyEndedClients[0].establishedClientsAtStart, 3);
    assert.equal(practice.endingFullMonthDenominator, months);
    assert.equal(practice.averageClientEndingsPerFullMonth, average);
  }
  assert.deepEqual(snapshot, before);
});

test("no contained mature calendar month leaves Team attrition unavailable, not zero", () => {
  const metrics = buildLocalRetentionMetrics([fixture()], {}, {}, 28, "2026-07-01", 90, "2026-01-15", "2026-01-31");
  const clinician = metrics.clientActivityByClinician[0];
  assert.equal(clinician.endingFullMonthDenominator, 0);
  assert.equal(clinician.averageClientEndingsPerFullMonth, null);
});
