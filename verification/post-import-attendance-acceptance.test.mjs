import test from 'node:test';
import assert from 'node:assert/strict';
import { completeReportCoverage } from '../artifacts/comp-dashboard/src/lib/complete-report-coverage.ts';
import { buildImportedSessionOverlay } from '../artifacts/comp-dashboard/src/lib/import-derived-sessions.ts';
import { completePeriodSessionSummary } from '../artifacts/comp-dashboard/src/lib/complete-session-summary.ts';
import { buildLocalRetentionMetrics, importAttendanceCsv } from '../artifacts/comp-dashboard/src/lib/retention-local.ts';

const asOf = '2026-10-16';
const selected = { start: '2026-09-17', end: asOf };
const bounds = { start: '2026-08-27', end: '2026-10-12', complete: true };
const clinicians = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, label: `Synthetic ${i + 1}`, goalId: 7 }));
const ids = clinicians.map(person => person.id);
const dates = (start, end) => {
  const result = [];
  for (let stamp = Date.parse(start + 'T12:00:00Z'); stamp <= Date.parse(end + 'T12:00:00Z'); stamp += 86400000)
    result.push(new Date(stamp).toISOString().slice(0, 10));
  return result;
};
const row = (clientId, serviceDate, status = 'show', billingCode = '90837', clinician = clinicians[0].label) => ({
  clientId, clinician, serviceDate, status, billingCode, location: 'Synthetic Room',
  sourceRowHash: `synthetic-${clientId}-${serviceDate}-${status}-${billingCode}`,
});
const source = (digit, rows, kind = 'attendance') => ({
  id: `${kind}-${digit.repeat(8)}`, kind, sourceHash: digit.repeat(8),
  importedAt: asOf + 'T00:00:00Z', coverageStart: bounds.start, coverageEnd: bounds.end, rows,
});
const declarationsFor = (snapshots, roster) => ({
  version: 1,
  mappings: roster.map(person => ({ sourceLabel: person.label, clinicianId: person.id, clinicianLabel: person.label, teamId: 7 })),
  sourceSets: ['attendance', 'billing'].flatMap(kind => {
    const members = snapshots.filter(snapshot => snapshot.kind === kind);
    return members.length ? [{ kind, snapshotIds: members.map(snapshot => snapshot.id), clinicianIds: roster.map(person => person.id), ...bounds }] : [];
  }),
});
function pipeline(snapshots, roster = clinicians, sessions = [], query = selected, declarations = declarationsFor(snapshots, roster)) {
  const input = { snapshots, roster, sessions, query, declarations };
  const before = structuredClone(input);
  const context = { clinicians: roster, staff: [], sessions };
  const proof = completeReportCoverage(snapshots, roster, asOf, roster, { declarations, teamId: 7 });
  const overlay = buildImportedSessionOverlay(context, proof.eligibleSnapshots, 7, {}, { declarations });
  const summary = completePeriodSessionSummary(overlay.context.sessions, roster.map(person => person.id), query, proof.completeAttendanceCoverage, asOf);
  const metrics = buildLocalRetentionMetrics(proof.eligibleSnapshots, {}, {}, 28, asOf, 90, query.start, query.end);
  assert.deepEqual(input, before, 'Admission and calculations must not mutate source evidence');
  return { proof, overlay, summary, metrics };
}
function sixProviderSources() {
  return [['2026-08-27', '2026-09-09'], ['2026-09-10', '2026-09-23'], ['2026-09-24', bounds.end]]
    .map(([start, end], i) => source(String(i + 1), dates(start, end).flatMap(date => clinicians.map(person => row(`daily-${person.id}`, date, 'show', '90837', person.label)))));
}

test('six providers: complete source-set admission -> daily overlay -> selected 126 / 21 = 42 per week', () => {
  const snapshots = sixProviderSources();
  const { proof, overlay, summary } = pipeline(snapshots);
  assert.equal(proof.attendanceThrough, '2026-10-07');
  assert.equal(proof.eligibleAttendanceRows.length, 6 * 42);
  assert.equal(proof.completeAttendanceCoverage.length, 6 * 3);
  assert.ok(proof.completeAttendanceCoverage.some(range => range.start === '2026-09-10' && range.end === '2026-09-23'));
  assert.equal(summary.observedCompleted, 126);
  assert.equal(summary.observedCoverageDays, 21);
  assert.equal(summary.completedWeekly, 42);
  assert.equal(summary.coverageComplete, false);
  assert.equal(summary.calendarWindowWeeklyEstimate, null);
  assert.equal(overlay.derivedSessions.filter(record => record.start >= selected.start).reduce((sum, record) => sum + record.completed, 0), 126);
  for (const clinicianId of ids) {
    const person = completePeriodSessionSummary(overlay.context.sessions, [clinicianId], selected, proof.completeAttendanceCoverage, asOf);
    assert.equal(person.observedCompleted, 21);
    assert.equal(person.observedCoverageDays, 21);
    assert.equal(person.completedWeekly, 7);
  }
  assert.ok(snapshots.every(snapshot => snapshot.reportCoverage === undefined), 'Frozen set proof must not rewrite member proofs');
});

