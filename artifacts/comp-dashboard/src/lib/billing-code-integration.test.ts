import test from "node:test";
import assert from "node:assert/strict";
import {
  bindBillingResolutions, billingCodeResolutionSchema, emptyWorkspace, forecast, monthFlow,
  prepareBillingCodeResolution, reconcileBillingEvidence, type Context, type ImportEvidenceDeclarations,
} from "@workspace/practice/hub";
import { summarizeImportedBillingActuals } from "../../../../lib/practice/src/hub/engine.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { billingRowsInSnapshots, summarizeReportedBilling } from "./reported-billing.ts";
import type { BillingRow, LocalSnapshot } from "./retention-local.ts";

type BillingSnapshot = Extract<LocalSnapshot, { kind: "billing" }>;
const date = "2026-10-12";
const label = "Synthetic Integration Clinician";
const ids = { attendance: "attendance-00000081", a: "billing-00000081", b: "billing-00000082", c: "billing-00000083" };
const billingRow = (patch: Partial<BillingRow> = {}): BillingRow => ({
  clientId: "synthetic-integration-client", clinician: label, serviceDate: date,
  billingCode: "90837", totalFeeCharged: 125, sourceRowHash: "synthetic-integration-hash-a", ...patch,
});
function billing(id: string, row: BillingRow): BillingSnapshot {
  return { id, kind: "billing", sourceHash: `synthetic-source-${id}`, importedAt: "2026-10-22T08:00:00Z",
    coverageStart: date, coverageEnd: date, rows: [row] };
}
function freeze(value: unknown) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
function fixture(selectedIndex = 0, repeated = false) {
  const context: Context = { clinicians: [{ id: 81, label, goalId: 8, classification: "1099",
    sessionRate: 175, sessionsPerWeek: 7, weeksWorkedPerYear: 48, capEnabled: false, capAmount: 0,
    preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 60, postCapPracticeSplit: 40,
    w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
  const bills = [billing(ids.a, billingRow()), billing(ids.b, billingRow({
    billingCode: "90834", sourceRowHash: "synthetic-integration-hash-b",
  }))];
  if (repeated) bills.push(billing(ids.c, { ...bills[1].rows[0] }));
  const attendance: LocalSnapshot = { id: ids.attendance, kind: "attendance", sourceHash: "synthetic-attendance-source",
    importedAt: "2026-10-22T08:00:00Z", coverageStart: date, coverageEnd: date,
    reportCoverage: { start: date, end: date, complete: true }, rows: [{
      clientId: "synthetic-integration-client", clinician: label, serviceDate: date, status: "show",
      location: null, billingCode: "90837", sourceRowHash: "synthetic-integration-attended-once",
    }] };
  const draft = prepareBillingCodeResolution(bills.map(s => ({ snapshotId: s.id, row: s.rows[0] })));
  assert.ok(draft);
  const selected = bills[selectedIndex];
  const resolution = billingCodeResolutionSchema.parse({ ...draft, kind: "billing-code",
    id: "00000000-0000-4000-8000-000000000081", approvalToken: "b".repeat(64), clinicianId: 81,
    selected: { snapshotId: selected.id, sourceRowHash: selected.rows[0].sourceRowHash },
    confirmedAt: "2026-10-22T09:00:00Z", approvalNote: "Synthetic owner choice for integration regression" });
  const declarations: ImportEvidenceDeclarations = { version: 1, mappings: [{
    sourceLabel: label, clinicianLabel: label, clinicianId: 81, teamId: 8,
  }], sourceSets: [], billingResolutions: [resolution] };
  const raw: LocalSnapshot[] = [attendance, ...bills];
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { teamId: 8, horizonMonths: 1, defaultInPersonPct: 0, collectionPct: 100 });
  return { context, raw, bills, declarations, resolution, workspace };
}

// Coverage views clone rows and may use a derived snapshot ID while retaining the original source ID.
function admittedView(raw: LocalSnapshot[], billingIds = [ids.a, ids.b, ids.c]) {
  return structuredClone(raw.filter(s => s.kind === "attendance" || billingIds.includes(s.id))).map(s =>
    s.kind === "billing" ? { ...s, id: `synthetic-admitted-${s.id}`, sourceSnapshotId: s.id } : s);
}
function run(f: ReturnType<typeof fixture>, admitted = admittedView(f.raw)) {
  const overlay = buildImportedSessionOverlay(f.context, admitted, 8, {}, {
    declarations: f.declarations, billingEvidenceSnapshots: f.raw,
  });
  const summary = summarizeImportedBillingActuals(overlay.context, new Set([81]));
  const flow = monthFlow(f.workspace, overlay.context, "2026-10-01", date);
  const earned = forecast(f.workspace, overlay.context, [], 1, false, {
    workingForecast: true, workingRange: { start: date, end: date },
    baselineWeeklyByClinician: { 81: 7 }, useImportedBillingActuals: true,
  })[0];
  const eligibleRows = billingRowsInSnapshots(f.raw, admitted);
  const data = summarizeReportedBilling(f.raw, "2026-10-22", { start: date, end: date,
    eligibleRows, billingResolutions: bindBillingResolutions(f.declarations.billingResolutions ?? [], f.context.clinicians, f.declarations) });
  return { overlay, summary, flow, earned, data, eligibleRows };
}
function assertOneAttendance(result: ReturnType<typeof run>) {
  assert.equal(result.overlay.derivedSessions.reduce((sum, r) => sum + r.completed, 0), 1);
  assert.equal(result.overlay.diagnostic.rawAttendedRows, 1);
  assert.equal(result.flow.sessions, 1);
}
function assertUnknown(result: ReturnType<typeof run>) {
  assertOneAttendance(result);
  assert.ok(result.overlay.importedBillingActuals.length > 0);
  assert.ok(result.overlay.importedBillingActuals.every(r => r.evidenceUnknown === true));
  assert.equal(result.overlay.diagnostic.billedFees, null);
  assert.equal(result.summary.billed.get(81), undefined);
  assert.ok(result.summary.unknownDates.some(r => r.clinicianId === 81 && r.date === date));
  assert.equal(result.flow.revenue, null);
  assert.equal(result.earned.values.revenue, null);
  assert.equal(result.earned.values.clinicianPay, null);
  assert.equal(result.data.currentMonth.chargesToDate, null);
  assert.equal(result.data.months[0].charges, null);
}

for (const repeated of [false, true]) for (const selectedIndex of repeated ? [0, 1, 2] : [0, 1]) {
  test(`overlay to engine and Data: choice ${selectedIndex}, ${repeated ? "three sources with shared B/C hash" : "two sources"}, one fee and one visit`, () => {
    const f = fixture(selectedIndex, repeated), admitted = admittedView(f.raw);
    const before = structuredClone({ f, admitted });
    freeze(f); freeze(admitted);
    const result = run(f, admitted);
    assertOneAttendance(result);
    assert.equal(result.overlay.importedBillingActuals.length, 1);
    assert.equal(result.overlay.importedBillingActuals[0].sourceSnapshotId, f.resolution.selected.snapshotId);
    assert.equal(result.overlay.importedBillingActuals[0].billingCode, f.bills[selectedIndex].rows[0].billingCode);
    assert.equal(result.overlay.importedBillingActuals[0].totalFeeCharged, 125);
    assert.equal(result.overlay.importedBillingActuals[0].replacementSessionCount, 1);
    assert.equal(result.overlay.importedBillingActuals[0].evidenceUnknown, undefined);
    assert.equal(result.overlay.context.billingChargeResolutions?.length ?? 0, 0,
      "validated code approval must not be applied again to a collapsed actual");
    assert.equal(result.overlay.diagnostic.billedFees, 125);
    assert.equal(result.summary.billed.get(81)?.get(date), 125);
    assert.deepEqual(result.summary.unknownDates, []);
    assert.equal(result.flow.revenue, 125);
    assert.deepEqual(result.flow.unavailableReasons, []);
    assert.equal(result.earned.values.revenue, 125);
    assert.equal(result.earned.values.clinicianPay, 75);
    assert.equal(result.data.currentMonth.chargesToDate, 125);
    assert.equal(result.data.evidence.resolvedCodeCaseCount, 1);
    assert.equal(result.data.evidence.staleResolutionCount, 0);
    assert.equal(result.data.evidence.rawRowCount, repeated ? 3 : 2);
    assert.equal(result.data.evidence.uniqueRowCount, 1);
    assert.equal(result.eligibleRows.size, repeated ? 3 : 2);
    for (const bill of f.bills) assert.ok(result.eligibleRows.has(bill.rows[0]));
    assert.deepEqual({ f, admitted }, before);
  });
}

for (const selectedIndex of [0, 1]) for (const repeatedPayload of [false, true]) {
  test(`unadmitted C invalidates choice ${selectedIndex} even with ${repeatedPayload ? "identical B payload/hash" : "a third code"}`, () => {
    const f = fixture(selectedIndex);
    const admitted = admittedView(f.raw);
    f.raw.push(billing(ids.c, repeatedPayload ? { ...f.bills[1].rows[0] }
      : billingRow({ billingCode: "90832", sourceRowHash: "synthetic-unadmitted-c" })));
    const before = structuredClone({ f, admitted });
    freeze(f); freeze(admitted);
    const result = run(f, admitted);
    assertUnknown(result);
    assert.equal(result.eligibleRows.size, 2);
    assert.equal(result.overlay.importedBillingActuals.length, 2);
    assert.ok(result.overlay.importedBillingActuals.every(r => r.sourceSnapshotId !== ids.c));
    assert.equal(result.data.evidence.rawRowCount, 2);
    assert.equal(result.data.evidence.staleResolutionCount, 1);
    assert.deepEqual({ f, admitted }, before);
  });
}

for (const selectedIndex of [0, 1]) {
  test(`missing selected source ${selectedIndex} stays unknown, with its other source still eligible`, () => {
    const f = fixture(selectedIndex);
    f.raw = f.raw.filter(s => s.id !== f.resolution.selected.snapshotId);
    const admitted = admittedView(f.raw), before = structuredClone({ f, admitted });
    freeze(f); freeze(admitted);
    const result = run(f, admitted);
    assertUnknown(result);
    assert.equal(result.overlay.importedBillingActuals.length, 1);
    assert.equal(result.data.evidence.staleResolutionCount, 1);
    assert.deepEqual({ f, admitted }, before);
  });

  test(`retained but unadmitted selected source ${selectedIndex} cannot switch to its admitted alternate`, () => {
    const f = fixture(selectedIndex);
    const otherId = selectedIndex ? ids.a : ids.b;
    const admitted = admittedView(f.raw, [otherId]), before = structuredClone({ f, admitted });
    freeze(f); freeze(admitted);
    const result = run(f, admitted);
    assertUnknown(result);
    assert.equal(result.eligibleRows.size, 1);
    assert.equal(result.overlay.importedBillingActuals[0].sourceSnapshotId, otherId);
    assert.ok(result.data.evidence.warnings.some(w => /outside admitted source coverage/.test(w)));
    assert.deepEqual({ f, admitted }, before);
  });
}

test("unrelated unadmitted billing does not stale a valid encounter or enter its financial total", () => {
  const f = fixture(1), admitted = admittedView(f.raw);
  f.raw.push(billing(ids.c, billingRow({ clientId: "synthetic-other-client", sourceRowHash: "synthetic-other-hash", totalFeeCharged: 999 })));
  const before = structuredClone({ f, admitted });
  const result = run(f, admitted);
  assertOneAttendance(result);
  assert.equal(result.overlay.importedBillingActuals.length, 1);
  assert.equal(result.summary.billed.get(81)?.get(date), 125);
  assert.deepEqual(result.summary.unknownDates, []);
  assert.equal(result.flow.revenue, 125);
  assert.equal(result.data.currentMonth.chargesToDate, 125);
  assert.equal(result.data.evidence.rawRowCount, 2);
  assert.deepEqual({ f, admitted }, before);
});

function proveComplete(f: ReturnType<typeof fixture>, excludedIds: string[] = []) {
  for (const snapshot of f.raw) {
    if (excludedIds.includes(snapshot.id)) {
      delete snapshot.reportCoverage;
      continue;
    }
    snapshot.reportCoverage = { start: "2026-10-08", end: "2026-10-21", complete: true };
  }
}
function coveredView(f: ReturnType<typeof fixture>) {
  return completeReportCoverage(f.raw, f.context.clinicians, "2026-10-22", f.context.clinicians,
    { teamId: 8, declarations: f.declarations });
}
function assertOrdinary125(result: ReturnType<typeof run>, sourceId: string) {
  assertOneAttendance(result);
  assert.equal(result.overlay.importedBillingActuals.length, 1);
  assert.equal(result.overlay.importedBillingActuals[0].sourceSnapshotId, sourceId);
  assert.equal(result.overlay.importedBillingActuals[0].totalFeeCharged, 125);
  assert.equal(result.overlay.importedBillingActuals[0].evidenceUnknown, undefined);
  assert.equal(result.overlay.diagnostic.billedFees, 125);
  assert.equal(result.summary.billed.get(81)?.get(date), 125);
  assert.deepEqual(result.summary.unknownDates, []);
  assert.equal(result.flow.revenue, 125);
  assert.deepEqual(result.flow.unavailableReasons, []);
  assert.equal(result.earned.values.revenue, 125);
  assert.equal(result.earned.values.clinicianPay, 75);
  assert.equal(result.data.currentMonth.chargesToDate, 125);
  assert.equal(result.data.evidence.uniqueRowCount, 1);
  assert.equal(result.data.evidence.resolvedCodeCaseCount, 0);
  assert.equal(result.data.evidence.staleResolutionCount, 0);
}

for (const approvalsField of ["absent", "empty"] as const) {
  test(`real coverage clones preserve original billing identity with ${approvalsField} approvals`, () => {
    const f = fixture();
    f.raw = f.raw.filter(s => s.id !== ids.b);
    if (approvalsField === "absent") delete f.declarations.billingResolutions;
    else f.declarations.billingResolutions = [];
    proveComplete(f);
    const before = structuredClone(f);
    freeze(f);
    const coverage = coveredView(f);
    assert.equal(coverage.dataThrough, "2026-10-21");
    assert.equal(coverage.eligibleBillingRows.length, 1);
    const original = f.raw.find(s => s.kind === "billing") as BillingSnapshot;
    assert.strictEqual(coverage.eligibleBillingRows[0], original.rows[0]);
    const clone = coverage.eligibleSnapshots.find(s => s.kind === "billing") as BillingSnapshot;
    assert.notEqual(clone.id, original.id);
    assert.equal(clone.sourceSnapshotId, original.id);
    assert.notStrictEqual(clone.rows[0], original.rows[0]);
    assert.deepEqual(clone.rows[0], original.rows[0]);
    const recovered = billingRowsInSnapshots(f.raw, coverage.eligibleSnapshots);
    assert.equal(recovered.size, 1);
    assert.ok(recovered.has(original.rows[0]));
    const result = run(f, coverage.eligibleSnapshots);
    assertOrdinary125(result, original.id);
    assert.equal(result.data.evidence.rawRowCount, 1);
    assert.deepEqual(f, before);
  });
}

test("undoing the final stale code approval recovers ordinary billing through real coverage without changing raw rows", () => {
  const f = fixture();
  f.raw = f.raw.filter(s => s.id !== ids.b);
  proveComplete(f);
  const beforeRaw = structuredClone(f.raw), beforeContext = structuredClone(f.context);
  const beforeApproval = structuredClone(f.resolution);
  const beforeUndo = run(f, coveredView(f).eligibleSnapshots);
  assertUnknown(beforeUndo);
  assert.equal(beforeUndo.data.evidence.staleResolutionCount, 1);
  f.declarations.billingResolutions = [];
  const afterUndo = coveredView(f);
  const billingClone = afterUndo.eligibleSnapshots.find(s => s.kind === "billing")!;
  assert.equal(billingClone.sourceSnapshotId, ids.a);
  const recovered = billingRowsInSnapshots(f.raw, afterUndo.eligibleSnapshots);
  assert.equal(recovered.size, 1);
  assert.ok(recovered.has(f.bills[0].rows[0]));
  assertOrdinary125(run(f, afterUndo.eligibleSnapshots), ids.a);
  assert.deepEqual(f.raw, beforeRaw);
  assert.deepEqual(f.context, beforeContext);
  assert.deepEqual(f.resolution, beforeApproval);
});

for (const reverse of [false, true]) {
  test(`excluded identical copy sorting first cannot hide an admitted ordinary charge, ${reverse ? "reversed" : "original"} source order`, () => {
    const f = fixture();
    delete f.declarations.billingResolutions;
    const excluded = billing("a-excluded", billingRow({ sourceRowHash: "a-excluded" }));
    const admitted = billing("z-admitted", billingRow({ sourceRowHash: "z-admitted" }));
    const sources = reverse ? [admitted, excluded] : [excluded, admitted];
    f.raw = [f.raw[0], ...sources];
    proveComplete(f, [excluded.id]);
    const before = structuredClone(f);
    freeze(f);
    const groups = reconcileBillingEvidence(sources.flatMap(s => s.rows.map(row => ({ row, snapshotId: s.id }))));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].known, true);
    assert.strictEqual(groups[0].row, excluded.rows[0], "the excluded row really is the reconciler's first representative");
    const coverage = coveredView(f);
    assert.equal(coverage.eligibleBillingRows.length, 1);
    assert.strictEqual(coverage.eligibleBillingRows[0], admitted.rows[0]);
    assert.ok(coverage.eligibleSnapshots.every(s => s.sourceSnapshotId !== excluded.id));
    const result = run(f, coverage.eligibleSnapshots);
    assertOrdinary125(result, admitted.id);
    assert.equal(result.eligibleRows.size, 1);
    assert.ok(result.eligibleRows.has(admitted.rows[0]));
    assert.equal(result.data.evidence.rawRowCount, 1);
    assert.deepEqual(f, before);
  });
}

test("real coverage still cannot replace an unadmitted pinned selected anchor with an eligible equivalent", () => {
  const f = fixture(0, true);
  proveComplete(f, [ids.a]);
  const before = structuredClone(f);
  freeze(f);
  const coverage = coveredView(f);
  assert.equal(coverage.eligibleBillingRows.length, 2);
  const result = run(f, coverage.eligibleSnapshots);
  assertUnknown(result);
  assert.ok(result.overlay.importedBillingActuals.every(r => r.sourceSnapshotId !== ids.a));
  assert.ok(result.data.evidence.warnings.some(w => /outside admitted source coverage/.test(w)));
  assert.deepEqual(f, before);
});
