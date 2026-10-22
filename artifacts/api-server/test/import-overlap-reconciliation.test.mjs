import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Bundle only pure code and pin workspace resolution to this checkout (node_modules may be shared).
const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/import-overlap-reconciliation.ts", import.meta.url))],
  alias: { "@workspace/practice/hub": fileURLToPath(new URL("../../../lib/practice/src/hub/index.ts", import.meta.url)) },
  bundle: true, write: false, platform: "node", format: "cjs",
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiled, compiled.exports, require);
const { assessAutomaticOverlap, overlapReviewMessage, sameSourceCoverageChanged } = compiled.exports;

const attendance = (patch = {}) => ({ clientId: "synthetic-a", clinician: "Synthetic Provider", serviceDate: "2026-10-01",
  sourceRowHash: "att-a", status: "show", location: "Synthetic Room", ...patch });
const billing = (patch = {}) => ({ clientId: "synthetic-a", clinician: "Synthetic Provider", serviceDate: "2026-10-01",
  sourceRowHash: "bill-a", billingCode: "90837", totalFeeCharged: 120, ...patch });
const source = (kind, rows, patch = {}) => ({ kind, rows, sourceHash: "source-a", coverageStart: "2026-10-01", coverageEnd: "2026-10-07", ...patch });
const provider = label => label.trim().toLowerCase() === "synthetic provider";
const assess = (active, incoming) => assessAutomaticOverlap(active, incoming, provider);
const proof = { start: "2026-10-01", end: "2026-10-07", complete: true };

test("rolling sources retain exact repeated facts and new encounters without mutating raw evidence or exclusions", () => {
  const active = [source("attendance", [attendance()]), source("billing", [billing()])];
  const incoming = [source("attendance", [attendance({ sourceRowHash: "att-reordered" }), attendance({ clientId: "synthetic-b", serviceDate: "2026-10-08", sourceRowHash: "att-new" })], { sourceHash: "source-b", coverageEnd: "2026-10-08" }),
    source("billing", [billing({ clientId: "synthetic-b", serviceDate: "2026-10-08", sourceRowHash: "bill-new" })], { sourceHash: "source-b", coverageEnd: "2026-10-08" })];
  const exclusions = { billingCodeMinutes: { "90837": 50 }, sameDayVisitOverrides: { synthetic: 2 } };
  const before = structuredClone({ active, incoming, exclusions });
  assert.deepEqual(assess(active, incoming), { safe: true });
  assert.deepEqual(assess([...active].reverse(), [...incoming].reverse()), { safe: true });
  assert.deepEqual({ active, incoming, exclusions }, before);
});

test("same-source changed complete or observed coverage always requires review", () => {
  const active = [source("attendance", [attendance()], { reportCoverage: proof })];
  for (const patch of [{ reportCoverage: null }, { reportCoverage: { ...proof, end: "2026-10-14" } }, { coverageStart: "2026-09-30", reportCoverage: proof }]) {
    const incoming = [source("attendance", [attendance()], patch)];
    assert.equal(sameSourceCoverageChanged(active, incoming), true);
    assert.equal(assess(active, incoming).reason, "same-source-coverage");
  }
  assert.equal(sameSourceCoverageChanged(active, structuredClone(active)), false);
});

test("attendance status, cancellation detail, location and service changes never choose a winner", () => {
  for (const patch of [{ status: "cancelled" }, { cancellationSubtype: "late_cancelled" }, { location: "Other Room" }, { billingCode: "PHONE" }, { visitKind: "consultation" }]) {
    const active = [source("attendance", [attendance()])];
    const incoming = [source("attendance", [attendance({ ...patch, sourceRowHash: "changed" })], { sourceHash: "source-b" })];
    assert.equal(assess(active, incoming).reason, "attendance-fact-conflict");
    assert.equal(assess(incoming, active).safe, false);
  }
});

test("attendance multiplicity, missing identity, unresolved aliases and hash collisions stay exceptions", () => {
  const previous = source("attendance", [attendance()]);
  assert.equal(assess([previous], [source("attendance", [attendance(), attendance({ sourceRowHash: "second" })], { sourceHash: "b" })]).reason, "attendance-multiplicity");
  for (const patch of [{ clientId: "" }, { clinician: "Alias" }, { sourceRowHash: "" }])
    assert.equal(assess([previous], [source("attendance", [attendance(patch)], { sourceHash: "b" })]).reason, "identity-review");
  assert.equal(assess([previous], [source("attendance", [attendance({ clientId: "other" })], { sourceHash: "b" })]).reason, "row-hash-conflict");
});

test("billing uses existing evidence reconciliation for changed charges, multiplicity and missing-code ambiguity", () => {
  for (const [oldRows, newRows] of [
    [[billing()], [billing({ totalFeeCharged: 130, sourceRowHash: "changed" })]],
    [[billing()], [billing(), billing({ sourceRowHash: "second" })]],
    [[billing({ billingCode: null })], [billing({ billingCode: null, sourceRowHash: "new" })]],
    [[billing()], [billing({ clientId: "other" })]],
  ]) assert.equal(assess([source("billing", oldRows)], [source("billing", newRows, { sourceHash: "b" })]).safe, false);
});

test("exact billing/non-show copies retain automatically while saved show overrides remain protected", () => {
  assert.deepEqual(assess([source("billing", [billing()])], [source("billing", [billing({ sourceRowHash: "repeat" })], { sourceHash: "b" })]), { safe: true });
  const active = [source("attendance", [attendance()])];
  const incoming = [source("attendance", [attendance({ sourceRowHash: "repeat" })], { sourceHash: "b" })];
  assert.equal(assessAutomaticOverlap(active, incoming, provider, () => true).reason, "attendance-derived-count-review");
  assert.equal(assess([source("attendance", [attendance({ status: "cancelled" })])],
    [source("attendance", [attendance({ status: "cancelled", sourceRowHash: "repeat" })], { sourceHash: "b" })]).safe, true);
});

