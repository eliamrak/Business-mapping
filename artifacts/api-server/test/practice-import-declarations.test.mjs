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
          if (q.sql.startsWith("SELECT detail FROM practice_import_audit")) {
            assertScope(q.params[0], q.params[1]);
            return { rows: state.audits.filter(row => row.action === "accept-billing-charge-exception" && row.practiceId === q.params[0] && row.accountId === q.params[1]).map(row => ({ detail: structuredClone(row.detail) })) };
          }
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

const candidatesHandler = router.stack.find((layer) => layer.route?.path === "/practice-imports/billing-resolution-candidates").route.stack[0].handle;
const acceptanceHandler = router.stack.find((layer) => layer.route?.path === "/practice-imports/billing-resolutions").route.stack[0].handle;
async function billingCall(handler, payload) {
  const res = { locals: { actor: "synthetic-owner" }, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body: payload }, res); return res;
}
function billingReset(amounts = [135, 150]) {
  reset();
  state.saved = { revision: 1, data: { ...body().data, sourceSets: [] }, confirmed_at: "2026-10-15T00:00:00Z" };
  state.snapshots = [{ ...state.snapshots[0], kind: "billing", rows: amounts.map((totalFeeCharged, i) => ({ clientId: "DO_NOT_DISPLAY_SYNTHETIC_KEY", clinician: "Synthetic", serviceDate: "2026-01-02", billingCode: "90837", totalFeeCharged, sourceRowHash: `DO_NOT_DISPLAY_HASH_${i}` })) }];
}
async function acceptanceBody() {
  const res = await billingCall(candidatesHandler);
  const candidate = res.body.candidates[0];
  return { expectedRevision: res.body.revision, caseToken: candidate.caseToken, clinicianLabel: candidate.clinicianLabel,
    serviceDate: candidate.serviceDate, amounts: candidate.amounts, confirmed: true, approvalNote: "Explicit synthetic owner keep-both approval" };
}
test("billing approval appends a separate scoped journal without changing declarations, sources or roster", async () => {
  for (const amounts of [[135, 150], [175, 175], [150, 150]]) {
    billingReset(amounts);
    const before = structuredClone({ saved: state.saved, snapshots: state.snapshots, roster: state.roster });
    const candidates = await billingCall(candidatesHandler);
    assert.equal(candidates.body.revision, 0); assert.equal(candidates.body.candidates[0].canAccept, true);
    assert.doesNotMatch(JSON.stringify(candidates.body), /DO_NOT_DISPLAY/);
    assert.deepEqual(state.audits, [], "GET never approves");
    const payload = await acceptanceBody(); const res = await billingCall(acceptanceHandler, payload);
    assert.equal(res.statusCode, 200); assert.equal(res.body.resolutionStatus, "saved");
    assert.equal(res.body.billingResolutionRevision, 1); assert.equal(res.body.declarations.revision, 1);
    assert.equal(res.body.billingResolutions[0].charges.length, 2);
    assert.deepEqual({ saved: state.saved, snapshots: state.snapshots, roster: state.roster }, before);
    assert.equal(state.audits.length, 1); assert.equal(state.audits[0].action, "accept-billing-charge-exception");
    assert.equal(state.audits[0].detail.affectsAttendance, false); assert.equal(state.audits[0].actor, "synthetic-owner");
    assert.ok(state.queries.every(q => !/INSERT INTO practice_import_declarations|UPDATE|DELETE|ALTER|CREATE TABLE/.test(q.sql)));
    assert.equal((await billingCall(acceptanceHandler, payload)).body.resolutionStatus, "duplicate");
    assert.equal(state.audits.length, 1);
    const reread = await billingCall(candidatesHandler);
    assert.equal(reread.body.candidates[0].canAccept, false); assert.ok(reread.body.candidates[0].resolutionId);
  }
});
test("billing approval rejects missing confirmation, wrong provider/day/amount, stale token or revision without writes", async () => {
  for (const mutate of [p => { p.confirmed = false; }, p => { p.expectedRevision = 1; }, p => { p.caseToken = "b".repeat(64); },
    p => { p.clinicianLabel = "Other"; }, p => { p.serviceDate = "2026-01-03"; }, p => { p.amounts = [135, 160]; },
    p => { p.approvalNote = ""; }, p => { p.clientId = "injected"; }]) {
    billingReset(); const payload = await acceptanceBody(); mutate(payload);
    const before = structuredClone(state.saved);
    assert.ok((await billingCall(acceptanceHandler, payload)).statusCode >= 400);
    assert.deepEqual(state.audits, []); assert.deepEqual(state.saved, before);
  }
});
test("billing approval checks provider mapping and exact unchanged evidence inside locked transaction", async () => {
  for (const mutate of [() => { state.roster[0].label = "Renamed"; }, () => { state.saved = null; },
    () => { state.snapshots[0].rows.push({ ...state.snapshots[0].rows[0], sourceRowHash: "third" }); },
    () => { state.snapshots[0].practiceId = "other"; }, () => { state.snapshots[0].active = 0; }]) {
    billingReset(); const payload = await acceptanceBody(); mutate();
    assert.equal((await billingCall(acceptanceHandler, payload)).statusCode, 409); assert.deepEqual(state.audits, []);
  }
});
test("billing audit failure is atomic and reimports cannot increment journal or retarget changed anchors", async () => {
  billingReset(); let payload = await acceptanceBody(); state.failAudit = true;
  const original = structuredClone({ saved: state.saved, snapshots: state.snapshots });
  await assert.rejects(billingCall(acceptanceHandler, payload), /audit failure/);
  assert.deepEqual(state.audits, []); assert.deepEqual({ saved: state.saved, snapshots: state.snapshots }, original);
  state.failAudit = false; await billingCall(acceptanceHandler, payload);
  const repeat = structuredClone(state.snapshots[0]); repeat.sourceHash = "reimport0123456789";
  repeat.rows.forEach((row, i) => { row.sourceRowHash = `shifted-${i}`; }); state.snapshots.push(repeat);
  payload = await acceptanceBody();
  assert.equal((await billingCall(acceptanceHandler, payload)).body.resolutionStatus, "duplicate"); assert.equal(state.audits.length, 1);
  state.snapshots.shift();
  const candidates = await billingCall(candidatesHandler);
  assert.equal(candidates.body.candidates[0].stale, true); assert.equal(candidates.body.candidates[0].canAccept, false);
  payload = await acceptanceBody();
  assert.equal((await billingCall(acceptanceHandler, payload)).statusCode, 409); assert.equal(state.audits.length, 1);
});
test("an approved case cannot follow a later provider remapping or become an idempotent success", async () => {
  billingReset(); const payload = await acceptanceBody(); await billingCall(acceptanceHandler, payload);
  state.saved.data.mappings[0] = { sourceLabel: "Synthetic", clinicianId: 2, clinicianLabel: "Synthetic", teamId: 8 };
  const cases = await billingCall(candidatesHandler);
  assert.equal(cases.body.candidates[0].stale, true); assert.equal(cases.body.candidates[0].canAccept, false);
  assert.equal((await billingCall(acceptanceHandler, { ...payload, expectedRevision: 1 })).statusCode, 409);
  assert.equal(state.audits.length, 1);
});
test("four exact approvals advance only the independent journal, rejecting stale concurrent approvals", async () => {
  billingReset();
  const source = state.snapshots[0];
  source.rows = [[135, 150], [175, 175], [150, 150], [150, 150]].flatMap((amounts, i) => amounts.map((totalFeeCharged, j) => ({ ...source.rows[0], clientId: `synthetic-${i}`, serviceDate: `2026-01-0${i + 2}`, sourceRowHash: `case-${i}-${j}`, totalFeeCharged })));
  const initial = await billingCall(candidatesHandler);
  for (const [i, candidate] of initial.body.candidates.entries()) {
    const payload = { expectedRevision: i, caseToken: candidate.caseToken, clinicianLabel: candidate.clinicianLabel, serviceDate: candidate.serviceDate, amounts: candidate.amounts, confirmed: true, approvalNote: "Synthetic owner approval" };
    if (i) assert.equal((await billingCall(acceptanceHandler, { ...payload, expectedRevision: i - 1 })).statusCode, 409);
    assert.equal((await billingCall(acceptanceHandler, payload)).body.billingResolutionRevision, i + 1);
  }
  assert.equal(state.audits.length, 4); assert.equal(state.saved.revision, 1); assert.equal(source.rows.length, 8);
});
