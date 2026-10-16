import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, importDeclarationsSchema, resolveHistoricalBillingProvider, restoreHistoricalBillingProviders,
  prepareBillingChargeResolution, type ImportEvidenceDeclarations, type Context } from "@workspace/practice/hub";
import { historicalBillingLedger, historicalBillingOverallStart } from "./historical-billing-ledger.ts";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { currentPracticeClinicians } from "./practice-scope.ts";
import { importBillingCsv, importAttendanceCsv, importLocalPackage, type LocalSnapshot, type BillingRow } from "./retention-local.ts";

const uuid = "00000000-0000-4000-8000-000000000001";
function fixture() {
  const workspace = emptyWorkspace("2026-10-01");
  const person = { id: 1, goalId: null, label: "Current", classification: "owner", sessionRate: 100, sessionsPerWeek: 7,
    weeksWorkedPerYear: 52, capEnabled: false, capAmount: 0, preCapClinicianSplit: 0, preCapPracticeSplit: 100,
    postCapClinicianSplit: 0, postCapPracticeSplit: 100, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 } as const;
  const context: Context = { clinicians: [person], staff: [], sessions: [] };
  const rows: BillingRow[] = [
    { clientId: "synthetic-current", clinician: "Current", serviceDate: "2025-07-16", totalFeeCharged: 100, billingCode: "90837", sourceRowHash: "current-row" },
    { clientId: "synthetic-former-first", clinician: "Former", serviceDate: "2025-07-01", totalFeeCharged: 25, billingCode: "90837", sourceRowHash: "former-first" },
    { clientId: "synthetic-former", clinician: "Former", serviceDate: "2025-07-16", totalFeeCharged: 175, billingCode: "90837", sourceRowHash: "former-row" },
  ];
  const snapshots: LocalSnapshot[] = [{ id: "billing-aaaaaaaa", kind: "billing", sourceHash: "aaaaaaaa", importedAt: "2026-10-16T00:00:00Z",
    coverageStart: "2025-07-01", coverageEnd: "2025-07-16", rows }];
  const declarations: ImportEvidenceDeclarations = { version: 1,
    mappings: [{ sourceLabel: "Current", clinicianId: 1, clinicianLabel: "Current", teamId: null }],
    sourceSets: [{ kind: "billing", snapshotIds: [snapshots[0].id], clinicianIds: [1], start: "2025-07-01", end: "2026-10-10", complete: true }],
    historicalBillingProviders: [{ id: uuid, sourceLabel: "Former", sourceSets: [{ snapshotIds: [snapshots[0].id], start: "2025-07-01", end: "2026-10-10", complete: true }] }],
  };
  return { workspace, context, snapshots, declarations };
}
const range = { start: "2025-07-01", end: "2025-07-31" };
const ledger = (f: ReturnType<typeof fixture>, window = range) => historicalBillingLedger(f.snapshots, f.context.clinicians, null, f.declarations, "2026-10-16", window);

