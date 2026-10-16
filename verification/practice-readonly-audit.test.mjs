import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { emptyWorkspace, prepareBillingChargeResolution } from "../lib/practice/src/hub/index.ts";
import { assertCandidateSource, auditOptions, loadAuditModel, readOnlyInput } from "./practice-readonly-audit.mjs";

const { aggregateAudit } = await loadAuditModel();
const options = { asOf: "2026-05-07", start: "2026-01-01", end: "2026-05-06", targetLabel: "Elia" };
function fixture() {
  const workspace = emptyWorkspace("2026-01-01");
  Object.assign(workspace.settings, { defaultInPersonPct: 0, organicClientsPerMonth: 0 });
  const person = { id: 1, goalId: null, label: "Elia", classification: "owner", sessionRate: 100, sessionsPerWeek: 7, weeksWorkedPerYear: 52,
    capEnabled: false, capAmount: 0, preCapClinicianSplit: 0, preCapPracticeSplit: 100, postCapClinicianSplit: 0, postCapPracticeSplit: 100,
    w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 };
  const visit = (clientId, serviceDate, phone = false) => ({ clientId, clinician: "Elia", serviceDate, status: "show", location: "SECRET_LOCATION",
    billingCode: phone ? "PHONE" : "90837", sourceRowHash: `SECRET_HASH_${clientId}_${serviceDate}` });
  const rows = [visit("SECRET_CLIENT_A", "2026-01-02", true), ...["2026-01-05", "2026-01-12", "2026-01-19"].map((date) => visit("SECRET_CLIENT_A", date)), visit("SECRET_CLIENT_PENDING", "2026-04-30")];
  const proof = { start: "2026-01-01", end: "2026-05-06", complete: true };
  const attendance = { id: "SECRET_SNAPSHOT_A", kind: "attendance", importedAt: "2026-05-07T00:00:00Z", sourceHash: "SECRET_SOURCE_A", reportCoverage: proof, rows };
  const billing = { id: "SECRET_SNAPSHOT_B", kind: "billing", importedAt: "2026-05-07T00:00:00Z", sourceHash: "SECRET_SOURCE_B", reportCoverage: proof,
    rows: rows.filter((row) => row.billingCode !== "PHONE").map((row) => ({ ...row, totalFeeCharged: 35 })) };
  return { workspace, context: { clinicians: [person], staff: [], sessions: [] }, snapshots: [attendance, billing], goals: [], overrides: {} };
}

test("aggregate output excludes raw identifiers, source strings and input mutation", () => {
  const input = fixture(), before = structuredClone(input);
  const result = aggregateAudit(input, options);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /SECRET_|clientId|sourceRowHash|sourceHash|snapshotId|clinicianId/);
  assert.deepEqual(input, before);
  assert.equal(result.comparison.admittedReconciledChargedFees, 140);
  assert.equal(result.through.attendance, "2026-05-06");
  assert.equal(result.comparison.candidateSessions, 4);
  assert.equal(result.financial.actual.revenue, 140);
  assert.equal(result.financial.actual.profit, null);
});

test("aggregate audit uses the same separate approval journal without leaking source bindings or certifying costs", () => {
  const input = fixture();
  const billing = input.snapshots[1];
  billing.rows.push({ ...billing.rows[0], sourceRowHash: "SECRET_EXCEPTION_SECOND", totalFeeCharged: 150 });
  const draft = prepareBillingChargeResolution(billing.rows.filter(row => row.serviceDate === billing.rows[0].serviceDate).map(row => ({ row, snapshotId: billing.id })));
  assert.ok(draft);
  input.declarations = { version: 1, mappings: [{ sourceLabel: "Elia", clinicianId: 1, clinicianLabel: "Elia", teamId: null }], sourceSets: [] };
  input.billingResolutions = [{ ...draft, id: "00000000-0000-4000-8000-000000000001", approvalToken: "a".repeat(64), clinicianId: 1, confirmedAt: "2026-10-16T00:00:00Z", approvalNote: "SECRET_OWNER_APPROVAL" }];
  const before = structuredClone(input);
  const result = aggregateAudit(input, options);
  assert.equal(result.comparison.admittedReconciledChargedFees, 290);
  assert.equal(result.financial.actual.revenue, 290);
  assert.equal(result.comparison.candidateSessions, 4);
  assert.equal(result.evidenceIssues.admittedBillingResolvedCases, 1);
  assert.equal(result.evidenceIssues.originalRawBillingConflicts, 1);
  assert.equal(result.financial.actual.profit, null);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_|approvalToken|sourceRowHash|clientId|snapshotId/);
  assert.deepEqual(input, before);
});

