import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const local = path => fileURLToPath(new URL(path, import.meta.url));
const routeSource = readFileSync(local("../src/routes/practiceImports.ts"), "utf8");
// Load the real routes and backup parser, but never initialize the database pool.
const bundle = await build({
  stdin: { contents: routeSource + `
    export { state, control } from '@workspace/db';
    export { prepareBillingChargeResolution, reconcileBillingEvidence } from '@workspace/practice/hub';
    export { parseBillingResolutionJournal } from '../lib/import-backup-validation';`,
    loader: "ts", resolveDir: local("../src/routes/") },
  bundle: true, write: false, platform: "node", format: "cjs",
  alias: { "@workspace/practice/hub": local("../../../lib/practice/src/hub/index.ts"),
    "@workspace/practice": local("../../../lib/practice/src/index.ts") },
  plugins: [{ name: "database-free-billing-code-review", setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "virtual-db" }));
    builder.onLoad({ filter: /.*/, namespace: "virtual-db" }, () => ({ resolveDir: local("../"), contents: `
      export * from ${JSON.stringify(local("../../../lib/db/src/schema/hub.ts"))};
      export * from ${JSON.stringify(local("../../../lib/db/src/schema/clinicians.ts"))};
      import { PgDialect } from "drizzle-orm/pg-core";
      import { getTableName } from "drizzle-orm";
      const dialect = new PgDialect();
      export const state = { saved: null, snapshots: [], packages: [], roster: [], audits: [],
        queries: [], reads: [], writes: [], transactions: 0, failAudit: false };
      export const control = { onLock: null };
      const scope = (practice, account) => {
        if (practice !== "synthetic-code-review" || account !== practice) throw new Error("Unexpected tenant scope");
      };
      const rowsFor = table => {
        const name = getTableName(table);
        if (name === "clinicians") return state.roster;
        if (name === "practice_import_snapshots") return state.snapshots;
        if (name === "practice_import_packages") return state.packages;
        throw new Error("Unexpected read table " + name);
      };
      const connection = transactional => ({
        async execute(statement) {
          const query = dialect.sqlToQuery(statement);
          state.queries.push({ ...query, transactional });
          const sql = query.sql.trim(), params = query.params;
          if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
            scope(...params);
            if (!transactional) throw new Error("Lock outside transaction");
            if (control.onLock) { const mutate = control.onLock; control.onLock = null; mutate(); }
            return { rows: [] };
          }
          if (sql.includes("to_regclass")) return { rows: [{ available: true }] };
          if (sql.startsWith("SELECT revision, data")) {
            scope(...params); return { rows: state.saved ? [structuredClone(state.saved)] : [] };
          }
          if (sql.startsWith("SELECT detail FROM practice_import_audit")) {
            scope(...params);
            // Honor the complete SQL action predicate, including every journal event.
            const predicate = sql.match(/action\\s+(?:IN\\s*\\(([^)]+)\\)|=\\s*('(?:[^']*)'))/i);
            if (!predicate) throw new Error("Missing audit action filter");
            const actions = [...(predicate[1] ?? predicate[2]).matchAll(/'([^']+)'/g)].map(match => match[1]);
            return { rows: state.audits.filter(row => row.practiceId === params[0] && row.accountId === params[1]
              && actions.includes(row.action)).slice(0, 1001).map(row => ({ detail: structuredClone(row.detail) })) };
          }
          if (sql.startsWith("SELECT package_id, detail FROM practice_import_audit")) {
            scope(...params);
            return { rows: state.audits.filter(row => row.practiceId === params[0] && row.accountId === params[1]
              && ["import", "retain-overlap", "replace-overlap"].includes(row.action))
              .map(row => ({ package_id: row.packageId, detail: structuredClone(row.detail) })) };
          }
          throw new Error("Unhandled SQL in database-free test: " + sql);
        },
        select() { return {
          from(table) { this.table = table; return this; },
          then(resolve, reject) {
            state.reads.push({ table: getTableName(this.table), transactional });
            return Promise.resolve(structuredClone(rowsFor(this.table))).then(resolve, reject);
          },
          async where(condition) {
            const query = dialect.sqlToQuery(condition), params = query.params;
            scope(...params);
            if (!/"practice_id"/.test(query.sql) || !/"account_id"/.test(query.sql) || !/"active"/.test(query.sql))
              throw new Error("Missing tenant or active-source filter");
            state.reads.push({ table: getTableName(this.table), transactional, ...query });
            return structuredClone(rowsFor(this.table).filter(row => row.practiceId === params[0]
              && row.accountId === params[1] && row.active === params[2]));
          },
        }; },
        insert(table) { return { async values(value) {
          scope(value.practiceId, value.accountId);
          if (!transactional || getTableName(table) !== "practice_import_audit") throw new Error("Unexpected write");
          state.writes.push("audit"); state.audits.push(structuredClone(value));
          if (state.failAudit) throw new Error("Synthetic audit failure");
        } }; },
      });
      const tx = connection(true), reader = connection(false);
      export const db = { ...reader, async transaction(callback) {
        const before = structuredClone(state);
        state.transactions++;
        try { return await callback(tx); } catch (error) { Object.assign(state, before); throw error; }
      } };
    ` }));
  } }],
});
const compiled = { exports: {} };
new Function("module", "exports", "require", bundle.outputFiles[0].text)(compiled, compiled.exports, require);
const { default: router, state, control, prepareBillingChargeResolution, reconcileBillingEvidence, parseBillingResolutionJournal } = compiled.exports;
const handler = (method, path) => {
  const layer = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]);
  assert.ok(layer, `Actual route ${method.toUpperCase()} ${path} must exist`);
  assert.equal(layer.route.stack.length, 1);
  return layer.route.stack[0].handle;
};
const candidates = handler("get", "/practice-imports/billing-code-candidates");
const accept = handler("post", "/practice-imports/billing-code-resolutions");
const revoke = handler("post", "/practice-imports/billing-code-resolutions/:id/revoke");
const history = handler("get", "/practice-imports");
const chargeCandidates = handler("get", "/practice-imports/billing-resolution-candidates");
const practiceId = "synthetic-code-review";
const stamp = "2026-10-22T12:00:00.000Z";
const uuid = i => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const sourceId = source => `${source.kind}-${source.sourceHash}`;
const row = (billingCode, sourceRowHash, extra = {}) => ({ clientId: "synthetic-client-reference",
  clinician: "Synthetic Lane", serviceDate: "2026-10-14", totalFeeCharged: 100,
  billingCode, sourceRowHash, ...extra });
