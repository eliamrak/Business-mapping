import { test } from "node:test";
import assert from "node:assert/strict";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import type { LocalSnapshot } from "./retention-local.ts";
import { summarizeConsultConversions } from "./retention-local.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";

const clinicians = [{ id: 1, label: "Current" }, { id: 2, label: "Former" }];

test("global identity ambiguity survives reporting scope while unrelated unique providers need no reports", () => {
  const selected = [clinicians[0]];
  const snapshots = [snapshot("attendance", "2026-09-24", "2026-10-21"), snapshot("billing", "2026-09-24", "2026-10-21")];
  const before = structuredClone(snapshots);
  const global = [...selected, { id: 99, label: " current " }, clinicians[1]];
  const ambiguous = completeReportCoverage(snapshots, selected, "2026-10-22", global);
  assert.equal(ambiguous.dataThrough, null);
  assert.equal(ambiguous.attendanceThrough, null);
  assert.equal(ambiguous.billingThrough, null);
  assert.deepEqual(ambiguous.eligibleSnapshots, []);
  assert.deepEqual(ambiguous.eligibleAttendanceRows, []);
  assert.deepEqual(ambiguous.eligibleBillingRows, []);
  assert.equal(ambiguous.excludedRowsCount, 2);
  assert.ok(ambiguous.incompletePeriods.every((row) => row.clinicianId === undefined || row.clinicianId === 1), "Other identities do not become reporting requirements");
  const unique = completeReportCoverage(snapshots, selected, "2026-10-22", [...selected, clinicians[1], { ...selected[0] }]);
  assert.equal(unique.dataThrough, "2026-10-21", "Unrelated provider and repeated same ID cannot invalidate unique selected identity");
  assert.deepEqual(unique.completeAttendanceCoverage.map((row) => row.clinicianId), [1, 1]);
  assert.deepEqual(snapshots, before);
});
function snapshot(kind: "attendance" | "billing", start: string, end: string, dates = [start], clinician = "Current"): LocalSnapshot {
  const base = { id: `${kind}:${start}:${end}:${clinician}`, importedAt: "2026-10-30T12:00:00Z", sourceHash: "synthetic",
    coverageStart: start, coverageEnd: end, reportCoverage: { start, end, complete: true as const } };
  return kind === "attendance" ? { ...base, kind, rows: dates.map((serviceDate, index) => ({
    clientId: `synthetic-${index}`, clinician, serviceDate, location: null, status: "show", sourceRowHash: `${serviceDate}:${index}`,
  })) } : { ...base, kind, rows: dates.map((serviceDate, index) => ({
    clientId: `synthetic-${index}`, clinician, serviceDate, billingCode: "90837", totalFeeCharged: 100, sourceRowHash: `${serviceDate}:${index}`,
  })) };
}

test("observed min/max and upload dates cannot establish complete periods without explicit valid proof", () => {
  const missing = snapshot("attendance", "2026-09-24", "2026-10-07");
  delete missing.reportCoverage;
  for (const proof of [undefined, { start: "2026-09-24", end: "2026-10-07", complete: false },
    { start: "2026-02-30", end: "2026-10-07", complete: true },
    { start: "2026-10-07", end: "2026-09-24", complete: true }]) {
    const source = { ...missing, reportCoverage: proof } as LocalSnapshot;
    const result = completeReportCoverage([source], [clinicians[0]], "2026-10-14");
    assert.deepEqual(result.eligibleSnapshots, []);
    assert.deepEqual(result.completeAttendanceCoverage, []);
    assert.equal(result.attendanceThrough, null);
    assert.equal(result.dataThrough, null);
    assert.equal(result.excludedRowsCount, 1);
    assert.match(result.incompletePeriods[0].reason, /Missing or invalid/);
  }
});

