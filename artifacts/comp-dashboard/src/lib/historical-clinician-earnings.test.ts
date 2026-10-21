import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clinicianSettingSchema, emptyWorkspace, eventSchema, prepareBillingChargeResolution, termSchema,
  type Context, type ImportEvidenceDeclarations,
} from "@workspace/practice/hub";
import { createHistoricalClinicianEarningsReader, historicalClinicianEarningsPerSession } from "./historical-clinician-earnings.ts";
import { practiceFinancialEstimateRange } from "./practice-financial-estimate.ts";
import { sameDayVisitKey, type BillingRow, type LocalSnapshot, type SameDayVisitOverrides } from "./retention-local.ts";

function fixture(start = "2026-01-01", end = "2026-01-14") {
  const workspace = emptyWorkspace(start);
  const context: Context = { clinicians: [{ id: 1, label: "Synthetic", goalId: null, classification: "1099", sessionRate: 900,
    sessionsPerWeek: 70, weeksWorkedPerYear: 52.1786, capEnabled: false, capAmount: 0,
    preCapClinicianSplit: 90, preCapPracticeSplit: 10, postCapClinicianSplit: 80, postCapPracticeSplit: 20,
    w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
  workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: start,
    payMode: "existing_split", clinicianSplit: 60 }));
  const row: BillingRow = { clientId: "Synthetic client", clinician: "Synthetic", serviceDate: start,
    billingCode: "90837", totalFeeCharged: 50, sourceRowHash: "discount" };
  const billing: Extract<LocalSnapshot, { kind: "billing" }> = { id: "billing", kind: "billing", importedAt: end + "T00:00:00Z",
    coverageStart: start, coverageEnd: end, reportCoverage: { start, end, complete: true }, sourceHash: "billing-source", rows: [row] };
  const attendance: Extract<LocalSnapshot, { kind: "attendance" }> = { ...billing, id: "attendance", kind: "attendance", sourceHash: "attendance-source",
    rows: [{ clientId: row.clientId, clinician: row.clinician, serviceDate: start, status: "show", location: null, billingCode: "90837", sourceRowHash: "show" }] };
  const declarations: ImportEvidenceDeclarations = { version: 1, mappings: [], sourceSets: [] };
  return { workspace, context, snapshots: [billing, attendance] as LocalSnapshot[], billing, attendance,
    declarations, sameDayVisitOverrides: {} as SameDayVisitOverrides, range: { start, end }, asOf: end, clinicianId: 1 };
}
const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const unknown = (f: ReturnType<typeof fixture>, pattern: RegExp) => {
  const result = historicalClinicianEarningsPerSession(f);
  assert.equal(result.status, "unavailable");
  assert.equal(result.averageCompensatedPerCompletedSession, null);
  assert.match(result.unavailableReasons.join(" "), pattern);
  return result;
};

test("Team earnings reader defers work, caches requested clinicians and isolates updated inputs", () => {
  const f = fixture();
  const original = structuredClone(f);
  const expected = historicalClinicianEarningsPerSession(f);
  let snapshotReads = 0;
  const input = { ...f, get snapshots() { snapshotReads++; return f.snapshots; } };
  const reader = createHistoricalClinicianEarningsReader(input);
  assert.equal(snapshotReads, 0);
  assert.equal(reader.get(99), undefined);
  assert.equal(snapshotReads, 0);
  const first = reader.get(1);
  assert.deepEqual(first, expected);
  const readsAfterFirst = snapshotReads;
  assert.ok(readsAfterFirst > 0);
  assert.equal(reader.get(1), first);
  assert.equal(snapshotReads, readsAfterFirst);
  const changed = structuredClone(f);
  changed.billing.rows[0].totalFeeCharged = 100;
  const next = createHistoricalClinicianEarningsReader(changed);
  assert.deepEqual(next.get(1), historicalClinicianEarningsPerSession(changed));
  assert.notDeepEqual(next.get(1), first);
  assert.equal(reader.get(1), first);
  assert.deepEqual(f, original);
});

test("lazy earnings retains selected-team and ambiguous-ID behavior", () => {
  const f = fixture();
  f.context.clinicians.push({ ...f.context.clinicians[0], id: 2, goalId: 9 });
  const reader = createHistoricalClinicianEarningsReader(f);
  assert.equal(reader.get(2), undefined);
  f.context.clinicians.push({ ...f.context.clinicians[0], label: "Duplicate synthetic ID" });
  const ambiguous = createHistoricalClinicianEarningsReader(f);
  assert.deepEqual(ambiguous.get(1), historicalClinicianEarningsPerSession(f));
  assert.equal(ambiguous.get(1)?.status, "unavailable");
});

