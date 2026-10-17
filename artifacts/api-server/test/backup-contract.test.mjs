import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importBackupTables, syntheticImportBackup } from "./backup-fixture.mjs";

const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");

function memoryPool(state) {
  return { async connect() {
    state.connections++;
    let before;
    return { release() {}, async query(sql, params = []) {
      state.queries.push({ sql, params: structuredClone(params) });
      if (sql.startsWith("BEGIN")) { before = structuredClone(state.tables); return { rows: [] }; }
      if (sql === "ROLLBACK") { if (before) state.tables = before; return { rows: [] }; }
      if (sql === "COMMIT" || sql.startsWith("SET LOCAL") || sql.startsWith("LOCK TABLE")) return { rows: [] };
      if (sql.includes("information_schema.columns")) return { rows: params[0].map((table_name) => ({
        table_name, column_name: state.changedSchema === table_name ? "changed_column" : "test_column",
        data_type: "text", is_nullable: "NO",
      })) };
      if (sql.startsWith("SELECT pg_get_serial_sequence")) {
        if (params[0] === "practice_import_declarations") throw new Error("Declarations have no id column");
        return { rows: [{ name: params[0] === "clinicians" ? "clinicians_id_seq" : null }] };
      }
      if (sql.startsWith("SELECT setval")) {
        const table = sql.match(/FROM "([a-z_]+)"/)?.[1];
        state.sequenceValues[params[0]] = state.tables[table].length
          ? Math.max(...state.tables[table].map((row) => row.id)) : 1;
        return { rows: [] };
      }
      const table = sql.match(/(?:FROM|INTO) "([a-z_]+)"/)?.[1];
      if (!table || !Object.hasOwn(state.tables, table)) throw new Error(`Unexpected backup query: ${sql}`);
      if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: String(state.tables[table].length) }] };
      if (sql.startsWith("SELECT row_to_json")) {
        const composite = table === "practice_import_declarations";
        const order = composite ? "practice_id, account_id" : "id";
        if (!sql.endsWith(`ORDER BY ${order}`)) throw new Error("Invalid export ordering");
        const keys = composite ? ["practice_id", "account_id"] : ["id"];
        const rows = structuredClone(state.tables[table]).sort((left, right) => {
          for (const key of keys) {
            if (left[key] < right[key]) return -1;
            if (left[key] > right[key]) return 1;
          }
          return 0;
        });
        return { rows: rows.map((record) => ({ record })) };
      }
      if (sql.startsWith("INSERT INTO")) {
        if (state.failInsert === table) throw new Error("Synthetic insert failure");
        const rows = JSON.parse(params[0]);
        if (table === "practice_import_snapshots" && rows.some((row) =>
          !state.tables.practice_import_packages.some((parent) => parent.id === row.package_import_id)))
          throw new Error("Missing package foreign key");
        state.tables[table].push(...rows);
        return { rows: [] };
      }
      throw new Error(`Unexpected backup query: ${sql}`);
    } };
  } };
}

// Bundle the actual route with a completely replaced database module; no Pool or credentials.
const bundle = await build({
  stdin: { contents: readFileSync(new URL("../src/routes/backup.ts", import.meta.url), "utf8")
    + "\nexport { mockState } from '@workspace/db';"
    + "\nexport { billingChargeResolutionSchema, importDeclarationsSchema, restoreHistoricalBillingProviders } from '@workspace/practice/hub';",
    loader: "ts", resolveDir: fileURLToPath(new URL("../src/routes/", import.meta.url)) },
  bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "backup-no-database", setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "backup-test" }));
    builder.onResolve({ filter: /^\.\.\/lib\/logger$/ }, () => ({ path: "logger", namespace: "backup-test" }));
    builder.onLoad({ filter: /.*/, namespace: "backup-test" }, ({ path }) => ({
      contents: path === "logger" ? "export const logger = { error() {}, info() {} };"
        : `export const mockState = {}; export const pool = (${memoryPool.toString()})(mockState);`,
    }));
  } }],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiled, compiled.exports, require);
const { default: router, backupTables, mockState: state,
  billingChargeResolutionSchema, importDeclarationsSchema, restoreHistoricalBillingProviders } = compiled.exports;
