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
            const action = q.sql.includes("confirm-historical-billing-providers") ? "confirm-historical-billing-providers" : "accept-billing-charge-exception";
            return { rows: state.audits.filter(row => row.action === action && row.practiceId === q.params[0] && row.accountId === q.params[1]).map(row => ({ detail: structuredClone(row.detail) })) };
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

function historicalBody() {
  const payload = body();
  state.snapshots.push({ ...structuredClone(state.snapshots[0]), kind: "billing", sourceHash: "bbbbbbbbbbbbbbbb",
    rows: [{ clientId: "synthetic-former", clinician: "Former", serviceDate: "2026-01-02", totalFeeCharged: 100, billingCode: "90837", sourceRowHash: "former-source" }] });
  payload.data.historicalBillingProviders = [{ id: "00000000-0000-4000-8000-000000000001", sourceLabel: "Former",
    sourceSets: [{ snapshotIds: ["billing-bbbbbbbbbbbbbbbb"], start: "2026-01-01", end: "2026-01-14", complete: true }] }];
  return payload;
}
test("historical identity saves to its own append-only journal, not strict declaration JSON or staff/source records", async () => {
  reset(); const payload = historicalBody(); const before = structuredClone({ roster: state.roster, snapshots: state.snapshots });
  const response = await call(payload);
  assert.equal(response.statusCode, 200); assert.deepEqual(response.body.declarations.data.historicalBillingProviders, payload.data.historicalBillingProviders);
  assert.ok(!Object.hasOwn(state.saved.data, "historicalBillingProviders"), "old strict readers can still parse original declaration JSON");
  assert.deepEqual(state.saved.data, body().data);
  assert.deepEqual({ roster: state.roster, snapshots: state.snapshots }, before);
  assert.equal(state.audits.filter(row => row.action === "confirm-historical-billing-providers").length, 1);
  assert.equal(state.audits.find(row => row.action === "confirm-historical-billing-providers").detail.declarationRevision, 1);
  assert.ok(state.queries.filter(q => q.sql.includes("confirm-historical-billing-providers")).every(q => q.params[0] === "synthetic" && q.params[1] === "synthetic"));
  const oldClient = body(); oldClient.expectedRevision = 1;
  const second = await call(oldClient);
  assert.equal(second.statusCode, 200); assert.deepEqual(second.body.declarations.data.historicalBillingProviders, payload.data.historicalBillingProviders);
  assert.equal(state.audits.filter(row => row.action === "confirm-historical-billing-providers").length, 1, "older clients neither clear nor resave historical metadata");
});
test("historical metadata rejects missing/wrong-kind sources, name collisions, aliases and stale bounds without writes", async () => {
  for (const change of [
    p => { p.data.historicalBillingProviders[0].sourceSets[0].snapshotIds = ["billing-missing0"]; },
    p => { p.data.historicalBillingProviders[0].sourceSets[0].start = "2026-01-03"; },
    p => { p.data.historicalBillingProviders[0].sourceSets[0].end = "2099-01-01"; },
    p => { p.data.historicalBillingProviders[0].sourceLabel = "Former guessed alias"; },
    () => { state.roster.push({ id: 99, label: " FORMER ", goalId: 99 }); },
    () => { state.snapshots.at(-1).kind = "attendance"; },
  ]) {
    reset(); const payload = historicalBody(); change(payload);
    assert.equal((await call(payload)).statusCode, 400); noWrites();
  }
});
test("historical metadata/audit failure rolls back atomically, stale writes cannot duplicate confirmation", async () => {
  reset(); const payload = historicalBody(); state.failAudit = true; const before = structuredClone(state.snapshots);
  await assert.rejects(call(payload), /audit failure/); noWrites(); assert.deepEqual(state.snapshots, before);
  state.failAudit = false; assert.equal((await call(payload)).statusCode, 200);
  const saved = structuredClone({ saved: state.saved, audits: state.audits });
  assert.equal((await call(payload)).statusCode, 409); assert.deepEqual({ saved: state.saved, audits: state.audits }, saved);
});
test("confirmed historical UUID cannot be repurposed to a different provider label", async () => {
  reset(); const payload = historicalBody(); await call(payload);
  state.snapshots.at(-1).rows.push({ ...state.snapshots.at(-1).rows[0], clinician: "Different former", sourceRowHash: "different" });
  payload.expectedRevision = 1; payload.data.historicalBillingProviders[0].sourceLabel = "Different former";
  const saved = structuredClone(state.saved); assert.equal((await call(payload)).statusCode, 400); assert.deepEqual(state.saved, saved);
});

