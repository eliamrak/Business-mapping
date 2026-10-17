import test from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@workspace/practice/hub";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { overviewClientFlow } from "./practice-overview.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";
import {
  attendanceStatusConflicts,
  buildLocalRetentionMetrics,
  derivedShowVisits,
  estimateLocalClientActivity,
  summarizeConsultConversions,
  treatmentAttendanceRows,
  type AttendanceRow,
  type LocalSnapshot,
} from "./retention-local.ts";

const asOf = "2026-06-01";
const start = "2026-01-01";
const end = "2026-01-31";
const proof = { start, end: "2026-05-20", complete: true as const };
const clinician = {
  id: 1, goalId: 7, label: "Synthetic", roleType: "associate", classification: "1099" as const,
  sessionRate: 175, sessionsPerWeek: 20, weeksWorkedPerYear: 48,
  preCapClinicianSplit: 60, preCapPracticeSplit: 40, capEnabled: false, capAmount: 0,
  postCapClinicianSplit: 60, postCapPracticeSplit: 40, w2EmployerFicaPct: 0,
  futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0,
  nonClinicalHoursPerWeek: 0, nonClinicalHourlyRate: 0,
};
const context: Context = { clinicians: [clinician], sessions: [], staff: [] };
const visit = (clientId: string, serviceDate: string, billingCode?: string): AttendanceRow => ({
  clientId, serviceDate, clinician: clinician.label, status: "show", location: "Room",
  ...(billingCode ? { billingCode } : {}), sourceRowHash: `${clientId}:${serviceDate}`,
});
const attendance = (id: string, rows: AttendanceRow[], complete = true): LocalSnapshot => ({
  id, kind: "attendance", sourceHash: id, importedAt: `${asOf}T00:00:00Z`,
  coverageStart: rows.map(row => row.serviceDate).sort()[0],
  coverageEnd: rows.map(row => row.serviceDate).sort().at(-1)!,
  ...(complete ? { reportCoverage: proof } : {}), rows,
});
function fixture(code: string) {
  const special = ["2026-01-02", "2026-01-09", "2026-01-16"].map(date => visit("special", date));
  const treatment = ["2026-01-03", "2026-01-10", "2026-01-17"].map(date => visit("treatment", date, "90837"));
  const billing = (id: string, rows: AttendanceRow[], billingCode: string, complete: boolean): LocalSnapshot => ({
    id, kind: "billing", sourceHash: id, importedAt: `${asOf}T00:00:00Z`,
    coverageStart: rows[0].serviceDate, coverageEnd: rows.at(-1)!.serviceDate,
    ...(complete ? { reportCoverage: proof } : {}),
    rows: rows.map(row => ({ clientId: row.clientId, clinician: row.clinician, serviceDate: row.serviceDate,
      billingCode, totalFeeCharged: complete ? 100 : 999, sourceRowHash: `billing:${row.sourceRowHash}` })),
  });
  return [attendance("attendance-full", [...special, ...treatment]),
    billing("billing-partial", special, code, false), billing("billing-full", treatment, "90837", true)];
}
const admitted = (sources: LocalSnapshot[]) => completeReportCoverage(sources, [clinician], asOf);
const metrics = (sources: LocalSnapshot[], classificationSnapshots: LocalSnapshot[]) =>
  buildLocalRetentionMetrics(sources, {}, {}, 28, asOf, 90, start, end, { classificationSnapshots });
const activity = (sources: LocalSnapshot[], classificationSnapshots: LocalSnapshot[]) =>
  estimateLocalClientActivity(sources, {}, 56, 56, 28, asOf, 90, start, end, { classificationSnapshots });

