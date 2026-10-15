import test from "node:test";
import assert from "node:assert/strict";
import type { BillingRow, LocalSnapshot } from "./retention-local.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";

type BillingSnapshot = Extract<LocalSnapshot, { kind: "billing" }>;
const row = (overrides: Partial<BillingRow> = {}): BillingRow => ({
  clientId: "synthetic-client", clinician: "Synthetic clinician", serviceDate: "2026-09-10",
  totalFeeCharged: 100, billingCode: "90837", sourceRowHash: "synthetic-row", ...overrides,
});
const snapshot = (rows: BillingRow[], id = "synthetic-snapshot"): BillingSnapshot => ({
  id, kind: "billing", importedAt: "2026-10-14T12:00:00Z", sourceHash: id,
  coverageStart: "2026-01-01", coverageEnd: "2026-10-09", rows,
});
function monthSnapshot(month: string, total: number, count: number, through = 28) {
  return snapshot(Array.from({ length: count }, (_, index) => row({
    clientId: `synthetic-${month}-${index}`, sourceRowHash: `synthetic-hash-${month}-${index}`,
    serviceDate: `${month}-${String(index % through + 1).padStart(2, "0")}`,
    totalFeeCharged: index === count - 1 ? total - (count - 1) * 100 : 100,
    billingCode: index === count - 1 ? "PHONE" : "90837",
  })), `synthetic-${month}`);
}

