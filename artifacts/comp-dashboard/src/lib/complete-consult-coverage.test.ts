import test from "node:test";
import assert from "node:assert/strict";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { summarizeConsultConversions, type LocalSnapshot } from "./retention-local.ts";

const consult = { clientId: "Synthetic referral", clinician: "Current", serviceDate: "2026-01-05", status: "show" as const, location: null, billingCode: "PHONE", visitKind: "consultation" as const, sourceRowHash: "consult" };
const treatment = { clientId: consult.clientId, clinician: "Former", serviceDate: "2026-01-12", status: "show" as const, location: null, billingCode: "90837", sourceRowHash: "treatment" };
const complete = (id: string, rows: typeof consult[] | typeof treatment[]): LocalSnapshot => ({ id, kind: "attendance", importedAt: "2026-02-20T00:00:00Z", coverageStart: rows[0].serviceDate, coverageEnd: rows.at(-1)!.serviceDate, reportCoverage: { start: "2026-01-01", end: "2026-02-11", complete: true }, sourceHash: id, rows });

test("excluded former-provider follow-up cannot become a false verified consultation miss", () => {
  const partial: LocalSnapshot = { id: "partial", kind: "attendance", importedAt: "2026-02-20T00:00:00Z", coverageStart: treatment.serviceDate, coverageEnd: treatment.serviceDate, sourceHash: "partial", rows: [treatment] };
  const raw = [complete("current", [consult]), partial];
  const before = structuredClone(raw);
  const coverage = completeReportCoverage(raw, [{ id: 1, label: "Current" }, { id: 2, label: "Former" }], "2026-02-20");
  const result = summarizeConsultConversions(coverage.eligibleSnapshots, {}, "2026-01-01", "2026-01-31", "2026-02-20", [], { cohortClinicianNames: ["Current"], excludedFollowUpEvidence: [treatment] });
  assert.equal(result.practice.converted, 0);
  assert.equal(result.practice.missed, 0);
  assert.equal(result.practice.pending, 1);
  assert.equal(result.practice.conversionRate, null);
  assert.equal(result.journeys[0].coverageVerified, false);
  const replaced = completeReportCoverage([...raw, complete("former-full", [treatment])], [{ id: 1, label: "Current" }, { id: 2, label: "Former" }], "2026-02-20");
  const confirmed = summarizeConsultConversions(replaced.eligibleSnapshots, {}, "2026-01-01", "2026-01-31", "2026-02-20", [], { cohortClinicianNames: ["Current"], excludedFollowUpEvidence: [treatment] });
  assert.equal(confirmed.practice.converted, 1);
  assert.equal(confirmed.practice.missed, 0);
  assert.equal(confirmed.practice.conversionRate, 100);
  assert.deepEqual(raw, before);
});

test("complete quiet provider periods retain follow-up maturity without inventing visit rows", () => {
  const raw = [complete("quiet", [consult])];
  const before = structuredClone(raw);
  const coverage = completeReportCoverage(raw, [{ id: 1, label: "Current" }], "2026-02-20");
  assert.equal(coverage.eligibleSnapshots.reduce((sum, snapshot) => sum + snapshot.rows.length, 0), 1);
  const result = summarizeConsultConversions(coverage.eligibleSnapshots, {}, "2026-01-01", "2026-01-31", "2026-02-20", [], { cohortClinicianNames: ["Current"] });
  assert.equal(result.practice.pending, 0);
  assert.equal(result.practice.missed, 1);
  assert.equal(result.journeys[0].coverageVerified, true);
  assert.deepEqual(raw, before);
});
