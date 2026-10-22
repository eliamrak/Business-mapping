import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace, monthFlow, planNextReportPeriod, prepareBillingCodeResolution, reconcileBillingEvidence,
  type Context, type NextReportPeriodInput, type StructuralReportRow, type StructuralSnapshot,
} from "@workspace/practice/hub";
import {
  isConsultationService, isRecognizedTreatmentCode, isTreatmentService, semanticServiceCode, semanticVisitKind,
} from "../../../../lib/practice/src/hub/service-codes.ts";
import { summarizeImportedBillingActuals } from "../../../../lib/practice/src/hub/engine.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";
import {
  buildLocalRetentionMetrics, derivedShowVisits, estimateLocalClientActivity, summarizeConsultConversions,
  treatmentAttendanceRows, treatmentBillingRows, type AttendanceRow, type BillingRow, type LocalSnapshot,
} from "./retention-local.ts";

const label = "Synthetic Zero Clinician";
const clientId = "synthetic-zero-client";
const asOf = "2026-06-01";
const proof = { start: "2026-01-01", end: "2026-05-20", complete: true as const };
const context = (): Context => ({ clinicians: [{ id: 91, label, goalId: 9, classification: "1099",
  sessionRate: 125, sessionsPerWeek: 7, weeksWorkedPerYear: 48, capEnabled: false, capAmount: 0,
  preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 60, postCapPracticeSplit: 40,
  w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] });
const visit = (serviceDate: string, billingCode?: string): AttendanceRow => ({ clientId, clinician: label,
  serviceDate, billingCode, status: "show", location: null, sourceRowHash: `synthetic-attendance-${serviceDate}-${billingCode}` });
const charge = (serviceDate: string, billingCode: string | null, patch: Partial<BillingRow> = {}): BillingRow => ({
  clientId, clinician: label, serviceDate, billingCode, totalFeeCharged: 0,
  sourceRowHash: `synthetic-billing-${serviceDate}-${billingCode}`, ...patch,
});
function attendance(rows: AttendanceRow[], id = "attendance-zero"): LocalSnapshot {
  return { id, kind: "attendance", sourceHash: `synthetic-${id}`, importedAt: `${asOf}T00:00:00Z`,
    coverageStart: proof.start, coverageEnd: proof.end, reportCoverage: { ...proof }, rows };
}
function billing(rows: BillingRow[], id = "billing-zero"): LocalSnapshot {
  return { id, kind: "billing", sourceHash: `synthetic-${id}`, importedAt: `${asOf}T00:00:00Z`,
    coverageStart: proof.start, coverageEnd: proof.end, reportCoverage: { ...proof }, rows };
}
function freeze(value: unknown) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
}
const entries = (sources: LocalSnapshot[]) => sources.flatMap(s => s.kind === "billing"
  ? s.rows.map(row => ({ snapshotId: s.id, row })) : []);
function retention(sources: LocalSnapshot[]) {
  return buildLocalRetentionMetrics(sources, {}, {}, 28, asOf, 90, "2026-01-01", "2026-01-31");
}
function conversions(sources: LocalSnapshot[]) {
  return summarizeConsultConversions(sources, {}, "2026-01-01", "2026-01-31", asOf);
}

test("only explicit zero is a PHONE consultation alias; blank and 00000 keep distinct semantics", () => {
  for (const code of ["0", " 0 ", "PHONE", " phone "]) {
    assert.equal(isConsultationService({ billingCode: code }), true);
    assert.equal(isTreatmentService({ billingCode: code }), false);
    assert.equal(isRecognizedTreatmentCode(code), false);
    assert.equal(semanticServiceCode(code), "phone");
    for (const kind of [undefined, null, "consultation"]) {
      assert.equal(semanticVisitKind({ billingCode: code, visitKind: kind }), "consultation");
    }
  }
  for (const code of [undefined, null, "", " ", "00000"]) {
    assert.equal(isConsultationService({ billingCode: code }), false);
    assert.notEqual(semanticServiceCode(code), "phone");
  }
});

