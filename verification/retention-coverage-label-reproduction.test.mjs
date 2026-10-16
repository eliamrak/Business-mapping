import test from 'node:test';
import assert from 'node:assert/strict';
import { completeReportCoverage } from '../artifacts/comp-dashboard/src/lib/complete-report-coverage.ts';
import { buildLocalRetentionMetrics, estimateLocalClientActivity } from '../artifacts/comp-dashboard/src/lib/retention-local.ts';
import { summarizeReportedBilling, billingMonthSelectionLabel } from '../artifacts/comp-dashboard/src/lib/reported-billing.ts';

// Characterizes the current discrepancy, not a repaired behavior or real-data finding.
test('unadmitted later tail can mark every clinician unverified while practice coverage stays verified', () => {
  const clinicians = Array.from({ length: 6 }, (_, n) => ({ id: n + 8, goalId: 1, label: `Synthetic Clinician ${n}` }));
  const globalRoster = [...clinicians, ...clinicians.map(c => ({ ...c, id: c.id + 100, goalId: 2 }))];
  const snapshots = [{ id: 'attendance-aaaaaaaa', kind: 'attendance', sourceHash: 'aaaaaaaa',
    coverageStart: '2026-01-01', coverageEnd: '2026-10-12', importedAt: '2026-10-16T00:00:00Z',
    rows: clinicians.flatMap(c => ['2026-01-16', '2026-01-23', '2026-01-30', '2026-10-09'].map(date => ({
      clientId: `synthetic-client-${c.id}`, clinician: c.label, serviceDate: date, status: 'show', location: null,
      billingCode: '90837', sourceRowHash: `synthetic-${c.id}-${date}`,
    }))),
  }];
  const declarations = { version: 1, mappings: clinicians.map(c => ({ sourceLabel: c.label, clinicianLabel: c.label, clinicianId: c.id, teamId: 1 })),
    sourceSets: [{ kind: 'attendance', snapshotIds: ['attendance-aaaaaaaa'], clinicianIds: clinicians.map(c => c.id),
      start: '2026-01-01', end: '2026-10-12', complete: true }] };
  const before = structuredClone({ snapshots, declarations });
  const proof = completeReportCoverage(snapshots, clinicians, '2026-10-16', globalRoster, { declarations, teamId: 1 });
  assert.equal(proof.attendanceThrough, '2026-10-07');
  assert.equal(proof.eligibleAttendanceRows.length, 18);
  assert.equal(proof.completeAttendanceCoverage.filter(r => r.start === '2026-01-15' && r.end === '2026-01-28').length, 6);
  const excludedFollowUpEvidence = snapshots[0].rows.filter(r => !proof.eligibleAttendanceRows.includes(r))
    .map(r => ({ clientId: r.clientId, serviceDate: r.serviceDate }));
  const args = [proof.eligibleSnapshots, {}, {}, 28, '2026-10-16', 90, '2026-01-15', '2026-01-28'];
  const withTail = buildLocalRetentionMetrics(...args, { excludedFollowUpEvidence });
  const withoutTail = buildLocalRetentionMetrics(...args);
  const practice = estimateLocalClientActivity(proof.eligibleSnapshots, {}, 56, 56, 28, '2026-10-16', 90,
    '2026-01-15', '2026-01-28', { excludedFollowUpEvidence });
  assert.equal(practice.coverageVerified, true);
  assert.equal(practice.retainedClientPairs, 6);
  assert.equal(withTail.clientActivityByClinician.length, 6);
  assert.ok(withTail.clientActivityByClinician.every(r => !r.coverageVerified && r.retainedClients === 1 && r.initialRetentionDenominator === 1));
  assert.ok(withTail.clientActivityByClinician.every(r => r.initialRetentionCoverageVerified));
  assert.equal(practice.initialRetentionCoverageVerified, true);
  assert.ok(withoutTail.clientActivityByClinician.every(r => r.coverageVerified && r.retainedClients === 1));
  assert.deepEqual({ snapshots, declarations }, before);
});

test('Money month-end summary as-of marks a full January partial without changing charged amounts', () => {
  const snapshots = [{ id: 'billing-synthetic', kind: 'billing', sourceHash: 'synthetic',
    coverageStart: '2026-01-01', coverageEnd: '2026-02-11', importedAt: '2026-10-16T00:00:00Z',
    reportCoverage: { start: '2026-01-01', end: '2026-02-11', complete: true }, rows: [{
      clientId: 'synthetic-client', clinician: 'Synthetic Clinician', serviceDate: '2026-01-31',
      sourceRowHash: 'synthetic-hash', billingCode: '90837', totalFeeCharged: 100,
    }],
  }];
  const range = { start: '2026-01-01', end: '2026-01-31' };
  // practiceFinancialRange passes actualEnd, not the current observation date.
  const atSelectedEnd = summarizeReportedBilling(snapshots, range.end, range);
  const atObservationDate = summarizeReportedBilling(snapshots, '2026-10-16', range);
  assert.equal(atSelectedEnd.months[0].fullyElapsed, false);
  assert.equal(atObservationDate.months[0].fullyElapsed, true);
  assert.equal(atSelectedEnd.months[0].charges, 100);
  assert.equal(atSelectedEnd.months[0].charges, atObservationDate.months[0].charges);
  assert.equal(billingMonthSelectionLabel('2026-01', range), null);
  assert.equal(billingMonthSelectionLabel('2026-01', { start: '2026-01-15', end: '2026-01-28' }), 'partial selection');
  assert.equal(billingMonthSelectionLabel('2026-01', null), 'selection unverified');
});