test("one practice conversion can coexist with zero confirmed closer credits and one pending retention start", () => {
  const result = aggregateAudit(fixture(), options);
  assert.equal(result.practiceConsultation.candidate.converted, 1);
  assert.equal(result.practiceConsultation.candidate.evaluated, 1);
  assert.equal(result.practiceConsultation.candidate.conversionRate, 100);
  assert.equal(result.requestedClinician.candidate.confirmedCloser.converted, 0);
  assert.equal(result.requestedClinician.candidate.confirmedCloser.needsAttribution, 1);
  assert.equal(result.requestedClinician.candidate.confirmedCloser.conversionRate, null);
  assert.equal(result.requestedClinician.candidate.retention.retained, 1);
  assert.equal(result.requestedClinician.candidate.retention.evaluated, 1);
  assert.equal(result.requestedClinician.candidate.retention.pending, 1);
  assert.equal(result.requestedClinician.candidate.retention.percent, 100);
});

test("legacy unproved sources are compared as raw evidence but cannot become candidate actuals", () => {
  const input = fixture();
  for (const snapshot of input.snapshots) delete snapshot.reportCoverage;
  const result = aggregateAudit(input, options);
  assert.equal(result.comparison.rawImportedVisitsInWindow, 4);
  assert.equal(result.comparison.rawReconciledChargedFees, 140);
  assert.equal(result.comparison.admittedReconciledChargedFees, null);
  assert.equal(result.comparison.candidateSessions, null);
  assert.equal(result.through.forecastStarts, null);
  assert.equal(result.periods.length, 0);
  assert.equal(result.sources.missingExplicitCoverageSnapshots, 2);
  assert.match(result.coverageBlocker, /^all_active_imports_lack_explicit_coverage_/);
  assert.equal(result.requestedClinician.candidate.retention, null);
});

test("global name collisions remain unknown while unrelated identities do not require reports", () => {
  const input = fixture();
  input.context.clinicians.push({ ...input.context.clinicians[0], id: 2, goalId: 999, label: " elia " });
  const ambiguous = aggregateAudit(input, options);
  assert.equal(ambiguous.scope.ambiguousNormalizedNames, 1);
  assert.equal(ambiguous.requestedClinician.identity, "ambiguous_global_identity");
  assert.equal(ambiguous.through.billing, null);
  assert.equal(ambiguous.comparison.candidateSessions, null);
  input.context.clinicians[1].label = "Unrelated";
  const unique = aggregateAudit(input, options);
  assert.equal(unique.through.billing, "2026-05-06");
  assert.equal(unique.comparison.candidateSessions, 4);
});

test("confirmed declarations resolve copied identities in the exact-model aggregate without exposing mapping values", () => {
  const input = fixture();
  input.context.clinicians.push({ ...input.context.clinicians[0], id: 2, goalId: 999 });
  for (const [i, snapshot] of input.snapshots.entries()) {
    snapshot.id = `${snapshot.kind}-${String(i + 1).repeat(16)}`;
    delete snapshot.reportCoverage;
  }
  input.declarations = { version: 1, mappings: [{ sourceLabel: "Elia", clinicianId: 1, clinicianLabel: "Elia", teamId: null }],
    sourceSets: input.snapshots.map((snapshot) => ({ kind: snapshot.kind, snapshotIds: [snapshot.id], clinicianIds: [1], start: "2026-01-01", end: "2026-05-06", complete: true })) };
  const before = structuredClone(input);
  const result = aggregateAudit(input, options);
  assert.equal(result.requestedClinician.identity, "explicit_confirmed_selected_identity");
  assert.equal(result.through.attendance, "2026-05-06");
  assert.equal(result.comparison.candidateSessions, 4);
  assert.equal(result.coverageBlocker, null);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_|clientId|sourceRowHash|sourceHash|snapshotId|clinicianId/);
  assert.deepEqual(input, before);
});

test("aggregate replay restores separate historical metadata and exports only historical charge aggregates", () => {
  const input = fixture();
  const billing = input.snapshots[1]; billing.id = "billing-bbbbbbbb"; billing.sourceHash = "bbbbbbbb";
  billing.rows.push({ clientId: "SECRET_FORMER_CLIENT", clinician: "Synthetic Former", serviceDate: "2026-01-31", totalFeeCharged: 75, billingCode: "90837", sourceRowHash: "SECRET_FORMER_HASH" });
  input.declarations = { version: 1, mappings: [{ sourceLabel: "Elia", clinicianId: 1, clinicianLabel: "Elia", teamId: null }], sourceSets: [] };
  input.declarationRevision = 2;
  input.historicalBillingJournal = [{ version: 1, declarationRevision: 2, providers: [{ id: "00000000-0000-4000-8000-000000000001", sourceLabel: "Synthetic Former",
    sourceSets: [{ snapshotIds: [billing.id], start: "2026-01-01", end: "2026-05-06", complete: true }] }] }];
  const before = structuredClone(input); const result = aggregateAudit(input, options);
  assert.equal(result.financial.actual.revenue, 140, "historical charges never feed current-team operating actuals");
  assert.equal(result.historicalBilling.reportedCharges, 215);
  assert.equal(result.historicalBilling.historicalProviderCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_|clientId|sourceRowHash|sourceHash|snapshotId|clinicianId/);
  assert.deepEqual(input, before);
});