const source = (hash, rows, extra = {}) => ({ id: `stored-${hash}`, packageImportId: "synthetic-package",
  practiceId, accountId: practiceId, kind: "billing", sourceHash: hash, rows, rowCount: rows.length,
  coverageStart: "2026-10-14", coverageEnd: "2026-10-14", reportCoverage: null,
  active: 1, createdAt: new Date(stamp), ...extra });
const audit = (action, detail, extra = {}) => ({ id: uuid(900), practiceId, accountId: practiceId,
  packageId: "synthetic-audit", action, actor: "synthetic-owner", detail, ...extra });
function reset() {
  process.env.EMC_PRACTICE_ID = practiceId;
  control.onLock = null;
  Object.assign(state, { saved: { revision: 4, confirmed_at: stamp, data: { version: 1,
    mappings: [{ sourceLabel: "Synthetic Lane", clinicianId: 1, clinicianLabel: "Synthetic Lane", teamId: 7 }], sourceSets: [] } },
    snapshots: [source("00000001", [row("90837", "synthetic-row-a")]),
      source("00000002", [row("90834", "synthetic-row-b")])],
    packages: [{ id: "synthetic-package", packageId: "synthetic-package", practiceId, accountId: practiceId,
      active: 1, contentHash: "synthetic-content", importedAt: new Date(stamp), exportedAt: new Date(stamp),
      billingCodeMinutes: { "90837": 50, "90834": 40 }, sameDayVisitOverrides: [] }],
    roster: [{ id: 1, label: "Synthetic Lane", goalId: 7 }], audits: [], queries: [], reads: [], writes: [],
    transactions: 0, failAudit: false });
}
async function call(route, body, { role = "owner", id, locals = {} } = {}) {
  const res = { locals: { role, actor: "synthetic-owner", ...locals }, statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; } };
  await route({ body, params: { id } }, res);
  return res;
}
const durable = () => structuredClone({ saved: state.saved, snapshots: state.snapshots,
  packages: state.packages, roster: state.roster, audits: state.audits });