for (const code of ["PHONE", "2"]) {
  test(`unproved ${code} billing classifies verified attendance without becoming financial actuals`, () => {
    const raw = fixture(code);
    const before = structuredClone(raw);
    const coverage = admitted(raw);
    const sources = coverage.eligibleSnapshots;
    const options = { classificationSnapshots: raw };
    const eligibleBefore = structuredClone(sources);
    const result = metrics(sources, raw);
    assert.equal(coverage.eligibleAttendanceRows.length, 6);
    assert.equal(coverage.eligibleBillingRows.length, 3);
    assert.equal(treatmentAttendanceRows(sources, raw).length, 3);
    assert.equal(derivedShowVisits(sources, {}, raw).length, 3);
    assert.equal(result.derivedShowVisits, 3);
    assert.equal(result.excludedConsultationShowRows, code === "PHONE" ? 3 : 0);
    assert.equal(result.clientActivityByClinician[0].retainedClients, 1);
    assert.equal(result.clientActivityByClinician[0].initialRetentionDenominator, 1);
    assert.equal(result.clientActivityByClinician[0].endingFullMonthClientEnds, 1);
    const estimate = activity(sources, raw)!;
    assert.equal(estimate.retainedClientPairs, 1);
    assert.equal(estimate.initialRetentionDenominator, 1);
    assert.deepEqual(estimate.endingEvents, [{ clientId: "treatment", date: "2026-01-17" }]);
    const overview = overviewClientFlow(sources, {}, start, end, asOf, options);
    assert.equal(overview.starts, 1);
    assert.equal(overview.departures, 1);
    const consult = summarizeConsultConversions(sources, {}, start, end, asOf, [], options);
    assert.equal(consult.practice.consultations, code === "PHONE" ? 1 : 0);
    assert.equal(consult.practice.converted, 0);
    assert.equal(consult.practice.missed, code === "PHONE" ? 1 : 0);
    const overlay = buildImportedSessionOverlay(context, sources, 7, {}, options);
    assert.equal(overlay.derivedSessions.reduce((sum, row) => sum + row.completed, 0), 3);
    assert.equal(overlay.diagnostic.billedFees, 300);
    assert.equal(overlay.importedBillingActuals.length, 3);
    assert.equal(overlay.importedBillingActuals.some(row => row.clientId === "special"), false);
    assert.deepEqual(overlay.importedBillingActuals, buildImportedSessionOverlay(context, sources, 7).importedBillingActuals);
    assert.equal(result.billingRows, 3);
    assert.equal(result.billingByClinician[0].totalFeesCharged, 300);
    const reported = summarizeReportedBilling(raw, asOf, { eligibleRows: new Set(coverage.eligibleBillingRows) });
    assert.equal(reported.months[0].charges, 300);
    assert.deepEqual(raw, before);
    assert.deepEqual(sources, eligibleBefore);
  });
}

test("classification evidence cannot introduce unproved attendance statuses, visits or coverage", () => {
  const raw = fixture("PHONE");
  const full = raw[0] as Extract<LocalSnapshot, { kind: "attendance" }>;
  raw.push(attendance("partial-attendance", [
    { ...full.rows.find(row => row.clientId === "treatment")!, status: "cancelled" },
    visit("unproved-consult", "2026-01-04", "PHONE"),
    visit("unproved-treatment", "2026-01-05", "90837"),
  ], false));
  const before = structuredClone(raw);
  const coverage = admitted(raw);
  const sources = coverage.eligibleSnapshots;
  assert.equal(coverage.attendanceStatusConflictCount, 0);
  assert.equal(attendanceStatusConflicts(sources, raw).length, 0);
  assert.equal(coverage.eligibleAttendanceRows.length, 6);
  assert.equal(derivedShowVisits(sources, {}, raw).length, 3);
  assert.equal(activity(sources, raw)!.initialRetentionCoverageVerified, true);
  const consult = summarizeConsultConversions(sources, {}, start, end, asOf, [], { classificationSnapshots: raw });
  assert.equal(consult.practice.consultations, 1);
  assert.equal(consult.practice.missed, 1);
  assert.equal(consult.coverageVerified, true);
  const overlay = buildImportedSessionOverlay(context, sources, 7, {}, { classificationSnapshots: raw });
  assert.equal(overlay.diagnostic.attendanceStatusConflictCount, 0);
  assert.equal(overlay.derivedSessions.reduce((sum, row) => sum + row.completed, 0), 3);
  assert.equal(derivedShowVisits([], {}, raw).length, 0);
  assert.equal(activity([], raw), null);
  assert.equal(summarizeConsultConversions([], {}, start, end, asOf, [], { classificationSnapshots: raw }).practice.consultations, 0);
  assert.deepEqual(raw, before);
});