function fakeClient({ mode = "on", fail = false } = {}) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("current_setting")) return { rows: [{ mode }] };
    if (fail && sql.startsWith("SELECT count")) throw new Error("SECRET_DATABASE_VALUE");
    if (sql.startsWith("SELECT count")) return { rows: [{ snapshots: 0, facts: "0" }] };
    if (sql.startsWith("SELECT data")) return { rows: [{ data: {} }] };
    return { rows: [] };
  } };
}
test("database snapshot is scoped, read-only, bounded, and always rolled back without writes", async () => {
  const client = fakeClient();
  await readOnlyInput(client, "SECRET_SCOPE");
  assert.equal(client.calls[0].sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(client.calls.at(-1).sql, "ROLLBACK");
  assert.ok(client.calls.every(({ sql }) => /^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|SET LOCAL |SELECT |ROLLBACK)/.test(sql)));
  assert.ok(client.calls.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT|COPY)\b/i.test(sql)));
  for (const { sql, params } of client.calls.filter(({ sql }) => /FROM practice_import_/.test(sql))) {
    assert.match(sql, /practice_id = \$1 AND account_id = \$2/);
    if (sql.includes("FROM practice_import_audit")) assert.match(sql, /action = '(accept-billing-charge-exception|confirm-historical-billing-providers)' LIMIT 1001/);
    else assert.match(sql, /AND active = 1/);
    assert.deepEqual(params, ["SECRET_SCOPE", "SECRET_SCOPE"]);
    assert.doesNotMatch(sql, /SECRET_SCOPE/);
  }
});
test("read-only proof failure and query errors roll back without retrieving source rows", async () => {
  const off = fakeClient({ mode: "off" });
  await assert.rejects(readOnlyInput(off, "scope"));
  assert.equal(off.calls.at(-1).sql, "ROLLBACK");
  assert.equal(off.calls.filter(({ sql }) => /FROM /.test(sql)).length, 0);
  const failing = fakeClient({ fail: true });
  await assert.rejects(readOnlyInput(failing, "scope"));
  assert.equal(failing.calls.at(-1).sql, "ROLLBACK");
});
test("explicit dates and source guard fail safely before any connection; CLI does not expose errors", () => {
  assertCandidateSource();
  const dates = { AUDIT_AS_OF: "2026-10-15", AUDIT_WINDOW_START: "2026-01-01", AUDIT_WINDOW_END: "2026-10-15" };
  assert.throws(() => auditOptions(dates), /explicit_clinician_label_required/);
  assert.equal(auditOptions({ ...dates, AUDIT_CLINICIAN_LABEL: " Synthetic Full Name " }).targetLabel, "Synthetic Full Name");
  assert.throws(() => auditOptions({ AUDIT_AS_OF: "2026-02-30", AUDIT_WINDOW_START: "2026-01-01", AUDIT_WINDOW_END: "2026-02-20" }));
  const child = spawnSync(process.execPath, [new URL("./practice-readonly-audit.mjs", import.meta.url).pathname], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "SECRET_CONNECTION_STRING" } });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, "");
  assert.deepEqual(JSON.parse(child.stderr), { status: "audit_failed_no_report", phase: "preflight", reason: "explicit_ack_required", patientDataPrinted: false });
});

test("production fallback contains only four SELECT statements and no mutation or side-effect commands", () => {
  const sql = readFileSync(new URL("./practice-production-aggregate-audit.sql", import.meta.url), "utf8").replace(/^\s*--.*$/gm, "");
  const statements = sql.split(";").map((value) => value.trim()).filter(Boolean);
  assert.doesNotMatch(sql, /regexp_replace\(btrim\(/, "Normalize whitespace before trimming so tab-padded identities cannot hide a duplicate");
  assert.match(sql, /lower\(btrim\(regexp_replace\(c\.label,/);
  assert.equal(statements.length, 4);
  assert.match(statements[1], /to_regclass\('practice_import_declarations'\) IS NULL/);
  assert.match(statements[3], /to_regclass\('practice_import_declarations'\) IS NULL/);
  for (const statement of statements) {
    assert.match(statement, /^WITH /);
    assert.doesNotMatch(statement, /\b(insert|update|delete|create|alter|drop|truncate|copy|call|begin|commit|rollback|grant|revoke|pg_sleep|set_config|dblink)\b/i);
    assert.match(statement, /active_scopes/);
    assert.match(statement, /count\(\*\) FROM active_scopes\) = 1/);
  }
});
