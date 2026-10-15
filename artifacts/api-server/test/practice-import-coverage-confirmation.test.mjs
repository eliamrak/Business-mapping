import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const schemaPath = fileURLToPath(new URL("../../../lib/db/src/schema/hub.ts", import.meta.url));
const source = readFileSync(new URL("../src/routes/practiceImports.ts", import.meta.url), "utf8");
const bundle = await build({
  stdin: { contents: source + "\nexport { mockState } from '@workspace/db';", loader: "ts", sourcefile: "practiceImports.ts", resolveDir: fileURLToPath(new URL("../src/routes/", import.meta.url)) },
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "database-free", setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "mock-db", namespace: "mock-db" }));
    builder.onLoad({ filter: /.*/, namespace: "mock-db" }, () => ({ resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
      export * from ${JSON.stringify(schemaPath)};
      import { PgDialect } from "drizzle-orm/pg-core";
      import { getTableName } from "drizzle-orm";
      export const mockState = { available: true, snapshots: [], packages: [], updates: [], audits: [], statements: [], reads: [], failAudit: false, failUpdate: false, failCas: false };
      const dialect = new PgDialect();
      const tx = {
        async execute(statement) { mockState.statements.push(dialect.sqlToQuery(statement)); return { rows: [{ available: mockState.available }] }; },
        select() { return { from(table) { this.table = table; return this; }, async where(condition) {
          const query = dialect.sqlToQuery(condition); mockState.reads.push(query);
          const rows = getTableName(this.table) === "practice_import_snapshots" ? mockState.snapshots : mockState.packages;
          return rows.filter(row => row.practiceId === query.params[0] && row.accountId === query.params[1] && row.active === 1);
        } }; },
        update(table) { return { set(patch) { this.patch = patch; return this; }, where(condition) { this.condition = condition; return this; }, async returning() {
          const query = dialect.sqlToQuery(this.condition);
          if (mockState.failUpdate) throw new Error("synthetic metadata update failure");
          if (mockState.failCas) return [];
          const row = mockState.snapshots.find(row => row.id === query.params[0] && row.practiceId === query.params[1] && row.accountId === query.params[2] && row.active === 1);
          if (!row) return [];
          mockState.updates.push({ table: getTableName(table), patch: structuredClone(this.patch), query });
          Object.assign(row, structuredClone(this.patch)); return [{ id: row.id }];
        } }; },
        insert(table) { return { async values(value) {
          if (mockState.failAudit) throw new Error("synthetic audit failure");
          mockState.audits.push({ table: getTableName(table), value: structuredClone(value) });
        } }; }
      };
      export const db = { select: tx.select, async transaction(callback) {
        const before = structuredClone({ snapshots: mockState.snapshots, updates: mockState.updates, audits: mockState.audits });
        try { return await callback(tx); } catch (error) { Object.assign(mockState, before); throw error; }
      } };
    ` }));
  } }],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiled, compiled.exports, require);
const { default: router, mockState } = compiled.exports;
const handler = router.stack.find((layer) => layer.route?.path === "/practice-imports/report-coverage").route.stack[0].handle;
const getHandler = router.stack.find((layer) => layer.route?.path === "/practice-imports").route.stack[0].handle;
const proof = { start: "2026-01-01", end: "2026-01-14", complete: true };
const publicId = "attendance-0123456789abcdef";
const practice = "synthetic-coverage-practice";
function reset() {
  process.env.EMC_PRACTICE_ID = practice;
  Object.assign(mockState, { available: true, snapshots: [{ id: "internal-uuid-not-public", kind: "attendance", sourceHash: "0123456789abcdef",
    practiceId: practice, accountId: practice, active: 1, packageImportId: "unchanged-package", createdAt: new Date("2026-01-15T00:00:00Z"),
    coverageStart: "2026-01-02", coverageEnd: "2026-01-08", reportCoverage: null, rowCount: 2,
    rows: ["2026-01-02", "2026-01-08"].map((serviceDate, index) => ({ clientId: `synthetic-${index}`, clinician: "Synthetic", serviceDate, status: "show", location: null, sourceRowHash: `unchanged-${index}` })),
  }], packages: [], updates: [], audits: [], statements: [], reads: [], failAudit: false, failUpdate: false, failCas: false });
}
const body = (patch = {}) => ({ snapshotId: publicId, reportCoverage: proof, expectedReportCoverage: null, sourceBasis: "source-report", confirmed: true, ...patch });
function response() { return { locals: { actor: "synthetic-owner@example.test" }, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } }; }
async function call(payload) { const res = response(); await handler({ body: payload }, res); return res; }
const noWrites = () => { assert.deepEqual(mockState.updates, []); assert.deepEqual(mockState.audits, []); };

test("metadata-only confirmation preserves all source fields and audits old/new proof, basis and actor", async () => {
  reset();
  const before = structuredClone(mockState.snapshots[0]);
  const res = await call(body());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(mockState.snapshots[0], { ...before, reportCoverage: proof });
  assert.deepEqual(mockState.updates[0].patch, { reportCoverage: proof });
  assert.deepEqual(mockState.updates[0].query.params.slice(0, 4), [before.id, practice, practice, 1]);
  assert.match(mockState.updates[0].query.sql, /IS NOT DISTINCT FROM/);
  assert.equal(mockState.audits[0].value.actor, "synthetic-owner@example.test");
  assert.equal(mockState.audits[0].value.action, "confirm-report-coverage");
  assert.deepEqual(mockState.audits[0].value.detail, { snapshotId: publicId, oldReportCoverage: null, newReportCoverage: proof, sourceBasis: "source-report", confirmed: true });
  assert.equal(res.body.snapshots[0].id, publicId);
  const next = { ...proof, end: "2026-01-28" };
  assert.equal((await call(body({ reportCoverage: next, expectedReportCoverage: proof, sourceBasis: "owner-confirmation" }))).statusCode, 200);
  assert.deepEqual(mockState.audits[1].value.detail.oldReportCoverage, proof);
  assert.deepEqual(mockState.audits[1].value.detail.newReportCoverage, next);
});

test("missing migration returns 503 before selecting or writing snapshots", async () => {
  reset(); mockState.available = false;
  const res = await call(body());
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "REPORT_COVERAGE_MIGRATION_REQUIRED");
  noWrites(); assert.deepEqual(mockState.reads, []);
  assert.ok(mockState.statements.every((query) => !/UPDATE|INSERT/.test(query.sql)));
});

test("legacy eight-digit and newer hashes retain public kind-hash identity", async () => {
  for (const kind of ["attendance", "billing"]) {
    for (const sourceHash of ["0123abcd", "0123456789abcdef", "a".repeat(64)]) {
      reset(); Object.assign(mockState.snapshots[0], { kind, sourceHash });
      const snapshotId = `${kind}-${sourceHash}`;
      const res = await call(body({ snapshotId }));
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.snapshots[0].id, snapshotId);
      assert.equal(mockState.audits[0].value.detail.snapshotId, snapshotId);
    }
  }
  for (const sourceHash of ["abcdef0", "a".repeat(65), "not-a-hash"]) {
    reset(); assert.equal((await call(body({ snapshotId: `attendance-${sourceHash}` }))).statusCode, 400); noWrites();
  }
});

test("explicit old proof is required and stale confirmations cannot overwrite a later declaration", async () => {
  for (const expectedReportCoverage of [undefined, { ...proof, complete: false }]) {
    reset(); assert.equal((await call(body({ expectedReportCoverage }))).statusCode, 400); noWrites();
  }
  reset(); mockState.snapshots[0].reportCoverage = proof;
  assert.equal((await call(body())).statusCode, 409); noWrites();
  reset(); mockState.failCas = true;
  assert.equal((await call(body())).statusCode, 409); noWrites();
});

test("nonexistent, inactive, duplicate and cross-practice public identities cannot mutate history", async () => {
  for (const change of [() => { mockState.snapshots = []; }, () => { mockState.snapshots[0].active = 0; },
    () => { mockState.snapshots[0].practiceId = "other-practice"; }, () => { mockState.snapshots[0].accountId = "other-account"; }]) {
    reset(); change(); assert.equal((await call(body())).statusCode, 404); noWrites();
  }
  reset(); mockState.snapshots.push({ ...structuredClone(mockState.snapshots[0]), id: "duplicate-internal" });
  assert.equal((await call(body())).statusCode, 409); noWrites();
  reset(); assert.equal((await call(body({ snapshotId: "internal-uuid-not-public" }))).statusCode, 400); noWrites();
});

test("invalid ranges, omitted confirmation/basis, future ends and unexpected source edits are rejected", async () => {
  const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const patch of [{ confirmed: false }, { confirmed: undefined }, { sourceBasis: "" }, { sourceBasis: undefined }, { rows: [] }, { reportCoverage: { ...proof, start: "2026-02-30" } },
    { reportCoverage: { ...proof, start: "2026-01-03" } }, { reportCoverage: { ...proof, end: "2026-01-07" } },
    { reportCoverage: { ...proof, end: future } }, { reportCoverage: { ...proof, start: "2026-01-15" } }]) {
    reset(); assert.equal((await call(body(patch))).statusCode, 400, JSON.stringify(patch)); noWrites();
  }
});

test("one invalid or out-of-proof source date blocks the entire confirmation", async () => {
  for (const date of ["invalid", "2026-02-30", "2025-12-31", "2026-01-15"]) {
    reset(); mockState.snapshots[0].rows[1].serviceDate = date;
    assert.equal((await call(body())).statusCode, 400); noWrites();
  }
});

test("audit failure rolls back the proof update and GET retains public kind-hash IDs", async () => {
  reset(); const before = structuredClone(mockState.snapshots);
  mockState.failAudit = true;
  await assert.rejects(call(body()), /synthetic audit failure/);
  assert.deepEqual(mockState.snapshots, before); noWrites();
  const res = response(); await getHandler({}, res);
  assert.equal(res.body.snapshots[0].id, publicId);
  assert.equal(res.body.snapshots[0].reportCoverage, null);
  const appSource = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  assert.match(appSource, /app\.use\("\/api", requireAccess, router\)/, "the route stays behind existing authentication/authorization middleware");
});

test("failed metadata update leaves source history and audit untouched", async () => {
  reset(); const before = structuredClone(mockState.snapshots);
  mockState.failUpdate = true;
  await assert.rejects(call(body()), /synthetic metadata update failure/);
  assert.deepEqual(mockState.snapshots, before); noWrites();
});
