import test from "node:test";
import assert from "node:assert/strict";
import { type Context } from "@workspace/practice/hub";
import { attendanceStatusConflicts, buildLocalRetentionMetrics, buildLocalVisitReconciliation, derivedShowVisits, importAttendanceCsv, importBillingCsv, summarizeConsultConversions, type LocalSnapshot } from "./retention-local.ts";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { completePeriodSessionSummary } from "./complete-session-summary.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";

const context: Context = { clinicians: [{ id: 1, goalId: null, label: "Current", classification: "owner", sessionRate: 100,
  sessionsPerWeek: 7, weeksWorkedPerYear: 52, capEnabled: false, capAmount: 0, preCapClinicianSplit: 0, preCapPracticeSplit: 100,
  postCapClinicianSplit: 0, postCapPracticeSplit: 100, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
const period = { start: "2026-10-08", end: "2026-10-21" };
const attendance = (rows: string[], proof = true) => {
  const source = importAttendanceCsv("Client,Clinician,Date of service,Status,Location,Billing code\n" + rows.join("\n")).snapshot;
  return { ...source, reportCoverage: proof ? { ...period, complete: true as const } : undefined };
};
const billing = (rows: string[]) => ({ ...importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\n" + rows.join("\n")).snapshot,
  reportCoverage: { ...period, complete: true as const } });
function admitted(snapshots: LocalSnapshot[], asOf = "2026-10-22", ctx = context) {
  const proof = completeReportCoverage(snapshots, ctx.clinicians, asOf, ctx.clinicians);
  const overlay = buildImportedSessionOverlay(ctx, proof.eligibleSnapshots, null);
  const summary = completePeriodSessionSummary(overlay.context.sessions, [1], period, proof.completeAttendanceCoverage, asOf);
  const fees = summarizeReportedBilling(snapshots, asOf, { ...period, eligibleRows: new Set(proof.eligibleBillingRows) });
  return { proof, overlay, summary, fees };
}

test("overlapping October 10 exports count identical visits and fees once despite changed export/row hashes", () => {
  const first = [attendance(["Repeat,Current,2026-10-10,Show,Room,90837"]), billing(["Repeat,Current,2026-10-10,100,90837"])];
  const next = [attendance(["Next,Current,2026-10-11,Show,Room,90837", "Repeat,Current,2026-10-10,Show,Room,90837"]),
    billing(["Next,Current,2026-10-11,50,90837", "Repeat,Current,2026-10-10,100,90837"])];
  assert.notEqual(first[0].sourceHash, next[0].sourceHash);
  assert.notEqual(first[0].rows[0].sourceRowHash, next[0].rows[1].sourceRowHash);
  assert.notEqual(first[1].rows[0].sourceRowHash, next[1].rows[1].sourceRowHash);
  const sources = [...first, ...next], before = structuredClone(sources);
  for (const rows of [sources, [...sources].reverse()]) {
    const result = admitted(rows);
    assert.equal(result.summary.observedCompleted, 2);
    assert.equal(result.summary.observedCoverageDays, 14);
    assert.equal(result.fees.months[0].charges, 150);
    assert.equal(result.fees.evidence.duplicateRowCount, 1);
    assert.equal(derivedShowVisits(result.proof.eligibleSnapshots).length, 2);
  }
  assert.equal(admitted(sources, "2026-10-14").summary.observedCompleted, null, "October 10 cannot make the unfinished October 8-21 period actual");
  assert.deepEqual(sources, before);
});

test("an October 10 fee correction is a retained conflict, not 225 dollars or an upload-order winner", () => {
  const sources = [attendance(["Repeat,Current,2026-10-10,Show,Room,90837"]), billing(["Repeat,Current,2026-10-10,100,90837"]),
    billing(["Other,Current,2026-10-09,0,90837", "Repeat,Current,2026-10-10,125,90837"])];
  const before = structuredClone(sources);
  for (const rows of [sources, [...sources].reverse()]) {
    const result = admitted(rows);
    assert.equal(result.summary.observedCompleted, 1, "Fee evidence does not invent extra clinical visits");
    assert.equal(result.fees.months[0].charges, null);
    assert.equal(result.fees.evidence.conflictingHashCount, 1);
    assert.equal(result.overlay.diagnostic.billedFees, null);
  }
  assert.deepEqual(sources, before);
});

test("separate October 10 billing codes do not multiply the one clinical visit", () => {
  const sources = [attendance(["Repeat,Current,2026-10-10,Show,Room,90837"]),
    billing(["Repeat,Current,2026-10-10,100,90837", "Repeat,Current,2026-10-10,25,90785"])];
  const result = admitted(sources);
  assert.equal(result.summary.observedCompleted, 1);
  assert.equal(result.fees.months[0].charges, 125);
});

test("matching mixed-status appointments in two complete exports are not a false correction", () => {
  const sources = [attendance(["Mixed,Current,2026-10-10,Show,Room,90837", "Mixed,Current,2026-10-10,Cancelled,Room,90837"]),
    attendance(["Other,Current,2026-10-09,Cancelled,Room,90837", "Mixed,Current,2026-10-10,Cancelled,Room,90837", "Mixed,Current,2026-10-10,Show,Room,90837"])];
  assert.equal(attendanceStatusConflicts(sources).length, 0);
  assert.equal(admitted(sources).summary.observedCompleted, 1);
  assert.equal(buildLocalRetentionMetrics(sources).attendanceByClinician[0].clientCancelled, 2);
});

test("contradictory October 10 show/cancel sources withhold that provider period while billing and other periods remain", () => {
  const sources: LocalSnapshot[] = [attendance(["Repeat,Current,2026-10-10,Show,Room,90837"]),
    attendance(["Other,Current,2026-10-09,Cancelled,Room,90837", "Repeat,Current,2026-10-10,Cancelled,Room,90837"]),
    billing(["Repeat,Current,2026-10-10,100,90837"])];
  const prior = attendance(["Prior,Current,2026-09-30,Show,Room,90837"]);
  prior.reportCoverage = { start: "2026-09-24", end: "2026-10-07", complete: true };
  sources.push(prior);
  const before = structuredClone(sources);
  for (const rows of [sources, [...sources].reverse()]) {
    const result = admitted(rows);
    assert.equal(result.proof.attendanceStatusConflictCount, 1);
    assert.equal(result.proof.attendanceThrough, "2026-10-07");
    assert.equal(result.proof.billingThrough, "2026-10-21");
    assert.equal(result.summary.observedCompleted, null);
    assert.equal(result.fees.months[0].charges, 100);
    assert.ok(result.proof.incompletePeriods.some((row) => row.start === period.start && row.conflictKind === "attendance-status"));
    const overlay = buildImportedSessionOverlay(context, rows, null);
    assert.equal(overlay.diagnostic.attendanceStatusConflictCount, 1);
    assert.ok(overlay.attendanceCoverage.every((row) => row.end < period.start || row.start > period.end));
    assert.equal(derivedShowVisits(rows).some((row) => row.serviceDate === "2026-10-10"), false);
    const diagnostic = buildLocalVisitReconciliation(rows, {}, "2026-10-22");
    const conflict = diagnostic.rows.find((row) => row.serviceDate === "2026-10-10")!;
    assert.equal(conflict.status, "ambiguous");
    assert.match(conflict.reviewReason!, /Conflicting attendance statuses/);
    assert.deepEqual([...new Set(conflict.attendanceRows.map((row) => row.status))].sort(), ["cancelled", "show"]);
  }
  const extra = attendance(["Unrelated,Other clinician,2026-10-10,Show,Room,90837"]);
  const second = { ...context, clinicians: [...context.clinicians, { ...context.clinicians[0], id: 2, label: "Other clinician" }] };
  const scoped = admitted([...sources, extra], "2026-10-22", second);
  assert.ok(scoped.proof.completeAttendanceCoverage.some((row) => row.clinicianId === 2 && row.start === period.start));
  assert.deepEqual(sources, before);
});

test("unverified partial status evidence cannot poison a complete replacement report", () => {
  const partial = attendance(["Repeat,Current,2026-10-10,Show,Room,90837"], false);
  const full = attendance(["Repeat,Current,2026-10-10,Cancelled,Room,90837"]);
  const sources = [partial, full], before = structuredClone(sources);
  const result = admitted(sources);
  assert.equal(result.proof.attendanceStatusConflictCount, 0);
  assert.equal(result.summary.observedCompleted, 0);
  assert.equal(result.summary.observedCoverageDays, 14);
  assert.equal(result.proof.eligibleAttendanceRows.length, 1);
  assert.equal(result.proof.eligibleAttendanceRows[0].status, "cancelled");
  assert.deepEqual(sources, before);
});

test("overlapping PHONE and billed late cancellation facts never become attended visits", () => {
  const sources = [attendance(["Phone,Current,2026-10-10,Show,Phone,", "Late cancellation,Current,2026-10-10,Cancelled,Room,90837"]),
    attendance(["Earlier cancellation,Current,2026-10-09,Cancelled,Room,90837", "Phone,Current,2026-10-10,Show,Phone,", "Late cancellation,Current,2026-10-10,Cancelled,Room,90837"]),
    billing(["Phone,Current,2026-10-10,0,PHONE", "Late cancellation,Current,2026-10-10,50,90837"]),
    billing(["Earlier cancellation,Current,2026-10-09,0,90837", "Phone,Current,2026-10-10,0,PHONE", "Late cancellation,Current,2026-10-10,50,90837"])];
  const before = structuredClone(sources), result = admitted(sources);
  assert.equal(result.summary.observedCompleted, 0);
  assert.equal(result.fees.months[0].charges, 50, "A charged cancellation fee remains billing evidence, not an attended session");
  const metrics = buildLocalRetentionMetrics(result.proof.eligibleSnapshots, {}, {}, 28, "2026-10-22");
  assert.equal(metrics.derivedShowVisits, 0);
  assert.equal(metrics.attendanceByClinician[0].clientCancelled, 2, "Two distinct cancelled clients, not three overlapping rows");
  assert.equal(summarizeConsultConversions(result.proof.eligibleSnapshots, {}, period.start, period.end, "2026-10-22").practice.consultations, 1);
  assert.deepEqual(sources, before);
});

test("same-day PHONE and cancelled treatment are distinguishable kinds, not a false status correction", () => {
  const converted = attendance(["Same client,Current,2026-10-10,Show,Phone,PHONE", "Same client,Current,2026-10-10,Cancelled,Room,90837"]);
  converted.rows[0] = { ...converted.rows[0], billingCode: "PHONE", visitKind: "consultation" };
  const sources = [converted,
    billing(["Same client,Current,2026-10-10,0,PHONE", "Same client,Current,2026-10-10,50,90837"])];
  assert.equal(attendanceStatusConflicts(sources).length, 0);
  assert.equal(admitted(sources).summary.observedCompleted, 0);
  assert.equal(admitted(sources).fees.months[0].charges, 50);
});

test("a conflicted return cannot certify either consultation conversion or a mature miss", () => {
  const sources = [attendance(["Referral,Current,2026-09-25,Show,Phone,PHONE", "Referral,Current,2026-10-10,Show,Room,90837"]),
    attendance(["Referral,Current,2026-10-10,Cancelled,Room,90837"])];
  sources[0].rows[0] = { ...sources[0].rows[0], billingCode: "PHONE", visitKind: "consultation" };
  for (const snapshot of sources) snapshot.reportCoverage = { start: "2026-09-24", end: "2026-11-04", complete: true };
  const proof = completeReportCoverage(sources, context.clinicians, "2026-11-05");
  const result = summarizeConsultConversions(proof.eligibleSnapshots, {}, "2026-09-24", "2026-09-30", "2026-11-05", [], {
    excludedFollowUpEvidence: [{ clientId: "Referral", serviceDate: "2026-10-10" }],
  });
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.missed, 0);
  assert.equal(result.practice.pending, 1);
  assert.equal(result.practice.conversionRate, null);
});