const raw = () => { const { audits, ...facts } = durable(); return facts; };
async function preview() {
  const response = await call(candidates);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.candidates.length, 1);
  return response.body;
}
async function proposal() {
  const value = await preview(), candidate = value.candidates[0];
  assert.equal(candidate.canResolve, true, candidate.reason);
  return { caseToken: candidate.caseToken, choiceToken: candidate.sources[1].choiceToken,
    expectedRevision: value.revision, confirmed: true, approvalNote: "  Synthetic owner reviewed the exact source code.  " };
}
async function rejected(route, body, status, options) {
  const before = durable(), writes = [...state.writes], response = await call(route, body, options);
  assert.equal(response.statusCode, status, JSON.stringify(response.body));
  assert.deepEqual(durable(), before);
  assert.deepEqual(state.writes, writes);
  return response;
}
function oldChargeApproval() {
  const charges = [135, 150].map((amount, i) => row("90837", `synthetic-charge-${i}`,
    { clientId: "synthetic-separate-two-charges", totalFeeCharged: amount }));
  const draft = prepareBillingChargeResolution(charges.map(row => ({ snapshotId: "billing-00000003", row })));
  assert.ok(draft);
  const resolution = { ...draft, clinicianId: 1, id: uuid(1), approvalToken: "a".repeat(64),
    confirmedAt: stamp, approvalNote: "Prior two-charge owner approval" };
  state.audits.push(audit("accept-billing-charge-exception", { revision: 1, oldRevision: 0, resolution }));
  return resolution;
}

test("owner GET exposes exact client, codes and source provenance without writes and disables caching", async () => {
  reset(); const before = durable(), value = await call(candidates);
  assert.equal(value.statusCode, 200);
  assert.equal(value.headers["cache-control"], "no-store");
  assert.equal(value.body.revision, 0);
  const [candidate] = value.body.candidates;
  assert.equal(candidate.clientReference, "synthetic-client-reference");
  assert.equal(candidate.clinicianLabel, "Synthetic Lane");
  assert.equal(candidate.serviceDate, "2026-10-14");
  assert.equal(candidate.totalFeeCharged, 100);
  assert.equal(candidate.canResolve, true);
  assert.equal(candidate.resolutionId, null);
  assert.equal(candidate.selectedChoiceToken, null);
  assert.equal(candidate.stale, false);
  assert.match(candidate.caseToken, /^[0-9a-f]{64}$/);
  assert.deepEqual(candidate.sources.map(({ choiceToken, ...provenance }) => {
    assert.match(choiceToken, /^[0-9a-f]{64}$/);
    return provenance;
  }), state.snapshots.map(snapshot => ({ snapshotId: sourceId(snapshot), sourceHash: snapshot.sourceHash,
    importedAt: stamp, billingCode: snapshot.rows[0].billingCode })));
  assert.equal(new Set(candidate.sources.map(s => s.choiceToken)).size, 2);
  assert.ok(candidate.sources.every(s => s.choiceToken !== candidate.caseToken));
  assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
  assert.equal(state.transactions, 0);
  assert.deepEqual((await preview()).candidates, value.body.candidates);
});

