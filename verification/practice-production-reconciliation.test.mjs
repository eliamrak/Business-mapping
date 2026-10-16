import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// An isolated, synthetic-only PostgreSQL cluster. Never reads DATABASE_URL.
const { Client } = createRequire(new URL('../lib/db/package.json', import.meta.url))('pg');
const sql = readFileSync(new URL('./practice-production-reconciliation.sql', import.meta.url), 'utf8');
const root = mkdtempSync(join(tmpdir(), 'practice-synthetic-sql-'));
let client, started = false;
const names = ['Erin Mrakovich', 'Elia Mrakovich', 'Natalie Rieke', 'Michele Teague', 'Jessica Cockrum', 'Jessica Yates'];
const ids = [8, 9, 10, 11, 12, 13];
const source = kind => `${kind}-${kind === 'attendance' ? 'a' : 'b'}`;
const visit = (client, date, clinician = names[0], extra = {}) => ({ clientId: `SYNTHETIC_${client}`, clinician,
  serviceDate: date, sourceRowHash: `SYNTHETIC_HASH_${client}_${date}_${clinician}`, status: 'show', billingCode: '90837', ...extra });
const charge = (client, date, fee = 100, clinician = names[0], extra = {}) => ({ ...visit(client, date, clinician), totalFeeCharged: fee, ...extra });

before(async () => {
  execFileSync('initdb', ['-D', join(root, 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
  execFileSync('pg_ctl', ['-D', join(root, 'data'), '-l', join(root, 'server.log'), '-o', `-h '' -k ${root} -p 55487`, '-w', 'start'], { stdio: 'pipe' });
  started = true;
  client = new Client({ host: root, port: 55487, database: 'postgres', user: process.env.USER });
  await client.connect();
  await client.query(`CREATE TABLE clinicians(id integer, goal_id integer, label text);
    CREATE TABLE hub_workspaces(id integer, data jsonb);
    CREATE TABLE practice_import_snapshots(practice_id text,account_id text,active integer,kind text,source_hash text,rows jsonb,report_coverage jsonb);
    CREATE TABLE practice_import_packages(practice_id text,account_id text,active integer,same_day_visit_overrides jsonb);
    CREATE TABLE practice_import_declarations(practice_id text,account_id text,revision integer,data jsonb);
    CREATE TABLE practice_import_audit(practice_id text,account_id text,action text,detail jsonb);`);
});
after(async () => {
  if (client) await client.end();
  if (started) execFileSync('pg_ctl', ['-D', join(root, 'data'), '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' });
  rmSync(root, { recursive: true, force: true });
});

async function fixture(mutator = () => {}) {
  const attendance = names.map((name, i) => visit(`roster_${i}`, '2025-12-01', name));
  const billing = names.map((name, i) => charge(`roster_${i}`, '2025-12-01', 100, name));
  attendance.push(visit('retained', '2026-01-16'), visit('retained', '2026-01-23'), visit('retained', '2026-01-30'),
    visit('converted', '2026-01-17', names[0], { billingCode: 'PHONE' }), visit('converted', '2026-01-24', names[1]),
    visit('missed', '2026-01-18', names[0], { billingCode: 'PHONE' }));
  billing.push(charge('retained', '2026-01-16'), charge('retained', '2026-01-23'), charge('retained', '2026-01-30'),
    charge('converted', '2026-01-17', 0, names[0], { billingCode: 'PHONE' }), charge('converted', '2026-01-24', 150, names[1]),
    charge('missed', '2026-01-18', 0, names[0], { billingCode: 'PHONE' }));
  const declarations = { version: 1, mappings: names.map((name, i) => ({ sourceLabel: name, clinicianLabel: name, clinicianId: ids[i], teamId: 1 })),
    sourceSets: ['attendance', 'billing'].map(kind => ({ kind, snapshotIds: [source(kind)], clinicianIds: ids,
      start: '2025-07-01', end: '2026-10-10', complete: true })) };
  const state = { attendance, billing, declarations, workspace: { settings: { teamId: 1 }, clinicians: [], consultAttributionOverrides: [] },
    journal: [], overrides: {}, extras: [] };
  mutator(state);
  await client.query('TRUNCATE clinicians,hub_workspaces,practice_import_snapshots,practice_import_packages,practice_import_declarations,practice_import_audit');
  for (let i = 0; i < names.length; i++) await client.query('INSERT INTO clinicians VALUES($1,1,$2)', [ids[i], names[i]]);
  await client.query('INSERT INTO hub_workspaces VALUES(1,$1)', [state.workspace]);
  await client.query("INSERT INTO practice_import_packages VALUES('synthetic','synthetic',1,$1)", [state.overrides]);
  await client.query("INSERT INTO practice_import_declarations VALUES('synthetic','synthetic',1,$1)", [state.declarations]);
  for (const kind of ['attendance', 'billing']) await client.query("INSERT INTO practice_import_snapshots VALUES('synthetic','synthetic',1,$1,$2,$3,NULL)", [kind, kind === 'attendance' ? 'a' : 'b', JSON.stringify(state[kind])]);
  for (const extra of state.extras) await client.query("INSERT INTO practice_import_snapshots VALUES('synthetic','synthetic',1,$1,$2,$3,$4)", [extra.kind, extra.hash, JSON.stringify(extra.rows), extra.proof ?? null]);
  for (const detail of state.journal) await client.query("INSERT INTO practice_import_audit VALUES('synthetic','synthetic','accept-billing-charge-exception',$1)", [detail]);
  return state;
}
async function run(query = sql) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout='30s'");
    const result = (await client.query(query)).rows[0];
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_|clientId|client_key|row_hash|source_key|approvalToken/);
    return result;
  } finally { await client.query('ROLLBACK'); }
}
const row = (report, label = 'Whole Practice', window = 'month') => report.aggregate_metrics.find(r => r.clinician === label && r.window === window);