test("optional clinician scope preserves default whole-team totals and omitted/empty/undefined options", () => {
  const f = fixture();
  f.context.clinicians.push({ ...f.context.clinicians[0], id: 2, label: "Second synthetic" });
  f.workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 2,
    effectiveDate: f.range.start, payMode: "salary", payAmount: 372 }));
  f.billing.rows.push({ ...f.billing.rows[0], clinician: "Second synthetic", clientId: "Second client", totalFeeCharged: 100, sourceRowHash: "second-charge" });
  f.attendance.rows.push({ ...f.attendance.rows[0], clinician: "Second synthetic", clientId: "Second client", sourceRowHash: "second-show" });
  const args = [f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations, f.sameDayVisitOverrides] as const;
  const before = structuredClone(f);
  const whole = practiceFinancialEstimateRange(...args);
  near(whole.values.clinicianPay!, 44);
  near(whole.values.revenue!, 150);
  assert.equal(whole.values.sessions, 2);
  assert.deepEqual(practiceFinancialEstimateRange(...args, {}), whole);
  assert.deepEqual(practiceFinancialEstimateRange(...args, { clinicianId: undefined }), whole);
  for (const [clinicianId, pay, revenue] of [[1, 30, 50], [2, 14, 100]]) {
    const scoped = practiceFinancialEstimateRange(...args, { clinicianId });
    near(scoped.values.clinicianPay!, pay);
    near(scoped.values.revenue!, revenue);
    assert.equal(scoped.values.sessions, 1);
    assert.equal(scoped.billingCoverageComplete, true);
  }
  assert.deepEqual(practiceFinancialEstimateRange(...args), whole);
  assert.deepEqual(f, before);
});

test("engine scope and helper reject duplicate IDs instead of counting or selecting the first match", () => {
  const f = fixture();
  f.context.clinicians.push({ ...f.context.clinicians[0], label: "Duplicate synthetic ID", goalId: 9 });
  unknown(f, /uniquely identified/);
  for (const clinicianId of [1, 0, -1, 1.5, NaN, 99]) {
    const scoped = practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range,
      f.declarations, f.sameDayVisitOverrides, { clinicianId });
    assert.equal(scoped.status, "unavailable");
    assert.equal(scoped.values.clinicianPay, null);
    assert.equal(scoped.values.sessions, null);
    assert.equal(scoped.billingCoverageComplete, false);
    assert.match(scoped.unavailableReasons.join(" "), /uniquely identified/);
  }
});

test("discounted treatment compensation is neither billed revenue nor a card/planning rate; input is immutable", () => {
  const f = fixture();
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    start: f.range.start, desiredWeeklySessions: 99, expectedSessionRevenue: 999 }));
  const before = structuredClone(f);
  const result = historicalClinicianEarningsPerSession(f);
  assert.equal(result.status, "available");
  assert.equal(result.completedTreatmentSessions, 1);
  near(result.compensatedAmount, 30);
  near(result.averageCompensatedPerCompletedSession, 30);
  assert.match(result.assumptions.join(" "), /not paid payroll/);
  assert.deepEqual(result.unavailableReasons, []);
  assert.deepEqual(f, before);
  assert.deepEqual(historicalClinicianEarningsPerSession(f), result);
});

test("consultation, documentation, free PHONE and employer burden do not become treatment earnings", () => {
  const f = fixture();
  Object.assign(f.context.clinicians[0], { classification: "w2", w2EmployerFicaPct: 20 });
  for (const [code, amount] of [["30003", 60], ["2", 25], ["PHONE", 0]] as const)
    f.billing.rows.push({ ...f.billing.rows[0], clientId: code, billingCode: code, totalFeeCharged: amount, sourceRowHash: code });
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 30);
  f.billing.rows.find(row => row.billingCode === "PHONE")!.totalFeeCharged = 5;
  unknown(f, /compensation inputs/);
});

