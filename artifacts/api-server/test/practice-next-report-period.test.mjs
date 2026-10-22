import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const local = path => fileURLToPath(new URL(path, import.meta.url));
// Bundle the actual route and planner. Only the database entry point is virtualized;
// importing the real DB entry point would initialize its connection pool.
const bundle = await build({
  stdin: {
    contents: readFileSync(new URL("../src/routes/practiceImports.ts", import.meta.url), "utf8")
      + "\nexport { state } from '@workspace/db';\nexport { prepareBillingChargeResolution } from '@workspace/practice/hub';",
    loader: "ts", resolveDir: local("../src/routes/"),
  },
  bundle: true, write: false, platform: "node", format: "cjs",
  alias: { "@workspace/practice/hub": local("../../../lib/practice/src/hub/index.ts"),
    "@workspace/practice": local("../../../lib/practice/src/index.ts") },
  plugins: [{ name: "database-free-next-period", setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "virtual-db" }));
    builder.onLoad({ filter: /.*/, namespace: "virtual-db" }, () => ({ resolveDir: local("../"), contents: `
      export * from ${JSON.stringify(local("../../../lib/db/src/schema/hub.ts"))};
      export * from ${JSON.stringify(local("../../../lib/db/src/schema/clinicians.ts"))};
      import { PgDialect } from "drizzle-orm/pg-core";
      import { getTableName } from "drizzle-orm";
      const dialect = new PgDialect();
      export const state = { saved: null, snapshots: [], packages: [], roster: [], audits: [], queries: [], writes: [], failAudit: false };
      const scope = (practice, account) => {
        if (practice !== "synthetic-next-period" || account !== practice) throw new Error("Unexpected tenant scope");
      };
      const rowsFor = table => {
        const name = getTableName(table);
        if (name === "clinicians") return state.roster;
        if (name === "practice_import_snapshots") return state.snapshots;
        if (name === "practice_import_packages") return state.packages;
        throw new Error("Unexpected table " + name);
      };
      const tx = {
        async execute(statement) {
          const query = dialect.sqlToQuery(statement); state.queries.push(query);
          const sql = query.sql.trim(), params = query.params;
          if (sql.startsWith("SELECT pg_advisory_xact_lock")) { scope(...params); return { rows: [] }; }
          if (sql.includes("to_regclass")) return { rows: [{ available: true }] };
          if (sql.startsWith("SELECT revision, data")) {
            scope(...params); return { rows: state.saved ? [structuredClone(state.saved)] : [] };
          }
          if (sql.startsWith("SELECT detail FROM practice_import_audit")) {
            scope(...params);
            const action = sql.includes("accept-billing-charge-exception") ? "accept-billing-charge-exception" : "confirm-historical-billing-providers";
            return { rows: state.audits.filter(row => row.practiceId === params[0] && row.accountId === params[1] && row.action === action)
              .map(row => ({ detail: structuredClone(row.detail) })) };
          }
          if (sql.startsWith("SELECT package_id, detail FROM practice_import_audit")) {
            scope(...params);
            return { rows: state.audits.filter(row => row.practiceId === params[0] && row.accountId === params[1]
              && ["import", "retain-overlap", "replace-overlap"].includes(row.action))
              .map(row => ({ package_id: row.packageId, detail: structuredClone(row.detail) })) };
          }
          if (sql.startsWith("INSERT INTO practice_import_declarations")) {
            scope(...params);
            if ((state.saved?.revision ?? 0) !== params[5]) return { rows: [] };
            state.writes.push("declarations");
            state.saved = { revision: params[2], data: JSON.parse(params[3]), confirmed_at: "2026-10-22T12:00:00Z", actor: params[4] };
            return { rows: [{ revision: params[2] }] };
          }
          if (sql.startsWith("INSERT INTO practice_import_snapshots")) {
            const [id, packageImportId, practiceId, accountId, kind, coverageStart, coverageEnd, sourceHash, rowCount, rows, proof] = params;
            scope(practiceId, accountId); state.writes.push("snapshots");
            state.snapshots.push({ id, packageImportId, practiceId, accountId, kind, coverageStart, coverageEnd, sourceHash, rowCount,
              rows: JSON.parse(rows), reportCoverage: proof ? JSON.parse(proof) : null, active: 1, createdAt: new Date("2026-10-22T12:00:00Z") });
            return { rows: [] };
          }
          throw new Error("Unhandled SQL in database-free test: " + sql);
        },
        select() { return {
          from(table) { this.table = table; return this; },
          then(resolve, reject) { return Promise.resolve(structuredClone(rowsFor(this.table))).then(resolve, reject); },
          async where(condition) {
            const query = dialect.sqlToQuery(condition), params = query.params;
            scope(...params);
            return structuredClone(rowsFor(this.table).filter(row => row.practiceId === params[0] && row.accountId === params[1]
              && (/"package_id"/.test(query.sql) ? row.packageId === params[2] : row.active === 1)));
          },
        }; },
        insert(table) { return { async values(value) {
          scope(value.practiceId, value.accountId);
          if (getTableName(table) === "practice_import_audit") {
            if (state.failAudit) throw new Error("Synthetic audit failure");
            state.writes.push("audit"); state.audits.push(structuredClone(value));
          } else if (getTableName(table) === "practice_import_packages") {
            state.writes.push("packages");
            state.packages.push({ active: 1, importedAt: new Date("2026-10-22T12:00:00Z"), ...structuredClone(value) });
          } else throw new Error("Unexpected insert");
        } }; },
      };
      export const db = { execute: tx.execute, select: tx.select, async transaction(callback) {
        const before = structuredClone(state);
        try { return await callback(tx); } catch (error) { Object.assign(state, before); throw error; }
      } };
    ` }));
  } }],
});
const compiled = { exports: {} };
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ["2026-10-22T12:00:00Z"])); }
  static now() { return Date.parse("2026-10-22T12:00:00Z"); }
}
new Function("module", "exports", "require", "Date", bundle.outputFiles[0].text)(compiled, compiled.exports, require, FixedDate);
const { default: router, state, prepareBillingChargeResolution } = compiled.exports;
const route = (method, path) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle;
const put = route("put", "/practice-imports/declarations");
const get = route("get", "/practice-imports");
const post = route("post", "/practice-imports/package");
const practiceId = "synthetic-next-period";
const ids = { oldAttendance: "attendance-00000001", oldBilling: "billing-00000001", attendance: "attendance-00000002", billing: "billing-00000002" };
const row = (clientId, serviceDate, sourceRowHash = clientId) => ({ clientId, serviceDate, sourceRowHash,
  clinician: "Synthetic Lane", status: "show", location: "Room A", billingCode: "90837", totalFeeCharged: 100 });
