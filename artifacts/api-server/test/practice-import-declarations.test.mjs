import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const bundle = await build({ stdin: { contents: readFileSync(new URL("../src/routes/practiceImports.ts", import.meta.url), "utf8") + "\nexport { state } from '@workspace/db';", loader: "ts", resolveDir: fileURLToPath(new URL("../src/routes/", import.meta.url)) }, bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "mock", setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ resolveDir: fileURLToPath(new URL("../", import.meta.url)), contents: `
      export * from ${JSON.stringify(fileURLToPath(new URL("../../../lib/db/src/schema/hub.ts", import.meta.url)))};
      export * from ${JSON.stringify(fileURLToPath(new URL("../../../lib/db/src/schema/clinicians.ts", import.meta.url)))};
      import { PgDialect } from "drizzle-orm/pg-core";
      import { getTableName } from "drizzle-orm";
      const dialect = new PgDialect();
      export const state = { available: true, saved: null, snapshots: [], roster: [], audits: [], queries: [], failAudit: false };
      const tx = {
        async execute(statement) {
          const q = dialect.sqlToQuery(statement); state.queries.push(q);
          if (q.sql.includes("to_regclass")) return { rows: [{ available: state.available }] };
          if (q.sql.startsWith("SELECT revision")) return { rows: state.saved ? [structuredClone(state.saved)] : [] };
          if (q.sql.startsWith("INSERT INTO practice_import_declarations")) {
            const [practice, account, revision, data, actor] = q.params;
            assertScope(practice, account);
            state.saved = { revision, data: JSON.parse(data), confirmed_at: "2026-10-15T00:00:00Z", actor };
            return { rows: [{ revision }] };
          }
          return { rows: [] };
        },
        select() { return { from(table) {
          if (getTableName(table) === "clinicians") return Promise.resolve(structuredClone(state.roster));
          return { async where(condition) { const q = dialect.sqlToQuery(condition); assertScope(q.params[0], q.params[1]);
            if (getTableName(table) === "practice_import_packages") return [];
            return state.snapshots.filter(row => row.practiceId === q.params[0] && row.accountId === q.params[1] && row.active === 1); } };
        } }; },
        insert() { return { async values(value) { if (state.failAudit) throw new Error("audit failure"); state.audits.push(structuredClone(value)); } }; }
      };
      function assertScope(practice, account) { if (practice !== "synthetic" || account !== "synthetic") throw new Error("wrong scope"); }
      export const db = { execute: tx.execute, select: tx.select, async transaction(callback) {
        const before = structuredClone(state); try { return await callback(tx); } catch (error) { Object.assign(state, before); throw error; }
      } };
    ` }));
  } }],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiled, compiled.exports, require);
const { default: router, state } = compiled.exports;
const handler = router.stack.find((layer) => layer.route?.path === "/practice-imports/declarations").route.stack[0].handle;
const sourceId = "attendance-0123456789abcdef";
function reset() {
  process.env.EMC_PRACTICE_ID = "synthetic";
  Object.assign(state, { available: true, saved: null, roster: [{ id: 1, label: "Synthetic", goalId: 7 }, { id: 2, label: "Synthetic", goalId: 8 }],
    snapshots: [{ kind: "attendance", sourceHash: "0123456789abcdef", active: 1, practiceId: "synthetic", accountId: "synthetic", createdAt: new Date("2026-01-15T00:00:00Z"), coverageStart: "2026-01-02", coverageEnd: "2026-01-02", reportCoverage: null,
      rows: [{ clientId: "synthetic-client", clinician: "Synthetic", serviceDate: "2026-01-02", status: "show", sourceRowHash: "unchanged" }] }], audits: [], queries: [], failAudit: false });
}
function body() { return { expectedRevision: 0, confirmed: true, data: { version: 1,
  mappings: [{ sourceLabel: "Synthetic", clinicianId: 1, clinicianLabel: "Synthetic", teamId: 7 }],
  sourceSets: [{ kind: "attendance", snapshotIds: [sourceId], clinicianIds: [1], start: "2026-01-01", end: "2026-01-14", complete: true }] } }; }
