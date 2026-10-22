import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { importBackupTables, syntheticImportBackup, syntheticStaleImportBackup, syntheticHistoricalFactsBackup, invalidImportBackupCases } from "./backup-fixture.mjs";

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

function memoryReader(state, PgDialect, getTableName) {
  const scoped = (rows, practiceId, accountId) => rows.filter((row) =>
    row.practice_id === practiceId && row.account_id === accountId);
  const domainRow = (row) => Object.fromEntries(Object.entries(structuredClone(row)).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    ["created_at", "imported_at", "exported_at"].includes(key) ? new Date(value) : value,
  ]));
  return {
    select() { return { from(table) { const name = getTableName(table); return {
      async where(condition) {
        const { params } = new PgDialect().sqlToQuery(condition);
        state.readerScopes.push(params.slice(0, 2));
        return scoped(state.tables[name], params[0], params[1]).filter((row) => row.active === 1).map(domainRow);
      },
    }; } }; },
    async execute(statement) {
      const { sql, params } = new PgDialect().sqlToQuery(statement);
      if (sql.includes("to_regclass")) return { rows: [{ available: true }] };
      state.readerScopes.push(params.slice(0, 2));
      if (sql.startsWith("SELECT revision")) return { rows: structuredClone(scoped(state.tables.practice_import_declarations, params[0], params[1])) };
      if (sql.startsWith("SELECT detail FROM practice_import_audit")) {
        const actions = sql.includes("confirm-historical-billing-providers")
          ? ["confirm-historical-billing-providers"] : ["accept-billing-charge-exception", "accept-billing-code-exception", "revoke-billing-code-exception"];
        return { rows: scoped(state.tables.practice_import_audit, params[0], params[1])
          .filter((row) => actions.includes(row.action)).slice(0, 1001).map((row) => ({ detail: structuredClone(row.detail) })) };
      }
      if (sql.startsWith("SELECT package_id, detail FROM practice_import_audit")) {
        return { rows: scoped(state.tables.practice_import_audit, params[0], params[1])
          .filter(row => ["import", "retain-overlap", "replace-overlap"].includes(row.action)).slice(0, 10001)
          .map(row => ({ package_id: row.package_id, detail: structuredClone(row.detail) })) };
      }
      throw new Error(`Unexpected reader query: ${sql}`);
    },
  };
}

// Bundle the actual route with a completely replaced database module; no Pool or credentials.
const bundle = await build({
  stdin: { contents: readFileSync(new URL("../src/routes/backup.ts", import.meta.url), "utf8")
    + "\nexport { mockState } from '@workspace/db';"
    + "\nexport { previews as testPreviews };"
    + "\nexport { default as readerRouter } from './practiceImports';"
    + "\nexport { billingChargeResolutionSchema, importDeclarationsSchema, restoreHistoricalBillingProviders } from '@workspace/practice/hub';",
    loader: "ts", resolveDir: fileURLToPath(new URL("../src/routes/", import.meta.url)) },
  bundle: true, write: false, platform: "node", format: "cjs",
  define: { "process.env.EMC_PRACTICE_ID": JSON.stringify("synthetic-backup") },
  plugins: [{ name: "backup-no-database", setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "backup-test" }));
    builder.onResolve({ filter: /^\.\.\/lib\/logger$/ }, () => ({ path: "logger", namespace: "backup-test" }));
    builder.onLoad({ filter: /.*/, namespace: "backup-test" }, ({ path }) => ({
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      contents: path === "logger" ? "export const logger = { error() {}, info() {} };"
        : `export * from ${JSON.stringify(fileURLToPath(new URL("../../../lib/db/src/schema/hub.ts", import.meta.url)))};
          export * from ${JSON.stringify(fileURLToPath(new URL("../../../lib/db/src/schema/clinicians.ts", import.meta.url)))};
          import { PgDialect } from 'drizzle-orm/pg-core';
          import { getTableName } from 'drizzle-orm';
          export const mockState = {}; export const pool = (${memoryPool.toString()})(mockState);
          export const db = (${memoryReader.toString()})(mockState, PgDialect, getTableName);`,
    }));
  } }],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiled, compiled.exports, require);