for (const explicitAttendanceCode of [false, true]) {
  test(`zero-only consultation ${explicitAttendanceCode ? "attendance and billing" : "billing classifying unmarked attendance"} adds no treatment or retained client`, () => {
    const dates = ["2026-01-02", "2026-01-09", "2026-01-16"];
    const sources = [attendance(dates.map(date => visit(date, explicitAttendanceCode ? "0" : undefined))),
      billing(dates.map(date => charge(date, "0")))];
    const before = structuredClone(sources);
    freeze(sources);
    assert.deepEqual(treatmentAttendanceRows(sources), []);
    assert.deepEqual(treatmentBillingRows(sources), []);
    assert.deepEqual(derivedShowVisits(sources), []);
    const metrics = retention(sources);
    assert.equal(metrics.derivedShowVisits, 0);
    assert.equal(metrics.excludedConsultationShowRows, 3);
    assert.equal(metrics.clientActivityByClinician.reduce((sum, r) => sum + r.retainedClients, 0), 0);
    assert.equal(estimateLocalClientActivity(sources), null);
    const converted = conversions(sources);
    assert.equal(converted.practice.consultations, 1);
    assert.equal(converted.practice.converted, 0);
    const overlay = buildImportedSessionOverlay(context(), sources, 9);
    assert.equal(overlay.derivedSessions.reduce((sum, r) => sum + r.completed, 0), 0);
    const summary = summarizeImportedBillingActuals(overlay.context, new Set([91]));
    assert.equal(summary.billed.get(91), undefined);
    assert.deepEqual(summary.unknownDates, []);
    const workspace = emptyWorkspace("2026-01-01"); workspace.settings.teamId = 9;
    const flow = monthFlow(workspace, overlay.context, "2026-01-01", "2026-01-31");
    assert.equal(flow.sessions, 0);
    assert.equal(flow.revenue, 0);
    assert.deepEqual(sources, before);
  });
}

test("PHONE/0 repeated exports form one consultation and one free charge without an owner resolution", () => {
  const phone = charge("2026-01-02", "PHONE", { visitKind: "consultation" });
  const zero = charge("2026-01-02", "0");
  const sources = [attendance([visit("2026-01-02", "PHONE")], "attendance-phone"),
    attendance([visit("2026-01-02", "0")], "attendance-zero"),
    billing([phone], "billing-phone"), billing([zero], "billing-zero"),
    billing([{ ...zero }], "billing-repeat-zero")];
  const before = structuredClone(sources);
  const source = entries(sources);
  assert.equal(prepareBillingCodeResolution(source), null);
  const groups = reconcileBillingEvidence(source);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].known, true);
  assert.equal(groups[0].duplicateRowCount, 2);
  assert.equal(groups[0].codeResolution, false);
  assert.equal(conversions(sources).practice.consultations, 1);
  assert.equal(conversions(sources).practice.converted, 0);
  const overlay = buildImportedSessionOverlay(context(), sources, 9);
  assert.equal(overlay.importedBillingActuals.length, 1);
  assert.equal(overlay.diagnostic.billedRows, 1);
  assert.equal(overlay.diagnostic.billedFees, 0);
  assert.equal(overlay.derivedSessions.reduce((sum, r) => sum + r.completed, 0), 0);
  assert.deepEqual(summarizeImportedBillingActuals(overlay.context, new Set([91])).unknownDates, []);
  const data = summarizeReportedBilling(sources, asOf);
  assert.equal(data.months[0].rowCount, 1);
  assert.equal(data.months[0].charges, 0);
  assert.equal(data.evidence.rawRowCount, 3);
  assert.deepEqual(sources, before);
});

test("consultation closes only after a full 90837 show and repeated treatment exports count once", () => {
  const consultation = visit("2026-01-02", "0"), treatment = visit("2026-01-09", "90837");
  const sources = [attendance([consultation]), billing([charge("2026-01-02", "0")])];
  assert.equal(conversions(sources).practice.converted, 0);
  const cancelled = attendance([{ ...treatment, status: "cancelled" }], "cancelled-treatment");
  assert.equal(conversions([...sources, cancelled]).practice.converted, 0);
  const showed = attendance([treatment], "attended-treatment");
  const treatmentFee = charge("2026-01-09", "90837", { totalFeeCharged: 125 });
  const full = [...sources, showed, attendance([{ ...treatment, sourceRowHash: "reexported-treatment" }], "repeated-treatment"),
    billing([treatmentFee], "treatment-fee"), billing([{ ...treatmentFee }], "repeated-treatment-fee")];
  const before = structuredClone(full);
  const converted = conversions(full);
  assert.equal(converted.practice.consultations, 1);
  assert.equal(converted.practice.converted, 1);
  assert.equal(converted.journeys[0].treatmentDate, "2026-01-09");
  assert.equal(derivedShowVisits(full).length, 1);
  const overlay = buildImportedSessionOverlay(context(), full, 9);
  assert.equal(overlay.derivedSessions.reduce((sum, r) => sum + r.completed, 0), 1);
  const summary = summarizeImportedBillingActuals(overlay.context, new Set([91]));
  assert.equal(summary.billed.get(91)?.get("2026-01-09"), 125);
  assert.deepEqual(summary.unknownDates, []);
  assert.deepEqual(full, before);
});

