import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptedBillingCodeRow, billingCodeResolutionSchema, prepareBillingCodeResolution,
  type BillingCodeEntry, type BillingCodeResolution,
} from "../src/hub/billing-code-resolution.ts";
import { reconcileBillingEvidence, type EncounterBillingRow } from "../src/hub/billing-evidence.ts";
import { bindBillingResolutions, type ImportDeclarations } from "../src/hub/import-declarations.ts";
import { planNextReportPeriod, type NextReportPeriodInput, type StructuralSnapshot } from "../src/hub/next-report-period.ts";
import { forecast, summarizeImportedBillingActuals, type Context } from "../src/hub/engine.ts";
import { emptyWorkspace } from "../src/hub/model.ts";

const approvalId = "00000000-0000-4000-8000-000000000071";
const historicalId = "00000000-0000-4000-8000-000000000072";
const ids = { oldAttendance: "attendance-00000071", attendance: "attendance-00000072",
  a: "billing-00000071", b: "billing-00000072", incoming: "billing-00000073" };
const row = (patch: Partial<EncounterBillingRow> = {}): EncounterBillingRow => ({
  clientId: "synthetic-code-client", clinician: "Synthetic Code Clinician", serviceDate: "2026-10-12",
  billingCode: "90837", visitKind: "treatment", cancellationSubtype: null,
  totalFeeCharged: 125, sourceRowHash: "synthetic-code-hash-a", ...patch,
});
function entries(): BillingCodeEntry[] {
  return [{ snapshotId: ids.a, row: row() },
    { snapshotId: ids.b, row: row({ billingCode: "0", sourceRowHash: "synthetic-code-hash-b" }) }];
}
function threeSources() {
  const source = entries();
  return [...source, { snapshotId: ids.incoming, row: { ...source[1].row } }];
}
function approve(source = entries(), selectedIndex = 1): BillingCodeResolution {
  const draft = prepareBillingCodeResolution(source);
  assert.ok(draft, "synthetic source must be eligible before approving it");
  const selected = source[selectedIndex];
  return billingCodeResolutionSchema.parse({ ...draft, kind: "billing-code", id: approvalId,
    approvalToken: "a".repeat(64), clinicianId: 71,
    selected: { snapshotId: selected.snapshotId, sourceRowHash: selected.row.sourceRowHash },
    confirmedAt: "2026-10-22T09:00:00Z", approvalNote: "Synthetic explicit owner code choice" });
}
function assertStale(source: BillingCodeEntry[], resolution: BillingCodeResolution) {
  assert.equal(acceptedBillingCodeRow(source, resolution), null);
  const group = reconcileBillingEvidence(source, [resolution]).find(group =>
    group.rows.some(r => r.clientId === resolution.clientId && r.serviceDate === resolution.serviceDate));
  assert.ok(group);
  assert.equal(group.known, false);
  assert.equal(group.codeResolution, false);
  assert.equal(group.resolutionStale, true);
  assert.equal(group.acceptedRows, undefined);
  assert.equal(group.resolutionId, undefined);
}
function freeze(value: unknown) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}

for (const selectedIndex of [0, 1, 2]) test(`free October 8 PHONE/0/0 dispute permits explicit source ${selectedIndex} without inventing visit kind`, () => {
  const source = threeSources().map((entry, index) => ({ ...entry, row: { ...entry.row,
    serviceDate: "2026-10-08", billingCode: index === 0 ? "PHONE" : "0", visitKind: undefined, totalFeeCharged: 0 } }));
  const before = structuredClone(source), resolution = approve(source, selectedIndex);
  const [group] = reconcileBillingEvidence(source, [resolution]);
  assert.equal(group.known, true); assert.equal(group.codeResolution, true);
  assert.equal(group.rows.length, 3); assert.equal(group.acceptedRows?.length, 1);
  assert.equal(group.row.billingCode, source[selectedIndex].row.billingCode);
  assert.equal(group.row.visitKind, undefined);
  assert.equal(group.acceptedRows?.reduce((sum, row) => sum + row.totalFeeCharged, 0), 0);
  assert.deepEqual(source, before);
  assertStale([...source, { snapshotId: "billing-added-source", row: { ...source[1].row } }], resolution);
});