test("unfinished Oct 8-21 rows stay reconciliation-only and proof is clipped to the last completed Oct 7 period", () => {
  const snapshots = [snapshot("attendance", "2026-09-24", "2026-10-21", ["2026-10-01", "2026-10-09"]),
    snapshot("billing", "2026-09-24", "2026-10-21", ["2026-10-01", "2026-10-09"])];
  const before = structuredClone(snapshots);
  const result = completeReportCoverage(snapshots, [clinicians[0]], "2026-10-14");
  assert.equal(result.dataThrough, "2026-10-07");
  assert.equal(result.excludedRowsCount, 2);
  assert.deepEqual(result.completeAttendanceCoverage, [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-07" }]);
  assert.deepEqual(result.completeBillingCoverage, result.completeAttendanceCoverage);
  assert.ok(result.eligibleSnapshots.every((source) => source.reportCoverage?.end === "2026-10-07" && source.coverageEnd === "2026-10-07"));
  assert.deepEqual(result.eligibleSnapshots.flatMap((source) => source.rows.map((row) => row.serviceDate)), ["2026-10-01", "2026-10-01"]);
  assert.ok(result.incompletePeriods.some((period) => period.start === "2026-10-08" && period.end === "2026-10-21" && /not ended/.test(period.reason)));
  assert.ok(result.incompletePeriods.some((period) => period.clinicianId === 1 && period.clinicianLabel === "Current"));
  result.eligibleSnapshots[0].rows[0].clinician = "Changed derived copy";
  assert.deepEqual(snapshots, before);
});

test("later complete replacement extends eligibility without rewriting the earlier snapshot", () => {
  const earlier = snapshot("attendance", "2026-09-24", "2026-10-07");
  const later = snapshot("attendance", "2026-09-24", "2026-10-21", ["2026-10-09"]);
  const before = structuredClone([earlier, later]);
  assert.equal(completeReportCoverage([earlier], [clinicians[0]], "2026-10-22").attendanceThrough, "2026-10-07");
  const extended = completeReportCoverage([earlier, later], [clinicians[0]], "2026-10-22");
  assert.equal(extended.attendanceThrough, "2026-10-21");
  assert.equal(extended.dataThrough, null, "Attendance proof does not invent billing coverage");
  assert.equal(extended.excludedRowsCount, 0);
  assert.deepEqual([earlier, later], before);
});

test("adjacent partial declarations cannot combine; only a full individual report admits its own rows", () => {
  const first = snapshot("attendance", "2026-09-24", "2026-09-30");
  const adjacent = snapshot("attendance", "2026-10-01", "2026-10-07");
  const partial = completeReportCoverage([first, adjacent], [clinicians[0]], "2026-10-14");
  assert.equal(partial.attendanceThrough, null);
  assert.deepEqual(partial.eligibleSnapshots, []);
  assert.deepEqual(partial.eligibleAttendanceRows, []);
  assert.equal(partial.excludedRowsCount, 2);
  const full = snapshot("attendance", "2026-09-24", "2026-10-07", ["2026-10-02"]);
  const before = structuredClone([first, adjacent, full]);
  const complete = completeReportCoverage([first, adjacent, full], [clinicians[0]], "2026-10-14");
  assert.equal(complete.attendanceThrough, "2026-10-07");
  assert.equal(complete.eligibleSnapshots.length, 1);
  assert.deepEqual(complete.eligibleAttendanceRows, full.rows);
  assert.equal(complete.eligibleAttendanceRows[0], full.rows[0]);
  assert.equal(complete.excludedRowsCount, 2);
  assert.deepEqual([first, adjacent, full], before);
  const gap = completeReportCoverage([first, snapshot("attendance", "2026-10-02", "2026-10-07")], [clinicians[0]], "2026-10-14");
  assert.equal(gap.attendanceThrough, null);
  assert.equal(gap.excludedRowsCount, 2);
  assert.ok(gap.incompletePeriods.some((period) => /gap or partial/.test(period.reason)));
});

test("partial billing fees remain raw even after an enclosing full report is admitted", () => {
  const first = snapshot("billing", "2026-09-24", "2026-09-30", ["2026-09-25"]);
  const second = snapshot("billing", "2026-10-01", "2026-10-07", ["2026-10-02"]);
  const full = snapshot("billing", "2026-09-24", "2026-10-07", ["2026-09-25", "2026-10-02"]);
  if (first.kind === "billing") first.rows[0].totalFeeCharged = 999;
  const before = structuredClone([first, second, full]);
  const result = completeReportCoverage([first, second, full], [clinicians[0]], "2026-10-14");
  assert.equal(result.billingThrough, "2026-10-07");
  assert.equal(result.eligibleBillingRows.length, 2);
  assert.equal(result.eligibleBillingRows[0], full.rows[0]);
  assert.equal(result.eligibleBillingRows[1], full.rows[1]);
  assert.equal(result.eligibleBillingRows.reduce((sum, row) => sum + row.totalFeeCharged, 0), 200);
  assert.equal(result.excludedRowsCount, 2);
  assert.equal(result.eligibleSnapshots.length, 1);
  assert.deepEqual([first, second, full], before);
});

test("provider scope is not inferred from absent rows; ambiguous names and other-provider proof cannot certify zero", () => {
  const current = snapshot("attendance", "2026-09-24", "2026-10-07");
  const result = completeReportCoverage([current], clinicians, "2026-10-14");
  assert.equal(result.attendanceThrough, null, "The supplied former provider has no proof");
  assert.equal(result.completeAttendanceCoverage.length, 1);
  assert.equal(result.completeAttendanceCoverage[0].clinicianId, 1);
  assert.ok(result.limits.some((limit) => /no provider roster/.test(limit)));
  const ambiguous = completeReportCoverage([current], [...clinicians, { id: 3, label: " current " }], "2026-10-14");
  assert.deepEqual(ambiguous.eligibleSnapshots, []);
  assert.equal(ambiguous.excludedRowsCount, 1);
  const empty = snapshot("attendance", "2026-09-24", "2026-10-07", []);
  assert.deepEqual(completeReportCoverage([empty], clinicians, "2026-10-14").completeAttendanceCoverage, []);
});

test("former clinicians' qualifying follow-up treatment remains eligible, with per-kind common dated readouts", () => {
  const snapshots = [snapshot("attendance", "2026-09-24", "2026-10-07", ["2026-09-25"]),
    snapshot("attendance", "2026-09-24", "2026-10-07", ["2026-10-01"], "Former"),
    snapshot("billing", "2026-09-10", "2026-09-23"), snapshot("billing", "2026-09-10", "2026-09-23", ["2026-09-12"], "Former")];
  const result = completeReportCoverage(snapshots, clinicians, "2026-10-14");
  assert.equal(result.attendanceThrough, "2026-10-07");
  assert.equal(result.billingThrough, "2026-09-23");
  assert.equal(result.dataThrough, "2026-09-23");
  assert.ok(result.eligibleSnapshots.some((source) => source.kind === "attendance" && source.rows.some((row) => row.clinician === "Former" && row.serviceDate === "2026-10-01")));
  assert.equal(result.excludedRowsCount, 0);
});

test("eligible consultation counts exclude partial-period consults while retaining former follow-up conversion evidence", () => {
  const current = snapshot("attendance", "2026-09-24", "2026-10-21", ["2026-09-25", "2026-10-09"]);
  if (current.kind === "attendance") current.rows.forEach((row) => { row.visitKind = "consultation"; });
  const former = snapshot("attendance", "2026-09-24", "2026-10-07", ["2026-10-01"], "Former");
  const before = structuredClone([current, former]);
  const coverage = completeReportCoverage([current, former], clinicians, "2026-10-14");
  const consults = summarizeConsultConversions(coverage.eligibleSnapshots, {}, "2026-09-01", "2026-10-14", "2026-10-14", [], { cohortClinicianNames: ["Current"] });
  assert.equal(consults.practice.consultations, 1);
  assert.equal(consults.practice.converted, 1);
  assert.equal(consults.practice.conversionRate, 100);
  assert.equal(consults.journeys[0].treatmentStartClinician, "Former");
  assert.equal(coverage.excludedRowsCount, 1);
  assert.deepEqual([current, former], before);
});

test("eligible row arrays preserve original references, deduplicate repeated references and never admit partial-period rows", () => {
  const billing = snapshot("billing", "2026-09-24", "2026-10-07", ["2026-10-01"]);
  const attendance = snapshot("attendance", "2026-09-24", "2026-10-07", ["2026-10-02"]);
  const partial = snapshot("billing", "2026-10-08", "2026-10-21", ["2026-10-09"]);
  const sources = [billing, billing, attendance, partial];
  const before = structuredClone(sources);
  const result = completeReportCoverage(sources, [clinicians[0]], "2026-10-14");
  assert.equal(result.eligibleBillingRows.length, 1);
  assert.equal(result.eligibleBillingRows[0], billing.rows[0]);
  assert.equal(result.eligibleAttendanceRows.length, 1);
  assert.equal(result.eligibleAttendanceRows[0], attendance.rows[0]);
  assert.equal(result.excludedRowsCount, 1, "Repeated snapshot references cannot multiply excluded raw-row identities");
  const eligible = new Set(result.eligibleBillingRows);
  assert.equal(eligible.has(billing.rows[0] as any), true);
  assert.equal(eligible.has(partial.rows[0] as any), false);
  assert.equal(eligible.has(result.eligibleSnapshots.find((source) => source.kind === "billing")!.rows[0] as any), false,
    "Eligible snapshot rows are still separate derived copies, not suitable for the raw identity filter");
  assert.ok(result.limits.some((limit) => /outside its own source/.test(limit)));
  assert.deepEqual(sources, before);
});

test("any invalid or out-of-range date rejects the entire source proof, not just its bad row", () => {
  for (const kind of ["attendance", "billing"] as const) for (const badDate of ["2026-02-30", "not-a-date", "2026-09-23", "2026-10-08"]) {
    const source = snapshot(kind, "2026-09-24", "2026-10-07", ["2026-10-01", badDate]);
    const before = structuredClone(source);
    const result = completeReportCoverage([source], [clinicians[0]], "2026-10-14");
    assert.deepEqual(result.eligibleSnapshots, []);
    assert.deepEqual(result.eligibleBillingRows, []);
    assert.deepEqual(result.eligibleAttendanceRows, []);
    assert.deepEqual(result.completeAttendanceCoverage, []);
    assert.deepEqual(result.completeBillingCoverage, []);
    assert.equal(result.dataThrough, null);
    assert.equal(result.excludedRowsCount, 2, "The otherwise valid row cannot certify a complete total from a contradictory source");
    assert.ok(result.incompletePeriods.some((period) => period.snapshotId === source.id && /Invalid or contradictory report range/.test(period.reason)));
    const replacement = snapshot(kind, "2026-09-24", "2026-10-07", ["2026-10-01"]);
    const repaired = completeReportCoverage([source, replacement], [clinicians[0]], "2026-10-14");
    const admitted = kind === "billing" ? repaired.eligibleBillingRows : repaired.eligibleAttendanceRows;
    assert.equal(admitted.length, 1);
    assert.equal(admitted[0], replacement.rows[0], "A valid replacement cannot rehabilitate contradictory source rows");
    assert.equal(repaired.excludedRowsCount, 2);
    assert.deepEqual(source, before);
  }
});

test("Imports and Money eligible charge summaries reconcile overlapping full exports including PHONE fees", () => {
  const first = snapshot("billing", "2026-09-24", "2026-10-07", ["2026-10-01"]);
  const overlap = structuredClone(first);
  overlap.id = "synthetic-overlap";
  overlap.rows[0].sourceRowHash = "synthetic-shifted-hash";
  if (overlap.kind === "billing") overlap.rows.push({ ...overlap.rows[0], clientId: "synthetic-phone", billingCode: "PHONE", totalFeeCharged: 25, sourceRowHash: "synthetic-phone-hash" });
  const sources = [first, overlap];
  const before = structuredClone(sources);
  const coverage = completeReportCoverage(sources, [clinicians[0]], "2026-10-14");
  const imports = summarizeReportedBilling(coverage.eligibleSnapshots, "2026-10-14");
  const money = summarizeReportedBilling(sources, "2026-10-14", { eligibleRows: new Set(coverage.eligibleBillingRows) });
  assert.equal(imports.months[0].charges, 125);
  assert.equal(money.months[0].charges, 125);
  assert.equal(coverage.eligibleBillingRows.length, 3, "Source-row counts must not be relabeled as unique visits");
  assert.equal(summarizeReportedBilling(coverage.eligibleSnapshots, "2026-10-14", { clinicianLabel: " current " }).months[0].charges, 125);
  assert.deepEqual(sources, before);
  const conflictingSources = structuredClone(sources);
  if (conflictingSources[1].kind === "billing") conflictingSources[1].rows[0].totalFeeCharged = 120;
  const conflict = completeReportCoverage(conflictingSources, [clinicians[0]], "2026-10-14");
  assert.equal(summarizeReportedBilling(conflict.eligibleSnapshots, "2026-10-14").months[0].charges, null);
  assert.equal(summarizeReportedBilling(conflict.eligibleSnapshots, "2026-10-14", { clinicianLabel: "Current" }).months[0].charges, null);
  assert.deepEqual(sources, before);
});

test("derived scope preserves quiet-period coverage and mature consultation outcomes without synthetic visits", () => {
  const source = snapshot("attendance", "2026-01-01", "2026-02-11", ["2026-01-02", "2026-01-08", "2026-01-02"]);
  assert.ok(source.kind === "attendance");
  source.rows[0].visitKind = "consultation";
  source.rows[1].clientId = source.rows[0].clientId;
  source.rows[2].visitKind = "consultation";
  const before = structuredClone(source);
  const coverage = completeReportCoverage([source], [clinicians[0]], "2026-02-12");
  assert.equal(coverage.eligibleSnapshots.length, 3);
  const quiet = coverage.eligibleSnapshots.filter((item) => item.rows.length === 0);
  assert.equal(quiet.length, 2);
  assert.deepEqual(quiet.map((item) => item.coverageClinicians), [["Current"], ["Current"]]);
  assert.equal(coverage.eligibleSnapshots.reduce((sum, item) => sum + item.rows.length, 0), 3);
  const summary = summarizeConsultConversions(coverage.eligibleSnapshots, {}, "2026-01-01", "2026-01-31", "2026-02-12");
  assert.equal(summary.coverageVerified, true);
  assert.equal(summary.practice.converted, 1);
  assert.equal(summary.practice.missed, 1);
  assert.equal(summary.practice.pending, 0);
  assert.equal(summary.practice.evaluated, 2);
  assert.equal(summary.practice.conversionRate, 50);
  const missingScope = coverage.eligibleSnapshots.map(({ coverageClinicians: _, ...item }) => item as LocalSnapshot);
  const control = summarizeConsultConversions(missingScope, {}, "2026-01-01", "2026-01-31", "2026-02-12");
  assert.equal(control.practice.pending, 1, "A quiet snapshot without derived scope cannot infer a provider");
  assert.equal(control.practice.evaluated, 1);
  assert.deepEqual(source, before);
  assert.equal(Object.hasOwn(source, "coverageClinicians"), false);
});

test("older reports expose trailing closed and current open gaps even with no later rows", () => {
  const source = snapshot("attendance", "2026-09-10", "2026-09-23");
  const result = completeReportCoverage([source], [clinicians[0]], "2026-10-14");
  assert.equal(result.attendanceThrough, "2026-09-23");
  const gaps = result.incompletePeriods.filter((period) => period.kind === "attendance" && period.start !== null);
  assert.deepEqual(gaps.map(({ start, end }) => ({ start, end })), [
    { start: "2026-09-24", end: "2026-10-07" },
    { start: "2026-10-08", end: "2026-10-21" },
  ]);
  assert.match(gaps[0].reason, /No individual/);
  assert.match(gaps[1].reason, /not ended/);
  assert.equal(result.eligibleAttendanceRows.length, 1, "Calendar gap diagnostics create no activity or inferred zeros");
  const full = snapshot("attendance", "2026-09-24", "2026-10-21");
  const replaced = completeReportCoverage([source, full], [clinicians[0]], "2026-10-22");
  assert.equal(replaced.attendanceThrough, "2026-10-21");
  assert.ok(replaced.incompletePeriods.some((period) => period.start === "2026-10-22" && period.end === "2026-11-04"));
  const future = snapshot("attendance", "2026-09-10", "2027-01-27");
  const futureResult = completeReportCoverage([future], [clinicians[0]], "2026-10-14");
  assert.ok(futureResult.incompletePeriods.every((period) => period.start === null || period.start <= "2026-10-14"), "Distant future proof claims cannot displace current gap diagnostics");
});