test("three distinct treatment shows are needed for initial retention; zero consultations cannot supply the third", () => {
  const shows = [visit("2026-01-02", "0"), visit("2026-01-03", "90837"), visit("2026-01-10", "90837")];
  const source = [attendance(shows)];
  const before = structuredClone(source);
  const two = retention(source);
  assert.equal(two.derivedShowVisits, 2);
  assert.equal(two.clientActivityByClinician[0].retainedClients, 0);
  assert.equal(estimateLocalClientActivity(source, {}, 56, 56, 28, asOf)!.retainedClientPairs, 0);
  const third = [...source, attendance([visit("2026-01-17", "90837")], "third-treatment")];
  const three = retention(third);
  assert.equal(three.derivedShowVisits, 3);
  assert.equal(three.clientActivityByClinician[0].retainedClients, 1);
  assert.equal(estimateLocalClientActivity(third, {}, 56, 56, 28, asOf)!.retainedClientPairs, 1);
  assert.deepEqual(source, before);
});

for (const [name, alter] of [
  ["fee difference", (rows: BillingRow[]) => { rows[1].totalFeeCharged = 1; }],
  ["conflicting raw hash payload", (rows: BillingRow[]) => { rows[1].sourceRowHash = rows[0].sourceRowHash; }],
  ["explicit contradictory treatment kind", (rows: BillingRow[]) => {
    Object.assign(rows[1], { visitKind: "treatment" });
  }],
] as const) {
  test(`consult alias reconciliation leaves ${name} unknown across Data and the engine`, () => {
    const rows = [charge("2026-01-02", "PHONE"), charge("2026-01-02", "0")];
    alter(rows);
    const sources = [attendance([visit("2026-01-02", "0")]), billing([rows[0]], "a"), billing([rows[1]], "b")];
    const before = structuredClone(sources);
    const groups = reconcileBillingEvidence(entries(sources));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].known, false);
    assert.equal(summarizeReportedBilling(sources, asOf).months[0].charges, null);
    const overlay = buildImportedSessionOverlay(context(), sources, 9);
    assert.ok(overlay.importedBillingActuals.every(row => row.evidenceUnknown));
    assert.ok(summarizeImportedBillingActuals(overlay.context, new Set([91])).unknownDates.length > 0);
    assert.deepEqual(sources, before);
  });
}

test("two consultation rows in the same source do not auto-collapse as independent export aliases", () => {
  const rows = [charge("2026-01-02", "PHONE"), charge("2026-01-02", "0")];
  const sources = [billing(rows, "same-source")];
  const group = reconcileBillingEvidence(entries(sources))[0];
  assert.equal(group.known, false);
  assert.equal(group.ambiguous, true);
  assert.equal(summarizeReportedBilling(sources, asOf).months[0].charges, null);
});

for (const code of ["0", "PHONE"]) {
  test(`a nonzero ${code} consultation fee cannot replace treatment revenue or silently disappear`, () => {
    const sources = [attendance([visit("2026-01-02", code)]),
      billing([charge("2026-01-02", code, { totalFeeCharged: 25 })])];
    const overlay = buildImportedSessionOverlay(context(), sources, 9);
    const summary = summarizeImportedBillingActuals(overlay.context, new Set([91]));
    assert.equal(summary.billed.get(91), undefined);
    assert.ok(summary.unknownDates.some(r => r.date === "2026-01-02"));
    const workspace = emptyWorkspace("2026-01-01"); workspace.settings.teamId = 9;
    assert.equal(monthFlow(workspace, overlay.context, "2026-01-01", "2026-01-31").revenue, null);
  });
}