const expectedTables = [
  "business_goals", "current_reality", "clinicians", "staff_members", "scenarios",
  "scenario_clinicians", "scenario_staff_members", "hub_workspaces", "hub_attachments",
  "session_records", "session_goal_years", "session_record_history", "hub_history",
  ...importBackupTables,
];
function reset(seed = {}) {
  Object.assign(state, { tables: Object.fromEntries(expectedTables.map((name) => [name, structuredClone(seed[name] ?? [])])),
    queries: [], connections: 0, changedSchema: null, failInsert: null, sequenceValues: {} });
}
async function call(path, body, actor = "synthetic-owner") {
  const route = router.stack.find((layer) => layer.route?.path === path).route;
  const response = { locals: { actor }, statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    attachment(name) { this.filename = name; return this; },
    json(value) { this.body = value; return this; },
  };
  await route.stack[0].handle({ body }, response);
  return response;
}
const restoreBody = (preview) => ({ token: preview.body.token, digest: preview.body.digest, confirmation: "RESTORE EMPTY APP" });
async function sourceBackup() {
  reset({ ...syntheticImportBackup(7, 1), business_goals: [{ id: 1 }],
    clinicians: [{ id: 7, goal_id: 1, label: "Synthetic Backup Clinician" }] });
  const exported = await call("/hub/backup");
  assert.equal(exported.statusCode, 200);
  return exported.body;
}

test("synthetic declarations and all five approval entries satisfy the current business schemas", () => {
  const fixture = syntheticImportBackup();
  const declaration = fixture.practice_import_declarations[0];
  assert.deepEqual(importDeclarationsSchema.parse(declaration.data), declaration.data);
  const journal = fixture.practice_import_audit;
  const approvals = journal.filter((row) => row.action === "accept-billing-charge-exception");
  assert.deepEqual(approvals.map((row) => row.detail.revision), [1, 2, 3, 4, 5]);
  for (const row of approvals) billingChargeResolutionSchema.parse(row.detail.resolution);
  const providers = restoreHistoricalBillingProviders(journal
    .filter((row) => row.action === "confirm-historical-billing-providers").map((row) => row.detail), declaration.revision);
  assert.equal(providers[0].id, approvals[4].detail.resolution.historicalProviderId);
});

test("export covers exactly 17 business tables, both declaration keys, and no authentication records", async () => {
  const fixture = syntheticImportBackup();
  fixture.practice_import_declarations.push(
    { ...structuredClone(fixture.practice_import_declarations[0]), account_id: "a-account" },
    { ...structuredClone(fixture.practice_import_declarations[0]), practice_id: "a-practice" },
  );
  reset(fixture);
  state.tables.hub_users = [{ password_hash: "synthetic-never-export" }];
  state.tables.hub_auth_sessions = [{ token_hash: "synthetic-never-export" }];
  const result = await call("/hub/backup");
  assert.equal(result.statusCode, 200);
  assert.deepEqual(backupTables, expectedTables);
  assert.deepEqual(Object.keys(result.body.tables), expectedTables);
  assert.equal(result.filename, "emc-business-data-backup.json");
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.doesNotMatch(JSON.stringify(result.body), /synthetic-never-export/);
  assert.deepEqual(result.body.tables.practice_import_declarations.map((row) => [row.practice_id, row.account_id]),
    [["a-practice", "synthetic-backup"], ["synthetic-backup", "a-account"], ["synthetic-backup", "synthetic-backup"]]);
  assert.deepEqual(state.queries.find((query) => query.sql.includes("information_schema.columns")).params[0], expectedTables);
});