test("complete report omissions conflict in either direction; observed spans do not assert completeness", () => {
  const old = source("attendance", [attendance()], { reportCoverage: proof });
  const added = source("attendance", [attendance({ clientId: "synthetic-b", sourceRowHash: "b" })], { sourceHash: "b" });
  assert.equal(assess([old], [added]).reason, "complete-coverage-conflict");
  assert.equal(assess([added], [old]).reason, "complete-coverage-conflict");
  assert.equal(assess([{ ...old, reportCoverage: null }], [added]).safe, true);
  assert.equal(assess([old], [{ ...added, rows: [attendance({ serviceDate: "2026-10-08", sourceRowHash: "b" })], coverageEnd: "2026-10-08" }]).safe, true);
});

test("compatible complete rolling reports retain visit-free endpoints without creating coverage", () => {
  const old = source("attendance", [attendance()], { reportCoverage: proof });
  const added = source("attendance", [attendance({ sourceRowHash: "repeated" }), attendance({ serviceDate: "2026-10-08", sourceRowHash: "new" })],
    { sourceHash: "b", coverageEnd: "2026-10-08", reportCoverage: { ...proof, end: "2026-10-14" } });
  assert.equal(assess([old], [added]).safe, true);
});

test("unrelated historical exceptions do not block safe encounters; bounded admission defers oversized history", () => {
  const old = source("billing", [billing({ totalFeeCharged: 1 }), billing({ totalFeeCharged: 2, sourceRowHash: "two" })]);
  const added = source("billing", [billing({ clientId: "synthetic-b", sourceRowHash: "new" })], { sourceHash: "b" });
  assert.equal(assess([old], [added]).safe, true);
  assert.equal(assess(Array.from({ length: 1001 }, () => old), [added]).reason, "automatic-review-limit");
});

test("partial sources may safely retain but never gain complete-report proof", () => {
  const active = [source("attendance", [attendance()], { reportCoverage: null })];
  const incoming = [source("attendance", [attendance({ sourceRowHash: "copy" }), attendance({ clientId: "new", sourceRowHash: "new" })], { sourceHash: "b" })];
  const before = structuredClone({ active, incoming });
  assert.deepEqual(assess(active, incoming), { safe: true });
  assert.deepEqual({ active, incoming }, before);
  assert.equal(active[0].reportCoverage, null);
  assert.equal(incoming[0].reportCoverage, undefined);
});

test("new cross-kind counterparts and changed service codes require classification review", () => {
  assert.equal(assess([source("attendance", [attendance()])], [source("billing", [billing({ billingCode: "PHONE" })])]).reason, "cross-kind-classification-review");
  assert.equal(assess([source("billing", [billing()])], [source("billing", [billing({ billingCode: "90834", sourceRowHash: "changed" })], { sourceHash: "b" })]).reason, "billing-evidence-review");
});

test("overlap messages provide actionable text for clients displaying only error", () => {
  for (const reason of ["identity-review", "attendance-multiplicity", "attendance-fact-conflict", "attendance-derived-count-review", "billing-evidence-review", "cross-kind-classification-review", "complete-coverage-conflict", "automatic-review-limit"])
    assert.match(overlapReviewMessage(reason), /[Rr]eview|[Rr]esolve|Compare/);
  assert.match(overlapReviewMessage("row-hash-conflict"), /Compare/);
  assert.match(overlapReviewMessage("same-source-coverage"), /Confirm/);
});

test("complete-report contradictions outside observed spans require review in either import order", () => {
  const old = source("attendance", [attendance()], { coverageEnd: "2026-10-01",
    reportCoverage: { start: "2026-10-01", end: "2026-10-31", complete: true } });
  const added = source("attendance", [attendance({ serviceDate: "2026-10-15", sourceRowHash: "new" })],
    { sourceHash: "b", coverageStart: "2026-10-15", coverageEnd: "2026-10-15" });
  assert.equal(old.coverageEnd < added.coverageStart, true);
  assert.equal(assess([old], [added]).reason, "complete-coverage-conflict");
  assert.equal(assess([added], [old]).reason, "complete-coverage-conflict");
  assert.deepEqual(assess([{ ...old, reportCoverage: null }], [added]), { safe: true });
});

test("saved aliases defer before raw-label encounter filtering, including coverage-only scope", () => {
  const identities = new Map([["saved alias", 1], ["synthetic provider", 1], ["unrelated provider", 2]]);
  const resolve = label => identities.get(label.trim().toLowerCase()) ?? null;
  const old = source("attendance", [attendance({ clinician: "Saved Alias" })]);
  const added = source("attendance", [attendance({ status: "cancelled", sourceRowHash: "new" })], { sourceHash: "b" });
  assert.equal(assessAutomaticOverlap([old], [added], provider, undefined, resolve).reason, "identity-review");
  assert.equal(assessAutomaticOverlap([added], [old], provider, undefined, resolve).reason, "identity-review");
  const later = { ...added, rows: [attendance({ serviceDate: "2026-10-15", sourceRowHash: "later" })],
    coverageStart: "2026-10-15", coverageEnd: "2026-10-15" };
  const complete = { ...old, coverageEnd: "2026-10-01", reportCoverage: { start: "2026-10-01", end: "2026-10-31", complete: true } };
  assert.equal(assessAutomaticOverlap([complete], [later], provider, undefined, resolve).reason, "identity-review");
  const unrelated = source("attendance", [attendance({ clinician: "Unrelated Provider" })]);
  assert.deepEqual(assessAutomaticOverlap([unrelated], [later], provider, undefined, resolve), { safe: true });
});