test("full identity roster preserves other known same-team and other-team providers without contaminating salary", () => {
  const f = fixture();
  f.workspace.terms = [];
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    start: f.range.start, desiredWeeklySessions: 7, payMode: "salary", payAmount: 372 }));
  for (const [id, goalId] of [[2, null], [3, 9]] as const) {
    const label = `Other synthetic ${id}`;
    f.context.clinicians.push({ ...f.context.clinicians[0], id, label, goalId });
    f.billing.rows.push({ ...f.billing.rows[0], clinician: label, clientId: label, totalFeeCharged: 500, sourceRowHash: label });
    f.attendance.rows.push({ ...f.attendance.rows[0], clinician: label, clientId: label, sourceRowHash: label });
  }
  const baseline = practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations);
  const before = structuredClone(f);
  const result = historicalClinicianEarningsPerSession(f);
  assert.equal(result.status, "available");
  near(result.compensatedAmount, 14);
  near(result.averageCompensatedPerCompletedSession, 14);
  assert.equal(result.completedTreatmentSessions, 1);
  assert.deepEqual(practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations), baseline);
  assert.deepEqual(f, before);
});

test("copied provider labels require a confirmed scoped mapping across the full roster", () => {
  const f = fixture();
  f.context.clinicians.push({ ...f.context.clinicians[0], id: 2, goalId: 9 });
  unknown(f, /coverage/);
  f.declarations.mappings.push({ sourceLabel: "Synthetic", clinicianLabel: "Synthetic", clinicianId: 1, teamId: null });
  assert.equal(historicalClinicianEarningsPerSession(f).status, "available");
  f.clinicianId = 2;
  unknown(f, /selected team/);
  f.clinicianId = 99;
  unknown(f, /uniquely identified/);
});

test("unresolved billed identities fail closed; declared historical-only providers remain excluded", () => {
  const f = fixture();
  f.billing.rows.push({ ...f.billing.rows[0], clinician: "Former synthetic", clientId: "Other client", sourceRowHash: "former" });
  unknown(f, /coverage/);
  f.declarations.historicalBillingProviders = [{ id: crypto.randomUUID(), sourceLabel: "Former synthetic",
    sourceSets: [{ snapshotIds: [f.billing.id], ...f.range, complete: true }] }];
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 30);
});

test("current-card splits and later salary profiles never invent historical pay", () => {
  const f = fixture();
  f.workspace.terms = [];
  unknown(f, /Dated active compensation/);
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    start: "2026-02-01", desiredWeeklySessions: 7, payMode: "salary", payAmount: 120000 }));
  unknown(f, /Dated active compensation/);
  f.workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: f.range.start,
    payMode: "salary", payAmount: 372 }));
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 14);
});

test("dated salary changes accrue on selected calendar dates, independent of treatment revenue", () => {
  const f = fixture();
  f.workspace.terms = [termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: f.range.start, payMode: "salary", payAmount: 372 }),
    termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: "2026-01-08", payAmount: 744 })];
  f.billing.rows[0].totalFeeCharged = 500;
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 21);
});

test("hourly accrual and nonclinical compensation retain the engine's disclosed semantics", () => {
  const f = fixture();
  f.workspace.terms = [termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: f.range.start,
    payMode: "hourly", payAmount: 10, paidHoursPerWeek: 7 })];
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 140);
  f.workspace.terms[0].payMode = "existing_split";
  f.workspace.terms[0].clinicianSplit = 60;
  Object.assign(f.context.clinicians[0], { nonClinicalHoursPerWeek: 7, nonClinicalHourlyRate: 10 });
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 170);
});

test("per-session pay uses completed visits and accepted same-day overrides, never planning counts", () => {
  const f = fixture();
  f.workspace.terms = [termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: f.range.start,
    payMode: "per_session", payAmount: 12 })];
  f.attendance.rows.push({ ...f.attendance.rows[0], sourceRowHash: "second-show" });
  f.sameDayVisitOverrides[sameDayVisitKey(f.attendance.rows[0])] = 2;
  const result = historicalClinicianEarningsPerSession(f);
  assert.equal(result.completedTreatmentSessions, 2);
  near(result.compensatedAmount, 24);
  near(result.averageCompensatedPerCompletedSession, 12);
});