test('Oct 8-21 is excluded even when its observed Oct 8-12 tail contains visits', () => {
  const result = pipeline(sixProviderSources());
  assert.ok(result.proof.incompletePeriods.some(period => period.start === '2026-10-08' && period.end === '2026-10-21'));
  assert.ok(result.proof.eligibleAttendanceRows.every(fact => fact.serviceDate <= '2026-10-07'));
  assert.ok(result.overlay.context.sessions.every(record => record.end <= '2026-10-07'));
  const tail = completePeriodSessionSummary(result.overlay.context.sessions, ids, { start: '2026-10-08', end: asOf }, result.proof.completeAttendanceCoverage, asOf);
  assert.equal(tail.observedCompleted, null);
  assert.equal(tail.observedCoverageDays, 0);
  assert.equal(tail.completedWeekly, null);
});

test('manual aggregate crossing the selected left boundary is withheld without proration', () => {
  const sessions = clinicians.flatMap(person => [['2026-09-10', '2026-09-23'], ['2026-09-24', '2026-10-07']]
    .map(([start, end], i) => ({ id: person.id * 10 + i, clinicianId: person.id, start, end, completed: 14 })));
  const result = completePeriodSessionSummary(sessions, ids, selected, [], asOf);
  assert.equal(result.observedCompleted, 84);
  assert.equal(result.observedCoverageDays, 14);
  assert.equal(result.completedWeekly, 42);
});

test('PHONE and documentation 2 are excluded; numeric code 4 remains treatment', () => {
  const rows = [row('phone', '2026-09-25', 'show', 'PHONE'), row('four', '2026-09-25', 'show', '4'), row('doc', '2026-09-25', 'show', '2')];
  const billing = source('5', rows.map(fact => ({ ...fact, totalFeeCharged: fact.billingCode === 'PHONE' ? 0 : 25 })), 'billing');
  const result = pipeline([source('4', rows), billing], clinicians.slice(0, 1));
  assert.equal(result.summary.observedCompleted, 1);
  assert.equal(result.metrics.derivedShowVisits, 1);
  assert.equal(result.overlay.derivedSessions.reduce((sum, record) => sum + record.completed, 0), 1);
  const legacyRows = structuredClone(rows);
  for (const fact of legacyRows) delete fact.billingCode;
  legacyRows[1].visitKind = 'consultation';
  const legacy = pipeline([source('4', legacyRows), billing], clinicians.slice(0, 1));
  assert.equal(legacy.summary.observedCompleted, 1, 'Billing-linked 4 overrides stale consultation metadata; billing-linked 2 and PHONE stay excluded');
});

test('47 billed late cancellations retain their subtype and add zero attended treatment visits', () => {
  const parsed = importAttendanceCsv('Client,Clinician,Date of service,Status,Location,Billing code\n' +
    Array.from({ length: 47 }, (_, i) => `late-${i},Synthetic 1,2026-09-25,Late cancelled,Room,90837`).join('\n')).snapshot;
  assert.ok(parsed.rows.every(fact => fact.status === 'cancelled' && fact.cancellationSubtype === 'late_cancelled'));
  const billing = source('6', parsed.rows.map(fact => ({ ...fact, sourceRowHash: `bill-${fact.sourceRowHash}`, totalFeeCharged: 50 })), 'billing');
  const result = pipeline([source('4', parsed.rows), billing], clinicians.slice(0, 1));
  assert.equal(result.summary.observedCompleted, 0);
  assert.equal(result.summary.observedCoverageDays, 21);
  assert.equal(result.overlay.derivedSessions.length, 0);
  assert.equal(result.metrics.derivedShowVisits, 0);
  assert.equal(result.metrics.attendanceByClinician[0].clientCancelled, 47);
  assert.equal(result.overlay.diagnostic.billedFees, 2350);
});

test('overlapping exports with changed row hashes count identical visits once in either source order', () => {
  const first = source('7', [row('repeat', '2026-09-25')]);
  const second = source('8', [{ ...first.rows[0], clinician: '  sYnThEtIc   1  ', sourceRowHash: 'changed-export-row-hash' }, row('next', '2026-09-26')]);
  for (const snapshots of [[first, second], [second, first]]) {
    const result = pipeline(snapshots, clinicians.slice(0, 1));
    assert.equal(result.summary.observedCompleted, 2);
    assert.equal(result.summary.observedCoverageDays, 21);
    assert.equal(result.metrics.derivedShowVisits, 2);
    assert.equal(result.proof.attendanceStatusConflictCount, 0);
  }
});

test('admitted Show/Cancelled source conflict withholds only the affected provider period in either order', () => {
  const first = sixProviderSources();
  const correction = source('9', [row('daily-1', '2026-09-25', 'cancelled')]);
  for (const snapshots of [[...first, correction], [...first, correction].reverse()]) {
    const result = pipeline(snapshots);
    assert.equal(result.proof.attendanceStatusConflictCount, 1);
    assert.ok(!result.proof.completeAttendanceCoverage.some(range => range.clinicianId === 1 && range.start === '2026-09-24'));
    assert.ok(result.proof.completeAttendanceCoverage.some(range => range.clinicianId === 2 && range.start === '2026-09-24'));
    assert.equal(result.proof.attendanceThrough, '2026-09-23');
    assert.equal(result.summary.observedCompleted, 42);
    assert.equal(result.summary.observedCoverageDays, 7);
    assert.equal(result.metrics.derivedShowVisits, 6 * 42 - 14);
    const affected = completePeriodSessionSummary(result.overlay.context.sessions, [1], { start: '2026-09-24', end: '2026-10-07' }, result.proof.completeAttendanceCoverage, asOf);
    assert.equal(affected.observedCompleted, null);
    assert.equal(affected.observedCoverageDays, 0);
  }
});