test("application auth middleware still protects the mounted practice-import router", () => {
  const app = readFileSync(local("../src/app.ts"), "utf8");
  const index = readFileSync(local("../src/routes/index.ts"), "utf8");
  assert.match(app, /app\.use\(\s*["']\/api["']\s*,\s*requireAccess\s*,\s*router\s*\)/);
  assert.match(index, /router\.use\(practiceImportsRouter\)/);
  assert.match(index, /import practiceImportsRouter from ["']\.\/practiceImports["']/);
});

for (const role of ["data_entry", undefined, "admin", "OWNER"]) {
  test(`all three new routes reject ${role ?? "missing"} role before reading or writing`, async () => {
    reset(); const body = await proposal(); state.queries = []; state.reads = [];
    for (const route of [candidates, accept, revoke]) {
      await rejected(route, body, 403, { locals: { role }, id: uuid(2) });
    }
    assert.deepEqual(state.queries, []); assert.deepEqual(state.reads, []);
    assert.equal(state.transactions, 0);
  });
}

test("accept rederives under the advisory transaction lock and saves only an owner audit", async () => {
  reset(); const body = await proposal(), before = raw(); state.queries = []; state.reads = [];
  const response = await call(accept, body);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.resolutionStatus, "saved");
  assert.equal(response.body.billingResolutionRevision, 1);
  assert.deepEqual(raw(), before); assert.deepEqual(state.writes, ["audit"]);
  assert.equal(state.transactions, 1);
  assert.match(state.queries[0].sql, /^SELECT pg_advisory_xact_lock/);
  assert.equal(state.queries[0].transactional, true);
  assert.deepEqual(state.queries[0].params, [practiceId, practiceId]);
  assert.ok(state.queries.some(q => q.transactional && q.sql.startsWith("SELECT revision, data")));
  const journalRead = state.queries.find(q => q.transactional && /SELECT detail FROM practice_import_audit/.test(q.sql)
    && /accept-billing-charge-exception/.test(q.sql));
  assert.ok(journalRead);
  for (const action of ["accept-billing-charge-exception", "accept-billing-code-exception", "revoke-billing-code-exception"])
    assert.ok(journalRead.sql.includes(`'${action}'`));
  assert.ok(state.reads.some(read => read.transactional && read.table === "practice_import_snapshots"));
  assert.ok(state.reads.some(read => read.transactional && read.table === "clinicians"));
  const saved = state.audits[0];
  assert.equal(saved.action, "accept-billing-code-exception");
  assert.equal(saved.actor, "synthetic-owner");
  assert.equal(saved.practiceId, practiceId); assert.equal(saved.accountId, practiceId);
  assert.equal(saved.detail.oldRevision, 0); assert.equal(saved.detail.revision, 1);
  assert.equal(saved.detail.affectsAttendance, false); assert.equal(saved.detail.affectsCoverage, false);
  const resolution = saved.detail.resolution;
  assert.equal(resolution.kind, "billing-code"); assert.equal(resolution.clinicianId, 1);
  assert.equal(resolution.approvalToken, body.caseToken);
  assert.equal(resolution.approvalNote, body.approvalNote.trim());
  assert.deepEqual(resolution.selected, { snapshotId: "billing-00000002", sourceRowHash: "synthetic-row-b" });
  assert.equal(resolution.evidence.length, 2);
  assert.deepEqual(response.body.billingResolutions, [resolution]);
  const reload = (await preview()).candidates[0];
  assert.equal(reload.canResolve, false); assert.equal(reload.stale, false);
  assert.equal(reload.resolutionId, resolution.id); assert.equal(reload.selectedChoiceToken, body.choiceToken);
  await rejected(accept, body, 409);
  assert.equal((await call(history)).body.billingResolutionRevision, 1);
});

for (const [label, mutate] of [
  ["confirmation missing", b => { delete b.confirmed; }],
  ["confirmation false", b => { b.confirmed = false; }],
  ["confirmation coerced", b => { b.confirmed = "true"; }],
  ["blank note", b => { b.approvalNote = " \n "; }],
  ["missing note", b => { delete b.approvalNote; }],
  ["long note", b => { b.approvalNote = "x".repeat(2001); }],
  ["negative revision", b => { b.expectedRevision = -1; }],
  ["fractional revision", b => { b.expectedRevision = 0.5; }],
  ["coerced revision", b => { b.expectedRevision = "0"; }],
  ["raw code instead of token", b => { b.choiceToken = "90834"; }],
  ["raw source instead of token", b => { b.caseToken = "billing-00000001"; }],
  ["client facts injected", b => { b.clientId = "forged-client"; }],
  ["identity injected", b => { b.clinicianId = 2; }],
  ["account injected", b => { b.accountId = "other-account"; }],
]) {
  test(`accept strict schema rejects ${label} before opening a transaction`, async () => {
    reset(); const body = await proposal(); mutate(body);
    await rejected(accept, body, 400); assert.equal(state.transactions, 0);
  });
}

test("valid-looking forged and mixed tokens cannot select arbitrary evidence", async () => {
  reset(); const body = await proposal();
  await rejected(accept, { ...body, caseToken: "f".repeat(64) }, 409);
  await rejected(accept, { ...body, choiceToken: "f".repeat(64) }, 400);
  state.snapshots.forEach((snapshot, i) => snapshot.rows.push(row(i ? "90832" : "90834", `other-row-${i}`,
    { clientId: "synthetic-other-client" })));
  const cases = (await call(candidates)).body.candidates;
  await rejected(accept, { ...body, choiceToken: cases[1].sources[0].choiceToken }, 400);
});

for (const [label, mutate] of [
  ["source row code", () => { state.snapshots[1].rows[0].billingCode = "90832"; }],
  ["source row fee", () => { state.snapshots[1].rows[0].totalFeeCharged = 120; }],
  ["source row hash", () => { state.snapshots[1].rows[0].sourceRowHash = "synthetic-reimport-row"; }],
  ["source replaced by reimport", () => { state.snapshots[1].sourceHash = "00000004"; }],
  ["source added", () => { state.snapshots.push(source("00000003", [row("90832", "synthetic-row-c")])); }],
  ["source removed", () => { state.snapshots.pop(); }],
  ["source archived", () => { state.snapshots[1].active = 0; }],
  ["source moved to another account", () => { state.snapshots[1].accountId = "other-account"; }],
  ["declaration revision", () => { state.saved.revision++; }],
  ["provider mapping removed", () => { state.saved.data.mappings = []; }],
  ["provider roster team", () => { state.roster[0].goalId = 8; }],
  ["journal revision", () => { oldChargeApproval(); }],
]) {
  test(`stale ${label} after preview returns 409 with zero writes`, async () => {
    reset(); const body = await proposal(); mutate(); await rejected(accept, body, 409);
  });
}

test("source changes at advisory-lock acquisition are rederived inside the transaction", async () => {
  reset(); const body = await proposal();
  control.onLock = () => { state.snapshots[1].rows[0].billingCode = "90832"; };
  const response = await call(accept, body);
  assert.equal(response.statusCode, 409, JSON.stringify(response.body));
  assert.deepEqual(state.writes, []); assert.deepEqual(state.audits, []);
});

function freePhoneZeroSources() {
  reset();
  state.snapshots = ["13", "16", "22"].map((day, i) => source(`0000000${i + 1}`,
    [row(i === 0 ? "PHONE" : "0", i === 0 ? "synthetic-phone-row" : "synthetic-zero-reexport-row",
      { serviceDate: "2026-10-08", totalFeeCharged: 0 })],
    { coverageStart: "2026-10-08", coverageEnd: "2026-10-08", createdAt: new Date(`2026-10-${day}T12:00:00.000Z`) }));
}

const billingGroups = snapshots => reconcileBillingEvidence(snapshots.filter(source => source.kind === "billing")
  .flatMap(source => source.rows.map(row => ({ snapshotId: source.id, row }))));

for (const explicitConsultation of [false, true]) {
  test(`PHONE/0/0 auto-equivalence with ${explicitConsultation ? "explicit consultation" : "absent raw kind"} needs no choice or audit`, async () => {
    freePhoneZeroSources();
    if (explicitConsultation) state.snapshots[0].rows[0].visitKind = "consultation";
    const before = durable(), response = await call(candidates);
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.body, { revision: 0, candidates: [] });
    const historical = await call(history);
    assert.equal(historical.statusCode, 200);
    assert.deepEqual(historical.body.billingResolutions, []);
    assert.equal(historical.body.billingResolutionRevision, 0);
    assert.deepEqual(historical.body.snapshots.map(source => source.rows[0].billingCode), ["PHONE", "0", "0"]);
    assert.deepEqual(historical.body.snapshots.map(source => source.importedAt),
      ["13", "16", "22"].map(day => `2026-10-${day}T12:00:00.000Z`));
    const groups = billingGroups(historical.body.snapshots);
    assert.equal(groups.length, 1); assert.equal(groups[0].known, true);
    assert.equal(groups[0].duplicateRowCount, 2); assert.equal(groups[0].codeResolution, false);
    assert.equal(groups[0].resolutionId, undefined);
    assert.deepEqual((await call(chargeCandidates)).body.candidates, []);
    assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
    assert.equal(state.transactions, 0);
    await rejected(accept, { caseToken: "f".repeat(64), choiceToken: "e".repeat(64), expectedRevision: 0,
      confirmed: true, approvalNote: "No manual choice exists for equivalent consultation codes" }, 409);
  });
}

for (const [label, mutate, chargeReview] of [
  ["differing fee", () => { state.snapshots[0].rows[0].totalFeeCharged = 25; }],
  ["contradictory raw visit-kind", () => { state.snapshots[0].rows[0].visitKind = "treatment"; }],
  ["same-source two rows", () => {
    state.snapshots[0].rows.push({ ...state.snapshots[0].rows[0], sourceRowHash: "synthetic-second-phone-row" });
    state.snapshots[0].rowCount = 2;
  }],
  ["cancellation subtype difference", () => { state.snapshots[0].rows[0].cancellationSubtype = "late_cancelled"; }],
  ["nonfinite fee", () => { state.snapshots[0].rows[0].totalFeeCharged = Number.NaN; }, false],
  ["conflicting reused raw hash", () => { state.snapshots[0].rows[0].sourceRowHash = state.snapshots[1].rows[0].sourceRowHash; }, false],
]) {
  test(`PHONE/0/0 ${label} stays unknown without discretionary code approval`, async () => {
    freePhoneZeroSources(); mutate();
    const before = durable(), response = await call(candidates);
    assert.deepEqual(response.body, { revision: 0, candidates: [] });
    const historical = await call(history), groups = billingGroups(historical.body.snapshots);
    assert.equal(groups.length, 1); assert.equal(groups[0].known, false);
    if (chargeReview !== false) {
      const review = await call(chargeCandidates);
      assert.equal(review.statusCode, 200);
      assert.equal(review.body.candidates.length, 1);
      assert.equal(review.body.candidates[0].canAccept, false);
    }
    assert.deepEqual(historical.body.billingResolutions, []);
    assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
  });
}

for (const blank of [null, ""]) {
  test(`literal zero remains distinct from ${blank === null ? "missing" : "blank"} billing code`, async () => {
    freePhoneZeroSources(); state.snapshots[0].rows[0].billingCode = blank;
    const before = durable(), response = await call(candidates);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.candidates.length, 1);
    assert.deepEqual(response.body.candidates[0].sources.map(source => source.billingCode), [blank, "0", "0"]);
    assert.deepEqual(durable(), before); assert.deepEqual(state.writes, []);
  });
}

for (const [label, mutate] of [
  ["same-source multiplicity", () => { state.snapshots[0].rows.push(row("90837", "synthetic-extra-row")); }],
  ["different fees", () => { state.snapshots[1].rows[0].totalFeeCharged = 101; }],
  ["different visit kinds", () => { state.snapshots[1].rows[0].visitKind = "consultation"; }],
  ["different cancellation subtypes", () => { state.snapshots[1].rows[0].cancellationSubtype = "late_cancelled"; }],
  ["documentation versus treatment", () => { state.snapshots[1].rows[0].billingCode = "2"; }],
  ["consultation versus treatment", () => { state.snapshots[1].rows[0].billingCode = "30003"; }],
]) {
  test(`${label} is visible but cannot be resolved with a code choice`, async () => {
    reset(); mutate(); const value = await preview(), candidate = value.candidates[0];
    assert.equal(candidate.canResolve, false); assert.ok(candidate.reason);
    await rejected(accept, { caseToken: candidate.caseToken, choiceToken: candidate.sources[0].choiceToken,
      expectedRevision: value.revision, confirmed: true, approvalNote: "Synthetic review" }, 400);
  });
}

test("foreign and archived evidence and journals never enter owner candidates or current revision", async () => {
  reset();
  const baseline = await proposal();
  state.snapshots.push(source("00000003", [row("PRIVATE-FOREIGN-CODE", "foreign-row")], { accountId: "other-account" }),
    source("00000004", [row("PRIVATE-OTHER-PRACTICE", "other-practice-row")], { practiceId: "other-practice" }),
    source("00000005", [row("PRIVATE-ARCHIVED-CODE", "archived-row")], { active: 0 }));
  state.audits.push(audit("accept-billing-code-exception", { invalid: true }, { accountId: "other-account" }),
    audit("revoke-billing-code-exception", { invalid: true }, { practiceId: "other-practice" }),
    audit("unrelated-action", { invalid: true }));
  assert.deepEqual(await proposal(), baseline);
  const response = await call(accept, baseline, { locals: { accountId: "other-account", practiceId: "other-practice" } });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.billingResolutionRevision, 1);
  assert.equal(response.body.snapshots.length, 2);
  assert.equal(state.audits.at(-1).accountId, practiceId);
});

test("audit failure rolls back a code choice and reversal including all partial writes", async () => {
  reset(); const body = await proposal(); state.failAudit = true;
  let before = structuredClone(state);
  await assert.rejects(call(accept, body), /Synthetic audit failure/);
  assert.deepEqual(state, before);
  state.failAudit = false;
  const saved = await call(accept, body), id = saved.body.billingResolutions[0].id;
  state.failAudit = true; before = structuredClone(state);
  await assert.rejects(call(revoke, { expectedRevision: 1, approvalNote: "Undo synthetic choice", confirmed: true }, { id }), /Synthetic audit failure/);
  assert.deepEqual(state, before);
});

test("mixed journal reload and reversal preserve old two-charge approvals and every raw fact", async () => {
  reset(); const charge = oldChargeApproval(), body = await proposal(), facts = raw();
  const accepted = await call(accept, body);
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.billingResolutionRevision, 2);
  const code = accepted.body.billingResolutions.find(row => row.kind === "billing-code");
  assert.ok(code); assert.deepEqual(accepted.body.billingResolutions[0], charge);
  let reloaded = await call(history);
  assert.deepEqual(reloaded.body.billingResolutions, [charge, code]);
  const reversal = { expectedRevision: 2, approvalNote: "  Undo exact synthetic code choice  ", confirmed: true };
  const undone = await call(revoke, reversal, { id: code.id });
  assert.equal(undone.statusCode, 200, JSON.stringify(undone.body));
  assert.equal(undone.headers["cache-control"], "no-store");
  assert.equal(undone.body.billingResolutionRevision, 3);
  assert.deepEqual(undone.body.billingResolutions, [charge]);
  assert.deepEqual(raw(), facts); assert.deepEqual(state.writes, ["audit", "audit"]);
  assert.equal(state.audits.length, 3);
  assert.deepEqual(state.audits[0].detail.resolution, charge);
  assert.deepEqual(state.audits[1].detail.resolution, code);
  const event = state.audits[2];
  assert.equal(event.action, "revoke-billing-code-exception");
  assert.equal(event.actor, "synthetic-owner");
  assert.equal(event.detail.revokedResolutionId, code.id);
  assert.equal(event.detail.approvalNote, reversal.approvalNote.trim());
  assert.equal(event.detail.oldRevision, 2); assert.equal(event.detail.revision, 3);
  const candidate = (await preview()).candidates[0];
  assert.equal(candidate.canResolve, true); assert.equal(candidate.resolutionId, null);
  reloaded = await call(history);
  assert.equal(reloaded.body.billingResolutionRevision, 3);
  assert.deepEqual(reloaded.body.billingResolutions, [charge]);
  await rejected(revoke, { ...reversal, expectedRevision: 3 }, 409, { id: code.id });
  await rejected(revoke, { ...reversal, expectedRevision: 3 }, 409, { id: charge.id });
  await rejected(revoke, { ...reversal, expectedRevision: 3 }, 409, { id: uuid(99) });
  // A new explicit review after undo can approve the same opaque case again.
  const again = await call(accept, await proposal());
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  assert.equal(again.body.billingResolutionRevision, 4);
  assert.deepEqual(again.body.billingResolutions[0], charge);
  assert.notEqual(again.body.billingResolutions[1].id, code.id);
});