const { default: router, readerRouter, testPreviews, backupTables, mockState: state,
  billingChargeResolutionSchema, importDeclarationsSchema, restoreHistoricalBillingProviders } = compiled.exports;
const expectedTables = [
  "business_goals", "current_reality", "clinicians", "staff_members", "scenarios",
  "scenario_clinicians", "scenario_staff_members", "hub_workspaces", "hub_attachments",
  "session_records", "session_goal_years", "session_record_history", "hub_history",
  ...importBackupTables,
];
function reset(seed = {}) {
  testPreviews.clear();
  Object.assign(state, { tables: Object.fromEntries(expectedTables.map((name) => [name, structuredClone(seed[name] ?? [])])),
    queries: [], connections: 0, changedSchema: null, failInsert: null, sequenceValues: {}, readerScopes: [] });
}
async function call(path, body, actor = "synthetic-owner") {
  const selected = path === "/practice-imports" ? readerRouter : router;
  const route = selected.stack.find((layer) => layer.route?.path === path).route;
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
async function sourceBackup(fixture = syntheticImportBackup(7, 1)) {
  reset({ ...fixture, business_goals: [{ id: 1 }],
    clinicians: [{ id: 7, goal_id: 1, label: "Synthetic Backup Clinician" }] });
  const exported = await call("/hub/backup");
  assert.equal(exported.statusCode, 200);
  return exported.body;
}

test("synthetic declarations and all five approval entries satisfy the current business schemas", () => {
  const fixture = syntheticImportBackup();
  for (const [key, value] of Object.entries(fixture.practice_import_packages[0].same_day_visit_overrides)) {
    assert.match(key, /^[0-9a-f]{16}$/);
    assert.equal(value, 2);
  }
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
  assert.equal(result.body.format, "emc-business-data-v2");
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

for (const undone of [false, true]) test(`billing code choice ${undone ? "and reversal" : "alone"} roundtrips with prior charge approvals and raw records`, async () => {
  const fixture = syntheticImportBackup(7, 1), original = structuredClone(fixture);
  const id = "00000000-0000-4000-8000-000000000060";
  const evidence = ["d", "e"].map((letter, index) => ({ snapshotId: "billing-" + letter.repeat(64),
    sourceRowHash: `synthetic-code-${index}`, billingCode: index ? "0" : "90837", visitKind: null, cancellationSubtype: null, totalFeeCharged: 125 }));
  const first = fixture.practice_import_audit[0];
  const resolution = { kind: "billing-code", id, approvalToken: "f".repeat(64), clinicianId: 7,
    clinicianLabel: first.detail.resolution.clinicianLabel, clientId: "synthetic-code-client", serviceDate: "2026-10-05", evidence,
    selected: { snapshotId: evidence[1].snapshotId, sourceRowHash: evidence[1].sourceRowHash },
    confirmedAt: "2026-10-22T12:00:00Z", approvalNote: "Synthetic explicit source code choice" };
  fixture.practice_import_audit.push({ ...structuredClone(first), id, package_id: `billing-code-resolution:${id}`,
    action: "accept-billing-code-exception", detail: { oldRevision: 5, revision: 6, resolution } });
  if (undone) fixture.practice_import_audit.push({ ...structuredClone(first), id: "00000000-0000-4000-8000-000000000061",
    package_id: `billing-code-reversal:${id}`, action: "revoke-billing-code-exception",
    detail: { oldRevision: 6, revision: 7, revokedResolutionId: id, revokedAt: "2026-10-22T12:01:00Z", approvalNote: "Synthetic explicit undo" } });
  const backup = await sourceBackup(fixture);
  reset();
  const preview = await call("/hub/backup/preview", backup);
  assert.equal(preview.body.canRestore, true, JSON.stringify(preview.body));
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 200);
  assert.deepEqual((await call("/hub/backup")).body.tables, backup.tables);
  const history = await call("/practice-imports");
  assert.equal(history.body.billingResolutionRevision, undone ? 7 : 6);
  assert.equal(history.body.billingResolutions.length, undone ? 5 : 6);
  assert.deepEqual(history.body.billingResolutions.slice(0, 5), original.practice_import_audit
    .filter(row => row.action === "accept-billing-charge-exception").map(row => row.detail.resolution));
  if (!undone) assert.deepEqual(history.body.billingResolutions.at(-1), resolution);
  assert.deepEqual(state.tables.practice_import_snapshots, original.practice_import_snapshots);
  assert.deepEqual(state.tables.practice_import_declarations, original.practice_import_declarations);
});

test("v1 backups with 13 or 17 tables require the earlier release and cannot partially restore", async () => {
  const backup = await sourceBackup();
  for (const legacyTables of [13, 17]) {
    const legacy = structuredClone(backup);
    legacy.format = "emc-business-data-v1";
    if (legacyTables === 13) for (const name of importBackupTables) delete legacy.tables[name];
    reset();
    const result = await call("/hub/backup/preview", legacy);
    assert.equal(result.statusCode, 400);
    assert.match(result.body.error, /matching|earlier release/i);
    assert.match(result.body.error, /partial|incomplete|legacy|v1|13-table/i);
    assert.equal(result.body.token, undefined);
    assert.equal(state.connections, 0);
    assert.ok(!state.queries.some((query) => query.sql.startsWith("INSERT INTO")));
  }
});

test("v2 backups missing import tables or containing authentication tables are rejected before database access", async () => {
  const backup = await sourceBackup();
  for (const missing of [importBackupTables, ...importBackupTables.map((name) => [name])]) {
    const incomplete = structuredClone(backup);
    for (const name of missing) delete incomplete.tables[name];
    reset();
    const result = await call("/hub/backup/preview", incomplete);
    assert.equal(result.statusCode, 400);
    assert.match(result.body.error, /complete|missing|17/i);
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

for (const [name, mutate] of invalidImportBackupCases) {
  test(`preview rejects ${name} without an INSERT or occupied target`, async () => {
    const backup = await sourceBackup();
    mutate(backup.tables);
    reset();
    const before = structuredClone(state.tables);
    const result = await call("/hub/backup/preview", backup);
    assert.equal(result.statusCode, 400);
    assert.ok(result.body.error);
    assert.ok(!result.body.token);
    assert.ok(!state.queries.some((query) => query.sql.startsWith("INSERT INTO")));
    assert.deepEqual(state.tables, before);
  });

  test(`restore independently rejects cached ${name} before any INSERT`, async () => {
    const backup = await sourceBackup();
    reset();
    const preview = await call("/hub/backup/preview", backup);
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.canRestore, true);
    // Model a malformed cached preview while keeping its digest internally consistent.
    const cached = testPreviews.get(preview.body.token);
    mutate(cached.backup.tables);
    cached.digest = createHash("sha256").update(JSON.stringify(cached.backup)).digest("hex");
    const before = structuredClone(state.tables);
    state.queries = [];
    const result = await call("/hub/backup/restore", { ...restoreBody(preview), digest: cached.digest });
    assert.ok([400, 409].includes(result.statusCode), `${result.statusCode}: ${JSON.stringify(result.body)}`);
    assert.ok(!state.queries.some((query) => query.sql.startsWith("INSERT INTO")));
    assert.deepEqual(state.tables, before);
  });
}

test("valid restoration is readable by actual GET /practice-imports in the synthetic scope", async () => {
  const backup = await sourceBackup();
  reset();
  const preview = await call("/hub/backup/preview", backup);
  assert.equal(preview.body.canRestore, true);
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 200);
  const history = await call("/practice-imports");
  assert.equal(history.statusCode, 200);
  assert.equal(history.body.snapshots.length, 2);
  assert.equal(history.body.packages.length, 1);
  assert.equal(history.body.billingResolutions.length, 5);
  assert.equal(history.body.billingResolutionRevision, 5);
  assert.equal(history.body.declarations.data.historicalBillingProviders.length, 1);
  assert.deepEqual(history.body.declarations.data.mappings, backup.tables.practice_import_declarations[0].data.mappings);
  assert.deepEqual(history.body.billingCodeMinutes, backup.tables.practice_import_packages[0].billing_code_minutes);
  assert.deepEqual(history.body.sameDayVisitOverrides, backup.tables.practice_import_packages[0].same_day_visit_overrides);
  assert.ok(state.readerScopes.length > 0);
  assert.ok(state.readerScopes.every((scope) => scope[0] === "synthetic-backup" && scope[1] === "synthetic-backup"));
});

test("preview owns an isolated copy of the reviewed rows", async () => {
  const backup = await sourceBackup();
  const expected = structuredClone(backup.tables);
  reset();
  const preview = await call("/hub/backup/preview", backup);
  assert.equal(preview.body.canRestore, true);
  backup.tables.practice_import_declarations[0].data.mappings = "broken-after-review";
  backup.tables.practice_import_audit[0].detail.resolution.approvalNote = "Changed after review";
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 200);
  assert.deepEqual((await call("/hub/backup")).body.tables, expected);
});

test("signed adjustments, unknown codes and deleted-prefix historical labels roundtrip without coercion and remain readable", async () => {
  const fixture = syntheticHistoricalFactsBackup(7, 1);
  const backup = await sourceBackup(fixture);
  reset();
  const preview = await call("/hub/backup/preview", backup);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.canRestore, true);
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 200);
  assert.deepEqual((await call("/hub/backup")).body.tables, backup.tables);
  const history = await call("/practice-imports");
  assert.equal(history.statusCode, 200);
  const billing = history.body.snapshots.find((row) => row.kind === "billing");
  const adjustments = billing.rows.filter((row) => row.totalFeeCharged < 0);
  assert.deepEqual(adjustments.map((row) => row.totalFeeCharged), [-5, -10, -15, -20, -25]);
  assert.deepEqual(adjustments.map((row) => row.billingCode), ["", null, "0", "unclassified", "   "]);
  assert.ok(adjustments.every((row) => row.clinician === "(deleted) Synthetic Former Clinician"));
  for (const snapshot of history.body.snapshots)
    assert.deepEqual(snapshot.rows, fixture.practice_import_snapshots.find((row) => row.kind === snapshot.kind && row.active === 1).rows);
  assert.equal(history.body.billingResolutionRevision, 5);
  assert.equal(history.body.billingResolutions[4].clinicianLabel, "(deleted) Synthetic Former Clinician");
  assert.equal(history.body.declarations.data.historicalBillingProviders[0].sourceLabel, "(deleted) Synthetic Former Clinician");
});