for (const [name, change] of [
  ["nonzero fee", (source: BillingCodeEntry[]) => source.forEach(entry => { entry.row.totalFeeCharged = 100; })],
  ["explicit visit-kind difference", (source: BillingCodeEntry[]) => { source[0].row.visitKind = "consultation"; }],
  ["same-source duplicate", (source: BillingCodeEntry[]) => source.push({ ...source[0], row: { ...source[0].row } })],
  ["third distinct code", (source: BillingCodeEntry[]) => { source[2].row.billingCode = "90837"; source[2].row.sourceRowHash = "third-distinct"; }],
] as const) test(`free PHONE/0 exception still rejects ${name}`, () => {
  const source = threeSources().map((entry, index) => ({ ...entry, row: { ...entry.row,
    billingCode: index === 0 ? "PHONE" : "0", visitKind: undefined, totalFeeCharged: 0 } }));
  change(source); assert.equal(prepareBillingCodeResolution(source), null);
});

test("draft preserves each exact raw code, fee and anchor without a default selection", () => {
  const source = threeSources(), before = structuredClone(source);
  freeze(source);
  const draft = prepareBillingCodeResolution(source);
  assert.ok(draft);
  assert.equal("selected" in draft, false);
  assert.equal("approvalToken" in draft, false);
  assert.equal(draft.evidence.length, 3);
  assert.deepEqual(draft.evidence.map(e => [e.snapshotId, e.billingCode, e.sourceRowHash, e.totalFeeCharged]), [
    [ids.a, "90837", "synthetic-code-hash-a", 125],
    [ids.b, "0", "synthetic-code-hash-b", 125],
    [ids.incoming, "0", "synthetic-code-hash-b", 125],
  ]);
  assert.deepEqual(prepareBillingCodeResolution([...source].reverse()), draft);
  assert.deepEqual(source, before);
});

for (const selectedIndex of [0, 1, 2]) {
  test(`three sources with identical B/incoming hash: explicit choice ${selectedIndex} accepts one fee`, () => {
    const source = threeSources(), resolution = approve(source, selectedIndex);
    const before = structuredClone({ source, resolution });
    freeze(source); freeze(resolution);
    assert.strictEqual(acceptedBillingCodeRow(source, resolution), source[selectedIndex].row);
    for (const ordered of [source, [...source].reverse()]) {
      const groups = reconcileBillingEvidence(ordered, [resolution]);
      assert.equal(groups.length, 1);
      const group = groups[0];
      assert.equal(group.known, true);
      assert.equal(group.codeResolution, true);
      assert.equal(group.hashConflict, false);
      assert.equal(group.resolutionId, approvalId);
      assert.strictEqual(group.row, source[selectedIndex].row);
      assert.deepEqual(group.acceptedRows, [source[selectedIndex].row]);
      assert.equal(group.acceptedRows!.reduce((sum, r) => sum + r.totalFeeCharged, 0), 125);
      assert.deepEqual(group.rows, ordered.map(e => e.row));
      assert.equal(group.duplicateRowCount, 2);
    }
    assert.deepEqual({ source, resolution }, before);
  });
}

test("explicit zero and missing code are separate alternatives, including a zero fee", () => {
  const source = entries().map((e, i) => ({ ...e, row: { ...e.row, billingCode: i ? "0" : null, totalFeeCharged: 0 } }));
  const draft = prepareBillingCodeResolution(source);
  assert.ok(draft);
  assert.deepEqual(draft.evidence.map(e => e.billingCode), [null, "0"]);
  for (const selectedIndex of [0, 1]) {
    const group = reconcileBillingEvidence(source, [approve(source, selectedIndex)])[0];
    assert.equal(group.known, true);
    assert.equal(group.acceptedRows?.length, 1);
    assert.equal(group.acceptedRows![0].billingCode, selectedIndex ? "0" : null);
    assert.equal(group.acceptedRows![0].totalFeeCharged, 0);
  }
});

