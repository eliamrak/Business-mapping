import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalRetentionMetrics,
  buildLocalVisitReconciliation,
  sameDayVisitKey,
  type AttendanceRow,
  type BillingRow,
  type LocalSnapshot,
} from "./retention-local.ts";

const attendance = (patch: Partial<AttendanceRow> = {}): AttendanceRow => ({
  clientId: "synthetic-client", clinician: "Synthetic Provider", serviceDate: "2026-10-01",
  status: "show", location: "Synthetic Room", sourceRowHash: "attendance-row", ...patch,
});
const billing = (patch: Partial<BillingRow> = {}): BillingRow => ({
  clientId: "synthetic-client", clinician: "Synthetic Provider", serviceDate: "2026-10-01",
  billingCode: "90837", totalFeeCharged: 150, sourceRowHash: "billing-row", ...patch,
});
function source(kind: "attendance", id: string, rows: AttendanceRow[]): LocalSnapshot;
function source(kind: "billing", id: string, rows: BillingRow[]): LocalSnapshot;
function source(kind: "attendance" | "billing", id: string, rows: AttendanceRow[] | BillingRow[]): LocalSnapshot {
  return { id, kind, rows, sourceHash: id, importedAt: "2026-10-02T00:00:00Z",
    coverageStart: "2026-10-01", coverageEnd: "2026-10-01" } as LocalSnapshot;
}
const metrics = (snapshots: LocalSnapshot[]) => buildLocalRetentionMetrics(snapshots, { "90837": 60 });

for (const sameHash of [true, false]) test(`exact cross-source billing copies count once, same hash=${sameHash}`, () => {
  const show = source("attendance", "attendance-a", [attendance()]);
  const first = source("billing", "billing-a", [billing()]);
  const repeated = source("billing", "billing-b", [billing({ sourceRowHash: sameHash ? "billing-row" : "reindexed" })]);
  const baseline = metrics([show, first]);
  const snapshots = [show, first, repeated];
  const before = structuredClone(snapshots);
  for (const ordered of [snapshots, [...snapshots].reverse()]) {
    const result = metrics(ordered);
    assert.deepEqual(result.billingByClinician, baseline.billingByClinician);
    assert.equal(result.billingRows, 2, "Raw diagnostics retain both source rows");
    assert.equal(result.billingByClinician[0].billedRows, 1);
    assert.equal(result.billingByClinician[0].totalFeesCharged, 150);
    assert.equal(result.billingByClinician[0].estimatedBillingHours, 1);
    const reconciliation = buildLocalVisitReconciliation(ordered);
    assert.equal(reconciliation.matchedVisits, 1);
    assert.equal(reconciliation.totalMatchedFeesCharged, 150);
    assert.equal(reconciliation.rows[0].billingRows.length, 2, "Review retains raw evidence");
    assert.ok(reconciliation.rows[0].billingRows.includes(first.rows[0] as BillingRow));
    assert.ok(reconciliation.rows[0].billingRows.includes(repeated.rows[0] as BillingRow));
    assert.deepEqual(snapshots, before);
    assert.equal(snapshots.some(snapshot => snapshot.reportCoverage), false);
  }
});

test("billing-only encounter counts and consultation totals use derived exact facts", () => {
  for (const code of ["90837", "30003", "PHONE"]) {
    const snapshots = [source("billing", "a", [billing({ billingCode: code })]),
      source("billing", "b", [billing({ billingCode: code, sourceRowHash: "repeat" })])];
    const result = buildLocalVisitReconciliation(snapshots);
    assert.equal(result.rows[0].billingRows.length, 2);
    assert.equal(result.rows[0].totalFeeCharged, 150);
    assert.equal(result.billingOnlyRows, code === "90837" ? 1 : 0);
  }
});

test("within-source equal/different charges and physical repeated rows preserve multiplicity", () => {
  const show = source("attendance", "show", [attendance()]);
  for (const secondFee of [150, 100]) {
    const charges = source("billing", "bill", [billing(), billing({ totalFeeCharged: secondFee, sourceRowHash: "second-charge" })]);
    const snapshots = [show, charges];
    const before = structuredClone(snapshots);
    assert.equal(metrics(snapshots).billingByClinician[0].totalFeesCharged, 150 + secondFee);
    assert.equal(metrics(snapshots).billingRows, 2);
    assert.equal(metrics(snapshots).billingByClinician[0].billedRows, 2);
    assert.equal(buildLocalVisitReconciliation(snapshots).totalMatchedFeesCharged, 150 + secondFee);
    assert.deepEqual(snapshots, before);
  }
  const row = billing();
  assert.equal(metrics([source("billing", "bill", [row, row])]).billingByClinician[0].billedRows, 2);
  assert.equal(metrics([source("billing", "bill", [row, { ...row }])]).billingByClinician[0].billedRows, 2);
  const repeatedSource = [source("billing", "bill", [row, row]), source("billing", "copy", [{ ...row, sourceRowHash: "copy" }])];
  assert.equal(metrics(repeatedSource).billingByClinician[0].billedRows, 3, "An ambiguous group retains every physical occurrence");
  assert.equal(buildLocalVisitReconciliation(repeatedSource).rows[0].billingRows.length, 3);
});

