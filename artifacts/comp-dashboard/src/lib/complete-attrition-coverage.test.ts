import test from "node:test";
import assert from "node:assert/strict";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { buildLocalRetentionMetrics, estimateLocalClientActivity, type ClientActivityOptions, type LocalSnapshot } from "./retention-local.ts";
import { overviewClientFlow } from "./practice-overview.ts";

const roster = [{ id: 1, label: "Current" }, { id: 2, label: "Former" }];
const visit = (clinician: string, serviceDate: string, clientId = "target") => ({
  clinician, serviceDate, clientId, status: "show" as const, location: null, sourceRowHash: `${clinician}:${clientId}:${serviceDate}`,
});
const full = (id: string, rows: ReturnType<typeof visit>[]): LocalSnapshot => ({
  id, kind: "attendance", sourceHash: id, importedAt: "2026-05-07T00:00:00Z",
  coverageStart: "2026-01-01", coverageEnd: "2026-05-06",
  reportCoverage: { start: "2026-01-01", end: "2026-05-06", complete: true }, rows,
});
const current = () => full("current", [visit("Current", "2026-01-02"), visit("Current", "2026-01-09"), visit("Current", "2026-01-16")]);
const activity = (sources: LocalSnapshot[], options: ClientActivityOptions = {}) => estimateLocalClientActivity(
  sources, {}, 56, 56, 28, "2026-05-07", 90, "2026-01-01", "2026-01-31", options,
)!;
const metrics = (sources: LocalSnapshot[], options: ClientActivityOptions = {}) => buildLocalRetentionMetrics(
  sources, {}, {}, 28, "2026-05-07", 90, "2026-01-01", "2026-01-31", options,
);

test("partial former-provider returns block certified endings and rates without adding visits", () => {
  const partial: LocalSnapshot = { ...full("partial", [visit("Former", "2026-02-05")]), reportCoverage: undefined };
  const raw = [current(), partial];
  const options = { excludedFollowUpEvidence: partial.rows.map(({ clientId, serviceDate }) => ({ clientId, serviceDate })) };
  const before = structuredClone({ raw, options });
  const coverage = completeReportCoverage(raw, roster, "2026-05-07");
  const baseline = activity(coverage.eligibleSnapshots);
  assert.equal(baseline.endingEvents.length, 1);
  const guarded = activity(coverage.eligibleSnapshots, options);
  assert.deepEqual(guarded.endingEvents, []);
  assert.equal(guarded.endingEventCoverageComplete, false);
  assert.equal(guarded.endingFullMonthDenominator, 0);
  assert.equal(guarded.averageClientEndingsPerFullMonth, null);
  assert.equal(guarded.averageClientEndingsPerLatestSixMonths, null);
  assert.equal(guarded.retainedClientPairs, baseline.retainedClientPairs, "Known retained success is independent of absent follow-up");
  const clinician = metrics(coverage.eligibleSnapshots, options).clientActivityByClinician[0];
  assert.equal(clinician.averageClientEndingsPerFullMonth, null);
  assert.equal(clinician.endingFullMonthDenominator, 0);
  assert.equal(clinician.coverageVerified, false);
  assert.equal(metrics(coverage.eligibleSnapshots, options).derivedShowVisits, 3);
  const overview = overviewClientFlow(coverage.eligibleSnapshots, {}, "2026-01-01", "2026-01-31", "2026-05-07", options);
  assert.equal(overview.departures, null, "Overview cannot bypass the unresolved-return safeguard");
  const wholeHistory = estimateLocalClientActivity(coverage.eligibleSnapshots, {}, 56, 56, 28, "2026-05-07", 90, "2026-01-01", "2026-05-06", options)!;
  assert.equal(wholeHistory.monthlyAttritionRate, null);
  assert.equal(wholeHistory.estimatedClientsLeavingPerMonth, null);
  assert.equal(wholeHistory.activeClientMonthDenominator, 0);
  assert.deepEqual({ raw, options }, before);
});

test("a later excluded return still blocks an earlier ending after the 90-day threshold", () => {
  const coverage = completeReportCoverage([current()], [roster[0]], "2026-05-07");
  const result = activity(coverage.eligibleSnapshots, { excludedFollowUpEvidence: [{ clientId: "target", serviceDate: "2026-05-01" }] });
  assert.deepEqual(result.endingEvents, []);
  assert.equal(result.endingEventCoverageComplete, false);
  assert.equal(result.averageClientEndingsPerFullMonth, null);
});

test("full replacement restores qualified metrics and old evidence matching an actual visit is harmless", () => {
  const replacement = full("former-full", [visit("Former", "2026-02-05")]);
  const raw = [current(), replacement];
  const before = structuredClone(raw);
  const coverage = completeReportCoverage(raw, roster, "2026-05-07");
  const options = { excludedFollowUpEvidence: [{ clientId: "target", serviceDate: "2026-02-05" }] };
  const restored = activity(coverage.eligibleSnapshots, options);
  assert.deepEqual(restored.endingEvents, []);
  assert.equal(restored.endingEventCoverageComplete, true);
  assert.equal(restored.endingFullMonthDenominator, 1);
  assert.equal(restored.averageClientEndingsPerFullMonth, 0);
  assert.deepEqual(metrics(coverage.eligibleSnapshots, options), metrics(coverage.eligibleSnapshots), "A known actual visit also resolves stale partial evidence for individual clinicians");
  assert.equal(metrics(coverage.eligibleSnapshots).derivedShowVisits, 4);
  const quiet = completeReportCoverage([current()], [roster[0]], "2026-05-07");
  assert.equal(activity(quiet.eligibleSnapshots).averageClientEndingsPerFullMonth, 1, "Caller removal of resolved partial evidence restores quiet-period endings");
  assert.deepEqual(raw, before);
});

test("partial follow-up cannot certify a failed initial episode or create a retained success", () => {
  const source = full("initial", [visit("Current", "2026-01-02"), visit("Current", "2026-01-09")]);
  const coverage = completeReportCoverage([source], [roster[0]], "2026-05-07");
  const options = { excludedFollowUpEvidence: [{ clientId: "target", serviceDate: "2026-01-16" }] };
  const result = activity(coverage.eligibleSnapshots, options);
  assert.equal(result.retainedClientPairs, 0);
  assert.equal(result.matureNonRetainedClientPairs, 0);
  assert.equal(result.immatureClientPairsExcluded, 1);
  assert.equal(result.initialRetentionRate, null);
  const individual = metrics(coverage.eligibleSnapshots, options).clientActivityByClinician[0];
  assert.equal(individual.retainedClients, 0);
  assert.equal(individual.matureNonRetainedClients, 0);
  assert.equal(individual.pendingInitialClients, 1);
  assert.equal(individual.initialRetentionPct, null);
});

test("unrelated, future and invalid excluded rows do not suppress known endings", () => {
  const coverage = completeReportCoverage([current()], [roster[0]], "2026-05-07");
  const options = { excludedFollowUpEvidence: [
    { clientId: "other-client", serviceDate: "2026-02-05" },
    { clientId: "target", serviceDate: "2026-05-08" },
    { clientId: "target", serviceDate: "invalid" },
    { clientId: "target", serviceDate: "2026-02-30" },
  ] };
  assert.deepEqual(activity(coverage.eligibleSnapshots, options), activity(coverage.eligibleSnapshots));
  assert.deepEqual(metrics(coverage.eligibleSnapshots, options), metrics(coverage.eligibleSnapshots));
});