test("revoke validates strict confirmation, note, revision and UUID and refuses stale journal", async () => {
  reset(); const saved = await call(accept, await proposal()), id = saved.body.billingResolutions[0].id;
  const body = { expectedRevision: 1, approvalNote: "Undo synthetic choice", confirmed: true };
  for (const invalid of [null, {}, { ...body, confirmed: false }, { ...body, confirmed: "true" },
    { ...body, approvalNote: " " }, { ...body, approvalNote: "x".repeat(2001) },
    { ...body, expectedRevision: "1" }, { ...body, expectedRevision: -1 },
    { ...body, choiceToken: "a".repeat(64) }]) await rejected(revoke, invalid, 400, { id });
  await rejected(revoke, body, 400, { id: "not-a-uuid" });
  await rejected(revoke, body, 400, { id: undefined });
  await rejected(revoke, { ...body, expectedRevision: 0 }, 409, { id });
  // A real foreign ID must not revoke the foreign tenant's audit or reveal its existence.
  const foreign = structuredClone(state.audits[0]);
  foreign.accountId = "other-account"; foreign.detail.resolution.id = uuid(50); state.audits.push(foreign);
  const unknown = await rejected(revoke, body, 409, { id: uuid(51) });
  const unauthorized = await rejected(revoke, body, 409, { id: uuid(50) });
  assert.deepEqual(unauthorized.body, unknown.body);
});