async function call(payload) { const res = { locals: { actor: "synthetic-owner" }, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } }; await handler({ body: payload }, res); return res; }
const noWrites = () => { assert.equal(state.saved, null); assert.deepEqual(state.audits, []); };

test("explicit declarations save only scoped metadata and atomic audit, preserving every source and future-copy row", async () => {
  reset(); const original = structuredClone({ snapshots: state.snapshots, roster: state.roster });
  const res = await call(body());
  assert.equal(res.statusCode, 200); assert.equal(res.body.declarations.revision, 1);
  assert.deepEqual(res.body.declarations.data, body().data);
  assert.deepEqual({ snapshots: state.snapshots, roster: state.roster }, original);
  assert.equal(state.audits[0].actor, "synthetic-owner");
  assert.equal(state.audits[0].action, "confirm-import-declarations");
  assert.ok(state.queries.some((q) => /ON CONFLICT/.test(q.sql) && /revision = \$/.test(q.sql)));
  assert.ok(state.queries.every((q) => !/UPDATE "?clinicians|UPDATE "?practice_import_snapshots|DELETE|ALTER|CREATE TABLE/.test(q.sql)));
});
test("migration absence and stale revisions cannot create or overwrite declarations", async () => {
  reset(); state.available = false; assert.equal((await call(body())).statusCode, 503); noWrites();
  reset(); await call(body()); const original = structuredClone(state.saved);
  assert.equal((await call(body())).statusCode, 409); assert.deepEqual(state.saved, original); assert.equal(state.audits.length, 1);
});
test("unconfirmed, ambiguous normalized mapping and unexpected source changes are rejected", async () => {
  for (const mutate of [(p) => { p.confirmed = false; }, (p) => { delete p.expectedRevision; }, (p) => { p.rows = []; },
    (p) => { p.data.mappings.push({ ...p.data.mappings[0], sourceLabel: " SYNTHETIC " }); }]) {
    reset(); const payload = body(); mutate(payload); assert.equal((await call(payload)).statusCode, 400); noWrites();
  }
});
test("wrong target configuration, renamed/deleted target and alias guesses require review", async () => {
  for (const mutate of [(p) => { p.data.mappings[0].teamId = 8; }, () => { state.roster[0].label = "Renamed"; }, () => { state.roster.shift(); },
    (p) => { p.data.mappings[0].sourceLabel = "Synthetic Other"; }, (p) => { p.data.sourceSets[0].clinicianIds = [2]; }]) {
    reset(); const payload = body(); mutate(payload); assert.equal((await call(payload)).statusCode, 400); noWrites();
  }
});
test("missing, duplicate, archived, wrong-kind and cross-practice source-set members fail safely", async () => {
  for (const mutate of [() => { state.snapshots = []; }, () => { state.snapshots.push(structuredClone(state.snapshots[0])); },
    () => { state.snapshots[0].active = 0; }, () => { state.snapshots[0].practiceId = "other"; },
    (p) => { p.data.sourceSets[0].kind = "billing"; }, (p) => { p.data.sourceSets[0].snapshotIds.push(sourceId); }]) {
    reset(); const payload = body(); mutate(payload); assert.equal((await call(payload)).statusCode, 400); noWrites();
  }
});
test("out-of-range, invalid and future coverage cannot certify a set", async () => {
  for (const mutate of [(p) => { p.data.sourceSets[0].start = "2026-01-03"; }, (p) => { p.data.sourceSets[0].end = "2099-01-01"; },
    () => { state.snapshots[0].rows[0].serviceDate = "2026-02-30"; }, () => { state.snapshots[0].rows[0].clinician = "Unmapped"; }]) {
    reset(); const payload = body(); mutate(payload); assert.equal((await call(payload)).statusCode, 400); noWrites();
  }
});
test("audit failure rolls metadata back with all source facts intact", async () => {
  reset(); state.failAudit = true; const original = structuredClone(state.snapshots);
  await assert.rejects(call(body()), /audit failure/); noWrites(); assert.deepEqual(state.snapshots, original);
});
