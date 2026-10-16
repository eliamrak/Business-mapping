#!/usr/bin/env node
import fs from "node:fs";
const importerUrl = new URL("../../../artifacts/comp-dashboard/src/lib/retention-local.ts", import.meta.url);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const packagePath = process.argv[2];
if (!packagePath) fail("usage: actual_importer_roundtrip.mjs PACKAGE_JSON");

const { importLocalPackage, mergeLocalPackage } = await import(
  importerUrl.href
);

const payload = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const imported = importLocalPackage(payload, "2026-10-13T15:00:00.000Z");
if (imported.snapshots.length !== 2) fail("expected attendance and billing snapshots");

const added = mergeLocalPackage([], {}, imported);
if (added.status !== "added") fail(`expected added, got ${added.status}`);

const duplicate = mergeLocalPackage(
  added.snapshots,
  added.billingCodeMinutes,
  imported,
);
if (duplicate.status !== "duplicate")
  fail(`expected duplicate, got ${duplicate.status}`);

const changedPackage = {
  ...structuredClone(payload),
  packageId: `${payload.packageId}-overlap-check`,
};
changedPackage.collections.billing.rows[0].totalFeeCharged += 1;
const changedImport = importLocalPackage(
  changedPackage,
  "2026-10-13T15:01:00.000Z",
);
const overlap = mergeLocalPackage(
  added.snapshots,
  added.billingCodeMinutes,
  changedImport,
);
if (overlap.status !== "overlap") fail(`expected overlap, got ${overlap.status}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      packageId: imported.packageId,
      snapshots: imported.snapshots.map((snapshot) => ({
        kind: snapshot.kind,
        coverageStart: snapshot.coverageStart,
        coverageEnd: snapshot.coverageEnd,
        rows: snapshot.rows.length,
      })),
      mergeStatuses: [added.status, duplicate.status, overlap.status],
    },
    null,
    2,
  ),
);