for (const [label, mutate] of [
  ["new source", () => { state.snapshots.push(source("00000003", [row("90832", "synthetic-row-c")])); }],
  ["removed source", () => { state.snapshots.pop(); }],
  ["all pinned sources inactive", () => { state.snapshots.forEach(source => { source.active = 0; }); }],
  ["only one code remains", () => { state.snapshots[1].rows[0].billingCode = "90837"; }],
  ["reimported source", () => { state.snapshots[1].sourceHash = "00000004"; }],
  ["changed source", () => { state.snapshots[1].rows[0].billingCode = "90832"; }],
  ["changed mapping", () => { state.saved.data.mappings = []; state.saved.revision++; }],
]) {
  test(`saved code choice becomes inactive/stale on ${label} without altering its audit`, async () => {
    reset(); const saved = await call(accept, await proposal()), resolution = saved.body.billingResolutions[0];
    mutate(); const before = durable(), response = await call(candidates);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.candidates.length, 1, "Undo must remain available for stale choices");
    const candidate = response.body.candidates[0];
    assert.equal(candidate.stale, true); assert.equal(candidate.canResolve, false);
    assert.equal(candidate.resolutionId, resolution.id);
    assert.equal(candidate.selectedChoiceToken, null);
    if (label === "all pinned sources inactive") assert.deepEqual(candidate.sources, []);
    assert.deepEqual(state.audits[0].detail.resolution, resolution);
    assert.deepEqual(durable(), before);
    const undone = await call(revoke, { expectedRevision: 1, confirmed: true, approvalNote: "Undo stale synthetic choice" },
      { id: candidate.resolutionId });
    assert.equal(undone.statusCode, 200, JSON.stringify(undone.body));
    assert.deepEqual(undone.body.billingResolutions, []);
    assert.equal(undone.body.billingResolutionRevision, 2);
  });
}

