import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalRetentionMetrics,
  estimateLocalClientActivity,
  importAttendanceCsv,
  summarizeConsultConversions,
  type ReportCoverage,
} from "./retention-local.ts";

const proof: ReportCoverage = { start: "2026-01-01", end: "2026-06-30", complete: true };
const attendance = (rows: string, reportCoverage?: ReportCoverage) => ({
  ...importAttendanceCsv(`Client,Clinician,Date of service,Location,Status\n${rows}`).snapshot,
  ...(reportCoverage ? { reportCoverage } : {}),
});
const cohort = (reportCoverage?: ReportCoverage) => attendance(`retained,Lane,2026-01-01,Room,show
retained,Lane,2026-01-15,Room,show
retained,Lane,2026-01-29,Room,show
single,Lane,2026-01-02,Room,show
later,Lane,2026-01-01,Room,show
later,Lane,2026-01-30,Room,show
later,Lane,2026-02-10,Room,show
boundary,Lane,2026-06-30,Room,no show`, reportCoverage);

test("legacy observed positives survive without negative retention, inactivity or ending inferences", () => {
  const snapshots = [cohort()];
  const estimate = estimateLocalClientActivity(snapshots)!;
  const metrics = buildLocalRetentionMetrics(snapshots);
  assert.equal(estimate.coverageVerified, false);
  assert.equal(metrics.coverageVerified, false);
  assert.equal(estimate.retainedClientPairs, 1);
  assert.equal(estimate.observedAttendedSessionsPerRetainedClient, 3);
  assert.equal(estimate.matureNonRetainedClientPairs, 0);
  assert.equal(estimate.immatureClientPairsExcluded, 2);
  assert.equal(estimate.initialNonRetainedLaterReturnPairs, 0);
  assert.equal(estimate.monthlyAttritionRate, null);
  assert.equal(estimate.averageInactiveClientTransitionsPerMonth, null);
  assert.deepEqual(estimate.endingEvents, []);
  assert.equal(estimate.endingEventCoverageComplete, false);
  assert.equal(estimate.averageClientEndingsPerFullMonth, null);
  assert.equal(estimate.averageClientEndingsPerLatestSixMonths, null);
  assert.equal(estimate.endingAttritionPct, null);
  assert.equal(metrics.attendanceRows, 8);
  assert.equal(metrics.derivedShowVisits, 7);
  const clinician = metrics.clientActivityByClinician[0];
  assert.equal(clinician.coverageVerified, false);
  assert.equal(clinician.retainedClients, 1);
  assert.equal(clinician.pendingInitialClients, 2);
  assert.equal(clinician.matureNonRetainedClients, 0);
  assert.equal(clinician.averageClientEndingsPerFullMonth, null);
});

test("verified reports preserve 3 sessions, 28-day boundary, 90-day endings and later-return rules", () => {
  const snapshots = [cohort(proof)];
  const estimate = estimateLocalClientActivity(snapshots)!;
  const metrics = buildLocalRetentionMetrics(snapshots);
  assert.equal(estimate.coverageVerified, true);
  assert.equal(metrics.coverageVerified, true);
  assert.equal(estimate.retainedClientPairs, 1);
  assert.equal(estimate.matureNonRetainedClientPairs, 2);
  assert.equal(estimate.initialNonRetainedLaterReturnPairs, 1);
  assert.equal(estimate.initialRetentionRate, 1 / 3);
  assert.deepEqual(estimate.endingEvents.sort((a, b) => a.clientId.localeCompare(b.clientId)), [
    { clientId: "later", date: "2026-02-10" },
    { clientId: "retained", date: "2026-01-29" },
  ]);
  assert.equal(metrics.clientActivityByClinician[0].matureNonRetainedClients, 2);
});

test("a gap inside the initial episode prevents failure even when later follow-up is verified", () => {
  const first = attendance("client,Lane,2026-01-01,Room,show", { ...proof, end: "2026-01-01" });
  const second = attendance("client,Lane,2026-01-20,Room,show", { ...proof, start: "2026-01-20" });
  const estimate = estimateLocalClientActivity([first, second])!;
  const metrics = buildLocalRetentionMetrics([first, second]);
  assert.equal(estimate.matureNonRetainedClientPairs, 0);
  assert.equal(estimate.immatureClientPairsExcluded, 1);
  assert.equal(metrics.clientActivityByClinician[0].pendingInitialClients, 1);
  assert.equal(estimate.initialRetentionRate, null);
});

const consults = (reportCoverage?: ReportCoverage) => {
  const snapshot = attendance(`converted,Intake,2026-01-01,Phone,show
converted,Treatment,2026-01-10,Room,show
missing,Intake,2026-01-02,Phone,show`, reportCoverage);
  for (const row of snapshot.rows) if (row.location === "Phone") row.visitKind = "consultation";
  return snapshot;
};
const summarize = (snapshot: ReturnType<typeof consults>, asOf = "2026-02-06") => summarizeConsultConversions(
  [snapshot], {}, "2026-01-01", "2026-01-31", asOf,
  [
    { clientId: "converted", outcome: "confirmed_closer", clinicianName: "Intake" },
    { clientId: "missing", outcome: "missed_owner", clinicianName: "Intake" },
  ],
);

