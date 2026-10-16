import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWorkspace, prepareBillingChargeResolution, bindBillingResolutions } from '../lib/practice/src/hub/index.ts';
import { importBillingCsv, importLocalPackage } from '../artifacts/comp-dashboard/src/lib/retention-local.ts';
import { summarizeReportedBilling } from '../artifacts/comp-dashboard/src/lib/reported-billing.ts';
import { practiceFinancialRange } from '../artifacts/comp-dashboard/src/lib/practice-financial-range.ts';
import { currentPracticeClinicians } from '../artifacts/comp-dashboard/src/lib/practice-scope.ts';
import { completeReportCoverage } from '../artifacts/comp-dashboard/src/lib/complete-report-coverage.ts';
import { historicalBillingLedger } from '../artifacts/comp-dashboard/src/lib/historical-billing-ledger.ts';

// Preserve the original operating-scope boundary while testing the separate historical ledger.
const current = 'Synthetic Current';
const former = 'Synthetic Former';
const bill = rows => importBillingCsv('Client,Clinician,Date of service,Total fee,Billing code\n' + rows.join('\n')).snapshot;
function fixture() {
  const workspace = emptyWorkspace('2026-10-01');
  workspace.settings.defaultInPersonPct = 0;
  const context = { clinicians: [{ id: 1, goalId: null, label: current, classification: 'owner', sessionRate: 100,
    sessionsPerWeek: 7, weeksWorkedPerYear: 52, capEnabled: false, capAmount: 0, preCapClinicianSplit: 0,
    preCapPracticeSplit: 100, postCapClinicianSplit: 0, postCapPracticeSplit: 100, w2EmployerFicaPct: 0,
    futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
  return { workspace, context };
}

test('current-team operating scope stays separate while confirmed cardless historical charges are included', () => {
  const { workspace, context } = fixture();
  const snapshot = bill([`Synthetic A,${current},2025-07-16,100,90837`, `Synthetic B,${former},2025-07-16,175,90837`]);
  snapshot.reportCoverage = { start: '2025-07-01', end: '2026-10-12', complete: true };
  const before = structuredClone({ workspace, context, snapshot });
  const raw = summarizeReportedBilling([snapshot], '2026-10-16', { start: '2025-07-01', end: '2025-07-31' });
  const selected = practiceFinancialRange(workspace, context, [snapshot], '2026-10-16', { start: '2025-07-01', end: '2025-07-31' });
  assert.equal(raw.months[0].charges, 275);
  assert.equal(selected.actual.reportedCharges, 100, 'former-provider charges remain outside the current-team operating scope');
  const declarations = { version: 1, mappings: [{ sourceLabel: current, clinicianLabel: current, clinicianId: 1, teamId: null }], sourceSets: [],
    historicalBillingProviders: [{ id: '00000000-0000-4000-8000-000000000001', sourceLabel: former,
      sourceSets: [{ snapshotIds: [snapshot.id], start: '2025-07-01', end: '2026-10-12', complete: true }] }] };
  const history = historicalBillingLedger([snapshot], context.clinicians, null, declarations, '2026-10-16', { start: '2025-07-01', end: '2025-07-31' });
  assert.equal(history.reportedCharges, 275); assert.equal(history.coverageComplete, true);
  assert.deepEqual(currentPracticeClinicians(workspace, context, '2026-10-16').map(c => c.label), [current]);
  assert.equal(context.clinicians.length, 1, 'do not create a clinician card to hide the unsupported billing-only identity');
  assert.deepEqual({ workspace, context, snapshot }, before);
});

test('unknown deleted JSON fields and provider-name suffixes require review, not guessing', () => {
  const pkg = JSON.parse(readFileSync(new URL('../docs/practice-local-import-package-v1.golden.json', import.meta.url), 'utf8'));
  pkg.collections.billing.rows[0].deleted = true;
  assert.throws(() => importLocalPackage(pkg), /Unverified deletion marker/);
  assert.throws(() => bill([`Synthetic A,${current} (deleted),2026-10-10,100,90837`]), /Unverified deletion marker/);
});

test('legacy CSV no longer silently discards an unknown deleted column', () => {
  assert.throws(() => importBillingCsv(`Client,Clinician,Date of service,Total fee,Billing code,Deleted\nSynthetic A,${current},2026-10-10,100,90837,true`), /Unverified deletion marker/);
});

test('October10-12 overlay counts October10 once and adds11-12 despite shifted source row hashes', () => {
  const old = bill([`Synthetic A,${current},2026-10-10,100,90837`]);
  const incoming = bill([`Synthetic B,${current},2026-10-11,200,90837`, `Synthetic A,${current},2026-10-10,100,90837`, `Synthetic C,${current},2026-10-12,300,90837`]);
  assert.notEqual(old.rows[0].sourceRowHash, incoming.rows[1].sourceRowHash);
  const before = structuredClone([old, incoming]);
  const result = summarizeReportedBilling([old, incoming], '2026-10-16', { start: '2026-10-10', end: '2026-10-12' });
  assert.equal(result.months[0].charges, 600);
  assert.equal(result.evidence.uniqueRowCount, 3);
  assert.equal(result.evidence.duplicateRowCount, 1);
  assert.deepEqual([old, incoming], before);
});

test('a changed October10 fee stays unresolved, never silently selects a newer export', () => {
  const old = bill([`Synthetic A,${current},2026-10-10,100,90837`]);
  const incoming = bill([`Synthetic A,${current},2026-10-10,125,90837`, `Synthetic B,${current},2026-10-11,200,90837`, `Synthetic C,${current},2026-10-12,300,90837`]);
  const result = summarizeReportedBilling([old, incoming], '2026-10-16');
  assert.equal(result.months[0].charges, null);
  assert.equal(result.evidence.conflictingHashCount, 1);
});

test('four source-pinned two-charge approvals survive an unrelated overlapping October export', () => {
  const dates = ['2025-11-19', '2026-01-21', '2026-07-23', '2026-08-10'];
  const old = bill([...dates.flatMap((date, n) => [`Synthetic approved ${n},${current},${date},${n === 0 ? 100 : 150},90837`, `Synthetic approved ${n},${current},${date},150,90837`]),
    `Synthetic A,${current},2026-10-10,100,90837`]);
  const { context } = fixture();
  const declarations = { version: 1, mappings: [{ sourceLabel: current, clinicianLabel: current, clinicianId: 1, teamId: null }], sourceSets: [] };
  const approvals = dates.map((date, n) => {
    const draft = prepareBillingChargeResolution(old.rows.filter(r => r.serviceDate === date).map(row => ({ row, snapshotId: old.id })));
    assert.ok(draft);
    return { ...draft, id: `00000000-0000-4000-8000-00000000000${n + 1}`, approvalToken: String(n + 1).repeat(64),
      clinicianId: 1, confirmedAt: '2026-10-16T00:00:00Z', approvalNote: 'Synthetic approval only' };
  });
  const incoming = bill([`Synthetic B,${current},2026-10-11,200,90837`, `Synthetic A,${current},2026-10-10,100,90837`, `Synthetic C,${current},2026-10-12,300,90837`]);
  const before = structuredClone({ old, incoming, approvals, declarations });
  const result = summarizeReportedBilling([old, incoming], '2026-10-16', { billingResolutions: bindBillingResolutions(approvals, context.clinicians, declarations) });
  assert.equal(result.months.reduce((sum, month) => sum + month.charges, 0), 1750);
  assert.equal(result.evidence.resolvedCaseCount, 4);
  assert.equal(result.evidence.staleResolutionCount, 0);
  assert.equal(result.evidence.duplicateRowCount, 1);
  const historicalSource = bill([`Synthetic retired,${former},2026-10-12,0,90837`]);
  const history = historicalBillingLedger([old, incoming, historicalSource], context.clinicians, null, {
    ...declarations, billingResolutions: approvals,
    historicalBillingProviders: [{ id: '00000000-0000-4000-8000-000000000099', sourceLabel: former,
      sourceSets: [{ snapshotIds: [historicalSource.id], start: '2026-10-10', end: '2026-10-12', complete: true }] }],
  }, '2026-10-16', { start: '2025-11-01', end: '2026-10-12' });
  assert.equal(history.reportedCharges, 1750); assert.equal(history.evidence.resolvedCaseCount, 4); assert.equal(history.evidence.staleResolutionCount, 0);
  assert.deepEqual({ old, incoming, approvals, declarations }, before);
});

test('a separate October10-12 report does not complete the October8-21 service period', () => {
  const { workspace, context } = fixture();
  const old = bill([`Synthetic A,${current},2026-10-10,100,90837`]);
  old.reportCoverage = { start: '2025-07-01', end: '2026-10-10', complete: true };
  const incoming = bill([`Synthetic A,${current},2026-10-10,100,90837`, `Synthetic B,${current},2026-10-11,200,90837`, `Synthetic C,${current},2026-10-12,300,90837`]);
  incoming.reportCoverage = { start: '2026-10-10', end: '2026-10-12', complete: true };
  const proof = completeReportCoverage([old, incoming], context.clinicians, '2026-10-16', context.clinicians, { teamId: workspace.settings.teamId });
  assert.equal(proof.billingThrough, '2026-10-07');
  assert.ok(!proof.eligibleBillingRows.some(r => r.serviceDate >= '2026-10-10'));
  assert.equal(old.reportCoverage.end, '2026-10-10');
});

test('frozen source-set proof cannot admit a new source even inside a proved provider period', () => {
  const { context } = fixture();
  const old = bill([`Synthetic original,${current},2026-10-05,100,90837`]);
  const incoming = bill([`Synthetic additional,${current},2026-10-06,200,90837`]);
  const declarations = { version: 1, mappings: [{ sourceLabel: current, clinicianLabel: current, clinicianId: 1, teamId: null }],
    sourceSets: [{ kind: 'billing', snapshotIds: [old.id], clinicianIds: [1], start: '2025-07-01', end: '2026-10-10', complete: true }] };
  const before = structuredClone({ old, incoming, declarations });
  const proof = completeReportCoverage([old, incoming], context.clinicians, '2026-10-16', context.clinicians, { teamId: null, declarations });
  assert.equal(proof.billingThrough, '2026-10-07');
  assert.equal(proof.eligibleBillingRows.length, 1);
  assert.equal(proof.eligibleBillingRows[0].clientId, 'Synthetic original');
  assert.deepEqual({ old, incoming, declarations }, before);
});