test("archived sources and stale approval anchors restore unchanged and remain readable", async () => {
  const fixture = syntheticStaleImportBackup(7, 1);
  const backup = await sourceBackup(fixture);
  reset();
  const preview = await call("/hub/backup/preview", backup);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.canRestore, true);
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 200);
  assert.deepEqual((await call("/hub/backup")).body.tables, backup.tables);
  const history = await call("/practice-imports");
  assert.equal(history.statusCode, 200);
  assert.equal(history.body.billingResolutions.length, 5);
  const billing = history.body.snapshots.find((row) => row.kind === "billing");
  assert.equal(billing.id, `billing-${"d".repeat(64)}`);
  assert.ok(history.body.billingResolutions.every((row) => row.charges.every((charge) => charge.anchor.snapshotId !== billing.id)));
});

test("multiple historical scopes roundtrip without remapping to the configured reader scope", async () => {
  const primary = syntheticImportBackup(7, 1);
  const secondary = syntheticImportBackup(7, 1);
  const idMap = new Map();
  for (const table of importBackupTables) for (const row of secondary[table]) {
    row.practice_id = "synthetic-historical-scope";
    row.account_id = "synthetic-historical-account";
    if (row.id) { const next = row.id.replace(/^00000000/, "11111111"); idMap.set(row.id, next); row.id = next; }
  }
  for (const row of secondary.practice_import_snapshots) row.package_import_id = idMap.get(row.package_import_id);
  const fixture = Object.fromEntries(importBackupTables.map((name) => [name, [...primary[name], ...secondary[name]]]));
  const backup = await sourceBackup(fixture);
  reset();
  const preview = await call("/hub/backup/preview", backup);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.canRestore, true);
  assert.equal((await call("/hub/backup/restore", restoreBody(preview))).statusCode, 200);
  assert.deepEqual((await call("/hub/backup")).body.tables, backup.tables);
  const history = await call("/practice-imports");
  assert.equal(history.body.snapshots.length, 2);
  assert.equal(history.body.billingResolutionRevision, 5);
});
