import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyConverterFixture, zeroCodeConverterFixture } from "../../../../verification/legacy-converter-fixture.mjs";
import { legacyServiceDefinition, isTreatmentService, isConsultationService, isDocumentationService, isFreePhoneService } from "@workspace/practice/hub";
import { importLocalPackage, importAttendanceCsv, buildLocalRetentionMetrics, treatmentAttendanceRows, phoneChargeAnomalies, exportLocalBackup, importLocalBackup, consultAttendanceClassifier } from "./retention-local.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";
import { practiceFinancialRange } from "./practice-financial-range.ts";
import { emptyWorkspace } from "@workspace/practice/hub";

test("all six owner codes preserve meaning independently of misleading consultation metadata", () => {
  for (const [code, minutes, kind] of [["1", 75, "treatment"], ["2", 0, "documentation"], ["4", 30, "treatment"], ["30001", 60, "treatment"], ["30002", 90, "treatment"], ["30003", 25, "consultation"]] as const) {
    assert.deepEqual(legacyServiceDefinition(code), { minutes, kind });
    assert.equal(isTreatmentService({ billingCode: code, visitKind: "consultation" }), kind === "treatment");
    assert.equal(isConsultationService({ billingCode: code }), kind === "consultation");
    assert.equal(isDocumentationService({ billingCode: code }), kind === "documentation");
    assert.equal(isFreePhoneService({ billingCode: code }), false);
  }
  assert.equal(isFreePhoneService({ billingCode: "PHONE" }), true);
  for (const code of ["constructor", "__proto__", "toString"]) {
    assert.equal(legacyServiceDefinition(code), undefined);
    assert.equal(isConsultationService({ billingCode: code, visitKind: "consultation" }), true);
  }
});

test("numeric 0, string 0, explicit 00000, blank and null survive XLSX conversion distinctly", () => {
  const payload = zeroCodeConverterFixture();
  assert.deepEqual(payload.collections.billing.rows.map((row: any) => row.billingCode), ["0", "0", "00000", null, null]);
  assert.deepEqual(payload.collections.attendance.rows.map((row: any) => row.billingCode ?? null), ["0", "0", "00000", null, null]);
  assert.deepEqual(payload.collections.billing.rows.map((row: any) => row.totalFeeCharged), [11, 22, 33, 44, 55]);
  assert.equal(Object.hasOwn(payload.billingCodeMinutes, "0"), false);
  assert.equal(payload.billingCodeMinutes["00000"], 15);
  assert.equal(legacyServiceDefinition("0"), undefined);
  const imported = importLocalPackage(payload);
  assert.equal(summarizeReportedBilling(imported.snapshots, "2026-10-16").months[0].charges, 165);
  const metric = buildLocalRetentionMetrics(imported.snapshots, imported.billingCodeMinutes).billingByClinician[0];
  assert.equal(metric.configuredMinuteRows, 1);
  assert.equal(metric.estimatedBillingHours, 0.25);
});