function plannerFixture(): NextReportPeriodInput {
  const oldAttendance = "attendance-00000091", incomingAttendance = "attendance-00000092";
  const a = "billing-00000091", b = "billing-00000092", incomingBilling = "billing-00000093";
  const regular = (clientId: string, serviceDate: string, sourceRowHash: string): StructuralReportRow => ({
    clientId, clinician: label, serviceDate, sourceRowHash, status: "show", location: null,
    billingCode: "90837", totalFeeCharged: 125,
  });
  const carry = Array.from({ length: 25 }, (_, i) => regular(`synthetic-carry-${i}`, "2026-10-07", `old-carry-${i}`));
  const consult = { ...regular("synthetic-october-consult", "2026-10-08", "phone-anchor"),
    billingCode: "PHONE", totalFeeCharged: 0, visitKind: "consultation" };
  const zero = { ...consult, billingCode: "0", sourceRowHash: "zero-anchor", visitKind: undefined };
  const make = (id: string, kind: StructuralSnapshot["kind"], rows: StructuralSnapshot["rows"], incoming = false): StructuralSnapshot => ({
    id, kind, sourceHash: `synthetic-${id}`, rows,
    importedAt: incoming ? "2026-10-22T08:00:00Z" : "2026-10-12T08:00:00Z",
    coverageStart: incoming ? "2026-10-07" : "2026-09-10", coverageEnd: incoming ? "2026-10-21" : "2026-10-12",
  });
  return { snapshots: [make(oldAttendance, "attendance", [...carry, consult]),
    make(a, "billing", [consult]), make(b, "billing", [zero]),
    make(incomingAttendance, "attendance", [...carry.map((row, i) => ({ ...row, sourceRowHash: `new-carry-${i}` })), zero], true),
    make(incomingBilling, "billing", [{ ...zero }], true)],
  storedDeclarations: { revision: 1, confirmedAt: "2026-10-13T00:00:00Z", data: { version: 1,
    mappings: [{ sourceLabel: label, clinicianLabel: label, clinicianId: 91, teamId: 9 }], sourceSets: [
      { kind: "attendance", snapshotIds: [oldAttendance], clinicianIds: [91], start: "2026-09-10", end: "2026-10-12", complete: true },
      { kind: "billing", snapshotIds: [a, b], clinicianIds: [91], start: "2026-09-10", end: "2026-10-12", complete: true },
    ] } }, roster: [{ id: 91, label, goalId: 9 }], teamId: 9,
  newSourceIds: [incomingAttendance, incomingBilling], today: "2026-10-22" };
}

test("actual-shaped October PHONE/0/0 package advances with 25 carryovers and no resolution", () => {
  const f = plannerFixture(), before = structuredClone(f);
  freeze(f);
  const plan = planNextReportPeriod(f);
  assert.equal(plan.status, "ready", plan.reasons.join(" "));
  assert.deepEqual(plan.period, { start: "2026-10-08", end: "2026-10-21", payDate: "2026-10-22" });
  assert.deepEqual(plan.carryover, { rows: 25, matched: 25, conflicts: 0 });
  assert.deepEqual(plan.reasons, []);
  assert.equal("billingResolutions" in plan.data!, false);
  assert.deepEqual(f, before);
});

for (const patch of [{ totalFeeCharged: 1 }, { visitKind: "treatment" }, { cancellationSubtype: "late" }]) {
  test(`planner consultation aliases do not hide changed ${Object.keys(patch)[0]}`, () => {
    const f = plannerFixture();
    const changed = { ...f, snapshots: f.snapshots.map(s => s.id === "billing-00000093"
      ? { ...s, rows: s.rows.map(row => ({ ...row, ...patch })) } : s) };
    const before = structuredClone(changed);
    const plan = planNextReportPeriod(changed);
    assert.equal(plan.status, "blocked");
    assert.equal(plan.data, undefined);
    assert.match(plan.reasons.join(" "), /Billing evidence requires reconciliation/);
    assert.deepEqual(changed, before);
  });
}

for (const billingCode of [null, "", "00000"]) {
  test(`planner never treats ${JSON.stringify(billingCode)} as another spelling of consultation zero`, () => {
    const f = plannerFixture();
    const changed = { ...f, snapshots: f.snapshots.map(s => s.id === "billing-00000093"
      ? { ...s, rows: s.rows.map(row => ({ ...row, billingCode })) } : s) };
    const before = structuredClone(changed);
    const plan = planNextReportPeriod(changed);
    assert.equal(plan.status, "blocked");
    assert.equal(plan.data, undefined);
    assert.match(plan.reasons.join(" "), /billing overlapping/);
    assert.deepEqual(changed, before);
  });
}

