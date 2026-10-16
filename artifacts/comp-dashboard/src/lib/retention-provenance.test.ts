import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalRetentionMetrics, estimateLocalClientActivity, type LocalSnapshot } from "./retention-local.ts";

function snapshot(start: string, end: string, days: string[], proof = true): LocalSnapshot {
  return { id: `${start}-${end}`, kind: "attendance", sourceHash: start, importedAt: "2026-10-16T00:00:00Z",
    coverageStart: start, coverageEnd: end, ...(proof ? { reportCoverage: { start, end, complete: true as const } } : {}),
    rows: days.map(day => ({ clientId: "synthetic-client", clinician: "Synthetic", serviceDate: day, status: "show", location: null, sourceRowHash: day })) };
}
function metrics(snapshots: LocalSnapshot[], excludedFollowUpEvidence: { clientId: string; serviceDate: string }[] = [], asOf = "2026-10-16") {
  const options = { excludedFollowUpEvidence };
  const individual = buildLocalRetentionMetrics(snapshots, {}, {}, 28, asOf, 90, "2026-01-15", "2026-01-28", options).clientActivityByClinician[0];
  const practice = estimateLocalClientActivity(snapshots, {}, 56, 56, 28, asOf, 90, "2026-01-15", "2026-01-28", options);
  return { individual, practice };
}
test("selected retention label requires observation beyond selected dates, not only proved visit days", () => {
  const { individual, practice } = metrics([snapshot("2026-01-15", "2026-01-28", ["2026-01-16", "2026-01-23"])]);
  assert.equal(individual.initialRetentionCoverageVerified, false);
  assert.equal(practice!.initialRetentionCoverageVerified, false);
  assert.equal(individual.pendingInitialClients, 1);
  assert.equal(individual.initialRetentionDenominator, 0);
});
test("positive third session does not certify a missing day in its observation window", () => {
  const { individual, practice } = metrics([snapshot("2026-01-15", "2026-01-28", ["2026-01-16", "2026-01-23"]),
    snapshot("2026-01-30", "2026-02-12", ["2026-01-30"])]);
  assert.equal(individual.retainedClients, 1);
  assert.equal(individual.initialRetentionCoverageVerified, false);
  assert.equal(practice!.initialRetentionCoverageVerified, false);
});
test("missing selected day is unknown even when a retained start has complete follow-up", () => {
  const { individual, practice } = metrics([snapshot("2026-01-16", "2026-03-01", ["2026-01-16", "2026-01-23", "2026-01-30"])]);
  assert.equal(individual.retainedClients, 1);
  assert.equal(individual.initialRetentionCoverageVerified, false);
  assert.equal(practice!.initialRetentionCoverageVerified, false);
});
test("raw positive visits without report proof never verify selected retention", () => {
  const { individual, practice } = metrics([snapshot("2026-01-15", "2026-03-01", ["2026-01-16", "2026-01-23", "2026-01-30"], false)]);
  assert.equal(individual.retainedClients, 1);
  assert.equal(individual.initialRetentionCoverageVerified, false);
  assert.equal(practice!.initialRetentionCoverageVerified, false);
});
test("excluded evidence inside a selected failure observation window preserves unknown and pending", () => {
  const { individual, practice } = metrics([snapshot("2026-01-15", "2026-03-01", ["2026-01-16", "2026-01-23"])],
    [{ clientId: "synthetic-client", serviceDate: "2026-02-05" }]);
  assert.equal(individual.initialRetentionCoverageVerified, false);
  assert.equal(practice!.initialRetentionCoverageVerified, false);
  assert.equal(individual.pendingInitialClients, 1);
});
test("as-of clipping cannot verify not-yet-observed retention follow-up", () => {
  const { individual, practice } = metrics([snapshot("2026-01-15", "2026-03-01", ["2026-01-16", "2026-01-23", "2026-01-30"])], [], "2026-01-28");
  assert.equal(individual.initialRetentionCoverageVerified, false);
  assert.equal(practice!.initialRetentionCoverageVerified, false);
  assert.equal(individual.pendingInitialClients, 1);
});
test("covered selected starts can have verified coverage with a genuine zero denominator", () => {
  const { individual, practice } = metrics([snapshot("2026-01-01", "2026-03-01", ["2026-01-02", "2026-01-09", "2026-01-16"])]);
  assert.equal(individual.initialRetentionCoverageVerified, true);
  assert.equal(practice!.initialRetentionCoverageVerified, true);
  assert.equal(individual.initialRetentionDenominator, 0);
  assert.equal(individual.initialRetentionPct, null);
});