test("legacy consult conversions stay visible while unverified non-conversions stay pending", () => {
  const summary = summarize(consults());
  assert.equal(summary.coverageVerified, false);
  assert.equal(summary.practice.converted, 1);
  assert.equal(summary.practice.missed, 0);
  assert.equal(summary.practice.pending, 1);
  assert.equal(summary.journeys.find((row) => row.clientId === "converted")?.status, "converted");
  const missing = summary.journeys.find((row) => row.clientId === "missing")!;
  assert.equal(missing.status, "pending");
  assert.equal(missing.coverageVerified, false);
  assert.equal(missing.creditedClinician, null);
  assert.equal(summary.byClinician[0].missed, 0);
});

test("consult misses require a verified calendar month, clipped to the as-of date", () => {
  const snapshot = consults(proof);
  const pending = summarize(snapshot, "2026-02-01");
  assert.equal(pending.practice.missed, 0);
  assert.equal(pending.practice.pending, 1);
  const mature = summarize(snapshot, "2026-02-02");
  assert.equal(mature.practice.missed, 1);
  assert.equal(mature.practice.pending, 0);
  assert.equal(mature.coverageVerified, true);
  assert.equal(mature.practice.conversionRate, 50);
});

test("partial or invalid proof cannot mature a missing consult", () => {
  for (const reportCoverage of [
    { ...proof, end: "2026-02-01" },
    { ...proof, start: "2026-01-02" },
    { ...proof, end: "2026-02-30" },
    { ...proof, complete: false } as unknown as ReportCoverage,
  ]) {
    const summary = summarize(consults(reportCoverage));
    assert.equal(summary.practice.converted, 1);
    assert.equal(summary.practice.missed, 0);
    assert.equal(summary.practice.pending, 1);
  }
});

test("another clinician's verified report cannot certify legacy missing attendance", () => {
  const lane = cohort();
  const moss = attendance("other,Moss,2026-01-01,Room,show", proof);
  const metrics = buildLocalRetentionMetrics([lane, moss]);
  assert.equal(metrics.clientActivityByClinician.find((row) => row.clinician === "Lane")?.matureNonRetainedClients, 0);
  assert.equal(metrics.clientActivityByClinician.find((row) => row.clinician === "Moss")?.matureNonRetainedClients, 1);
  const estimate = estimateLocalClientActivity([lane, moss])!;
  assert.equal(estimate.coverageVerified, false);
  assert.equal(estimate.matureNonRetainedClientPairs, 0);
  assert.deepEqual(estimate.endingEvents, []);
});

test("visit-free report endpoints can prove maturity that observed min/max cannot", () => {
  const legacy = attendance("single,Lane,2026-01-01,Room,show");
  const verified = { ...legacy, reportCoverage: { ...proof, end: "2026-01-29" } };
  assert.equal(estimateLocalClientActivity([legacy])!.matureNonRetainedClientPairs, 0);
  assert.equal(estimateLocalClientActivity([verified], {}, 56, 56, 28, "2026-01-29")!.matureNonRetainedClientPairs, 1);
  assert.equal(buildLocalRetentionMetrics([verified], {}, {}, 28, "2026-01-28").clientActivityByClinician[0].pendingInitialClients, 1);
});

test("ending maturity respects the exact 90-day boundary", () => {
  const snapshot = attendance(`client,Lane,2026-01-01,Room,show
client,Lane,2026-01-15,Room,show
client,Lane,2026-01-29,Room,show`, proof);
  assert.deepEqual(estimateLocalClientActivity([snapshot], {}, 56, 56, 28, "2026-04-28")!.endingEvents, []);
  assert.deepEqual(estimateLocalClientActivity([snapshot], {}, 56, 56, 28, "2026-04-29")!.endingEvents, [
    { clientId: "client", date: "2026-01-29" },
  ]);
});

test("zero ending rates appear only for verified full observation months", () => {
  const legacy = attendance(`client,Lane,2026-01-15,Room,show
client,Lane,2026-01-29,Room,show
client,Lane,2026-02-12,Room,show
client,Lane,2026-05-01,Room,show
client,Lane,2026-06-15,Room,show`);
  const unknown = estimateLocalClientActivity([legacy])!;
  assert.equal(unknown.averageClientEndingsPerFullMonth, null);
  assert.equal(unknown.endingAttritionPct, null);
  const known = estimateLocalClientActivity([{ ...legacy, reportCoverage: proof }])!;
  assert.equal(known.coverageVerified, true);
  assert.equal(known.averageClientEndingsPerFullMonth, 0);
  assert.equal(known.endingAttritionPct, 0);
});

test("adjacent declarations mature consults while a one-day reporting gap keeps them pending", () => {
  const first = attendance("client,Lane,2026-01-02,Phone,show", { ...proof, end: "2026-01-15" });
  first.rows[0].visitKind = "consultation";
  for (const start of ["2026-01-16", "2026-01-17"]) {
    const second = attendance("boundary,Lane,2026-01-17,Room,no show", { ...proof, start, end: "2026-02-02" });
    const summary = summarizeConsultConversions([first, second], {}, "2026-01-01", "2026-01-31", "2026-02-02");
    assert.equal(summary.practice.missed, start === "2026-01-16" ? 1 : 0);
    assert.equal(summary.practice.pending, start === "2026-01-16" ? 0 : 1);
    assert.equal(summary.journeys[0].coverageVerified, start === "2026-01-16");
  }
});