test('one SELECT with no mutable SQL, temporary writes, raw final projection or credential lookup', () => {
  const statements = sql.replace(/--[^\n]*/g, '').trim().split(';').filter(Boolean);
  assert.equal(statements.length, 1);
  assert.doesNotMatch(statements[0], /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|DROP|ALTER|COPY|DO|CALL|GRANT|SET|COMMIT)\b/i);
  assert.doesNotMatch(statements[0], /pg_read_file|dblink|lo_export|set_config|pg_sleep/i);
});
test('six mapped clinicians plus practice, full coverage, independent visit and fee arithmetic', async () => {
  await fixture(); const result = await run();
  assert.equal(result.status, 'READY_AGGREGATE_DIAGNOSTIC_NOT_UI_CERTIFICATION');
  assert.equal(result.aggregate_metrics.length, 14);
  const month = row(result), period = row(result, 'Whole Practice', 'biweekly');
  assert.equal(month.sessions, 4); assert.equal(period.sessions, 3);
  assert.equal(month.attendanceCoveredDays, 31); assert.equal(period.attendanceCoveredDays, 14);
  assert.ok(Math.abs(month.sessionsWeekly - 28 / 31) < 1e-12);
  assert.equal(month.billedCharges, 450); assert.equal(period.billedCharges, 350);
  assert.equal(row(result, names[0]).retained, 1);
  assert.equal(row(result, names[0]).retentionEvaluated, 1);
  assert.equal(month.consultConverted, 1); assert.equal(month.consultEvaluated, 2); assert.equal(month.consultPercent, 50);
  assert.equal(row(result, names[1]).consultEvaluated, 0);
  assert.equal(row(result, names[1]).convertedNeedsAttribution, 1);
  assert.equal(row(result, names[1]).consultPending, 1);
  assert.equal(row(result, names[0]).consultPending, 1);
  assert.equal(row(result, names[1]).consultPercent, null);
});
test('confirmed actual closer and missed owner, protected internal referrer', async () => {
  await fixture(s => { s.workspace.consultAttributionOverrides = [
    { clientId: 'SYNTHETIC_converted', outcome: 'confirmed_closer', clinicianName: names[1] },
    { clientId: 'SYNTHETIC_missed', outcome: 'missed_owner', clinicianName: names[0] }]; });
  const result = await run();
  assert.equal(row(result, names[1]).consultConverted, 1); assert.equal(row(result, names[1]).consultPercent, 100);
  assert.equal(row(result, names[0]).consultEvaluated, 1); assert.equal(row(result, names[0]).consultPercent, 0);
  assert.equal(row(result, names[0]).internalReferrerProtected, 1);
  assert.equal(row(result).consultPercent, 50);
});
test('billing-linked PHONE is consult, not treatment; overlapping exports deduplicate', async () => {
  await fixture(s => {
    delete s.attendance.find(r => r.clientId === 'SYNTHETIC_converted' && r.serviceDate === '2026-01-17').billingCode;
    s.extras.push({ kind: 'attendance', hash: 'c', rows: s.attendance.map(r => ({ ...r })), proof: { start: '2025-07-01', end: '2026-10-10', complete: true } });
    s.extras.push({ kind: 'billing', hash: 'd', rows: s.billing.map(r => ({ ...r })), proof: { start: '2025-07-01', end: '2026-10-10', complete: true } });
  });
  const result = await run(); assert.equal(row(result).sessions, 4); assert.equal(row(result).consultConverted, 1); assert.equal(row(result).billedCharges, 450);
});
test('two pinned approved charges do not add treatment visits, stale anchors withhold fees', async () => {
  const state = await fixture(s => {
    const first = s.billing.find(r => r.clientId === 'SYNTHETIC_retained' && r.serviceDate === '2026-01-23');
    const second = { ...first, sourceRowHash: 'SYNTHETIC_SECOND', totalFeeCharged: 150 }; s.billing.push(second);
    s.journal.push({ revision: 1, resolution: { id: '00000000-0000-4000-8000-000000000001', approvalToken: 'a'.repeat(64), clientId: first.clientId,
      clinicianId: 8, clinicianLabel: names[0], serviceDate: first.serviceDate, billingCode: '90837', visitKind: '',
      confirmedAt: '2026-10-16T00:00:00Z', approvalNote: 'Synthetic fixture only',
      charges: [first, second].map(r => ({ amount: r.totalFeeCharged, anchor: { snapshotId: source('billing'), sourceRowHash: r.sourceRowHash } })) } });
  });
  let result = await run(); assert.equal(row(result).billedCharges, 600); assert.equal(row(result).sessions, 4); assert.equal(row(result).approvedTwoChargeGroups, 1);
  state.journal[0].resolution.charges[1].anchor.sourceRowHash = 'SYNTHETIC_STALE';
  await client.query('UPDATE practice_import_audit SET detail=$1', [state.journal[0]]);
  result = await run(); assert.equal(row(result).billedCharges, null); assert.equal(row(result).staleApprovals, 1);
});
test('no source proof never certifies zero, stale frozen membership stops', async () => {
  await fixture(s => { s.declarations.sourceSets = []; });
  let result = await run(); assert.equal(row(result).sessions, null); assert.equal(row(result).billedCharges, null); assert.equal(row(result).retentionPercent, null);
  await fixture(s => { s.declarations.sourceSets[0].snapshotIds.push('attendance-missing'); });
  result = await run(); assert.equal(result.status, 'STOP_STALE_SOURCE_SET'); assert.equal(result.aggregate_metrics, null);
});
test('differing cross-export attendance status sets withhold provider period only', async () => {
  await fixture(s => { s.extras.push({ kind: 'attendance', hash: 'c', rows: s.attendance.map(r => ({ ...r, status: r.clientId === 'SYNTHETIC_retained' && r.serviceDate === '2026-01-23' ? 'cancelled' : r.status })),
    proof: { start: '2025-07-01', end: '2026-10-10', complete: true } }); });
  const result = await run(); assert.ok(result.conflicting_attendance_groups > 0);
  assert.equal(row(result).sessions, null); assert.equal(row(result, names[0], 'biweekly').sessions, null);
  assert.equal(row(result, names[1], 'biweekly').sessions, 1); assert.equal(row(result).billedCharges, 450);
});
test('28-day initial gaps qualify, 29-day gap fails, unknown maturity remains pending', async () => {
  await fixture(s => {
    s.attendance.push(visit('gap28', '2026-01-19'), visit('gap28', '2026-02-16'), visit('gap28', '2026-03-16'),
      visit('gap29', '2026-01-20'), visit('gap29', '2026-02-18'), visit('gap29', '2026-03-18'));
  });
  const result = await run(); const m = row(result, names[0]);
  assert.equal(m.retained, 2); assert.equal(m.retentionEvaluated, 3); assert.equal(m.retentionPending, 0);
});
test('final established visit needs 90 covered days, later return removes January ending', async () => {
  await fixture(); let result = await run();
  assert.equal(row(result, names[0]).endingEvents, 1); assert.equal(row(result, names[0]).endingMonthlyAverage, 1);
  assert.equal(row(result, names[0], 'biweekly').endingMatureMonths, 0); assert.equal(row(result, names[0], 'biweekly').endingMonthlyAverage, null);
  await fixture(s => { s.attendance.push(visit('retained', '2026-06-01')); }); result = await run();
  assert.equal(row(result, names[0]).endingEvents, 0); assert.equal(row(result, names[0]).endingMonthlyAverage, 0);
});
test('multiplicity overrides are visibly unsupported, not invented; hash collision withholds fees', async () => {
  await fixture(s => { s.overrides = { synthetic_key: 2 }; });
  let result = await run(); assert.equal(Number(result.packages_with_unsupported_multiplicity_overrides), 1); assert.equal(row(result).sessions, null); assert.equal(row(result).retained, 1);
  await fixture(s => { s.billing[1].sourceRowHash = s.billing[0].sourceRowHash; });
  result = await run(); assert.equal(Number(result.cross_encounter_billing_hash_collisions), 1); assert.equal(row(result).billedCharges, null);
});
test('unproved later return blocks an ending but does not add visits', async () => {
  await fixture(s => { s.extras.push({ kind: 'attendance', hash: 'c', rows: [visit('retained', '2026-10-09')] }); });
  const result = await run();
  assert.equal(row(result).sessions, 4); assert.equal(row(result, names[0]).endingEvents, null);
  assert.equal(row(result, names[0]).positiveMatureEndingEvents, 0); assert.equal(row(result, names[0]).endingMatureMonths, 0);
  const provenance = result.retention_provenance.find(r => r.clinician === names[0] && r.window === 'month');
  assert.equal(provenance.unresolvedPartialFollowupRows, 1);
  assert.equal(provenance.partialFollowupAfterAdmittedThroughRows, 1);
  assert.equal(provenance.legacyClinicianLabelVerified, false);
  assert.equal(provenance.selectedRetentionCoverageVerified, true);
});
test('right-censored consults and retention remain pending, never failed', async () => {
  await fixture(s => { for (const set of s.declarations.sourceSets) set.end = '2026-01-31'; });
  const result = await run(); const month = row(result);
  // Only Jan1-28 canonical periods qualify; Jan30 positive rows remain raw evidence.
  assert.equal(month.sessions, null); assert.equal(month.consultConverted, 1); assert.equal(month.consultEvaluated, 1); assert.equal(month.consultPending, 1);
  assert.equal(row(result, names[0]).retained, 0); assert.equal(row(result, names[0]).retentionPending, 1);
  assert.equal(row(result, names[0]).endingEvents, null);
  assert.equal(result.retention_provenance.find(r => r.clinician === names[0] && r.window === 'month').selectedRetentionCoverageVerified, false);
});
test('roster changes, scope ambiguity and unsupported attendance identities fail closed', async () => {
  await fixture(); await client.query("INSERT INTO clinicians VALUES(99,1,'Synthetic extra')");
  let result = await run(); assert.equal(result.status, 'STOP_ROSTER_OR_MAPPING_CHANGED');
  await fixture(); await client.query("INSERT INTO practice_import_packages VALUES('other','other',1,'{}')");
  result = await run(); assert.equal(result.status, 'STOP_SCOPE_NOT_UNIQUE'); assert.equal(result.aggregate_metrics, null);
  await fixture(s => { s.attendance[1].sourceRowHash = s.attendance[0].sourceRowHash; });
  result = await run(); assert.equal(result.status, 'STOP_ATTENDANCE_HASH_IDENTITY');
});
test('invalid dates reject frozen proof without returning the invalid source value', async () => {
  await fixture(s => { s.attendance[0].serviceDate = '2026-02-31'; });
  const result = await run(); assert.equal(result.status, 'STOP_STALE_SOURCE_SET'); assert.equal(Number(result.invalid_source_dates), 1);
});
test('null status, missing journal revision and malformed approval/schema fail closed', async () => {
  await fixture(s => { delete s.attendance[0].status; });
  let result = await run(); assert.equal(result.status, 'STOP_UNSUPPORTED_ATTENDANCE_STATUS'); assert.equal(result.aggregate_metrics, null);
  for (const detail of [{ resolution: {} }, { revision: 1, resolution: { charges: 'SYNTHETIC_BAD' } },
    { revision: 'SYNTHETIC_BAD', resolution: null }]) {
    await fixture(s => { s.journal = [detail]; }); result = await run(); assert.equal(result.status, 'STOP_JOURNAL_INVALID'); assert.equal(result.aggregate_metrics, null);
  }
  await fixture(s => { s.declarations.sourceSets[0].snapshotIds = 'SYNTHETIC_BAD'; });
  result = await run(); assert.equal(result.status, 'STOP_STALE_SOURCE_SET');
  await fixture(s => { s.declarations.mappings = 'SYNTHETIC_BAD'; }); result = await run(); assert.equal(result.status, 'STOP_METADATA_SCHEMA');
});
test('journal timestamp validates full ISO structure, calendar day and clock without unsafe casts', async () => {
  for (const confirmedAt of ['2026-01-01TNOT_A_TIMESTAMP', '2026-02-31T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '0000-01-01T00:00:00Z']) {
    await fixture(s => { s.journal.push({ revision: 1, resolution: {
      id: '00000000-0000-4000-8000-000000000001', approvalToken: 'a'.repeat(64), clinicianId: 8, clinicianLabel: names[0],
      clientId: 'SYNTHETIC_retained', serviceDate: '2026-01-23', billingCode: '90837', visitKind: '', confirmedAt, approvalNote: 'Synthetic only',
      charges: [1, 2].map(n => ({ amount: 100, anchor: { snapshotId: source('billing'), sourceRowHash: `SYNTHETIC_ANCHOR_${n}` } })),
    } }); });
    const result = await run(); assert.equal(result.status, 'STOP_JOURNAL_INVALID'); assert.equal(result.aggregate_metrics, null);
  }
});
test('bounded larger synthetic source sets retain exact totals', async () => {
  await fixture(s => { for (let n = 0; n < 400; n++) for (const day of ['2026-01-16', '2026-01-23', '2026-01-30']) {
    const name = names[n % 6]; s.attendance.push(visit(`bulk_${n}`, day, name)); s.billing.push(charge(`bulk_${n}`, day, 100, name));
  } });
  const result = await run(); assert.equal(row(result).sessions, 1204); assert.equal(row(result).billedCharges, 120450);
  assert.equal(row(result).retained, 401);
});