test("synthetic files flow through converter, strict Practice package validation and metrics", () => {
  const payload = legacyConverterFixture();
  const imported = importLocalPackage(payload, "2026-10-16T12:00:00Z");
  assert.deepEqual(payload.collections.billing.rows.map((row: any) => row.billingCode), ["1", "30001", "30002", "30003", "4", "2", "PHONE", "90837", "90837", "90837"]);
  assert.deepEqual(payload.collections.billing.rows.map((row: any) => row.totalFeeCharged), [125, 151, 210, 60, 44, 25, 0, 35, 0, 0]);
  assert.equal(payload.billingCodeMinutes["1"], 75);
  assert.equal(payload.billingCodeMinutes["30001"], 60);
  assert.equal(payload.billingCodeMinutes["30002"], 90);
  assert.equal(payload.billingCodeMinutes["30003"], 25);
  assert.equal(payload.billingCodeMinutes["4"], 30);
  assert.equal(payload.collections.attendance.rows[4].visitKind, undefined);
  assert.equal(payload.collections.attendance.rows[7].status, "cancelled");
  assert.equal(payload.collections.attendance.rows[7].cancellationSubtype, "late_cancelled");
  const metrics = buildLocalRetentionMetrics(imported.snapshots, imported.billingCodeMinutes);
  assert.equal(treatmentAttendanceRows(imported.snapshots).filter(row => row.status === "show").length, 4);
  assert.equal(phoneChargeAnomalies(imported.snapshots).length, 0);
  assert.equal(metrics.billingByClinician[0].totalFeesCharged, 650);
  assert.equal(metrics.billingByClinician[0].estimatedBillingHours, 460 / 60);
  const reported = summarizeReportedBilling(imported.snapshots, "2026-10-16");
  assert.equal(reported.months[0].charges, 650);
  const context: any = { clinicians: [{ id: 1, label: "Dr Legacy", goalId: null, sessionRate: 100, sessionsPerWeek: 10, weeksWorkedPerYear: 52 }], staff: [], sessions: [] };
  for (const snapshot of imported.snapshots) snapshot.reportCoverage = { start: "2026-01-01", end: "2026-01-31", complete: true };
  const overlay = buildImportedSessionOverlay(context, imported.snapshots, null);
  assert.equal(overlay.derivedSessions.reduce((sum, row) => sum + row.completed, 0), 4);
  assert.equal(overlay.diagnostic.billedFees, 650);
  const financial = practiceFinancialRange(emptyWorkspace("2026-02-01"), overlay.context, imported.snapshots, "2026-02-01", { start: "2026-01-01", end: "2026-01-28" }, overlay.attendanceCoverage);
  assert.equal(financial.actual.reportedCharges, 650);
  assert.equal(financial.actual.values.revenue, 650);
  const backup = exportLocalBackup(imported.snapshots, imported.billingCodeMinutes, {}, "2026-10-16T12:00:00Z");
  const restored = importLocalBackup(backup);
  assert.equal(restored.snapshots.find(s => s.kind === "attendance")!.rows[7].cancellationSubtype, "late_cancelled");
});

test("old consultation flags cannot turn billing code 4 into a free consultation or fee conflict", () => {
  const imported = importLocalPackage(legacyConverterFixture());
  const attendance = imported.snapshots.find(s => s.kind === "attendance")!;
  const billing = imported.snapshots.find(s => s.kind === "billing")!;
  delete attendance.rows[4].billingCode;
  attendance.rows[4].visitKind = "consultation";
  assert.equal(consultAttendanceClassifier(imported.snapshots)(attendance.rows[4]), false);
  assert.equal(treatmentAttendanceRows(imported.snapshots).filter(row => row.status === "show").length, 4);
  const older = { ...billing, id: "older-synthetic", rows: [{ ...billing.rows[4], sourceRowHash: "older-code4", visitKind: "consultation" as const }] };
  const report = summarizeReportedBilling([...imported.snapshots, older], "2026-10-16");
  assert.equal(report.months[0].charges, 650);
  assert.equal(report.evidence.conflictingHashCount, 0);
  billing.rows.push({ ...billing.rows[5], clientId: billing.rows[4].clientId, serviceDate: billing.rows[4].serviceDate, sourceRowHash: "documentation-with-code4" });
  assert.equal(consultAttendanceClassifier(imported.snapshots)(attendance.rows[4]), false);
  assert.equal(treatmentAttendanceRows(imported.snapshots).filter(row => row.status === "show").length, 4);
});

test("direct CSV preserves legacy code and late subtype; billing-linked documentation is not a visit", () => {
  const csv = importAttendanceCsv("Client,Clinician,Date of service,Status,Billing Code\nx,Dr Legacy,2026-01-01,Late cancelled,4");
  assert.equal(csv.snapshot.rows[0].billingCode, "4");
  assert.equal(csv.snapshot.rows[0].status, "cancelled");
  assert.equal(csv.snapshot.rows[0].cancellationSubtype, "late_cancelled");
  const imported = importLocalPackage(legacyConverterFixture());
  for (const snapshot of imported.snapshots) if (snapshot.kind === "attendance") delete snapshot.rows[5].billingCode;
  assert.equal(treatmentAttendanceRows(imported.snapshots).filter(row => row.status === "show").length, 4);
});