test("no approval leaves raw alternative-code groups unchosen and preserves baseline arithmetic", () => {
  const source = threeSources();
  const groups = reconcileBillingEvidence(source);
  assert.equal(groups.length, 2);
  assert.ok(groups.every(g => !g.codeResolution && !g.acceptedRows && !g.resolutionId));
  assert.equal(groups.flatMap(g => g.rows).length, 3);
  assert.equal(groups.filter(g => g.known).reduce((sum, g) => sum + g.row.totalFeeCharged, 0), 250);
  assert.deepEqual(reconcileBillingEvidence(source, []), groups);
  const baseline = [
    { snapshotId: ids.a, row: row({ clientId: "synthetic-baseline-a", totalFeeCharged: 100 }) },
    { snapshotId: ids.b, row: row({ clientId: "synthetic-baseline-a", totalFeeCharged: 100 }) },
    { snapshotId: ids.a, row: row({ clientId: "synthetic-baseline-b", sourceRowHash: "baseline-b", totalFeeCharged: 25 }) },
    { snapshotId: ids.a, row: row({ clientId: "synthetic-baseline-free", sourceRowHash: "baseline-free", totalFeeCharged: 0 }) },
  ];
  const reconciled = reconcileBillingEvidence(baseline);
  assert.equal(reconciled.length, 3);
  assert.ok(reconciled.every(g => g.known));
  assert.equal(reconciled.reduce((sum, g) => sum + g.row.totalFeeCharged, 0), 125);
  assert.equal(reconciled.reduce((sum, g) => sum + g.duplicateRowCount, 0), 1);
  assert.deepEqual(reconcileBillingEvidence(baseline, [approve()]), reconciled);
});

for (const [name, patch] of [
  ["fee", { totalFeeCharged: 126 }], ["nonfinite fee", { totalFeeCharged: Number.NaN }],
  ["infinite fee", { totalFeeCharged: Infinity }], ["raw kind", { visitKind: "cancelled" }],
  ["cancellation subtype", { cancellationSubtype: "late" }],
  ["legacy documentation", { billingCode: "2" }], ["legacy consultation", { billingCode: "30003" }],
  ["phone consultation", { billingCode: "PHONE" }], ["client", { clientId: "other-client" }],
  ["provider", { clinician: "Other synthetic clinician" }], ["date", { serviceDate: "2026-10-13" }],
  ["missing hash", { sourceRowHash: " " }],
] as const) {
  test(`preparation refuses ${name} differences`, () => {
    const source = entries();
    source[1].row = { ...source[1].row, ...patch };
    assert.equal(prepareBillingCodeResolution(source), null);
    assert.equal(acceptedBillingCodeRow(source, approve()), null);
  });
}

test("same-day multiple rows from one source cannot become a single code choice", () => {
  const source = entries(), resolution = approve(source);
  for (const extra of [source[1], { ...source[1], row: { ...source[1].row, sourceRowHash: "third-visit" } }]) {
    const changed = [...source, extra];
    assert.equal(prepareBillingCodeResolution(changed), null);
    assertStale(changed, resolution);
  }
});

test("preparation rejects empty, singleton, missing-source and identical normalized-code cases", () => {
  const source = entries();
  for (const changed of [[], source.slice(0, 1),
    source.map(e => ({ ...e, snapshotId: "" })),
    source.map(e => ({ ...e, row: { ...e.row, clientId: " " } })),
    source.map(e => ({ ...e, row: { ...e.row, clinician: " " } })),
    source.map((e, i) => ({ ...e, row: { ...e.row, billingCode: i ? " 90837 " : "90837" } })),
    source.map((e, i) => ({ ...e, row: { ...e.row, billingCode: i ? undefined : null } })),
  ]) assert.equal(prepareBillingCodeResolution(changed), null);
});

test("a shared hash with different code payloads is a conflict, not an identical re-export", () => {
  const source = entries();
  source[1].row.sourceRowHash = source[0].row.sourceRowHash;
  assert.equal(prepareBillingCodeResolution(source), null);
  const group = reconcileBillingEvidence(source, [approve()])[0];
  assert.equal(group.hashConflict, true);
  assert.equal(group.known, false);
  assert.equal(group.acceptedRows, undefined);
});