test("caps replay prior discounted dollars before the selected window", () => {
  const f = fixture("2026-01-01", "2026-02-25");
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  f.billing.rows[0].totalFeeCharged = 200;
  f.billing.rows.push({ ...f.billing.rows[0], clientId: "Later", serviceDate: "2026-02-01", totalFeeCharged: 100, sourceRowHash: "later" });
  f.attendance.rows.push({ ...f.attendance.rows[0], clientId: "Later", serviceDate: "2026-02-01", sourceRowHash: "later-show" });
  f.range = { start: "2026-02-01", end: "2026-02-10" };
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 70);
  f.workspace.terms[0].effectiveDate = f.range.start;
  unknown(f, /Prior annual cap contributions lack dated/);
});

test("unknown annual cap history stays unknown until a dated opening contribution establishes replay", () => {
  const f = fixture("2026-07-02", "2026-07-15");
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  unknown(f, /cap progress/);
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    start: f.range.start, desiredWeeklySessions: 7, openingCapContribution: 100 }));
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 40);
});

test("unresolved providers before the selected window withhold cap history until a dated opening replaces it", () => {
  const f = fixture("2026-01-01", "2026-02-25");
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  f.billing.rows.push({ ...f.billing.rows[0], clinician: "Unknown prior provider", clientId: "Unknown prior", sourceRowHash: "unknown-prior" },
    { ...f.billing.rows[0], serviceDate: "2026-02-01", clientId: "Selected", sourceRowHash: "selected" });
  f.attendance.rows.push({ ...f.attendance.rows[0], serviceDate: "2026-02-01", clientId: "Selected", sourceRowHash: "selected-show" });
  f.range = { start: "2026-02-01", end: "2026-02-10" };
  unknown(f, /Unresolved billed provider identities in prior annual cap history/);
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    start: f.range.start, desiredWeeklySessions: 7, openingCapContribution: 100 }));
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 40);
});

test("annual cap replay resets on January 1 across a selected year boundary", () => {
  const f = fixture("2025-12-18", "2026-01-14");
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    start: f.range.start, desiredWeeklySessions: 7, openingCapContribution: 100 }));
  f.billing.rows.push({ ...f.billing.rows[0], serviceDate: "2026-01-01", sourceRowHash: "new-year" });
  f.attendance.rows.push({ ...f.attendance.rows[0], serviceDate: "2026-01-01", sourceRowHash: "new-year-show" });
  const result = historicalClinicianEarningsPerSession(f);
  assert.equal(result.completedTreatmentSessions, 2);
  near(result.compensatedAmount, 70);
  near(result.averageCompensatedPerCompletedSession, 35);
});

test("missing, partial and conflicting attendance or billing coverage cannot supply an average", () => {
  for (const kind of ["attendance", "billing"] as const) {
    const f = fixture();
    f[kind].reportCoverage = undefined;
    unknown(f, /coverage/);
    f[kind].reportCoverage = { ...f.range, complete: false };
    unknown(f, /coverage/);
  }
  const f = fixture();
  const conflicting = structuredClone(f.attendance);
  conflicting.id = "conflicting-attendance";
  conflicting.rows[0].status = "no show";
  conflicting.rows[0].sourceRowHash = "conflict";
  f.snapshots.push(conflicting);
  unknown(f, /coverage/);
});

test("matching treatment dates and clients are required in both directions", () => {
  for (const change of ["date", "client", "no-attended-treatment", "extra-charge"] as const) {
    const f = fixture();
    if (change === "date") f.billing.rows[0].serviceDate = "2026-01-02";
    if (change === "client") f.billing.rows[0].clientId = "Different client";
    if (change === "no-attended-treatment") f.attendance.rows[0].status = "cancelled";
    if (change === "extra-charge") f.billing.rows.push({ ...f.billing.rows[0], clientId: "Unmatched", sourceRowHash: "unmatched" });
    unknown(f, /must match/);
  }
});

test("duplicated snapshots are idempotent but conflicting excluded billing evidence stays unknown", () => {
  const f = fixture();
  const baseline = historicalClinicianEarningsPerSession(f);
  f.snapshots.push({ ...structuredClone(f.billing), id: "duplicate" });
  assert.deepEqual(historicalClinicianEarningsPerSession(f), baseline);
  const conflicting = structuredClone(f.billing);
  conflicting.id = "excluded-conflict";
  conflicting.reportCoverage = undefined;
  conflicting.rows[0].totalFeeCharged = 99;
  f.snapshots.push(conflicting);
  unknown(f, /coverage/);
});