test("removing a registry entry does not release its historical UUID for a different identity", async () => {
  reset(); const original = historicalBody(); await call(original);
  const removal = body(); removal.expectedRevision = 1; removal.data.historicalBillingProviders = [];
  assert.equal((await call(removal)).statusCode, 200);
  state.snapshots.push({ ...structuredClone(state.snapshots.at(-1)), sourceHash: "dddddddddddddddd",
    rows: [{ ...state.snapshots.at(-1).rows[0], clinician: "Different former", sourceRowHash: "different-provider" }] });
  const reuse = structuredClone(original); reuse.expectedRevision = 2;
  reuse.data.historicalBillingProviders[0].sourceLabel = "Different former";
  reuse.data.historicalBillingProviders[0].sourceSets[0].snapshotIds = ["billing-dddddddddddddddd"];
  const before = structuredClone({ saved: state.saved, audits: state.audits });
  assert.equal((await call(reuse)).statusCode, 400); assert.deepEqual({ saved: state.saved, audits: state.audits }, before);
  const next = body(); next.expectedRevision = 2;
  const response = await call(next); assert.equal(response.statusCode, 200); assert.deepEqual(response.body.declarations.data.historicalBillingProviders, []);
});

test("API rejects unsupported deletion fields and name markers with clear guidance before writes", async () => {
  const packageHandler = router.stack.find(layer => layer.route?.path === "/practice-imports/package").route.stack[0].handle;
  for (const alter of [pkg => { pkg.collections.billing.rows[0].deleted = true; }, pkg => { pkg.collections.billing.rows[0].clinician = "Former (deleted)"; }]) {
    reset(); const pkg = JSON.parse(readFileSync(new URL("../../../docs/practice-local-import-package-v1.golden.json", import.meta.url), "utf8")); alter(pkg);
    const res = { locals: { actor: "synthetic-owner" }, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await packageHandler({ body: { package: pkg } }, res);
    assert.equal(res.statusCode, 400); assert.match(res.body.error, /Unverified deletion marker/); noWrites(); assert.deepEqual(state.queries, []);
  }
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
test("historical-only fifth approval requires explicit identity and preserves four prior approvals", async () => {
  billingReset([110, 150]);
  const currentRows = structuredClone(state.snapshots[0].rows);
  state.snapshots[0].rows = Array.from({ length: 4 }, (_, i) => currentRows.map(row => ({
    ...row, serviceDate: `2026-01-0${i + 2}`, sourceRowHash: row.sourceRowHash + i,
  }))).flat();
  for (let i = 0; i < 4; i++) {
    const cases = await billingCall(candidatesHandler);
    const next = cases.body.candidates.find(row => row.canAccept);
    const saved = await billingCall(acceptanceHandler, { expectedRevision: cases.body.revision, caseToken: next.caseToken,
      clinicianLabel: next.clinicianLabel, serviceDate: next.serviceDate, amounts: next.amounts,
      confirmed: true, approvalNote: "Synthetic original approval" });
    assert.equal(saved.statusCode, 200);
  }
  const originalApprovals = structuredClone(state.audits);
  const historicalLabel = "(deleted) Synthetic Former";
  state.snapshots[0].rows.push(...currentRows.map(row => ({ ...row, clinician: historicalLabel, serviceDate: "2025-10-03", sourceRowHash: row.sourceRowHash + "former" })));
  let cases = await billingCall(candidatesHandler);
  assert.equal(cases.body.candidates.find(row => row.clinicianLabel === historicalLabel).canAccept, false);
  const providerId = "00000000-0000-4000-8000-000000000099";
  state.saved.revision = 2;
  state.audits.push({ practiceId: "synthetic", accountId: "synthetic", action: "confirm-historical-billing-providers",
    detail: { version: 1, declarationRevision: 2, providers: [{ id: providerId, sourceLabel: historicalLabel,
      sourceSets: [{ snapshotIds: ["billing-0123456789abcdef"], start: "2025-07-01", end: "2026-10-12", complete: true }] }] } });
  const before = structuredClone({ saved: state.saved, snapshots: state.snapshots, roster: state.roster });
  cases = await billingCall(candidatesHandler);
  const next = cases.body.candidates.find(row => row.clinicianLabel === historicalLabel);
  assert.equal(next.canAccept, true);
  const payload = { expectedRevision: 4, caseToken: next.caseToken, clinicianLabel: next.clinicianLabel,
    serviceDate: next.serviceDate, amounts: next.amounts, confirmed: true, approvalNote: "Synthetic owner-authorized fifth approval" };
  const result = await billingCall(acceptanceHandler, payload);
  assert.equal(result.statusCode, 200); assert.equal(result.body.billingResolutionRevision, 5);
  const approval = result.body.billingResolutions[4];
  assert.equal(approval.historicalProviderId, providerId); assert.equal(approval.clinicianId, undefined);
  assert.deepEqual(state.audits.slice(0, 4), originalApprovals);
  assert.deepEqual({ saved: state.saved, snapshots: state.snapshots, roster: state.roster }, before);
  assert.equal((await billingCall(acceptanceHandler, payload)).body.resolutionStatus, "duplicate");
  assert.equal((await billingCall(candidatesHandler)).body.candidates.find(row => row.clinicianLabel === historicalLabel).stale, false);
  state.saved.revision = 3;
  state.audits.push({ practiceId: "synthetic", accountId: "synthetic", action: "confirm-historical-billing-providers",
    detail: { version: 1, declarationRevision: 3, providers: [] } });
  assert.equal((await billingCall(candidatesHandler)).body.candidates.find(row => row.clinicianLabel === historicalLabel).stale, true);
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