for (const [name, change] of [
  ["new source", (s: BillingCodeEntry[]) => [...s, { ...s[1], snapshotId: ids.incoming }]],
  ["removed source", (s: BillingCodeEntry[]) => s.slice(0, 1)],
  ["replaced source", (s: BillingCodeEntry[]) => s.map((e, i) => i ? { ...e, snapshotId: ids.incoming } : e)],
  ["changed code", (s: BillingCodeEntry[]) => s.map((e, i) => i ? { ...e, row: { ...e.row, billingCode: "90834" } } : e)],
  ["changed hash", (s: BillingCodeEntry[]) => s.map((e, i) => i ? { ...e, row: { ...e.row, sourceRowHash: "changed-hash" } } : e)],
  ["changed equal fees", (s: BillingCodeEntry[]) => s.map(e => ({ ...e, row: { ...e.row, totalFeeCharged: 126 } }))],
  ["changed equal kinds", (s: BillingCodeEntry[]) => s.map(e => ({ ...e, row: { ...e.row, visitKind: "cancelled" } }))],
  ["changed equal cancellation", (s: BillingCodeEntry[]) => s.map(e => ({ ...e, row: { ...e.row, cancellationSubtype: "late" } }))],
] as const) {
  test(`approval becomes stale after ${name}`, () => assertStale(change(entries()), approve()));
}

test("tampered evidence, identity and unmatched selected anchor fail closed", () => {
  const source = entries(), resolution = approve(source);
  const tampered: BillingCodeResolution[] = [
    { ...resolution, clientId: "different-client" }, { ...resolution, clinicianLabel: "Different clinician" },
    { ...resolution, serviceDate: "2026-10-13" },
    { ...resolution, evidence: resolution.evidence.slice(1) },
    { ...resolution, evidence: resolution.evidence.map((e, i) => i ? { ...e, billingCode: "90834" } : e) },
    { ...resolution, evidence: resolution.evidence.map((e, i) => i ? { ...e, totalFeeCharged: 126 } : e) },
    { ...resolution, selected: { snapshotId: ids.a, sourceRowHash: source[1].row.sourceRowHash } },
    { ...resolution, selected: { snapshotId: ids.incoming, sourceRowHash: source[1].row.sourceRowHash } },
  ];
  for (const changed of tampered) assert.equal(acceptedBillingCodeRow(source, changed), null);
  for (const changed of tampered.slice(3)) assertStale(source, changed);
});

test("schema requires explicit selection, valid audit metadata and exactly one provider identity", () => {
  const resolution = approve();
  for (const patch of [{ selected: undefined }, { id: "not-a-uuid" }, { approvalToken: "a".repeat(63) },
    { approvalToken: "g".repeat(64) }, { approvalNote: " " }, { confirmedAt: "yesterday" },
    { clinicianId: undefined }, { historicalProviderId: historicalId }]) {
    assert.equal(billingCodeResolutionSchema.safeParse({ ...resolution, ...patch }).success, false);
  }
});

test("competing approvals cannot choose a default winner", () => {
  const source = threeSources(), first = approve(source, 0), second = { ...approve(source, 1), id: historicalId };
  for (const approvals of [[first, second], [second, first], [first, first]]) {
    const group = reconcileBillingEvidence(source, approvals)[0];
    assert.equal(group.known, false);
    assert.equal(group.resolutionStale, true);
    assert.equal(group.acceptedRows, undefined);
  }
});

for (const patch of [{ clientId: "other-client" }, { clinician: "Other synthetic clinician" },
  { serviceDate: "2026-10-13" }, { totalFeeCharged: 999 }]) {
  test(`global hash collision cannot hide behind code approval: ${Object.keys(patch)[0]}`, () => {
    const source = threeSources(), resolution = approve(source);
    const collision = { snapshotId: "billing-00000074", row: { ...source[1].row, ...patch } };
    const baseline = reconcileBillingEvidence([...source, collision]);
    assert.ok(baseline.filter(g => g.rows.some(r => r.sourceRowHash === collision.row.sourceRowHash))
      .every(g => !g.known), "without approval, conflicting hashes already fail closed");
    const groups = reconcileBillingEvidence([...source, collision], [resolution]);
    const approvedGroup = groups.find(g => g.rows.includes(source[0].row))!;
    assert.equal(approvedGroup.hashConflict, true);
    assert.equal(approvedGroup.known, false);
    assert.equal(approvedGroup.acceptedRows, undefined);
    const colliding = groups.filter(g => g.rows.some(r => r.sourceRowHash === collision.row.sourceRowHash));
    assert.ok(colliding.every(g => !g.known),
      `every row with a conflicting hash must remain unverified: ${JSON.stringify(colliding.map(g => ({
        clientId: g.row.clientId, clinician: g.row.clinician, serviceDate: g.row.serviceDate,
        known: g.known, hashConflict: g.hashConflict,
      })))}`);
  });
}