test("raw documentation classification prevents false conflicts from withholding complete attendance periods", () => {
  const raw = fixture("2");
  const full = raw[0] as Extract<LocalSnapshot, { kind: "attendance" }>;
  raw.push(attendance("documentation-cancellation", full.rows.filter(row => row.clientId === "special")
    .map(row => ({ ...row, status: "cancelled" }))));
  const coverage = admitted(raw);
  assert.equal(coverage.attendanceStatusConflictCount, 0);
  assert.equal(coverage.eligibleAttendanceRows.length, 9);
  assert.equal(coverage.attendanceThrough, "2026-05-20");
  assert.equal(attendanceStatusConflicts(coverage.eligibleSnapshots, raw).length, 0);
  assert.equal(metrics(coverage.eligibleSnapshots, raw).clientActivityByClinician[0].initialRetentionCoverageVerified, true);
  assert.equal(activity(coverage.eligibleSnapshots, raw)!.initialRetentionCoverageVerified, true);
  assert.equal(derivedShowVisits(coverage.eligibleSnapshots, {}, raw).length, 3);
});

for (const code of ["PHONE", "2"]) {
  test(`explicit numeric code 4 remains treatment despite partial ${code} billing and old consultation flags`, () => {
    const raw = fixture(code);
    const full = raw[0] as Extract<LocalSnapshot, { kind: "attendance" }>;
    full.rows = full.rows.map(row => row.clientId === "special"
      ? { ...row, billingCode: "4", visitKind: "consultation" } : row);
    const sources = admitted(raw).eligibleSnapshots;
    assert.equal(derivedShowVisits(sources, {}, raw).length, 6);
    assert.equal(metrics(sources, raw).clientActivityByClinician[0].retainedClients, 2);
    assert.equal(activity(sources, raw)!.retainedClientPairs, 2);
    assert.equal(summarizeConsultConversions(sources, {}, start, end, asOf, [], { classificationSnapshots: raw }).practice.consultations, 0);
    const overlay = buildImportedSessionOverlay(context, sources, 7, {}, { classificationSnapshots: raw });
    assert.equal(overlay.derivedSessions.reduce((sum, row) => sum + row.completed, 0), 6);
    assert.equal(overlay.diagnostic.billedFees, 300);
  });
}

test("consult conversion retains admitted treatment follow-up while classifying a legacy PHONE consult", () => {
  const raw = fixture("PHONE");
  const full = raw[0] as Extract<LocalSnapshot, { kind: "attendance" }>;
  full.rows.push(visit("special", "2026-01-23", "4"));
  const sources = admitted(raw).eligibleSnapshots;
  const summary = summarizeConsultConversions(sources, {}, start, end, asOf, [], {
    classificationSnapshots: raw, cohortClinicianNames: [clinician.label],
  });
  assert.equal(summary.practice.consultations, 1);
  assert.equal(summary.practice.converted, 1);
  assert.equal(summary.practice.conversionRate, 100);
  assert.equal(summary.journeys[0].treatmentDate, "2026-01-23");
  assert.equal(summary.byClinician[0].candidateConversions, 1);
  assert.equal(summary.byClinician[0].converted, 0);
  assert.equal(metrics(sources, raw).clientActivityByClinician[0].retainedClients, 1);
  assert.equal(overviewClientFlow(sources, {}, start, end, asOf, { classificationSnapshots: raw }).starts, 2);
});