const source = (kind, hash, packageImportId, rows, start, end) => ({ id: `stored-${kind}-${hash}`, kind, sourceHash: hash,
  packageImportId, practiceId, accountId: practiceId, active: 1, rows, rowCount: rows.length,
  coverageStart: start, coverageEnd: end, reportCoverage: null, createdAt: new Date("2026-10-22T12:00:00Z") });
const packageRow = id => ({ id, packageId: `synthetic-${id}`, practiceId, accountId: practiceId, active: 1,
  contentHash: id, importedAt: new Date("2026-10-22T12:00:00Z"), exportedAt: new Date("2026-10-22T00:00:00Z"),
  billingCodeMinutes: {}, sameDayVisitOverrides: [] });
function reset() {
  process.env.EMC_PRACTICE_ID = practiceId;
  const carry = Array.from({ length: 25 }, (_, i) => row(`synthetic-boundary-${i}`, "2026-10-07", `old-${i}`));
  const data = { version: 1, mappings: [{ sourceLabel: "Synthetic Lane", clinicianId: 1, clinicianLabel: "Synthetic Lane", teamId: 7 }],
    sourceSets: ["attendance", "billing"].map(kind => ({ kind, snapshotIds: [kind === "attendance" ? ids.oldAttendance : ids.oldBilling],
      clinicianIds: [1], start: "2026-09-10", end: "2026-10-12", complete: true })) };
  const dates = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 8).padStart(2, "0")}`);
  Object.assign(state, { saved: { revision: 4, data, confirmed_at: "2026-10-13T00:00:00Z" },
    snapshots: [
      source("attendance", "00000001", "prior", [...carry, row("synthetic-overlap", "2026-10-12")], "2026-09-10", "2026-10-12"),
      source("billing", "00000001", "prior", [row("synthetic-billing-boundary", "2026-10-07"), row("synthetic-overlap", "2026-10-12")], "2026-09-10", "2026-10-12"),
      source("attendance", "00000002", "next", [...carry.map((r, i) => ({ ...r, sourceRowHash: `new-${i}` })),
        ...dates.map(date => row(date === "2026-10-12" ? "synthetic-overlap" : `synthetic-${date}`, date, `new-${date}`))], "2026-10-07", "2026-10-21"),
      source("billing", "00000002", "next", dates.map(date => row(date === "2026-10-12" ? "synthetic-overlap" : `synthetic-${date}`, date, `new-billing-${date}`)), "2026-10-08", "2026-10-21"),
    ], packages: [packageRow("prior"), packageRow("next")], roster: [{ id: 1, label: "Synthetic Lane", goalId: 7 }],
    audits: [], queries: [], writes: [], failAudit: false });
}
function proposal() {
  const data = structuredClone(state.saved.data);
  for (const kind of ["attendance", "billing"]) data.sourceSets.push({ kind, clinicianIds: [1],
    snapshotIds: [kind === "attendance" ? ids.oldAttendance : ids.oldBilling, ids[kind]],
    start: "2026-09-10", end: "2026-10-21", complete: true });
  return { expectedRevision: 4, confirmed: true, data, nextPeriod: { packageId: "synthetic-next", sourceIds: [ids.attendance, ids.billing], teamId: 7 } };
}
async function call(handler, body) {
  const res = { locals: { actor: "synthetic-owner" }, statusCode: 200,
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body }, res); return res;
}
const durable = () => structuredClone({ saved: state.saved, snapshots: state.snapshots, packages: state.packages, roster: state.roster, audits: state.audits });
async function reviewWithoutWrites(payload, reason) {
  const before = durable(), response = await call(put, payload);
  assert.equal(response.statusCode, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, "NEXT_PERIOD_REVIEW_REQUIRED");
  if (reason) assert.match(response.body.error, reason);
  assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
  return response;
}

test("ready PUT rederives Oct 8-21 from the Oct 12 frozen end, matches 25 copies, and atomically audits only metadata", async () => {
  reset(); const payload = proposal(), before = durable();
  const response = await call(put, payload);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.declarations.revision, 5);
  assert.deepEqual(response.body.declarations.data, payload.data);
  assert.deepEqual(state.saved.data.sourceSets.slice(0, 2), before.saved.data.sourceSets);
  assert.deepEqual(state.snapshots, before.snapshots); assert.deepEqual(state.packages, before.packages); assert.deepEqual(state.roster, before.roster);
  assert.deepEqual(state.writes, ["declarations", "audit"]);
  assert.equal(state.audits.length, 1);
  const audit = state.audits[0];
  assert.equal(audit.action, "confirm-import-declarations"); assert.equal(audit.actor, "synthetic-owner");
  assert.equal(audit.practiceId, practiceId); assert.equal(audit.accountId, practiceId);
  assert.equal(audit.detail.basis, "known-next-reporting-period"); assert.equal(audit.detail.revision, 5);
  assert.deepEqual(audit.detail.newDeclarations, payload.data);
  assert.deepEqual(audit.detail.oldDeclarations.data, before.saved.data);
  assert.deepEqual(audit.detail.nextPeriod, { period: { start: "2026-10-08", end: "2026-10-21", payDate: "2026-10-22" },
    sourceIds: [ids.attendance, ids.billing], carryover: { rows: 25, matched: 25, conflicts: 0 } });
  assert.ok(state.queries.every(q => !/UPDATE "?clinicians|UPDATE "?practice_import_snapshots|DELETE|ALTER|CREATE TABLE/.test(q.sql)));
});

test("carryover changed after proposal requires review with zero writes", async () => {
  for (const change of [
    rows => { rows[0].status = "cancelled"; },
    rows => { rows[0].location = "Changed room"; },
    rows => { rows.push({ ...rows[0], sourceRowHash: "extra-multiplicity" }); },
    rows => { rows[0].clientId = "synthetic-novel-client"; },
  ]) {
    reset(); const payload = proposal(); change(state.snapshots[2].rows);
    await reviewWithoutWrites(payload, /carryover/);
  }
});

test("forged proposal, extended future period and unselected membership cannot bypass the live plan", async () => {
  for (const change of [
    p => { p.data.sourceSets[2].end = "2026-10-22"; },
    p => { p.data.sourceSets[2].start = "2026-09-11"; },
    p => { p.data.sourceSets[0].end = "2026-10-13"; },
    p => { p.data.sourceSets[2].snapshotIds.push("attendance-00000003"); },
  ]) {
    reset(); state.snapshots.push(source("attendance", "00000003", "unchecked", [row("unchecked", "2026-10-15")], "2026-10-15", "2026-10-15"));
    const payload = proposal(); change(payload); await reviewWithoutWrites(payload);
  }
});

test("future raw facts and missing, duplicate, wrong-kind or unselected source choices require review", async () => {
  for (const change of [
    p => { p.nextPeriod.sourceIds = [ids.attendance, "billing-ffffffff"]; },
    p => { p.nextPeriod.sourceIds = [ids.attendance, ids.attendance]; },
    p => { p.nextPeriod.sourceIds = [ids.attendance, ids.oldAttendance]; },
    p => { p.nextPeriod.sourceIds = [ids.oldAttendance, ids.oldBilling]; },
    () => { state.snapshots[2].rows.push(row("synthetic-future", "2026-10-22")); state.snapshots[2].coverageEnd = "2026-10-22"; },
    () => { state.snapshots[2].active = 0; },
    () => { state.snapshots[2].practiceId = "other-practice"; },
  ]) { reset(); const payload = proposal(); change(payload); await reviewWithoutWrites(payload); }
});

test("stale expectedRevision rejects before any declaration or audit write", async () => {
  reset(); const payload = proposal(); state.saved.revision++;
  const before = durable(), response = await call(put, payload);
  assert.equal(response.statusCode, 409); assert.match(response.body.error, /changed.*Reload/);
  assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
});

test("next-period approval still requires expectedRevision, confirmed true and an exact two-source request", async () => {
  for (const change of [
    p => { delete p.expectedRevision; },
    p => { p.confirmed = false; },
    p => { delete p.data; },
    p => { delete p.nextPeriod.packageId; },
    p => { p.nextPeriod.packageId = ""; },
    p => { p.nextPeriod.sourceIds = [ids.attendance]; },
    p => { p.nextPeriod.sourceIds.push(ids.oldBilling); },
    p => { p.nextPeriod.sourceIds[1] = "billing-not-an-exact-hash"; },
    p => { p.nextPeriod.teamId = "7"; },
    p => { p.nextPeriod.unverifiedApproval = true; },
  ]) {
    reset(); const payload = proposal(); change(payload); const before = durable();
    assert.equal((await call(put, payload)).statusCode, 400);
    assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
  }
});

test("canonical proposal comparison accepts reordered object keys but rejects already-applied approval", async () => {
  reset(); const payload = proposal();
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
  payload.data = reverseKeys(payload.data);
  const response = await call(put, payload);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.declarations.data, payload.data);
  const replay = { ...payload, expectedRevision: 5 };
  state.writes = [];
  await reviewWithoutWrites(replay, /proposal changed/);
});

test("another provider, another team and a moved or renamed mapping block approval", async () => {
  for (const change of [
    p => { p.nextPeriod.teamId = 8; },
    () => { state.roster[0].goalId = 8; },
    () => { state.roster[0].label = "Renamed Synthetic"; },
    () => { state.roster.push({ id: 2, label: "Other Synthetic", goalId: 7 }); state.snapshots[2].rows.at(-1).clinician = "Other Synthetic"; },
  ]) { reset(); const payload = proposal(); change(payload); await reviewWithoutWrites(payload, /provider|mapping|team/i); }
});

test("audit failure rolls back the new revision while preserving frozen sets, raw rows and journal", async () => {
  reset(); state.failAudit = true; const before = structuredClone(state);
  await assert.rejects(call(put, proposal()), /Synthetic audit failure/);
  assert.deepEqual(state, before);
});

test("ordinary legacy PUT remains an explicit owner confirmation without nextPeriod", async () => {
  reset(); const payload = { expectedRevision: 4, confirmed: true, data: structuredClone(state.saved.data) }, before = durable();
  const response = await call(put, payload);
  assert.equal(response.statusCode, 200); assert.equal(response.body.declarations.revision, 5);
  assert.deepEqual(state.saved.data, payload.data); assert.deepEqual(state.snapshots, before.snapshots);
  assert.deepEqual(state.writes, ["declarations", "audit"]);
  assert.equal(state.audits[0].detail.basis, "owner-confirmation"); assert.ok(!Object.hasOwn(state.audits[0].detail, "nextPeriod"));
});

test("history GET sourceIds follow package foreign keys even when timestamps coincide", async () => {
  reset(); state.packages.push(packageRow("empty"));
  state.snapshots.push({ ...structuredClone(state.snapshots[2]), id: "archived", sourceHash: "00000003", active: 0 },
    { ...structuredClone(state.snapshots[2]), id: "foreign", sourceHash: "00000004", accountId: "other-account" });
  const before = durable(), response = await call(get);
  assert.equal(response.statusCode, 200);
  const packages = new Map(response.body.packages.map(p => [p.packageId, p.sourceIds]));
  assert.deepEqual(packages.get("synthetic-prior"), [ids.oldAttendance, ids.oldBilling].sort());
  assert.deepEqual(packages.get("synthetic-next"), [ids.attendance, ids.billing].sort());
  assert.deepEqual(packages.get("synthetic-empty"), []);
  assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
});

const receipt = (sourceIds, overrides = {}) => ({ id: "synthetic-receipt", practiceId, accountId: practiceId,
  packageId: "synthetic-next", action: "import", detail: { sourceIds }, ...overrides });

test("PUT rejects an otherwise-ready unrelated source pair and missing or out-of-scope package binding", async () => {
  reset();
  const unrelated = state.snapshots.slice(2).map(snapshot => ({ ...structuredClone(snapshot),
    id: `${snapshot.kind}-unrelated`, sourceHash: "00000003", packageImportId: "unrelated" }));
  state.snapshots.push(...unrelated); state.packages.push(packageRow("unrelated"));
  const payload = proposal();
  payload.nextPeriod.sourceIds = ["attendance-00000003", "billing-00000003"];
  for (const set of payload.data.sourceSets.slice(2)) set.snapshotIds[1] = `${set.kind}-00000003`;
  await reviewWithoutWrites(payload, /does not match the saved upload/);
  for (const change of [
    p => { p.nextPeriod.packageId = "missing-package"; },
    () => { state.packages[1].active = 0; },
    () => { state.packages[1].practiceId = "other-practice"; },
    () => { state.packages[1].accountId = "other-account"; },
  ]) { reset(); const p = proposal(); change(p); await reviewWithoutWrites(p, /does not match the saved upload/); }
});

test("matching import receipts admit reused sources on reload and PUT without changing ownership", async () => {
  reset(); state.snapshots[2].packageImportId = "prior";
  const pair = [ids.attendance, ids.billing];
  state.audits.push(receipt(pair), receipt([...pair].reverse(), { id: "synthetic-repeat-receipt", action: "retain-overlap" }),
    receipt([ids.oldAttendance, ids.oldBilling], { id: "foreign-receipt", accountId: "other-account" }));
  const before = durable(), history = await call(get);
  assert.deepEqual(history.body.packages.find(p => p.packageId === "synthetic-next").sourceIds, [...pair].sort());
  assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
  const response = await call(put, proposal());
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.deepEqual(state.snapshots, before.snapshots); assert.deepEqual(state.audits.slice(0, 3), before.audits);
  assert.deepEqual(state.writes, ["declarations", "audit"]);
});

test("inconsistent or invalid receipts block GET membership and PUT despite an exact owned fallback pair", async () => {
  for (const invalid of [
    [ids.oldAttendance, ids.oldBilling], null, [], [ids.attendance], [ids.attendance, ids.attendance],
    [ids.attendance, "billing-ffffffff"], [ids.attendance, ids.billing, ids.oldBilling],
  ]) {
    reset(); state.audits.push(receipt([ids.attendance, ids.billing]), receipt(invalid, { id: "synthetic-inconsistent-receipt" }));
    const before = durable(), history = await call(get);
    assert.deepEqual(history.body.packages.find(p => p.packageId === "synthetic-next").sourceIds, []);
    assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
    await reviewWithoutWrites(proposal(), /does not match the saved upload/);
  }
});

test("legacy fallback requires exactly two owned snapshots, one per collection", async () => {
  for (const change of [
    () => { state.snapshots[2].packageImportId = "prior"; },
    () => { state.snapshots.push({ ...structuredClone(state.snapshots[2]), id: "extra-owned", sourceHash: "00000003" }); },
    () => { state.snapshots[3].kind = "attendance"; },
  ]) {
    reset(); change(); const history = await call(get);
    assert.deepEqual(history.body.packages.find(p => p.packageId === "synthetic-next").sourceIds, []);
    await reviewWithoutWrites(proposal(), /does not match the saved upload/);
  }
});

function approvedCharges() {
  reset();
  const charges = [135, 150].map((amount, i) => ({ ...row("synthetic-approved", "2026-10-12", `anchor-${i}`), totalFeeCharged: amount }));
  state.snapshots[1].rows = [state.snapshots[1].rows[0], ...charges];
  state.snapshots[3].rows = [...state.snapshots[3].rows.filter(r => r.serviceDate !== "2026-10-12"),
    ...charges.map((r, i) => ({ ...r, sourceRowHash: `reexport-${i}` }))];
  const draft = prepareBillingChargeResolution(charges.map(row => ({ row, snapshotId: ids.oldBilling })));
  assert.ok(draft);
  const resolution = { ...draft, clinicianId: 1, id: "00000000-0000-4000-8000-000000000001", approvalToken: "a".repeat(64),
    confirmedAt: "2026-10-16T00:00:00Z", approvalNote: "Synthetic owner approves two charges" };
  state.audits.push({ id: "synthetic-prior-approval", practiceId, accountId: practiceId, action: "accept-billing-charge-exception",
    packageId: "billing-resolutions", actor: "synthetic-owner", detail: { revision: 1, oldRevision: 0, resolution } });
}

function frozenHistoricalAttendance() {
  approvedCharges();
  const historical = { ...row("synthetic-former", "2026-09-23"), clinician: "(deleted) Synthetic Former" };
  for (const snapshot of state.snapshots.slice(0, 2)) {
    snapshot.rows.push(structuredClone(historical));
    snapshot.rowCount = snapshot.rows.length;
  }
  const providers = [{ id: "00000000-0000-4000-8000-000000000002", sourceLabel: historical.clinician,
    sourceSets: [{ snapshotIds: [ids.oldBilling], start: "2026-09-10", end: "2026-10-12", complete: true }] }];
  state.audits.push({ id: "synthetic-historical-registry", practiceId, accountId: practiceId,
    action: "confirm-historical-billing-providers", packageId: "historical-billing-providers", actor: "synthetic-owner",
    detail: { version: 1, declarationRevision: 4, providers } });
  return providers;
}

test("PUT accepts already-confirmed historical billing-only labels in frozen attendance and preserves both journals", async () => {
  const providers = frozenHistoricalAttendance(), payload = proposal(), before = durable();
  payload.data.historicalBillingProviders = structuredClone(providers);
  const response = await call(put, payload);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.declarations.revision, 5);
  assert.deepEqual(response.body.declarations.data, payload.data);
  assert.deepEqual(response.body.declarations.data.historicalBillingProviders, providers);
  assert.deepEqual(response.body.declarations.data.mappings, before.saved.data.mappings);
  for (const set of response.body.declarations.data.sourceSets) assert.deepEqual(set.clinicianIds, [1]);
  assert.deepEqual(state.saved.data.sourceSets.slice(0, 2), before.saved.data.sourceSets);
  assert.deepEqual(state.saved.data.mappings, before.saved.data.mappings);
  assert.ok(!Object.hasOwn(state.saved.data, "historicalBillingProviders"));
  assert.ok(!Object.hasOwn(state.saved.data, "billingResolutions"));
  assert.deepEqual(response.body.billingResolutions, [before.audits[0].detail.resolution]);
  assert.equal(response.body.billingResolutionRevision, 1);
  assert.deepEqual(state.audits.slice(0, 2), before.audits);
  assert.equal(state.audits.length, 3);
  assert.equal(state.audits[2].action, "confirm-import-declarations");
  assert.equal(state.audits[2].detail.basis, "known-next-reporting-period");
  assert.deepEqual(state.audits[2].detail.nextPeriod.carryover, { rows: 25, matched: 25, conflicts: 0 });
  assert.deepEqual(state.snapshots, before.snapshots);
  assert.deepEqual(state.packages, before.packages);
  assert.deepEqual(state.roster, before.roster);
  assert.deepEqual(state.writes, ["declarations", "audit"]);
  const after = durable(), reloaded = await call(get);
  assert.deepEqual(reloaded.body.declarations.data.historicalBillingProviders, providers);
  assert.deepEqual(reloaded.body.billingResolutions, response.body.billingResolutions);
  assert.deepEqual(durable(), after);
  assert.deepEqual(state.writes, ["declarations", "audit"]);
});

test("PUT rejects unclassified frozen historical attendance with an actionable provider label and zero writes", async () => {
  frozenHistoricalAttendance();
  state.audits = state.audits.filter(audit => audit.action !== "confirm-historical-billing-providers");
  const response = await reviewWithoutWrites(proposal(), /Frozen member attendance-00000001 has an unmapped or out-of-scope provider/);
  assert.ok(response.body.error.includes(JSON.stringify("(deleted) Synthetic Former")), response.body.error);
});

test("PUT rederives with the saved billing journal and preserves approvals and original anchors", async () => {
  approvedCharges(); const before = durable();
  const response = await call(put, proposal());
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.billingResolutionRevision, 1);
  assert.deepEqual(response.body.billingResolutions, [before.audits[0].detail.resolution]);
  assert.deepEqual(state.audits.slice(0, 1), before.audits);
  assert.deepEqual(state.snapshots, before.snapshots); assert.deepEqual(state.roster, before.roster);
  assert.deepEqual(state.saved.data.sourceSets.slice(0, 2), before.saved.data.sourceSets);
  assert.ok(!Object.hasOwn(state.saved.data, "billingResolutions"));
  assert.deepEqual(state.writes, ["declarations", "audit"]);
  approvedCharges(); const payload = proposal(); state.audits = [];
  await reviewWithoutWrites(payload, /Billing evidence requires reconciliation/);
});

test("journal changes after proposal and stale approval anchors cannot authorize ambiguous charges", async () => {
  for (const change of [
    () => { state.audits[0].detail.resolution.charges[0].anchor.sourceRowHash = "missing-anchor"; },
    () => { state.audits[0].accountId = "other-account"; },
    () => { state.snapshots[3].rows.at(-1).totalFeeCharged = 175; },
  ]) { approvedCharges(); const payload = proposal(); change(); await reviewWithoutWrites(payload); }
});

test("audit failure also rolls back a ready proposal backed by an existing billing journal", async () => {
  approvedCharges(); state.failAudit = true; const before = structuredClone(state);
  await assert.rejects(call(put, proposal()), /Synthetic audit failure/);
  assert.deepEqual(state, before);
});

test("raw POST returns exact validated collection references, including duplicate imports", async () => {
  reset(); state.snapshots = []; state.packages = []; state.saved = null;
  const input = { format: "emc-practice-local-import-package", version: 1, packageId: "synthetic-post-only", exportedAt: "2026-10-22T00:00:00Z",
    collections: Object.fromEntries(["attendance", "billing"].map(kind => [kind, {
      coverageStart: "2026-10-21", coverageEnd: "2026-10-21", rowCount: 1,
      rows: [{ clientId: "synthetic-post", clinician: "Synthetic Lane", serviceDate: "2026-10-21",
        ...(kind === "attendance" ? { status: "show", location: null } : { totalFeeCharged: 100, billingCode: "90837" }) }],
    }])), billingCodeMinutes: { "90837": 50 } };
  const original = structuredClone(input), response = await call(post, { package: input });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body)); assert.equal(response.body.status, "added");
  const actual = state.snapshots.map(snapshot => `${snapshot.kind}-${snapshot.sourceHash}`);
  assert.equal(actual.length, 2); assert.equal(new Set(actual).size, 2);
  assert.deepEqual(response.body.importedSourceIds, actual);
  assert.deepEqual(state.audits[0].detail.sourceIds, actual);
  assert.deepEqual(response.body.packages[0].sourceIds, [...actual].sort());
  assert.ok(actual.every(id => /^(attendance|billing)-[0-9a-f]{8,64}$/.test(id)));
  assert.deepEqual(input, original);
  const before = durable(), duplicate = await call(post, { package: input });
  assert.equal(duplicate.statusCode, 200); assert.equal(duplicate.body.status, "duplicate");
  assert.deepEqual(duplicate.body.importedSourceIds, actual); assert.deepEqual(durable(), before);
  const invalid = structuredClone(input); invalid.collections.attendance.rowCount = 2;
  const rejected = await call(post, { package: invalid });
  assert.equal(rejected.statusCode, 400); assert.ok(!Object.hasOwn(rejected.body, "importedSourceIds")); assert.deepEqual(durable(), before);
  const partial = structuredClone(input); partial.packageId = "synthetic-post-reused";
  partial.collections.billing.rows[0].totalFeeCharged = 125;
  const retained = await call(post, { package: partial, retainOverlaps: true });
  assert.equal(retained.statusCode, 200, JSON.stringify(retained.body)); assert.equal(retained.body.status, "retained");
  assert.equal(state.snapshots.length, 3, "Unchanged attendance source is reused without another snapshot");
  const reusedPair = retained.body.importedSourceIds;
  assert.equal(reusedPair.length, 2); assert.equal(reusedPair[0], actual[0]); assert.notEqual(reusedPair[1], actual[1]);
  assert.deepEqual(state.audits.at(-1).detail.sourceIds, reusedPair, "Receipt includes reused attendance and newly inserted billing");
  assert.equal(state.snapshots.filter(s => s.packageImportId === state.packages[1].id).length, 1);
  const reloadBefore = durable(), reloaded = await call(get);
  assert.deepEqual(reloaded.body.packages.find(p => p.packageId === partial.packageId).sourceIds, [...reusedPair].sort());
  assert.deepEqual(durable(), reloadBefore);
});