function mappingFixture() {
  const roster = [{ id: 71, label: "Synthetic Code Clinician", goalId: 7 }];
  const declarations: ImportDeclarations = { version: 1, mappings: [{ sourceLabel: roster[0].label,
    clinicianLabel: roster[0].label, clinicianId: 71, teamId: 7 }], sourceSets: [] };
  return { roster, declarations };
}

test("binding validates the exact active identity and marks stale mapping choices unusable", () => {
  const source = entries(), resolution = approve(source), f = mappingFixture();
  assert.equal(bindBillingResolutions([resolution], f.roster, f.declarations)[0].mappingInvalid, undefined);
  for (const change of [
    (f: ReturnType<typeof mappingFixture>) => { f.roster = []; },
    (f: ReturnType<typeof mappingFixture>) => { f.roster[0].label = "Renamed"; },
    (f: ReturnType<typeof mappingFixture>) => { f.roster[0].goalId = 8; },
    (f: ReturnType<typeof mappingFixture>) => { f.declarations.mappings = []; },
    (f: ReturnType<typeof mappingFixture>) => { f.declarations.mappings.push({ ...f.declarations.mappings[0] }); },
    (f: ReturnType<typeof mappingFixture>) => { f.declarations.mappings[0].clinicianId = 72; },
  ]) {
    const changed = mappingFixture(); change(changed);
    const bound = bindBillingResolutions([resolution], changed.roster, changed.declarations);
    assert.equal(bound[0].mappingInvalid, true);
    const group = reconcileBillingEvidence(source, bound)[0];
    assert.equal(group.known, false);
    assert.equal(group.resolutionStale, true);
    assert.equal(group.acceptedRows, undefined);
  }
});

test("historical billing identity must match the confirmed registry and cannot collide with staff", () => {
  const source = entries(), { clinicianId: _clinicianId, ...rest } = approve(source);
  const resolution = billingCodeResolutionSchema.parse({ ...rest, historicalProviderId: historicalId });
  const declarations: ImportDeclarations = { version: 1, mappings: [], sourceSets: [], historicalBillingProviders: [{
    id: historicalId, sourceLabel: resolution.clinicianLabel,
    sourceSets: [{ snapshotIds: [ids.a, ids.b], start: "2026-10-08", end: "2026-10-21", complete: true }],
  }] };
  const valid = bindBillingResolutions([resolution], [], declarations);
  assert.equal(valid[0].mappingInvalid, undefined);
  assert.equal(reconcileBillingEvidence(source, valid)[0].known, true);
  for (const bound of [bindBillingResolutions([resolution], [], { ...declarations, historicalBillingProviders: [] }),
    bindBillingResolutions([resolution], [{ id: 71, label: resolution.clinicianLabel, goalId: 7 }], declarations)]) {
    assert.equal(bound[0].mappingInvalid, true);
    assert.equal(reconcileBillingEvidence(source, bound)[0].known, false);
  }
});

function plannerFixture(): NextReportPeriodInput {
  const source = threeSources(), { roster, declarations } = mappingFixture();
  const make = (id: string, kind: StructuralSnapshot["kind"], rows: StructuralSnapshot["rows"], incoming = false): StructuralSnapshot => ({
    id, kind, sourceHash: `synthetic-source-${id}`, importedAt: incoming ? "2026-10-22T08:00:00Z" : "2026-10-12T08:00:00Z",
    coverageStart: incoming ? "2026-10-08" : "2026-09-10", coverageEnd: incoming ? "2026-10-21" : "2026-10-12", rows,
  });
  declarations.sourceSets = [
    { kind: "attendance", snapshotIds: [ids.oldAttendance], clinicianIds: [71], start: "2026-09-10", end: "2026-10-12", complete: true },
    { kind: "billing", snapshotIds: [ids.a, ids.b], clinicianIds: [71], start: "2026-09-10", end: "2026-10-12", complete: true },
  ];
  return { snapshots: [make(ids.oldAttendance, "attendance", [{ ...row(), status: "show" }]),
    make(ids.attendance, "attendance", [{ ...row(), status: "show" }], true),
    ...source.map((e, i) => make(e.snapshotId, "billing", [e.row], i === 2))],
  storedDeclarations: { revision: 1, data: declarations, confirmedAt: "2026-10-13T00:00:00Z" },
  roster, teamId: 7, newSourceIds: [ids.attendance, ids.incoming], today: "2026-10-22" };
}