test("actual route roundtrip preserves five approvals, historical identities, declarations, archived sources and settings", async () => {
  const backup = await sourceBackup();
  assert.equal(backup.tables.practice_import_audit.filter((row) => row.action === "accept-billing-charge-exception").length, 5);
  assert.equal(backup.tables.practice_import_snapshots.filter((row) => !row.active).length, 1);
  reset();
  const preview = await call("/hub/backup/preview", backup);
  assert.equal(preview.body.canRestore, true);
  assert.deepEqual(Object.keys(preview.body.counts), expectedTables);
  assert.equal(preview.body.counts.practice_import_audit, 6);
  const restored = await call("/hub/backup/restore", restoreBody(preview));
  assert.equal(restored.statusCode, 200);
  assert.deepEqual((await call("/hub/backup")).body.tables, backup.tables);
  const lock = state.queries.find((query) => query.sql.startsWith("LOCK TABLE"));
  for (const name of expectedTables) assert.ok(lock.sql.includes(`"${name}"`), name);
  const inserts = state.queries.filter((query) => query.sql.startsWith("INSERT INTO")).map((query) => query.sql);
  assert.ok(inserts.findIndex((sql) => sql.startsWith('INSERT INTO "practice_import_packages"'))
    < inserts.findIndex((sql) => sql.startsWith('INSERT INTO "practice_import_snapshots"')));
  assert.ok(state.queries.filter((query) => query.sql.includes("pg_get_serial_sequence"))
    .every((query) => query.params[0] !== "practice_import_declarations"));
  assert.equal(state.sequenceValues.clinicians_id_seq, 7);
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 409);
});

test("legacy 13-table and individually missing import tables are explicitly rejected before database access", async () => {
  const backup = await sourceBackup();
  for (const missing of [importBackupTables, ...importBackupTables.map((name) => [name])]) {
    const incomplete = structuredClone(backup);
    for (const name of missing) delete incomplete.tables[name];
    reset();
    const result = await call("/hub/backup/preview", incomplete);
    assert.equal(result.statusCode, 400);
    assert.match(result.body.error, /13-table backups are incomplete/);
    assert.equal(state.connections, 0);
  }
  reset();
  const forbidden = structuredClone(backup);
  forbidden.tables.hub_users = [];
  assert.equal((await call("/hub/backup/preview", forbidden)).statusCode, 400);
  assert.equal(state.connections, 0);
});

test("each import-only occupied target prevents a restore preview token", async () => {
  const backup = await sourceBackup();
  for (const name of importBackupTables) {
    reset({ [name]: backup.tables[name] });
    const before = structuredClone(state.tables);
    const result = await call("/hub/backup/preview", backup);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.canRestore, false, name);
    assert.equal(result.body.token, null, name);
    assert.equal(result.body.existing[name], backup.tables[name].length);
    assert.deepEqual(state.tables, before);
  }
});

test("restore rechecks import-only occupancy after preview under the expanded lock", async () => {
  const backup = await sourceBackup();
  reset();
  const preview = await call("/hub/backup/preview", backup);
  state.tables.practice_import_declarations = structuredClone(backup.tables.practice_import_declarations);
  const before = structuredClone(state.tables);
  const result = await call("/hub/backup/restore", restoreBody(preview));
  assert.equal(result.statusCode, 409);
  assert.deepEqual(state.tables, before);
  assert.ok(!state.queries.some((query) => query.sql.startsWith("INSERT INTO")));
});

test("a late import journal failure rolls back every preceding table and permits a clean retry", async () => {
  const backup = await sourceBackup();
  reset();
  const before = structuredClone(state.tables);
  const preview = await call("/hub/backup/preview", backup);
  state.failInsert = "practice_import_audit";
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 409);
  assert.deepEqual(state.tables, before);
  state.failInsert = null;
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 200);
  assert.deepEqual((await call("/hub/backup")).body.tables, backup.tables);
});

test("each import table participates in preview and restore schema checking", async () => {
  const backup = await sourceBackup();
  for (const name of importBackupTables) {
    reset();
    state.changedSchema = name;
    assert.equal((await call("/hub/backup/preview", backup)).statusCode, 400, name);
  }
  reset();
  const preview = await call("/hub/backup/preview", backup);
  state.changedSchema = "practice_import_declarations";
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 409);
  assert.ok(Object.values(state.tables).every((rows) => rows.length === 0));
});

test("restoration remains bound to the reviewed actor, digest and explicit confirmation", async () => {
  const backup = await sourceBackup();
  reset();
  const preview = await call("/hub/backup/preview", backup);
  const body = restoreBody(preview);
  assert.equal((await call("/hub/backup/restore", { ...body, confirmation: "" })).statusCode, 400);
  assert.equal((await call("/hub/backup/restore", body, "another-owner")).statusCode, 409);
  assert.equal((await call("/hub/backup/restore", { ...body, digest: "wrong" })).statusCode, 409);
  assert.equal((await call("/hub/backup/restore", body)).statusCode, 200);
});
