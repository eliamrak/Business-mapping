import test from "node:test";
import assert from "node:assert/strict";
import { importDeclarationsSchema, resolveImportedProvider, type ImportDeclarations, type Context } from "@workspace/practice/hub";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { phoneChargeAnomalies, importAttendanceCsv, importBillingCsv } from "./retention-local.ts";

function fixture() {
  const labels = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
  const clinicians = labels.flatMap((label, i) => [
    { id: i + 1, label, goalId: 7 }, { id: i + 101, label, goalId: 8 },
  ]);
  const first = importAttendanceCsv("Client,Clinician,Date of service,Status,Location\n" + labels.map((label, i) => `client-${i},${label},2026-01-02,Show,Room`).join("\n")).snapshot;
  const second = importAttendanceCsv("Client,Clinician,Date of service,Status,Location\n" + labels.map((label, i) => `client-${i},${label},2026-01-09,Show,Room`).join("\n")).snapshot;
  const data: ImportDeclarations = { version: 1, mappings: labels.map((sourceLabel, i) => ({ sourceLabel, clinicianId: i + 1, clinicianLabel: sourceLabel, teamId: 7 })),
    sourceSets: [{ kind: "attendance", snapshotIds: [first.id, second.id], clinicianIds: [1, 2, 3, 4, 5, 6], start: "2026-01-01", end: "2026-01-14", complete: true }] };
  return { clinicians, first, second, data };
}
test("explicit six-provider crosswalk resolves only confirmed live rows, never future copies", () => {
  const { clinicians, data } = fixture();
  const before = structuredClone({ clinicians, data });
  for (const mapping of data.mappings) {
    assert.equal(resolveImportedProvider(mapping.sourceLabel, clinicians, 7), null);
    assert.equal(resolveImportedProvider(mapping.sourceLabel, clinicians, 7, data), mapping.clinicianId);
    assert.equal(resolveImportedProvider(mapping.sourceLabel, clinicians, 8, data), null);
  }
  assert.deepEqual({ clinicians, data }, before);
});
test("renamed, moved, missing and conflicting explicit targets stay unknown", () => {
  const { clinicians, data } = fixture();
  for (const roster of [clinicians.filter((row) => row.id !== 1), clinicians.map((row) => row.id === 1 ? { ...row, label: "Renamed" } : row), clinicians.map((row) => row.id === 1 ? { ...row, goalId: 8 } : row)])
    assert.equal(resolveImportedProvider("Alpha", roster, 7, data), null);
  const conflict = { ...data, mappings: [...data.mappings, { ...data.mappings[0], clinicianId: 101 }] };
  assert.equal(resolveImportedProvider("Alpha", clinicians, 7, conflict), null);
  assert.equal(importDeclarationsSchema.safeParse(conflict).success, false);
  assert.equal(importDeclarationsSchema.safeParse({ ...data, mappings: [...data.mappings, { ...data.mappings[0], sourceLabel: " ALPHA " }] }).success, false);
});
test("explicit source set admits combined partial exports without changing individual proofs", () => {
  const { clinicians, data, first, second } = fixture();
  const sources = [first, second];
  const before = structuredClone(sources);
  const selected = clinicians.filter((person) => person.goalId === 7);
  assert.equal(completeReportCoverage(sources, selected, "2026-01-15", clinicians).attendanceThrough, null);
  const admitted = completeReportCoverage(sources, selected, "2026-01-15", clinicians, { declarations: data, teamId: 7 });
  assert.equal(admitted.attendanceThrough, "2026-01-14");
  assert.equal(admitted.eligibleAttendanceRows.length, 12);
  assert.equal(admitted.completeAttendanceCoverage.length, 6);
  assert.deepEqual(sources, before);
  assert.equal(first.reportCoverage, undefined);
  const subset = completeReportCoverage(sources, selected.slice(0, 1), "2026-01-15", clinicians, { declarations: data, teamId: 7 });
  assert.deepEqual(subset.completeAttendanceCoverage.map((row) => row.clinicianId), [1]);
  const context = { clinicians, sessions: [], staff: [] } as unknown as Context;
  const overlay = buildImportedSessionOverlay(context, admitted.eligibleSnapshots, 7, {}, { declarations: data });
  assert.equal(overlay.derivedSessions.reduce((sum, row) => sum + row.completed, 0), 12);
  assert.ok(overlay.context.sessions.every((row) => row.clinicianId <= 6));
  assert.deepEqual(overlay.diagnostic.ambiguousClinicianLabels, []);
});
test("source-set scope is frozen; missing members, invalid dates and unmapped rows invalidate it", () => {
  const { clinicians, data, first, second } = fixture();
  const selected = clinicians.filter((row) => row.goalId === 7);
  const cases = [[first], [first, { ...second, rows: [{ ...second.rows[0], serviceDate: "2026-01-15" }] }],
    [first, { ...second, rows: [{ ...second.rows[0], clinician: "Outside" }] }]];
  for (const snapshots of cases) assert.equal(completeReportCoverage(snapshots, selected, "2026-01-15", clinicians, { declarations: data, teamId: 7 }).attendanceThrough, null);
  const later = importAttendanceCsv("Client,Clinician,Date of service,Status,Location\nextra,Alpha,2026-01-10,Show,Room").snapshot;
  const report = completeReportCoverage([first, second, later], selected, "2026-01-15", clinicians, { declarations: data, teamId: 7 });
  assert.equal(report.eligibleAttendanceRows.length, 12, "An unlisted upload never inherits source-set coverage");
  assert.equal(report.excludedRowsCount, 1);
});
test("attendance and billing sets remain independent and unfinished periods are excluded", () => {
  const { clinicians, data, first, second } = fixture();
  data.sourceSets[0].end = "2026-01-20";
  const report = completeReportCoverage([first, second], clinicians.filter((row) => row.goalId === 7), "2026-01-21", clinicians, { declarations: data, teamId: 7 });
  assert.equal(report.attendanceThrough, "2026-01-14");
  assert.equal(report.billingThrough, null);
  assert.equal(report.dataThrough, null);
});
test("PHONE fee anomalies are flagged without mutating zero or nonzero facts", () => {
  const source = importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\na,Alpha,2026-01-02,0,PHONE\nb,Alpha,2026-01-02,25,PHONE\nc,Alpha,2026-01-02,100,90837").snapshot;
  const before = structuredClone(source);
  assert.equal(phoneChargeAnomalies([source]).length, 1);
  assert.equal(phoneChargeAnomalies([{ ...source, rows: [source.rows[0]] }]).length, 0);
  assert.deepEqual(source, before);
});