test("planner requires owner choice for A=90837, B=incoming=0, then advances without mutating sources", () => {
  const input = plannerFixture(), before = structuredClone(input);
  const blocked = planNextReportPeriod(input);
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.reasons.join(" "), /billing overlapping/);
  for (const selectedIndex of [1, 2]) {
    const approved = { ...input, billingResolutions: [approve(threeSources(), selectedIndex)] };
    freeze(approved);
    const plan = planNextReportPeriod(approved);
    assert.equal(plan.status, "ready", plan.reasons.join(" "));
    assert.deepEqual(plan.period, { start: "2026-10-08", end: "2026-10-21", payDate: "2026-10-22" });
    assert.deepEqual(plan.data!.sourceSets.slice(0, 2), input.storedDeclarations!.data.sourceSets);
    assert.deepEqual(plan.data!.sourceSets.at(-1)!.snapshotIds, [ids.a, ids.b, ids.incoming]);
    assert.equal("billingResolutions" in plan.data!, false);
  }
  assert.deepEqual(input, before);
});

test("planner keeps changed fees, raw kinds, cancellation and source multiplicity blocked after choice", () => {
  for (const patch of [{ totalFeeCharged: 126 }, { visitKind: "cancelled" }, { cancellationSubtype: "late" }]) {
    const input = plannerFixture();
    const changed = { ...input, billingResolutions: [approve(threeSources())], snapshots: input.snapshots.map(s =>
      s.id === ids.incoming ? { ...s, rows: s.rows.map(r => ({ ...r, ...patch })) } : s) };
    const plan = planNextReportPeriod(changed);
    assert.equal(plan.status, "blocked");
    assert.equal(plan.data, undefined);
    assert.match(plan.reasons.join(" "), /Billing evidence requires reconciliation/);
  }
  const input = plannerFixture();
  const multiple = { ...input, billingResolutions: [approve(threeSources())], snapshots: input.snapshots.map(s =>
    s.id === ids.incoming ? { ...s, rows: [...s.rows, { ...s.rows[0], sourceRowHash: "extra-same-day" }] } : s) };
  assert.equal(planNextReportPeriod(multiple).status, "blocked");
  const invalidIdentity = { ...input, billingResolutions: [{ ...approve(threeSources()), clinicianId: 72 }] };
  assert.equal(planNextReportPeriod(invalidIdentity).status, "blocked");
});

function financialFixture(selectedIndex = 0, alternateCode = "90834") {
  const source = threeSources().map((entry, i) => ({ ...entry,
    row: { ...entry.row, visitKind: null, billingCode: i ? alternateCode : "90837" },
  }));
  const resolution = approve(source, selectedIndex);
  const { roster, declarations } = mappingFixture();
  const context: Context = {
    clinicians: [{ id: 71, label: roster[0].label, goalId: 7, classification: "1099", sessionRate: 100,
      sessionsPerWeek: 7, weeksWorkedPerYear: 52, capEnabled: false, capAmount: 0,
      preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 60, postCapPracticeSplit: 40,
      w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }],
    staff: [], sessions: [],
    billingChargeResolutions: bindBillingResolutions([resolution], roster, declarations),
    importedBillingActuals: source.map(({ row, snapshotId }) => ({ clinicianId: 71,
      clientId: row.clientId, serviceDate: row.serviceDate, totalFeeCharged: row.totalFeeCharged,
      sourceRowHash: row.sourceRowHash, billingCode: row.billingCode,
      sourceSnapshotId: snapshotId, replacementSessionCount: 1 })),
  };
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { teamId: 7, horizonMonths: 1, defaultInPersonPct: 0 });
  const options = { baselineWeeklyByClinician: { 71: 7 }, workingForecast: true,
    useImportedBillingActuals: true, workingRange: { start: "2026-10-12", end: "2026-10-12" } };
  return { context, workspace, options };
}

