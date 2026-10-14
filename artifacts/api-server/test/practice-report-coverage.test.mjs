import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const routeUrl = new URL("../src/routes/practiceImports.ts", import.meta.url);
const schemaPath = fileURLToPath(new URL("../../../lib/db/src/schema/hub.ts", import.meta.url));
// Replace the database module entirely: no Pool, credentials or database calls.
const result = await build({
  stdin: {
    contents: readFileSync(routeUrl, "utf8") + "\nexport { packageSchema, toSnapshots, snapshotFromRow, snapshotColumns }; export { mockState } from '@workspace/db';",
    resolveDir: fileURLToPath(new URL("../src/routes/", import.meta.url)),
    sourcefile: "practiceImports.ts",
    loader: "ts",
  },
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{
    name: "no-database",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "mock-db", namespace: "no-database" }));
      builder.onLoad({ filter: /.*/, namespace: "no-database" }, () => ({
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        contents: `
          export * from ${JSON.stringify(schemaPath)};
          import { PgDialect } from "drizzle-orm/pg-core";
          export const mockState = { available: false, statements: [], writes: 0 };
          const query = { from() { return this; }, async where() { return []; } };
          const tx = {
            async execute(statement) {
              mockState.statements.push(new PgDialect().sqlToQuery(statement));
              return { rows: [{ available: mockState.available }] };
            },
            select() { return query; },
            insert() { return { async values() { mockState.writes++; } }; }
          };
          export const db = { select: tx.select, async transaction(callback) { return callback(tx); } };
        `,
      }));
    },
  }],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", result.outputFiles[0].text)(compiled, compiled.exports, require);
const { default: router, packageSchema, toSnapshots, snapshotFromRow, snapshotColumns, mockState } = compiled.exports;
const proof = { start: "2026-10-01", end: "2026-10-31", complete: true };
const packageFor = () => ({
  format: "emc-practice-local-import-package", version: 1, packageId: "proof-package",
  exportedAt: "2026-10-14T12:00:00.000Z",
  collections: {
    attendance: {
      coverageStart: "2026-10-03", coverageEnd: "2026-10-03", rowCount: 1,
      rows: [{ clientId: "random", clinician: "Lane", serviceDate: "2026-10-03", location: null, status: "show" }],
    },
    billing: {
      coverageStart: "2026-10-03", coverageEnd: "2026-10-03", rowCount: 1,
      rows: [{ clientId: "random", clinician: "Lane", serviceDate: "2026-10-03", totalFeeCharged: 100, billingCode: null }],
    },
  },
});

test("API accepts separate declared proof while retaining observed endpoints", () => {
  const input = packageFor();
  input.collections.attendance.reportCoverage = proof;
  const snapshots = toSnapshots(packageSchema.parse(input));
  assert.deepEqual(snapshots[0].reportCoverage, proof);
  assert.equal(snapshots[0].coverageStart, "2026-10-03");
  assert.equal(snapshots[0].coverageEnd, "2026-10-03");
  assert.equal(snapshots[1].reportCoverage, undefined);
});

test("API rejects invalid dates, incomplete proof and ranges excluding observed rows", () => {
  for (const reportCoverage of [
    { ...proof, start: "2026-02-30" }, { ...proof, complete: false },
    { ...proof, end: "2026-09-01" }, { ...proof, start: "2026-10-04" },
  ]) {
    const input = packageFor();
    input.collections.attendance.reportCoverage = reportCoverage;
    assert.throws(() => toSnapshots(packageSchema.parse(input)));
  }
});

test("legacy API reads return null proof and select it using whole-row JSON", async () => {
  assert.equal(snapshotFromRow({
    kind: "attendance", createdAt: new Date(), coverageStart: "2026-10-03",
    coverageEnd: "2026-10-03", sourceHash: "hash", rows: [],
  }).reportCoverage, null);
  const { PgDialect } = require("drizzle-orm/pg-core");
  const query = new PgDialect().sqlToQuery(snapshotColumns.reportCoverage);
  assert.match(query.sql, /to_jsonb\("practice_import_snapshots"\) -> 'report_coverage'/);
  assert.doesNotMatch(query.sql, /"report_coverage"/);
});

test("new proof writes clearly fail before mutation when migration is missing", async () => {
  const input = packageFor();
  input.collections.attendance.reportCoverage = proof;
  const handler = router.stack.find((layer) => layer.route?.path === "/practice-imports/package").route.stack[0].handle;
  const response = { locals: {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body: { package: input } }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, "REPORT_COVERAGE_MIGRATION_REQUIRED");
  assert.equal(mockState.writes, 0);
  assert.ok(mockState.statements.every((statement) => !statement.sql.includes("INSERT")));
});

test("legacy inserts omit the missing column and migrated inserts serialize proof", async () => {
  const handler = router.stack.find((layer) => layer.route?.path === "/practice-imports/package").route.stack[0].handle;
  for (const available of [false, true]) {
    mockState.available = available;
    mockState.statements = [];
    const input = packageFor();
    if (available) input.collections.attendance.reportCoverage = proof;
    const response = { locals: {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ body: { package: input } }, response);
    assert.equal(response.statusCode, 200);
    const inserts = mockState.statements.filter((statement) => statement.sql.includes("INSERT INTO practice_import_snapshots"));
    assert.equal(inserts.length, 2);
    if (available) {
      assert.match(inserts[0].sql, /report_coverage/);
      assert.ok(inserts[0].params.includes(JSON.stringify(proof)));
      assert.equal(inserts[1].params.at(-1), null);
    } else {
      assert.ok(inserts.every((statement) => !statement.sql.includes("report_coverage")));
    }
  }
});
