import test from "node:test";
import assert from "node:assert/strict";
import { prepareBillingChargeResolution, reconcileBillingEvidence } from "../src/hub/billing-evidence.ts";
import { billingChargeResolutionSchema, type BillingChargeResolution } from "../src/hub/billing-resolution.ts";

const row = (amount: number, hash: string) => ({ clientId: "synthetic-key", clinician: "Synthetic clinician", serviceDate: "2026-01-02", billingCode: "90837", visitKind: "treatment", totalFeeCharged: amount, sourceRowHash: hash });
const entries = (amounts = [135, 150]) => amounts.map((amount, i) => ({ row: row(amount, `source-${i}`), snapshotId: "original" }));
function approve(source = entries()): BillingChargeResolution {
  const draft = prepareBillingChargeResolution(source);
  assert.ok(draft);
  return billingChargeResolutionSchema.parse({ ...draft, clinicianId: 1, id: "00000000-0000-4000-8000-000000000001", approvalToken: "a".repeat(64), confirmedAt: "2026-10-16T00:00:00Z", approvalNote: "Synthetic explicit owner approval" });
}

for (const amounts of [[135, 150], [175, 175], [150, 150], [150, 150]]) {
  test(`exact two-charge approval retains ${amounts.join("+")} without editing source`, () => {
    const source = entries(amounts); const before = structuredClone(source);
    assert.equal(reconcileBillingEvidence(source)[0].known, false);
    const result = reconcileBillingEvidence(source, [approve(source)])[0];
    assert.equal(result.known, true); assert.equal(result.acceptedRows?.length, 2);
    assert.equal(result.acceptedRows?.reduce((n, r) => n + r.totalFeeCharged, 0), amounts[0] + amounts[1]);
    assert.equal(result.ambiguous, true); assert.equal(result.duplicateRowCount, 0);
    assert.deepEqual(source, before);
  });
}
test("exact repeated and shifted exports cannot add a third charge", () => {
  for (const amounts of [[135, 150], [175, 175]]) {
    const source = entries(amounts); const resolution = approve(source);
    const repeated = [...source, ...source.map((entry, i) => ({ snapshotId: "reimport", row: { ...entry.row, sourceRowHash: `shifted-${i}` } })), ...source];
    const group = reconcileBillingEvidence(repeated, [resolution])[0];
    assert.equal(group.known, true); assert.equal(group.acceptedRows?.length, 2); assert.equal(group.duplicateRowCount, 4);
  }
});
test("missing anchors, extra same-source charges, new amounts and multiple approvals stay unknown", () => {
  const source = entries([150, 150]); const resolution = approve(source);
  for (const changed of [source.slice(1), source.map((entry) => ({ ...entry, snapshotId: "replacement" })),
    [...source, { snapshotId: "original", row: row(150, "third") }], [...source, { snapshotId: "other", row: row(160, "new-fee") }]]) {
    const group = reconcileBillingEvidence(changed, [resolution])[0];
    assert.equal(group.known, false); assert.equal(group.resolutionStale, true); assert.equal(group.acceptedRows, undefined);
  }
  assert.equal(reconcileBillingEvidence(source, [resolution, { ...resolution, id: "00000000-0000-4000-8000-000000000002" }])[0].known, false);
});
test("approval cannot cross client, provider, date, code or visit kind and hash collisions fail closed", () => {
  const source = entries(); const resolution = approve(source);
  for (const change of [{ clientId: "other" }, { clinician: "Other clinician" }, { serviceDate: "2026-01-03" }, { billingCode: "90834" }, { visitKind: "consultation" }]) {
    const changed = source.map((entry) => ({ ...entry, row: { ...entry.row, ...change } }));
    assert.equal(reconcileBillingEvidence(changed, [resolution])[0].known, false);
    const collision = [...source, changed[0]];
    assert.equal(prepareBillingChargeResolution(collision), null);
    assert.equal(reconcileBillingEvidence(collision, [resolution])[0].known, false);
  }
});
test("PHONE, nonpositive amounts, missing identity and non-pair evidence cannot be approved", () => {
  for (const changed of [entries([0, 150]), entries([-10, 150]), entries([1, 2, 3]), entries([150]),
    entries().map((entry) => ({ ...entry, row: { ...entry.row, billingCode: " PHONE " } })),
    entries().map((entry) => ({ ...entry, row: { ...entry.row, sourceRowHash: "" } }))]) assert.equal(prepareBillingChargeResolution(changed), null);
});