for (const selectedIndex of [0, 1, 2]) {
  test(`financial engine keeps one canonical fee and split pay for recognized alternative ${selectedIndex}`, () => {
    const f = financialFixture(selectedIndex), before = structuredClone(f);
    freeze(f);
    const summary = summarizeImportedBillingActuals(f.context, new Set([71]));
    assert.equal(summary.billed.get(71)?.get("2026-10-12"), 125);
    assert.deepEqual(summary.unknownDates, []);
    assert.equal(summary.replacementSessions.get(71)?.get("2026-10-12"), 1);
    assert.equal(summary.requiresProof.has("71|2026-10-12"), true);
    const month = forecast(f.workspace, f.context, [], 1, false, f.options)[0];
    assert.equal(month.values.sessions, 1);
    assert.equal(month.values.revenue, 125);
    assert.equal(month.values.clinicianPay, 75);
    assert.equal(month.clinicians["71"].revenue, 125);
    assert.equal(month.clinicians["71"].clinicianPay, 75);
    assert.deepEqual(f, before);
  });
}

test("financial engine accepts one 90837 fee when the other two shared-hash codes are explicit zero", () => {
  const { context } = financialFixture(0, "0");
  const summary = summarizeImportedBillingActuals(context, new Set([71]));
  assert.equal(summary.billed.get(71)?.get("2026-10-12"), 125);
  assert.deepEqual(summary.unknownDates, []);
  const selectedZero = financialFixture(1, "0");
  const unclassified = summarizeImportedBillingActuals(selectedZero.context, new Set([71]));
  assert.equal(unclassified.billed.get(71), undefined);
  assert.ok(unclassified.unknownDates.some(r => r.reason?.includes("Unclassified")),
    "code approval must not silently classify explicit zero as a recognized treatment");
});

for (const omittedIndex of [0, 1, 2]) {
  test(`financial engine leaves billing and split pay unknown when anchor ${omittedIndex} is omitted`, () => {
    const f = financialFixture(1);
    f.context.importedBillingActuals = f.context.importedBillingActuals!.filter((_, i) => i !== omittedIndex);
    const summary = summarizeImportedBillingActuals(f.context, new Set([71]));
    assert.equal(summary.billed.get(71), undefined);
    assert.equal(summary.replacementSessions.get(71), undefined);
    assert.ok(summary.unknownDates.some(r => r.clinicianId === 71 && r.date === "2026-10-12"));
    const month = forecast(f.workspace, f.context, [], 1, false, f.options)[0];
    assert.equal(month.values.revenue, null);
    assert.equal(month.values.clinicianPay, null);
    assert.equal(month.values.profit, null);
    assert.equal(month.clinicians["71"].revenue, null);
    assert.equal(month.clinicians["71"].clinicianPay, null);
  });
}

test("financial engine propagates global hash conflicts to every affected clinician-date", () => {
  const f = financialFixture(1);
  f.context.importedBillingActuals!.push({ ...f.context.importedBillingActuals![1], clientId: "other-financial-client" });
  const summary = summarizeImportedBillingActuals(f.context, new Set([71]));
  assert.equal(summary.billed.get(71), undefined);
  assert.ok(summary.unknownDates.length > 0);
  const month = forecast(f.workspace, f.context, [], 1, false, f.options)[0];
  assert.equal(month.values.revenue, null);
  assert.equal(month.values.clinicianPay, null);
});

test("a pre-collapsed selected actual cannot self-certify the missing approval anchors", () => {
  const f = financialFixture(1);
  f.context.importedBillingActuals = [f.context.importedBillingActuals![1]];
  const summary = summarizeImportedBillingActuals(f.context, new Set([71]));
  assert.equal(summary.billed.get(71), undefined);
  assert.equal(summary.unknownDates.length, 1);
  const month = forecast(f.workspace, f.context, [], 1, false, f.options)[0];
  assert.equal(month.values.revenue, null);
  assert.equal(month.values.clinicianPay, null);
});