test("approved two-charge compensation does not double the completed-session denominator", () => {
  const f = fixture();
  f.declarations.mappings.push({ sourceLabel: "Synthetic", clinicianLabel: "Synthetic", clinicianId: 1, teamId: null });
  f.billing.rows = [20, 30].map((totalFeeCharged, slot) => ({ ...f.billing.rows[0], totalFeeCharged, sourceRowHash: `slot-${slot}` }));
  const draft = prepareBillingChargeResolution(f.billing.rows.map(row => ({ row, snapshotId: f.billing.id })))!;
  f.declarations.billingResolutions = [{ ...draft, id: crypto.randomUUID(), clinicianId: 1,
    approvalToken: "a".repeat(64), confirmedAt: "2026-01-15T00:00:00Z", approvalNote: "Synthetic only" }];
  const result = historicalClinicianEarningsPerSession(f);
  assert.equal(result.completedTreatmentSessions, 1);
  near(result.averageCompensatedPerCompletedSession, 30);
  f.declarations.mappings = [];
  unknown(f, /coverage/);
});

test("unsupported clinician events and unclassified services cannot fabricate compensation", () => {
  const f = fixture();
  f.workspace.events.push(eventSchema.parse({ id: crypto.randomUUID(), name: "Synthetic unsupported pay event",
    field: "clinician.hire", targetId: "1", date: f.range.start, value: 100 }));
  unknown(f, /compensation inputs/);
  f.workspace.events = [];
  f.billing.rows[0].billingCode = "UNKNOWN";
  unknown(f, /compensation inputs/);
});

test("event-only earnings changes invalidate the workspace reader without stale compensated values", () => {
  const f = fixture();
  const reader = createHistoricalClinicianEarningsReader(f);
  const previous = reader.get(1);
  assert.equal(previous?.status, "available");
  const workspace = { ...f.workspace, events: [eventSchema.parse({ id: crypto.randomUUID(),
    name: "Synthetic pay event", field: "clinician.hire", targetId: "1", date: f.range.start, value: 100 })] };
  const refreshed = createHistoricalClinicianEarningsReader({ ...f, workspace }).get(1);
  assert.equal(refreshed?.status, "unavailable");
  assert.equal(refreshed?.averageCompensatedPerCompletedSession, null);
  assert.equal(reader.get(1), previous);
  const source = readFileSync(new URL("../pages/practice-workspace.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const historicalEarningsById = useMemo(");
  const end = source.indexOf("const planProjection", start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /\}, \[[^\]]*workingWorkspace\?\.events/,
    "workspace earnings cache must recreate its reader when only pay events change");
});

test("zero compensated treatment remains zero; no completed treatments remains unknown", () => {
  const f = fixture();
  f.billing.rows[0].totalFeeCharged = 0;
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 0);
  f.billing.rows[0].billingCode = "30003";
  f.attendance.rows[0].billingCode = "30003";
  const result = unknown(f, /No completed treatment sessions/);
  assert.equal(result.completedTreatmentSessions, 0);
});

test("invalid/future ranges stay unknown; clipping uses one identical window for pay and sessions", () => {
  const f = fixture();
  f.range.end = "2026-02-01";
  const result = historicalClinicianEarningsPerSession(f);
  assert.deepEqual(result.range, { start: "2026-01-01", end: f.asOf });
  near(result.averageCompensatedPerCompletedSession, 30);
  for (const start of ["invalid", "2026-02-01"]) {
    f.range.start = start;
    unknown(f, /valid historical dates/);
  }
});

test("overlapping selected salary profiles are unknown in either input order without changing the engine", () => {
  const f = fixture();
  f.workspace.terms = [];
  f.workspace.clinicians = [372, 744].map(payAmount => clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    start: f.range.start, desiredWeeklySessions: 7, payMode: "salary", payAmount }));
  const before = structuredClone(f);
  const first = unknown(f, /selected-window compensation ambiguous/);
  assert.equal(first.compensatedAmount, null);
  near(practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations).values.clinicianPay!, 14);
  assert.deepEqual(f, before);
  f.workspace.clinicians.reverse();
  const reversedBefore = structuredClone(f);
  assert.deepEqual(historicalClinicianEarningsPerSession(f), first);
  near(practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations).values.clinicianPay!, 28);
  assert.deepEqual(f, reversedBefore);
});