test("planner cannot collapse two same-day consult rows in one incoming source", () => {
  const f = plannerFixture();
  const changed = { ...f, snapshots: f.snapshots.map(s => s.id === "billing-00000093"
    ? { ...s, rows: [...s.rows, { ...s.rows[0], sourceRowHash: "synthetic-second-consult", billingCode: "PHONE" }] } : s) };
  const before = structuredClone(changed);
  const plan = planNextReportPeriod(changed);
  assert.equal(plan.status, "blocked");
  assert.equal(plan.data, undefined);
  assert.match(plan.reasons.join(" "), /Billing evidence requires reconciliation/);
  assert.deepEqual(changed, before);
});

test("a shared billing hash cannot hide absent versus explicit consultation kind, while exact raw copies stay known", () => {
  for (const code of ["0", "PHONE"]) {
    const original = charge("2026-01-02", code, { sourceRowHash: `synthetic-stable-${code}` });
    const changed = { ...original, visitKind: "consultation" as const };
    const sources = [billing([original], "original"), billing([changed], "changed")];
    const before = structuredClone(sources);
    freeze(sources);
    const [group] = reconcileBillingEvidence(entries(sources));
    assert.equal(group.known, false);
    assert.equal(group.hashConflict, true);
    assert.equal(group.rows.length, 2);
    assert.equal(summarizeReportedBilling(sources, asOf).months[0].charges, null);
    const overlay = buildImportedSessionOverlay(context(), sources, 9);
    assert.equal(overlay.importedBillingActuals.length, 2);
    assert.ok(overlay.importedBillingActuals.every(row => row.evidenceUnknown));
    assert.ok(summarizeImportedBillingActuals(overlay.context, new Set([91])).unknownDates.length > 0);
    assert.deepEqual(sources, before);

    const exactCopies = [billing([original], "original"), billing([{ ...original }], "exact-copy")];
    const [exact] = reconcileBillingEvidence(entries(exactCopies));
    assert.equal(exact.known, true);
    assert.equal(exact.hashConflict, false);
    assert.equal(exact.duplicateRowCount, 1);
    assert.equal(summarizeReportedBilling(exactCopies, asOf).months[0].charges, 0);

    const separateHashes = [billing([original], "original"), billing([{ ...changed, sourceRowHash: "separate-consult-hash" }], "changed")];
    const [semanticEquivalent] = reconcileBillingEvidence(entries(separateHashes));
    assert.equal(semanticEquivalent.known, true);
    assert.equal(semanticEquivalent.hashConflict, false);
    assert.equal(semanticEquivalent.duplicateRowCount, 1);
  }
});

test("planner rejects PHONE to zero attendance hash reuse but accepts distinct hashes and exact raw copies", () => {
  const f = plannerFixture();
  const old = f.snapshots.find(s => s.id === "attendance-00000091")!.rows
    .find(row => row.clientId === "synthetic-october-consult")!;
  const withIncoming = (patch: Partial<StructuralReportRow>): NextReportPeriodInput => ({ ...f,
    snapshots: f.snapshots.map(s => s.id === "attendance-00000092"
      ? { ...s, rows: s.rows.map(row => row.clientId === old.clientId ? { ...row, ...patch } : row) } : s),
  });
  const cases = [
    { input: f, expected: "ready", collision: false },
    { input: withIncoming({ sourceRowHash: old.sourceRowHash }), expected: "blocked", collision: true },
    { input: withIncoming({ ...old }), expected: "ready", collision: false },
  ] as const;
  for (const { input, expected, collision } of cases) {
    const before = structuredClone(input);
    freeze(input);
    const plan = planNextReportPeriod(input);
    assert.equal(plan.status, expected, plan.reasons.join(" "));
    assert.deepEqual(plan.carryover, { rows: 25, matched: 25, conflicts: 0 });
    if (collision) {
      assert.equal(plan.data, undefined);
      assert.match(plan.reasons.join(" "), /attendance source row identity.*conflicting raw facts/);
    } else {
      assert.deepEqual(plan.reasons, []);
      assert.ok(plan.data);
    }
    assert.deepEqual(input, before);
  }
});
