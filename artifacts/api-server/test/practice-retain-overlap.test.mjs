import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const schemaPath = fileURLToPath(new URL("../../../lib/db/src/schema/hub.ts", import.meta.url));
const bundled = await build({
  stdin: { contents: readFileSync(new URL("../src/routes/practiceImports.ts", import.meta.url), "utf8") + "\nexport { mockState } from '@workspace/db';",
    loader: "ts", sourcefile: "practiceImports.ts", resolveDir: fileURLToPath(new URL("../src/routes/", import.meta.url)) },
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "no-database", setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "mock", namespace: "no-database" }));
    builder.onLoad({ filter: /.*/, namespace: "no-database" }, () => ({ resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
      export * from ${JSON.stringify(schemaPath)};
      export * from ${JSON.stringify(fileURLToPath(new URL("../../../lib/db/src/schema/clinicians.ts", import.meta.url)))};
      import { PgDialect } from "drizzle-orm/pg-core";
      import { getTableName } from "drizzle-orm";
      export const mockState = { snapshots: [], packages: [], audits: [], updates: [], failAudit: false };
      const dialect = new PgDialect();
      const rowsFor = table => getTableName(table) === "practice_import_snapshots" ? mockState.snapshots : mockState.packages;
      const tx = {
        async execute(statement) {
          const query = dialect.sqlToQuery(statement);
          if (query.sql.startsWith("SELECT detail FROM practice_import_audit")) return { rows: [] };
          if (query.sql.includes("practice_import_declarations")) return { rows: [{ available: false }] };
          if (/INSERT INTO practice_import_snapshots/.test(query.sql)) {
            const [id, packageImportId, practiceId, accountId, kind, coverageStart, coverageEnd, sourceHash, rowCount, rows, proof] = query.params;
            mockState.snapshots.push({ id, packageImportId, practiceId, accountId, kind, coverageStart, coverageEnd, sourceHash, rowCount,
              rows: JSON.parse(rows), reportCoverage: proof ? JSON.parse(proof) : null, active: 1, createdAt: new Date("2026-10-15T00:00:00Z") });
          }
          return { rows: [{ available: true }] };
        },
        select() { return { from(table) { this.table = table; return this; }, async where(condition) {
          const query = dialect.sqlToQuery(condition), params = query.params;
          const rows = rowsFor(this.table);
          if (/package_import_id/.test(query.sql)) return rows.filter(row => row.active === 1 && params.includes(row.packageImportId));
          return rows.filter(row => row.practiceId === params[0] && row.accountId === params[1]
            && (/\\.\"package_id\"/.test(query.sql) ? row.packageId === params[2] : row.active === 1));
        } }; },
        update(table) { return { set(patch) { this.patch = patch; return this; }, async where(condition) {
          const query = dialect.sqlToQuery(condition); mockState.updates.push({ table: getTableName(table), patch: this.patch });
          for (const row of rowsFor(table)) if (query.params.includes(row.id)) Object.assign(row, this.patch);
        } }; },
        insert(table) { return { async values(value) {
          if (getTableName(table) === "practice_import_audit") {
            if (mockState.failAudit) throw new Error("synthetic audit failure");
            mockState.audits.push(structuredClone(value));
          } else mockState.packages.push({ active: 1, importedAt: new Date("2026-10-15T00:00:00Z"), ...structuredClone(value) });
        } }; }
      };
      export const db = { select: tx.select, execute: tx.execute, async transaction(callback) {
        const before = structuredClone(mockState);
        try { return await callback(tx); } catch (error) { Object.assign(mockState, before); throw error; }
      } };
    ` }));
  } }],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundled.outputFiles[0].text)(compiled, compiled.exports, require);
const { default: router, mockState } = compiled.exports;
const handler = router.stack.find(layer => layer.route?.path === "/practice-imports/package").route.stack[0].handle;
const practice = "synthetic-retain-practice";
const packageFor = (packageId, dates, fee = 100) => ({
  format: "emc-practice-local-import-package", version: 1, packageId, exportedAt: "2026-10-15T00:00:00Z",
  collections: Object.fromEntries(["attendance", "billing"].map(kind => [kind, {
    coverageStart: dates[0], coverageEnd: dates.at(-1), rowCount: dates.length,
    rows: dates.map(serviceDate => ({ clientId: "synthetic-client", clinician: "Synthetic", serviceDate,
      ...(kind === "attendance" ? { status: "show", location: null } : { totalFeeCharged: fee, billingCode: "90837" }) })),
  }])), billingCodeMinutes: { "90837": 50 },
});
const originalPackage = () => packageFor("original", ["2026-10-01", "2026-10-10"]);
async function call(input, flags = {}) {
  const res = { locals: { actor: "synthetic-owner" }, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { package: input, ...flags } }, res); return res;
}
async function reset() {
  process.env.EMC_PRACTICE_ID = practice;
  Object.assign(mockState, { snapshots: [], packages: [], audits: [], updates: [], failAudit: false });
  assert.equal((await call(originalPackage())).statusCode, 200);
}

test("overlap still requires explicit review; retain and replace are mutually exclusive", async () => {
  await reset(); const before = structuredClone(mockState);
  const input = packageFor("partial", ["2026-10-10", "2026-10-14"]);
  const res = await call(input);
  assert.equal(res.statusCode, 409); assert.equal(res.body.code, "OVERLAP_REVIEW_REQUIRED");
  assert.deepEqual(mockState, before);
  assert.equal((await call(input, { retainOverlaps: true, replaceOverlaps: true })).statusCode, 400);
  assert.deepEqual(mockState, before);
});

test("retaining a partial upload preserves all existing provenance, active packages, rows and settings", async () => {
  await reset(); const before = structuredClone(mockState);
  const input = packageFor("partial", ["2026-10-10", "2026-10-14"]);
  input.billingCodeMinutes = { "90837": 999 };
  const inputBefore = structuredClone(input);
  const res = await call(input, { retainOverlaps: true });
  assert.equal(res.statusCode, 200); assert.equal(res.body.status, "retained");
  assert.deepEqual(mockState.snapshots.slice(0, 2), before.snapshots);
  assert.deepEqual(mockState.packages[0], before.packages[0]);
  assert.deepEqual(mockState.updates, []);
  assert.equal(mockState.snapshots.length, 4); assert.ok(mockState.snapshots.every(row => row.active === 1));
  assert.equal(mockState.packages.length, 2); assert.deepEqual(mockState.packages[1].billingCodeMinutes, {});
  assert.deepEqual(res.body.billingCodeMinutes, { "90837": 50 });
  assert.equal(mockState.audits.at(-1).action, "retain-overlap");
  assert.equal(mockState.audits.at(-1).detail.replacedSnapshotCount, 0);
  assert.equal(mockState.audits.at(-1).detail.retainedOverlapSnapshotCount, 2);
  assert.deepEqual(input, inputBefore);
});

test("exact package/source duplicates are idempotent while changed fees remain separate evidence", async () => {
  await reset(); const before = structuredClone(mockState);
  assert.equal((await call(originalPackage(), { retainOverlaps: true })).body.status, "duplicate");
  const sameSources = { ...originalPackage(), packageId: "different-package-same-source" };
  assert.equal((await call(sameSources, { retainOverlaps: true })).body.status, "duplicate");
  assert.deepEqual(mockState, before);
  const corrected = originalPackage(); corrected.collections.billing.rows[1].totalFeeCharged = 125;
  assert.equal((await call(corrected, { retainOverlaps: true })).body.code, "PACKAGE_ID_CHANGED_CONTENT");
  corrected.packageId = "changed-fee-source";
  const res = await call(corrected, { retainOverlaps: true });
  assert.equal(res.body.status, "retained");
  assert.equal(mockState.snapshots.length, 3, "Unchanged attendance source is not inserted again");
  assert.deepEqual(mockState.snapshots.slice(0, 2), before.snapshots);
  assert.equal(mockState.snapshots[2].rows[1].totalFeeCharged, 125);
  assert.equal(mockState.snapshots[1].rows[1].totalFeeCharged, 100);
  assert.equal(mockState.audits.at(-1).detail.skippedDuplicateSnapshotCount, 1);
});

test("retain rejects matching source identities with different proof without writes or duplicate active IDs", async () => {
  for (const existingProof of [null, { start: "2026-10-01", end: "2026-10-14", complete: true }]) {
    await reset();
    for (const snapshot of mockState.snapshots) snapshot.reportCoverage = existingProof;
    const before = structuredClone(mockState);
    const input = { ...originalPackage(), packageId: "new-proof" };
    if (existingProof === null) {
      for (const collection of Object.values(input.collections)) collection.reportCoverage = { start: "2026-10-01", end: "2026-10-14", complete: true };
    }
    const res = await call(input, { retainOverlaps: true });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "COVERAGE_REVIEW_REQUIRED");
    assert.match(res.body.error, /Confirm report coverage/);
    assert.deepEqual(mockState, before, "No original source, proof, package, audit or settings may change");
    const ids = mockState.snapshots.filter(row => row.active === 1).map(row => `${row.kind}-${row.sourceHash}`);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("audit failure rolls back retained new sources", async () => {
  await reset(); mockState.failAudit = true; const before = structuredClone(mockState);
  await assert.rejects(call(packageFor("partial", ["2026-10-10", "2026-10-14"]), { retainOverlaps: true }), /synthetic audit failure/);
  assert.deepEqual(mockState, before);
});

test("replacement remains an explicit separate archival action", async () => {
  await reset();
  const res = await call(packageFor("replacement", ["2026-10-10", "2026-10-14"]), { replaceOverlaps: true });
  assert.equal(res.body.status, "replaced");
  assert.ok(mockState.snapshots.slice(0, 2).every(row => row.active === 0));
  assert.equal(mockState.packages[0].active, 0);
  assert.equal(mockState.audits.at(-1).action, "replace-overlap");
});