test("one shared object reference across distinct sources is an exact copy without mutating source arrays", () => {
  const row = billing();
  const snapshots = [source("billing", "a", [row]), source("billing", "b", [row])];
  assert.equal(metrics(snapshots).billingByClinician[0].billedRows, 1);
  assert.equal(metrics(snapshots).billingRows, 2);
  const result = buildLocalVisitReconciliation(snapshots);
  assert.equal(result.rows[0].totalFeeCharged, 150);
  assert.equal(result.rows[0].billingRows.length, 2);
  assert.equal(snapshots[0].rows[0], row);
  assert.equal(snapshots[1].rows[0], row);
});

test("changed facts, hash collisions and missing-code ambiguity are not deduplicated", () => {
  for (const patch of [{ totalFeeCharged: 100 }, { visitKind: "consultation" as const }, { clientId: "different-client", sourceRowHash: "billing-row" }]) {
    const snapshots = [source("billing", "a", [billing()]), source("billing", "b", [billing({ sourceRowHash: "repeat", ...patch })])];
    assert.equal(metrics(snapshots).billingRows, 2);
    assert.equal(metrics(snapshots).billingByClinician[0].billedRows, "visitKind" in patch ? 1 : 2, "Existing consultation exclusion is preserved");
    assert.equal(buildLocalVisitReconciliation(snapshots).rows.reduce((count, row) => count + row.billingRows.length, 0), 2);
  }
  const missingCode = [source("billing", "a", [billing({ billingCode: null })]),
    source("billing", "b", [billing({ billingCode: null, sourceRowHash: "repeat" })])];
  assert.equal(metrics(missingCode).billingByClinician[0].billedRows, 2);
  const conflict = [source("billing", "a", [billing()]), source("billing", "b", [billing({ sourceRowHash: "copy" })]),
    source("billing", "c", [billing({ sourceRowHash: "changed", totalFeeCharged: 100 })])];
  assert.equal(metrics(conflict).billingByClinician[0].billedRows, 3, "Do not hide one fact from a conflicting group");
});

for (const status of ["cancelled", "no show", "clinician cancelled"] as const) test(`exact cross-source ${status} rows count once; raw rows and source order are preserved`, () => {
  const snapshots = [source("attendance", "a", [attendance({ status })]),
    source("attendance", "b", [attendance({ status, sourceRowHash: "repeat" })])];
  const before = structuredClone(snapshots);
  const field = status === "cancelled" ? "clientCancelled" : status === "no show" ? "noShows" : "clinicianCancelled";
  for (const ordered of [snapshots, [...snapshots].reverse()]) {
    const result = metrics(ordered);
    assert.equal(result.attendanceRows, 2);
    assert.equal(result.attendanceByClinician[0][field], 1);
    assert.equal(result.roomCounts[0][field], 1);
    assert.equal(buildLocalVisitReconciliation(ordered).attendanceOnlyRows, 2, "Raw unmatched-row diagnostics remain unchanged");
    assert.equal(buildLocalVisitReconciliation(ordered).rows[0].attendanceRows.length, 2);
    assert.deepEqual(snapshots, before);
  }
});

test("established non-show status dedupe remains unchanged within a source and across detail changes", () => {
  const rows = [attendance({ status: "cancelled" }), attendance({ status: "cancelled", sourceRowHash: "second" })];
  assert.equal(metrics([source("attendance", "a", rows)]).attendanceByClinician[0].clientCancelled, 1);
  assert.equal(metrics([source("attendance", "a", rows)]).attendanceRows, 2);
  for (const patch of [{ location: "Other Room" }, { cancellationSubtype: "late_cancelled" as const }, { billingCode: "90834" }]) {
    const snapshots = [source("attendance", "a", [rows[0]]), source("attendance", "b", [attendance({ status: "cancelled", sourceRowHash: "repeat", ...patch })])];
    assert.equal(metrics(snapshots).attendanceByClinician[0].clientCancelled, 1);
    assert.equal(metrics(snapshots).attendanceRows, 2);
  }
});

test("conflicting attendance outcomes stay excluded; exact dedupe does not choose a status", () => {
  const snapshots = [source("attendance", "a", [attendance({ status: "cancelled" })]),
    source("attendance", "b", [attendance({ sourceRowHash: "show" })])];
  const result = buildLocalVisitReconciliation(snapshots);
  assert.equal(result.rows[0].status, "ambiguous");
  assert.equal(result.rows[0].attendanceRows.length, 2);
  assert.equal(metrics(snapshots).derivedShowVisits, 0);
});

test("same-day show overrides and admitted source selection are unchanged", () => {
  const first = source("attendance", "a", [attendance()]);
  const second = source("attendance", "b", [attendance({ sourceRowHash: "second-show" })]);
  const override = { [sameDayVisitKey(attendance())]: 2 };
  assert.equal(buildLocalRetentionMetrics([first, second], {}, override).derivedShowVisits, 2);
  const billA = source("billing", "bill-a", [billing()]);
  const billB = source("billing", "bill-b", [billing({ sourceRowHash: "selected-copy" })]);
  assert.equal(metrics([billB]).billingByClinician[0].totalFeesCharged, 150);
  assert.equal(metrics([]).billingRows, 0);
  assert.equal(billA.rows.length, 1);
  const derivedCopy = { ...billB, sourceSnapshotId: "bill-a" };
  assert.equal(metrics([billA, derivedCopy]).billingByClinician[0].billedRows, 2, "Clips of one source cannot establish cross-source duplicates");
});