test("backup journal parser accepts mixed approval/reversal events in revision order and returns only active approvals", async () => {
  reset(); const charge = oldChargeApproval();
  const saved = await call(accept, await proposal()), code = saved.body.billingResolutions[1];
  await call(revoke, { expectedRevision: 2, approvalNote: "Undo synthetic choice", confirmed: true }, { id: code.id });
  const events = state.audits.map(event => event.detail);
  assert.deepEqual(parseBillingResolutionJournal([...events].reverse()), { billingResolutionRevision: 3, billingResolutions: [charge] });
  assert.throws(() => parseBillingResolutionJournal([events[0], { ...events[1], revision: 3 }]));
  assert.throws(() => parseBillingResolutionJournal([events[0], { ...events[0], revision: 2 }]));
  assert.throws(() => parseBillingResolutionJournal([events[0], { ...events[2], revision: 2 }]));
  assert.throws(() => parseBillingResolutionJournal([events[0], { ...events[2], revision: 2, revokedResolutionId: charge.id }]));
  assert.throws(() => parseBillingResolutionJournal([...events, { ...events[2], revision: 4 }]));
  const badEvidence = structuredClone(events[1]); delete badEvidence.resolution.selected;
  assert.throws(() => parseBillingResolutionJournal([events[0], badEvidence]));
  const again = await call(accept, await proposal());
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  const reaccepted = again.body.billingResolutions.find(row => row.kind === "billing-code");
  const complete = state.audits.map(event => event.detail);
  assert.deepEqual(parseBillingResolutionJournal([...complete].reverse()), {
    billingResolutionRevision: 4, billingResolutions: [charge, reaccepted],
  });
  assert.equal(reaccepted.approvalToken, code.approvalToken);
  assert.notEqual(reaccepted.id, code.id);
  assert.throws(() => parseBillingResolutionJournal([...events, { ...complete[3], resolution: code }]),
    /journal requires review/, "A revoked resolution ID cannot be reused");
  for (const invalid of [
    { ...events[2], revokedResolutionId: "not-a-uuid" },
    { ...events[2], approvalNote: " " },
    { ...events[2], revokedAt: "not-a-timestamp" },
    { ...events[2], revision: 2.5 },
    { ...events[2], revision: 0 },
  ]) assert.throws(() => parseBillingResolutionJournal([events[0], events[1], invalid]));
  assert.throws(() => parseBillingResolutionJournal(Array.from({ length: 1001 }, () => events[0])));
});