test("confirmed cardless historical identity includes July1 fees without cards or current-team imported facts", () => {
  const f = fixture(); const before = structuredClone(f);
  importDeclarationsSchema.parse(f.declarations);
  const result = ledger(f);
  assert.equal(result.reportedCharges, 300); assert.equal(result.months[0].charges, 300); assert.equal(result.coverageComplete, true);
  assert.equal(result.historicalProviderCount, 1); assert.equal(result.unknownProviderRows, 0);
  const admitted = completeReportCoverage(f.snapshots, f.context.clinicians, "2026-10-16", f.context.clinicians, { declarations: f.declarations, teamId: null });
  assert.ok(admitted.eligibleBillingRows.every(row => row.clinician === "Current"));
  assert.equal(admitted.eligibleBillingRows.length, 1);
  const overlay = buildImportedSessionOverlay(f.context, admitted.eligibleSnapshots, null, {}, { declarations: f.declarations });
  assert.equal(overlay.context.clinicians.length, 1); assert.ok(overlay.importedBillingActuals.every(row => row.clinicianId === 1));
  assert.deepEqual(currentPracticeClinicians(f.workspace, f.context, "2026-10-16").map(person => person.label), ["Current"]);
  assert.deepEqual(f, before);
});
test("historical-only source needs no clinician record and retains quiet proved month zero", () => {
  const f = fixture(); f.context.clinicians = []; f.declarations.mappings = []; f.declarations.sourceSets = [];
  if (f.snapshots[0].kind === "billing") f.snapshots[0].rows = f.snapshots[0].rows.filter(row => row.clinician === "Former");
  assert.equal(ledger(f).reportedCharges, 200);
  const quiet = ledger(f, { start: "2025-08-01", end: "2025-08-31" });
  assert.equal(quiet.coverageComplete, true); assert.equal(quiet.reportedCharges, 0);
  assert.equal(f.context.clinicians.length, 0);
});
test("unconfirmed provider never silently disappears from a claimed practice total", () => {
  const f = fixture(); delete f.declarations.historicalBillingProviders;
  const result = ledger(f); assert.equal(result.reportedCharges, null); assert.equal(result.unknownProviderRows, 2);
  assert.equal(result.months[0].charges, null); assert.equal(result.coverageComplete, false);
});
test("Overall includes retained older billing dates before confirmed proof and withholds unknown providers", () => {
  const f = fixture();
  f.declarations.sourceSets[0].start = "2026-01-01";
  delete f.declarations.historicalBillingProviders;
  const start = historicalBillingOverallStart(f.snapshots, f.declarations, "2026-01-01");
  assert.equal(start, "2025-07-01");
  const result = ledger(f, { start, end: "2026-10-12" });
  assert.equal(result.reportedCharges, null);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.unknownProviderRows, 2);
});
test("stored full-history shape preserves three prefixed identities, late cancellations and frozen admission", () => {
  const f = fixture();
  const former = ["(deleted) Synthetic Former A", "(deleted) Synthetic Former B", "(deleted) Synthetic Former C"];
  const billingId = "billing-1111222233334444", attendanceId = "attendance-5555666677778888";
  const billing: BillingRow[] = Array.from({ length: 3681 }, (_, i) => ({
    clientId: `synthetic-billing-${i}`, clinician: i < 3 ? former[i] : "Current",
    serviceDate: i === 0 ? "2025-07-01" : i === 3680 ? "2026-10-12" : "2026-10-10",
    totalFeeCharged: 100, billingCode: "90837", sourceRowHash: `synthetic-b-${i}`,
  }));
  billing[4] = { ...billing[3], totalFeeCharged: 150, sourceRowHash: "synthetic-unresolved-fee" };
  const attendance: Extract<LocalSnapshot, { kind: "attendance" }> = {
    id: attendanceId, kind: "attendance", sourceHash: "5555666677778888", importedAt: "2026-10-16T20:00:55Z",
    coverageStart: "2025-07-01", coverageEnd: "2026-10-12",
    rows: Array.from({ length: 4823 }, (_, i) => ({ clientId: `synthetic-attendance-${i}`,
      clinician: i < 3 ? former[i] : "Current", serviceDate: i === 0 ? "2025-07-01" : "2026-10-12",
      location: null, status: i < 47 ? "cancelled" : "show", ...(i < 47 ? { cancellationSubtype: "late_cancelled" as const } : {}), sourceRowHash: `synthetic-a-${i}` })),
  };
  const previousSources = structuredClone(f.snapshots);
  f.snapshots.push(attendance, { id: billingId, kind: "billing", sourceHash: "1111222233334444",
    importedAt: "2026-10-16T20:00:55Z", coverageStart: "2025-07-01", coverageEnd: "2026-10-12", rows: billing });
  const before = structuredClone(f.snapshots);
  const window = { start: "2025-07-01", end: "2026-10-12" };
  assert.equal(ledger(f, window).reportedCharges, null);
  const frozen = completeReportCoverage(f.snapshots, f.context.clinicians, "2026-10-16", f.context.clinicians, { declarations: f.declarations, teamId: null });
  assert.ok(!frozen.eligibleSnapshots.some(source => source.id === billingId || source.id === attendanceId));
  // Synthetic explicit confirmation only; exact prefix remains part of each identity.
  f.declarations.historicalBillingProviders!.push(...former.map((sourceLabel, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 2).padStart(12, "0")}`, sourceLabel,
    sourceSets: [{ snapshotIds: [billingId], start: window.start, end: window.end, complete: true as const }],
  })));
  f.declarations.sourceSets.push({ kind: "billing", snapshotIds: [billingId], clinicianIds: [1], ...window, complete: true });
  const result = ledger(f, window);
  assert.equal(result.unknownProviderRows, 0);
  assert.equal(result.reportedCharges, null, "unresolved changed fee never becomes a complete amount after identity confirmation");
  assert.equal(result.evidence.conflictingHashCount, 1);
  assert.equal(f.context.clinicians.length, 1);
  assert.deepEqual(f.snapshots, before);
  assert.deepEqual(f.snapshots.slice(0, previousSources.length), previousSources);
  assert.equal(attendance.rows.filter(row => row.cancellationSubtype === "late_cancelled").length, 47);
  assert.equal(attendance.rows.length, 4823); assert.equal(billing.length, 3681);
});
test("a former label colliding with any current or planning clinician needs review, not automatic matching", () => {
  const f = fixture(); f.context.clinicians.push({ ...f.context.clinicians[0], id: 99, goalId: 7, label: " FORMER " });
  assert.equal(resolveHistoricalBillingProvider("Former", f.context.clinicians, f.declarations), null);
  assert.equal(ledger(f).reportedCharges, null);
  assert.equal(ledger(f).coverageComplete, false);
});
test("new overlapping source contributes reported facts once without inheriting frozen completeness", () => {
  const f = fixture(); const oldRows = (f.snapshots[0] as Extract<LocalSnapshot, { kind: "billing" }>).rows;
  oldRows.push({ ...oldRows[2], serviceDate: "2026-10-10", totalFeeCharged: 100, sourceRowHash: "oct10" });
  const incoming = importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\nsynthetic-new,Former,2026-10-11,200,90837\nsynthetic-former,Former,2026-10-10,100,90837\nsynthetic-new2,Former,2026-10-12,300,90837").snapshot;
  f.snapshots.push(incoming); const before = structuredClone(f);
  const result = ledger(f, { start: "2026-10-10", end: "2026-10-12" });
  assert.equal(result.reportedCharges, 600); assert.equal(result.evidence.duplicateRowCount, 1);
  assert.equal(result.coverageComplete, false); assert.equal(result.unconfirmedSourceRows, 3);
  assert.deepEqual(f, before);
});
test("changed fees in an overlapping source remain unknown even before new source proof", () => {
  const f = fixture(); f.snapshots.push(importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\nsynthetic-former,Former,2025-07-16,200,90837").snapshot);
  const result = ledger(f); assert.equal(result.reportedCharges, null); assert.equal(result.evidence.conflictingHashCount, 1);
});
test("missing, duplicate and changed-bound frozen historical source evidence cannot certify totals", () => {
  for (const alter of [(f: ReturnType<typeof fixture>) => { f.declarations.historicalBillingProviders![0].sourceSets[0].snapshotIds = ["billing-missing0"]; },
    (f: ReturnType<typeof fixture>) => { f.snapshots.push(structuredClone(f.snapshots[0])); },
    (f: ReturnType<typeof fixture>) => { f.declarations.historicalBillingProviders![0].sourceSets[0].start = "2025-07-02"; }]) {
    const f = fixture(); alter(f); const result = ledger(f);
    assert.equal(result.reportedCharges, null); assert.equal(result.coverageComplete, false);
  }
});
test("approved charge pair stays pinned and cannot become extra clinical visits", () => {
  const f = fixture(); const source = f.snapshots[0] as Extract<LocalSnapshot, { kind: "billing" }>;
  source.rows.push({ ...source.rows[0], totalFeeCharged: 150, sourceRowHash: "second-approved" });
  const draft = prepareBillingChargeResolution(source.rows.filter(row => row.clinician === "Current").map(row => ({ row, snapshotId: source.id })))!;
  f.declarations.billingResolutions = [{ ...draft, id: uuid, approvalToken: "a".repeat(64), clinicianId: 1, confirmedAt: "2026-10-16T00:00:00Z", approvalNote: "Synthetic only" }];
  const before = structuredClone(f); const result = ledger(f);
  assert.equal(result.reportedCharges, 450); assert.equal(result.evidence.resolvedCaseCount, 1);
  assert.deepEqual(f, before); assert.equal(f.context.sessions.length, 0);
  source.id = "billing-bbbbbbbb";
  f.declarations.sourceSets[0].snapshotIds = [source.id]; f.declarations.historicalBillingProviders![0].sourceSets[0].snapshotIds = [source.id];
  assert.equal(ledger(f).reportedCharges, null, "changing source anchors never transfers the old approval");
});
test("metadata defaults are backward compatible and registry journal replays without mutating strict declaration JSON", () => {
  const f = fixture(); const { historicalBillingProviders, ...original } = f.declarations;
  assert.ok(!Object.hasOwn(importDeclarationsSchema.parse(original), "historicalBillingProviders"));
  const journal = [{ version: 1, declarationRevision: 2, providers: historicalBillingProviders }];
  assert.deepEqual(restoreHistoricalBillingProviders(journal, 2), historicalBillingProviders);
  assert.deepEqual(original, { version: 1, mappings: f.declarations.mappings, sourceSets: f.declarations.sourceSets });
  assert.throws(() => restoreHistoricalBillingProviders(journal, 1), /requires review/);
  assert.throws(() => restoreHistoricalBillingProviders([...journal, ...journal], 2), /requires review/);
  assert.throws(() => restoreHistoricalBillingProviders([...journal, { version: 1, declarationRevision: 3, providers: [] },
    { version: 1, declarationRevision: 4, providers: [{ ...historicalBillingProviders![0], sourceLabel: "Different former" }] }], 4), /requires review/);
  assert.throws(() => restoreHistoricalBillingProviders([{ patient: "DO_NOT_PRINT", version: 1 }], 2), error => error instanceof Error && error.message === "Historical billing metadata requires review.");
});
test("ambiguous provider identities and duplicate registry bindings fail the strict schema", () => {
  const f = fixture();
  for (const value of [{ ...f.declarations, historicalBillingProviders: [f.declarations.historicalBillingProviders![0], f.declarations.historicalBillingProviders![0]] },
    { ...f.declarations, historicalBillingProviders: [{ ...f.declarations.historicalBillingProviders![0], sourceLabel: " CURRENT " }] }]) assert.equal(importDeclarationsSchema.safeParse(value).success, false);
});
test("unverified deletion columns and provider-name markers stop both raw CSV import paths", () => {
  for (const key of ["Deleted", "IsDeleted", "Clinician Deleted"]) {
    assert.throws(() => importBillingCsv(`Client,Clinician,Date of service,Total fee,Billing code,${key}\na,Former,2026-10-10,100,90837,true`), /Unverified deletion marker/);
    assert.throws(() => importAttendanceCsv(`Client,Clinician,Date of service,Status,Location,${key}\na,Former,2026-10-10,Show,Room,true`), /Unverified deletion marker/);
  }
  assert.throws(() => importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\na,Former (deleted),2026-10-10,100,90837"), /Unverified deletion marker/);
  assert.throws(() => importAttendanceCsv("Client,Clinician,Date of service,Status,Location\na,Former (deleted),2026-10-10,Show,Room"), /Unverified deletion marker/);
  assert.throws(() => importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code,Provider Status\na,Former,2026-10-10,100,90837,inactive"), /Unverified deletion marker/);
  assert.throws(() => importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code,Extra Field\na,Former,2026-10-10,100,90837,Deleted"), /Unverified deletion marker/);
  assert.throws(() => importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\na,Former,2026-10-10,100,DELETED"), /Unverified deletion marker/);
});