test("overlapping profiles in prior cap replay are unknown even when selected profiles are unique", () => {
  const f = fixture("2026-01-01", "2026-02-25");
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  f.billing.rows[0].totalFeeCharged = 200;
  f.billing.rows.push({ ...f.billing.rows[0], clientId: "Selected", serviceDate: "2026-02-01", totalFeeCharged: 100, sourceRowHash: "selected" });
  f.attendance.rows.push({ ...f.attendance.rows[0], clientId: "Selected", serviceDate: "2026-02-01", sourceRowHash: "selected-show" });
  f.range = { start: "2026-02-01", end: "2026-02-10" };
  f.workspace.clinicians = [0, 100].map(openingCapContribution => clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    start: "2026-01-01", end: "2026-01-14", desiredWeeklySessions: 7, openingCapContribution }));
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    start: "2026-01-15", desiredWeeklySessions: 7 }));
  const before = structuredClone(f);
  const first = unknown(f, /prior annual cap replay ambiguous/);
  assert.equal(first.compensatedAmount, null);
  assert.deepEqual(f, before);
  f.workspace.clinicians.reverse();
  const reversedBefore = structuredClone(f);
  assert.deepEqual(historicalClinicianEarningsPerSession(f), first);
  assert.deepEqual(f, reversedBefore);
});

test("competing same-day salary terms are unknown in either order", () => {
  const f = fixture();
  f.workspace.terms = [372, 744].map(payAmount => termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    effectiveDate: f.range.start, payMode: "salary", payAmount }));
  const before = structuredClone(f);
  const first = unknown(f, /competing dated terms.*selected-window/);
  assert.deepEqual(f, before);
  f.workspace.terms.reverse();
  assert.deepEqual(historicalClinicianEarningsPerSession(f), first);
});

test("competing prior cap splits cannot be hidden by unique later selected terms", () => {
  const f = fixture("2026-01-01", "2026-02-25");
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  f.billing.rows[0].totalFeeCharged = 200;
  f.billing.rows.push({ ...f.billing.rows[0], clientId: "Selected", serviceDate: "2026-02-01", totalFeeCharged: 100, sourceRowHash: "selected" });
  f.attendance.rows.push({ ...f.attendance.rows[0], clientId: "Selected", serviceDate: "2026-02-01", sourceRowHash: "selected-show" });
  f.range = { start: "2026-02-01", end: "2026-02-10" };
  f.workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    effectiveDate: "2026-01-01", clinicianSplit: 90 }), termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1,
    effectiveDate: "2026-02-01", clinicianSplit: 60 }));
  const before = structuredClone(f);
  const first = unknown(f, /prior annual cap replay ambiguous/);
  assert.deepEqual(f, before);
  f.workspace.terms.reverse();
  assert.deepEqual(historicalClinicianEarningsPerSession(f), first);
});

test("inclusive profile endpoints overlap, but adjacent nonoverlapping salary profiles remain usable", () => {
  const f = fixture();
  f.workspace.terms = [];
  f.workspace.clinicians = [
    clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: f.range.start,
      end: "2026-01-08", desiredWeeklySessions: 7, payMode: "salary", payAmount: 372 }),
    clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-01-08",
      desiredWeeklySessions: 7, payMode: "salary", payAmount: 744 }),
  ];
  unknown(f, /selected-window compensation ambiguous/);
  f.workspace.clinicians[0].end = "2026-01-07";
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 21);
  f.workspace.clinicians.reverse();
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 21);
});

test("disjoint same-day term fields and later changes are deterministic; archived or unrelated profiles do not conflict", () => {
  const f = fixture();
  f.workspace.terms = [
    termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: f.range.start, payMode: "salary" }),
    termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: f.range.start, payAmount: 372 }),
    termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: "2026-01-08", payAmount: 744 }),
  ];
  f.workspace.clinicians = [
    clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 2, start: f.range.start, desiredWeeklySessions: 7, payMode: "salary", payAmount: 999 }),
    clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: f.range.start, desiredWeeklySessions: 7, status: "archived", payMode: "salary", payAmount: 999 }),
  ];
  // Dated terms precede later configuration, as supported by the existing engine.
  f.workspace.clinicians[1].start = "2026-02-01";
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 21);
  f.workspace.terms.reverse();
  near(historicalClinicianEarningsPerSession(f).averageCompensatedPerCompletedSession, 21);
});