test("reported charges reproduce specified monthly totals and row counts, separating October partial charges", () => {
  const snapshots = [
    ...[33035, 31370, 37480, 31655, 31927.5, 32261.5].map((total, index) => monthSnapshot(`2026-${String(index + 1).padStart(2, "0")}`, total, 1)),
    monthSnapshot("2026-07", 30810, 221), monthSnapshot("2026-08", 33310, 239),
    monthSnapshot("2026-09", 32850, 225), monthSnapshot("2026-10", 11440, 73, 9),
  ];
  const before = structuredClone(snapshots);
  const result = summarizeReportedBilling(snapshots, "2026-10-14");
  for (const [month, total, count] of [["2026-07", 30810, 221], ["2026-08", 33310, 239], ["2026-09", 32850, 225]] as const) {
    const found = result.months.find((item) => item.month === month)!;
    assert.equal(found.charges, total);
    assert.equal(found.rowCount, count);
    assert.equal(found.rawRowCount, count);
    assert.equal(found.duplicateRowCount, 0);
    assert.equal(found.coverage, "reported-rows-only");
  }
  assert.deepEqual(result.latestThreeMonthAverage.months, ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(result.latestThreeMonthAverage.monthLabels, ["July 2026", "August 2026", "September 2026"]);
  assert.equal(result.latestThreeMonthAverage.denominator, 3);
  assert.equal(result.latestThreeMonthAverage.averageMonthlyCharges, 96970 / 3);
  assert.equal(result.elapsedReportedMonthAverage.denominator, 9);
  assert.equal(result.elapsedReportedMonthAverage.averageMonthlyCharges, 294699 / 9);
  assert.equal(result.currentMonth.chargesToDate, 11440);
  assert.equal(result.currentMonth.rowCount, 73);
  assert.equal(result.currentMonth.through, "2026-10-09");
  assert.equal(result.latestServiceDate, "2026-10-09");
  assert.match(result.currentMonth.label, /October 2026 charged fees to date, not cash/);
  assert.equal(result.months.at(-1)!.fullyElapsed, false);
  assert.equal(result.evidence.duplicateRowCount, 0);
  assert.equal(result.evidence.conflictingHashCount, 0);
  assert.equal(result.evidence.coverageVerified, false);
  assert.deepEqual(snapshots, before);
});

test("identical hashes deduplicate across snapshots and input order without dropping PHONE fees or signed adjustments", () => {
  const rows = [row(), row({ sourceRowHash: "phone", billingCode: "PHONE", visitKind: "consultation", totalFeeCharged: 75 }),
    row({ clientId: "synthetic-credit-encounter", sourceRowHash: "credit", totalFeeCharged: -25 }), row({ clientId: "synthetic-zero-encounter", sourceRowHash: "zero", totalFeeCharged: 0 })];
  const first = snapshot(rows), repeated = snapshot(structuredClone(rows), "repeat");
  const result = summarizeReportedBilling([first, repeated], "2026-10-14");
  assert.equal(result.months[0].charges, 150);
  assert.equal(result.months[0].rowCount, 4);
  assert.equal(result.evidence.rawRowCount, 8);
  assert.equal(result.evidence.uniqueRowCount, 4);
  assert.equal(result.evidence.duplicateRowCount, 4);
  assert.equal(result.evidence.conflictingHashCount, 0);
  assert.deepEqual(summarizeReportedBilling([repeated, first], "2026-10-14"), result);
});

test("a conflicting hash makes every affected month's charges unknown rather than choosing a payload", () => {
  const snapshots = [snapshot([row()]), snapshot([row({ serviceDate: "2026-08-10", totalFeeCharged: 125 })], "conflict")];
  const result = summarizeReportedBilling(snapshots, "2026-10-14");
  assert.deepEqual(result.months.map((month) => month.charges), [null, null]);
  assert.equal(result.evidence.conflictingHashCount, 1);
  assert.equal(result.evidence.uniqueRowCount, 1);
  assert.equal(result.evidence.duplicateRowCount, 1);
  assert.equal(result.latestThreeMonthAverage.averageMonthlyCharges, null);
  assert.equal(result.latestThreeMonthAverage.denominator, 2);
  assert.deepEqual(summarizeReportedBilling([...snapshots].reverse(), "2026-10-14"), result);
  const sameMonth = summarizeReportedBilling([snapshot([row(), row({ totalFeeCharged: 125 })])], "2026-10-14");
  assert.equal(sameMonth.months[0].charges, null);
});

test("nonfinite fees invalidate the affected aggregate and average, never becoming zero or selecting older good months", () => {
  for (const badFee of [NaN, Infinity, -Infinity, null]) {
    const snapshots = [monthSnapshot("2026-06", 100, 1), monthSnapshot("2026-07", 200, 1),
      monthSnapshot("2026-08", 300, 1), snapshot([row({ totalFeeCharged: badFee as number })])];
    const result = summarizeReportedBilling(snapshots, "2026-10-14");
    assert.equal(result.months.at(-1)!.charges, null);
    assert.equal(result.evidence.invalidFeeRowCount, 1);
    assert.deepEqual(result.latestThreeMonthAverage.months, ["2026-07", "2026-08", "2026-09"]);
    assert.equal(result.latestThreeMonthAverage.averageMonthlyCharges, null);
  }
});

test("only reported elapsed months form the denominator; missing months and empty imports are not zeros", () => {
  const snapshots = [monthSnapshot("2026-05", 100, 1), monthSnapshot("2026-09", 300, 1), monthSnapshot("2026-10", 900, 1)];
  const result = summarizeReportedBilling(snapshots, "2026-10-14");
  assert.deepEqual(result.latestThreeMonthAverage.months, ["2026-05", "2026-09"]);
  assert.equal(result.latestThreeMonthAverage.denominator, 2);
  assert.equal(result.latestThreeMonthAverage.averageMonthlyCharges, 200);
  assert.match(result.latestThreeMonthAverage.label, /May 2026, September 2026; denominator 2 reported months/);
  assert.ok(result.months.every((month) => month.coverage === "reported-rows-only"));
  const empty = summarizeReportedBilling([snapshot([])], "2026-10-14");
  assert.deepEqual(empty.months, []);
  assert.equal(empty.latestThreeMonthAverage.denominator, 0);
  assert.equal(empty.latestThreeMonthAverage.averageMonthlyCharges, null);
  assert.equal(empty.currentMonth.chargesToDate, null);
  assert.equal(empty.currentMonth.through, null);
  const zero = summarizeReportedBilling([monthSnapshot("2026-09", 0, 1)], "2026-10-14");
  assert.equal(zero.latestThreeMonthAverage.averageMonthlyCharges, 0);
});

test("clinician scope is exact after whitespace/case normalization and hash conflicts cannot hide across scopes", () => {
  const rows = [row(), row({ clinician: "Other clinician", sourceRowHash: "other", totalFeeCharged: 200 })];
  const result = summarizeReportedBilling([snapshot(rows)], "2026-10-14", { clinicianLabel: " SYNTHETIC   CLINICIAN " });
  assert.equal(result.months[0].charges, 100);
  assert.equal(result.evidence.rawRowCount, 1);
  const conflicting = summarizeReportedBilling([snapshot([row(), row({ clinician: "Other clinician" })])], "2026-10-14", { clinicianLabel: "Synthetic clinician" });
  assert.equal(conflicting.months[0].charges, null);
  assert.equal(conflicting.evidence.conflictingHashCount, 1);
  assert.throws(() => summarizeReportedBilling([], "2026-10-14", { clinicianLabel: " " }), /must not be blank/);
});

test("invalid dates and absent hashes expose uncertainty; future service rows are excluded as of the selected day", () => {
  const snapshots = [snapshot([row(), row({ serviceDate: "2026-02-30", sourceRowHash: "bad-date" }),
    row({ serviceDate: "2026-10-20", sourceRowHash: "future", totalFeeCharged: 900 })])];
  const result = summarizeReportedBilling(snapshots, "2026-10-14");
  assert.equal(result.evidence.invalidDateRowCount, 1);
  assert.equal(result.evidence.futureDatedRowCount, 1);
  assert.equal(result.latestThreeMonthAverage.averageMonthlyCharges, null);
  assert.equal(result.currentMonth.chargesToDate, null);
  assert.equal(result.latestServiceDate, "2026-09-10");
  const missingHash = summarizeReportedBilling([snapshot([row({ sourceRowHash: " " })])], "2026-10-14");
  assert.equal(missingHash.months[0].charges, null);
  assert.equal(missingHash.evidence.missingHashRowCount, 1);
  for (const date of ["2026-02-30", "2026-13-01", "not-a-date"])
    assert.throws(() => summarizeReportedBilling([], date), /valid as-of/);
});

test("output contains aggregates only and frozen input rows are never changed", () => {
  const rows = [row({ clientId: "synthetic-private-client", clinician: "synthetic-private-provider", sourceRowHash: "synthetic-private-hash" })];
  const snapshots = [snapshot(rows)];
  Object.freeze(rows[0]); Object.freeze(rows); Object.freeze(snapshots[0]); Object.freeze(snapshots);
  const result = summarizeReportedBilling(snapshots, "2026-10-14");
  assert.equal(result.months[0].charges, 100);
  const encoded = JSON.stringify(result);
  for (const privateValue of ["synthetic-private-client", "synthetic-private-provider", "synthetic-private-hash", "clientId", "sourceRowHash"])
    assert.equal(encoded.includes(privateValue), false);
});

test("inclusive dates and team labels are applied after global encounter/hash reconciliation", () => {
  const snapshots = [snapshot([row(), row({ sourceRowHash: "unrelated", clinician: "Other", serviceDate: "2026-09-20", totalFeeCharged: 200 })]), snapshot([row({ serviceDate: "2026-08-10", clinician: "Other", totalFeeCharged: 125 })], "conflicting-export")];
  const result = summarizeReportedBilling(snapshots, "2026-10-14", { start: "2026-09-10", end: "2026-09-10", clinicianLabels: [" SYNTHETIC  CLINICIAN "] });
  assert.equal(result.months.length, 1);
  assert.equal(result.months[0].charges, null, "an out-of-range/provider conflicting hash still invalidates its selected counterpart");
  assert.equal(result.evidence.conflictingHashCount, 1);
  assert.equal(result.evidence.rawRowCount, 1);
  assert.deepEqual(summarizeReportedBilling(snapshots, "2026-10-14", { clinicianLabels: [] }).months, []);
  const healthy = summarizeReportedBilling([snapshot([row(), row({ clientId: "other-date", sourceRowHash: "different", serviceDate: "2026-09-11", totalFeeCharged: 300 })])], "2026-10-14", { start: "2026-09-10", end: "2026-09-10", clinicianLabels: ["Synthetic clinician"] });
  assert.equal(healthy.months[0].charges, 100);
  assert.equal(healthy.evidence.rawRowCount, 1);
  assert.throws(() => summarizeReportedBilling([], "2026-10-14", { start: "2026-10-15", end: "2026-10-14" }), /ordered calendar dates/);
});
