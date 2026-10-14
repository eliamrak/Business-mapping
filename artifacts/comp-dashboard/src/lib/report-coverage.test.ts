import { test } from "node:test";
import assert from "node:assert/strict";
import { exportLocalBackup, importLocalBackup, importLocalPackage } from "./retention-local.ts";

const packageFor = () => ({
  format: "emc-practice-local-import-package",
  version: 1,
  packageId: "coverage-proof",
  exportedAt: "2026-10-14T12:00:00.000Z",
  collections: {
    attendance: {
      coverageStart: "2026-10-03", coverageEnd: "2026-10-03", rowCount: 1,
      rows: [{ clientId: "random-1", clinician: "Lane", serviceDate: "2026-10-03", location: null, status: "show" }],
    },
    billing: {
      coverageStart: "2026-10-03", coverageEnd: "2026-10-03", rowCount: 1,
      rows: [{ clientId: "random-1", clinician: "Lane", serviceDate: "2026-10-03", totalFeeCharged: 100, billingCode: null }],
    },
  },
});
const proof = { start: "2026-10-01", end: "2026-10-14", complete: true as const };

test("legacy packages and backups leave report completeness unknown", () => {
  const parsed = importLocalPackage(packageFor());
  assert.ok(parsed.snapshots.every((snapshot) => snapshot.reportCoverage == null));
  const restored = importLocalBackup(exportLocalBackup(parsed.snapshots, {}));
  assert.ok(restored.snapshots.every((snapshot) => snapshot.reportCoverage == null));
});

test("declared coverage contains observed dates and survives JSON backup serialization", () => {
  const value = packageFor();
  Object.assign(value.collections.attendance, { reportCoverage: proof });
  const parsed = importLocalPackage(value);
  assert.deepEqual(parsed.snapshots[0].reportCoverage, proof);
  assert.equal(parsed.snapshots[0].coverageStart, "2026-10-03");
  assert.equal(parsed.snapshots[0].coverageEnd, "2026-10-03");
  const restored = importLocalBackup(JSON.parse(JSON.stringify(exportLocalBackup(parsed.snapshots, {}))));
  assert.deepEqual(restored.snapshots[0].reportCoverage, proof);
});

test("invalid, reversed, incomplete, unknown-field and non-containing proof is rejected", () => {
  for (const reportCoverage of [
    { ...proof, start: "2026-02-30" },
    { ...proof, end: "2026-10-00" },
    { ...proof, start: "2026-10-10", end: "2026-10-01" },
    { ...proof, start: "2026-10-04" },
    { ...proof, end: "2026-10-02" },
    { ...proof, complete: false },
    { ...proof, inferred: true },
    null,
  ]) {
    const value = packageFor();
    Object.assign(value.collections.attendance, { reportCoverage });
    assert.throws(() => importLocalPackage(value), /reportCoverage/);
  }
});

test("proof never replaces the legacy observed row span validation", () => {
  const value = packageFor();
  Object.assign(value.collections.attendance, { reportCoverage: proof, coverageStart: proof.start });
  assert.throws(() => importLocalPackage(value), /coverage does not match its rows/);
});