for (const [label, mutate] of [
  ["revision gap", events => { events[0].detail.revision = 2; }],
  ["duplicate revision", events => { events.push(structuredClone(events[0])); }],
  ["invalid code approval", events => { delete events[0].detail.resolution.selected; }],
  ["unknown reversal target", events => { events.push(audit("revoke-billing-code-exception", {
    revision: 2, revokedResolutionId: uuid(99), approvalNote: "Synthetic undo", revokedAt: stamp })); }],
  ["duplicate reversal", events => {
    const detail = { revision: 2, revokedResolutionId: events[0].detail.resolution.id,
      approvalNote: "Synthetic undo", revokedAt: stamp };
    events.push(audit("revoke-billing-code-exception", detail),
      audit("revoke-billing-code-exception", { ...detail, revision: 3 }));
  }],
]) {
  test(`actual mixed-action journal reads fail closed on ${label}`, async () => {
    reset(); const body = await proposal();
    assert.equal((await call(accept, body)).statusCode, 200);
    const id = state.audits[0].detail.resolution.id;
    mutate(state.audits);
    const before = durable(), writes = [...state.writes];
    await assert.rejects(call(candidates));
    await assert.rejects(call(accept, { ...body, expectedRevision: state.audits.length }));
    await assert.rejects(call(revoke, { expectedRevision: state.audits.length, confirmed: true, approvalNote: "Synthetic undo" }, { id }));
    assert.deepEqual(durable(), before); assert.deepEqual(state.writes, writes);
  });
}
