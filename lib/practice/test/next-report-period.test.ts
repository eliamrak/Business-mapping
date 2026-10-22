import test from "node:test";
import assert from "node:assert/strict";
import { planNextReportPeriod, type StructuralReportRow, type StructuralSnapshot } from "../src/hub/next-report-period.ts";
import type { ImportDeclarations } from "../src/hub/import-declarations.ts";
import { prepareBillingChargeResolution } from "../src/hub/billing-evidence.ts";
import { billingChargeResolutionSchema, type BillingChargeResolution } from "../src/hub/billing-resolution.ts";

const ids = { oldAttendance: "attendance-00000001", oldBilling: "billing-00000001", attendance: "attendance-00000002", billing: "billing-00000002" };
const row = (clientId: string, serviceDate: string, sourceRowHash = clientId): StructuralReportRow => ({
  clientId, serviceDate, clinician: "Dr Lane", sourceRowHash, status: "show", location: "Room A", billingCode: "90837", totalFeeCharged: 100,
});
function fixture() {
  const carry = Array.from({ length: 25 }, (_, i) => row(`boundary-${i}`, "2026-10-07", `old-${i}`));
  const snapshots: StructuralSnapshot[] = [
    { id: ids.oldAttendance, kind: "attendance", sourceHash: "old-attendance", coverageStart: "2026-09-10", coverageEnd: "2026-10-12", rows: [...carry, row("overlap", "2026-10-12")] },
    { id: ids.oldBilling, kind: "billing", sourceHash: "old-billing", coverageStart: "2026-09-10", coverageEnd: "2026-10-12", rows: [row("billing-boundary", "2026-10-07"), row("overlap", "2026-10-12")] },
    { id: ids.attendance, kind: "attendance", sourceHash: "new-attendance", coverageStart: "2026-10-07", coverageEnd: "2026-10-21", rows: [...carry.map((r, i) => ({ ...r, sourceRowHash: `new-index-${i}` })), row("overlap", "2026-10-12", "new-overlap"), row("new", "2026-10-20")] },
    { id: ids.billing, kind: "billing", sourceHash: "new-billing", coverageStart: "2026-10-08", coverageEnd: "2026-10-21", rows: [row("overlap", "2026-10-12", "new-billing-overlap"), row("new", "2026-10-20")] },
  ];
  for (let i = 0; i < snapshots.length; i++) snapshots[i] = { ...snapshots[i], importedAt: i < 2 ? "2026-10-12T23:00:00Z" : "2026-10-22T09:00:00Z" };
  const data: ImportDeclarations = { version: 1, mappings: [{ sourceLabel: "Dr Lane", clinicianId: 1, clinicianLabel: "Dr Lane", teamId: 1 }],
    sourceSets: (["attendance", "billing"] as const).map((kind) => ({ kind, snapshotIds: [kind === "attendance" ? ids.oldAttendance : ids.oldBilling], clinicianIds: [1], start: "2026-09-10", end: "2026-10-12", complete: true })) };
  return { snapshots, storedDeclarations: { revision: 1, data, confirmedAt: "2026-10-13T00:00:00Z" },
    roster: [{ id: 1, label: "Dr Lane", goalId: 1 }], teamId: 1, newSourceIds: [ids.attendance, ids.billing], today: "2026-10-22" };
}
function changeRows(f: ReturnType<typeof fixture>, index: number, change: (rows: StructuralReportRow[]) => StructuralReportRow[]) {
  f.snapshots[index] = { ...f.snapshots[index], rows: change([...f.snapshots[index].rows]) };
}
function blocked(f: ReturnType<typeof fixture>, reason: RegExp) {
  const plan = planNextReportPeriod(f);
  assert.equal(plan.status, "blocked", JSON.stringify(plan));
  assert.equal(plan.data, undefined);
  assert.match(plan.reasons.join(" "), reason);
  return plan;
}

test("Oct 12 frozen sets imply Oct 7 fully ended, then Oct 8-21 with Oct 22 payday", () => {
  const f = fixture(), plan = planNextReportPeriod(f);
  assert.equal(plan.status, "ready", plan.reasons.join(" "));
  assert.deepEqual(plan.period, { start: "2026-10-08", end: "2026-10-21", payDate: "2026-10-22" });
  assert.deepEqual(plan.carryover, { rows: 25, matched: 25, conflicts: 0 });
  assert.deepEqual(plan.data!.sourceSets.slice(0, 2), f.storedDeclarations.data.sourceSets);
  assert.deepEqual(plan.data!.mappings, f.storedDeclarations.data.mappings);
  assert.deepEqual(plan.data!.sourceSets.slice(2).map((set) => [set.start, set.end, set.snapshotIds]), [
    ["2026-09-10", "2026-10-21", [ids.oldAttendance, ids.attendance]],
    ["2026-09-10", "2026-10-21", [ids.oldBilling, ids.billing]],
  ]);
});

test("25 occupied Oct 7 rows cannot manufacture prior period proof", () => {
  const f = fixture();
  f.storedDeclarations.data.sourceSets = [];
  blocked(f, /previously confirmed provider scope/);
  const partial = fixture();
  for (const set of partial.storedDeclarations.data.sourceSets) set.start = "2026-10-07";
  blocked(partial, /No shared fully ended canonical period/);
});

test("period does not follow raw min/max, snapshot order or upload metadata", () => {
  const f = fixture();
  f.snapshots.reverse();
  assert.equal(planNextReportPeriod(f).period?.start, "2026-10-08");
  // The incoming export is sparse, with no occupied last service day.
  assert.ok(f.snapshots.every((source) => source.rows.every((r) => r.serviceDate !== "2026-10-21")));
  assert.equal(planNextReportPeriod(f).status, "ready");
});

test("carryover matching ignores source and index hashes but preserves exact multiplicity", () => {
  const f = fixture();
  changeRows(f, 0, (rows) => [...rows, { ...rows[0], sourceRowHash: "second-old-visit" }]);
  changeRows(f, 2, (rows) => [...rows, { ...rows[0], sourceRowHash: "second-new-visit" }]);
  const plan = planNextReportPeriod(f);
  assert.equal(plan.status, "ready", plan.reasons.join(" "));
  assert.deepEqual(plan.carryover, { rows: 26, matched: 26, conflicts: 0 });
  changeRows(f, 2, (rows) => [...rows, { ...rows[0], sourceRowHash: "third-visit" }]);
  assert.equal(blocked(f, /carryover.*changed facts or multiplicity/).carryover.conflicts, 3);
});

test("changed status, location, code and novel carryovers block with specific reasons", () => {
  for (const patch of [{ status: "cancelled" }, { location: "Room B" }, { billingCode: "90834" }, { clientId: "novel" }]) {
    const f = fixture();
    changeRows(f, 2, (rows) => rows.map((r, i) => i === 0 ? { ...r, ...patch } : r));
    const plan = blocked(f, /attendance carryover 2026-10-07: changed facts|novel facts/);
    assert.equal(plan.carryover.conflicts, 1);
  }
});

test("billing carryovers compare canonical fees and require admitted complete history", () => {
  const f = fixture();
  f.snapshots[3] = { ...f.snapshots[3], coverageStart: "2026-10-07", rows: [...f.snapshots[3].rows, row("billing-boundary", "2026-10-07", "different-index")] };
  assert.equal(planNextReportPeriod(f).status, "ready");
  changeRows(f, 3, (rows) => rows.map((r) => r.serviceDate === "2026-10-07" ? { ...r, totalFeeCharged: 101 } : r));
  blocked(f, /billing carryover.*changed facts/);
  const unadmitted = fixture();
  changeRows(unadmitted, 2, (rows) => rows.map((r, i) => i === 0 ? { ...r, serviceDate: "2026-09-09" } : r));
  unadmitted.snapshots[2] = { ...unadmitted.snapshots[2], coverageStart: "2026-09-09" };
  blocked(unadmitted, /novel facts without previously admitted complete source evidence/);
});

test("conflicting admitted sources cannot choose an arbitrary carryover winner", () => {
  const f = fixture();
  const id = "attendance-00000003";
  f.snapshots.push({ ...f.snapshots[0], id, sourceHash: "conflicting-old", rows: f.snapshots[0].rows.map((r, i) => i === 0 ? { ...r, status: "no show" } : r) });
  f.storedDeclarations.data.sourceSets[0].snapshotIds.push(id);
  blocked(f, /carryover.*changed facts/);
});

test("next-period overlap detects changed attendance status, billing fee and multiplicity", () => {
  for (const [index, patch] of [[2, { status: "cancelled" }], [3, { totalFeeCharged: 99 }]] as const) {
    const f = fixture();
    changeRows(f, index, (rows) => rows.map((r) => r.clientId === "overlap" ? { ...r, ...patch } : r));
    blocked(f, /overlapping facts\/status\/fees or multiplicity conflict/);
  }
  const f = fixture();
  changeRows(f, 2, (rows) => [...rows, { ...rows.find((r) => r.clientId === "overlap")!, sourceRowHash: "extra" }]);
  blocked(f, /multiplicity conflict/);
  const withinSource = fixture();
  changeRows(withinSource, 2, (rows) => [...rows, { ...rows.find((r) => r.clientId === "new")!, sourceRowHash: "conflicting-status", status: "cancelled" }]);
  blocked(withinSource, /Attendance facts within source.*ambiguous statuses/);
});

test("billing reconciler blocks ambiguous repeated charges and hash collisions", () => {
  const f = fixture();
  changeRows(f, 3, (rows) => [...rows, { ...rows[1], sourceRowHash: "second-charge" }]);
  blocked(f, /Billing evidence requires reconciliation/);
  const collision = fixture();
  changeRows(collision, 3, (rows) => rows.map((r) => ({ ...r, sourceRowHash: "collision" })));
  blocked(collision, /Billing evidence requires reconciliation/);
});

test("missing members, invalid dates and all-member containment revalidate old proof", () => {
  const missing = fixture(); missing.snapshots.shift(); blocked(missing, /missing member/);
  for (const serviceDate of ["2026-09-09", "2026-10-13", "2026-02-30"]) {
    const f = fixture();
    changeRows(f, 0, (rows) => [...rows, row("outside", serviceDate)]);
    blocked(f, /outside its confirmed bounds/);
  }
  const duplicate = fixture(); duplicate.snapshots.push(duplicate.snapshots[0]); blocked(duplicate, /Duplicate snapshot identity/);
});

test("stale, moved, renamed, absent and different-team mappings cannot advance", () => {
  const edits = [
    (f: ReturnType<typeof fixture>) => { f.roster[0].goalId = 2; },
    (f: ReturnType<typeof fixture>) => { f.roster[0].label = "Renamed"; },
    (f: ReturnType<typeof fixture>) => { f.roster = []; },
    (f: ReturnType<typeof fixture>) => { f.teamId = 2; },
    (f: ReturnType<typeof fixture>) => { f.storedDeclarations.data.mappings = []; },
  ];
  for (const edit of edits) { const f = fixture(); edit(f); blocked(f, /mapping|mapped source evidence/); }
});

test("common frozen provider scope permits sparse next reports without inventing a new provider", () => {
  const f = fixture();
  f.roster.push({ id: 2, label: "Dr Quiet", goalId: 1 });
  f.storedDeclarations.data.mappings.push({ sourceLabel: "Dr Quiet", clinicianId: 2, clinicianLabel: "Dr Quiet", teamId: 1 });
  for (const set of f.storedDeclarations.data.sourceSets) set.clinicianIds.push(2);
  for (const i of [0, 1]) changeRows(f, i, (rows) => [...rows, { ...row("quiet", "2026-09-24"), clinician: "Dr Quiet" }]);
  const plan = planNextReportPeriod(f);
  assert.equal(plan.status, "ready", plan.reasons.join(" "));
  assert.deepEqual(plan.data!.sourceSets.at(-1)!.clinicianIds, [1, 2]);
  f.storedDeclarations.data.sourceSets[1].clinicianIds = [1];
  blocked(f, /out-of-scope provider|common previously confirmed provider scope/);
});

test("gapped history cannot become a new combined complete range", () => {
  const f = fixture();
  for (const kind of ["attendance", "billing"] as const) {
    const id = `${kind}-00000004`;
    f.snapshots.push({ id, kind, sourceHash: id, coverageStart: "2026-08-01", coverageEnd: "2026-08-02", rows: [row("earlier", "2026-08-01")] });
    f.storedDeclarations.data.sourceSets.push({ kind, snapshotIds: [id], clinicianIds: [1], start: "2026-08-01", end: "2026-08-02", complete: true });
  }
  blocked(f, /coverage gap/);
});

test("unfinished period and future out-of-period billing cannot be declared complete", () => {
  const f = fixture(); f.today = "2026-10-14"; blocked(f, /has not ended/);
  const future = fixture();
  future.snapshots[3] = { ...future.snapshots[3], coverageEnd: "2026-10-22", rows: [...future.snapshots[3].rows, row("future", "2026-10-22")] };
  blocked(future, /future\/out-of-period facts/);
  const advancedOld = fixture();
  advancedOld.snapshots[0] = { ...advancedOld.snapshots[0], coverageEnd: "2026-11-04", rows: [...advancedOld.snapshots[0].rows, row("advanced", "2026-11-04")] };
  advancedOld.storedDeclarations.data.sourceSets[0].end = "2026-11-04";
  advancedOld.today = "2026-11-05";
  blocked(advancedOld, /cannot contain all frozen and selected member rows/);
});

test("a stale saved package cannot extend the calendar using occupied old rows", () => {
  const f = fixture();
  f.snapshots[2] = { ...f.snapshots[2], coverageEnd: "2026-10-07", rows: f.snapshots[2].rows.filter((r) => r.serviceDate === "2026-10-07") };
  blocked(f, /coverage does not intersect the next period/);
});

test("contractor Sep 24 payday remains the day after Sep 10-23 canonical service", () => {
  const f = fixture();
  for (const i of [0, 1]) {
    f.snapshots[i] = { ...f.snapshots[i], coverageEnd: "2026-09-23", rows: [row("previous", "2026-09-23")] };
    f.storedDeclarations.data.sourceSets[i].end = "2026-09-23";
  }
  for (const i of [2, 3]) f.snapshots[i] = { ...f.snapshots[i], coverageStart: "2026-09-24", coverageEnd: "2026-10-07", rows: [row("next", "2026-10-06")] };
  f.today = "2026-10-08";
  const plan = planNextReportPeriod(f);
  assert.equal(plan.status, "ready", plan.reasons.join(" "));
  assert.deepEqual(plan.period, { start: "2026-09-24", end: "2026-10-07", payDate: "2026-10-08" });
});

test("invalid calendar and absent confirmation produce blocked results without throwing", () => {
  const f = fixture(); f.today = "2026-02-30"; blocked(f, /valid calendar today/);
  assert.equal(planNextReportPeriod({ ...fixture(), storedDeclarations: null }).status, "blocked");
});

test("only the exact saved pair is selected; unchecked older sources remain excluded", () => {
  const f = fixture();
  f.snapshots.push({ ...f.snapshots[2], id: "attendance-00000005", sourceHash: "excluded", rows: [row("unchecked", "2026-12-31")] });
  const plan = planNextReportPeriod(f);
  assert.equal(plan.status, "ready", plan.reasons.join(" "));
  assert.ok(plan.data!.sourceSets.every((set) => !set.snapshotIds.includes("attendance-00000005")));
  for (const selected of [[], [ids.attendance], [ids.attendance, ids.attendance], [ids.attendance, "billing-ffffffff"], [ids.attendance, ids.billing, ids.oldBilling]]) {
    f.newSourceIds = selected; blocked(f, /exact saved next-period source pair|missing|exactly one billing/);
  }
});

test("an already included package is up-to-date and returns no proposal", () => {
  const f = fixture(), first = planNextReportPeriod(f);
  f.storedDeclarations = { ...f.storedDeclarations, revision: 2, data: first.data! };
  const again = planNextReportPeriod(f);
  assert.equal(again.status, "up-to-date");
  assert.equal(again.data, undefined);
  assert.deepEqual(again.period, first.period);
});

test("planner never mutates readonly inputs, mappings, source sets or historical registry", () => {
  const f = fixture();
  f.storedDeclarations.data.historicalBillingProviders = [];
  const before = structuredClone(f);
  function freeze(value: unknown) {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  }
  freeze(f);
  const plan = planNextReportPeriod(f);
  assert.equal(plan.status, "ready", plan.reasons.join(" "));
  plan.data!.mappings[0].clinicianLabel = "Proposal-only edit";
  assert.deepEqual(f, before);
  assert.deepEqual(plan.data!.historicalBillingProviders, []);
});

test("late versus ordinary cancellation is a changed carryover fact and reasons omit client keys", () => {
  const f = fixture();
  changeRows(f, 0, (rows) => rows.map((r, i) => i === 0 ? { ...r, status: "cancelled", cancellationSubtype: "late" } : r));
  changeRows(f, 2, (rows) => rows.map((r, i) => i === 0 ? { ...r, status: "cancelled", cancellationSubtype: "ordinary" } : r));
  const plan = blocked(f, /attendance carryover 2026-10-07: changed facts/);
  assert.equal(plan.carryover.conflicts, 1);
  for (const source of f.snapshots) for (const r of source.rows) assert.ok(!plan.reasons.some((reason) => reason.includes(r.clientId)));
});

test("next-period late-cancel subtype changes block across and within sources", () => {
  const f = fixture();
  for (const index of [0, 2]) changeRows(f, index, (rows) => rows.map((r) => r.clientId === "overlap"
    ? { ...r, status: "cancelled", cancellationSubtype: index === 0 ? "late" : "ordinary" } : r));
  blocked(f, /overlapping facts/);
  const within = fixture();
  changeRows(within, 2, (rows) => [...rows.map((r) => r.clientId === "new" ? { ...r, status: "cancelled", cancellationSubtype: "late" } : r),
    { ...row("new", "2026-10-20", "other-cancel"), status: "cancelled", cancellationSubtype: "ordinary" }]);
  blocked(within, /ambiguous statuses, locations or cancellation subtypes/);
});

function approvedFixture(amounts: readonly number[]) {
  const f = fixture();
  const charges = amounts.map((amount, i) => ({ ...row("approved-encounter", "2026-10-12", `approved-anchor-${i}`), totalFeeCharged: amount }));
  changeRows(f, 1, (rows) => [...rows.filter((r) => r.clientId !== "overlap"), ...charges]);
  changeRows(f, 3, (rows) => [...rows.filter((r) => r.clientId !== "overlap"), ...charges.map((r, i) => ({ ...r, sourceRowHash: `shifted-charge-${i}` }))]);
  const draft = prepareBillingChargeResolution(charges.map((r) => ({ row: { ...r, totalFeeCharged: r.totalFeeCharged! }, snapshotId: ids.oldBilling })));
  assert.ok(draft);
  const approval = billingChargeResolutionSchema.parse({ ...draft, clinicianId: 1, id: "00000000-0000-4000-8000-000000000001", approvalToken: "a".repeat(64),
    confirmedAt: "2026-10-16T00:00:00Z", approvalNote: "Synthetic approved two-charge encounter" });
  return { ...f, billingResolutions: [approval] as readonly BillingChargeResolution[] };
}

test("approved two-charge evidence keeps labels, original anchors and the journal unchanged", () => {
  for (const amounts of [[135, 150], [175, 175], [150, 150], [100, 125], [200, 200]]) {
    const f = approvedFixture(amounts), before = structuredClone(f);
    const plan = planNextReportPeriod(f);
    assert.equal(plan.status, "ready", plan.reasons.join(" "));
    assert.deepEqual(f, before);
    assert.ok(!("billingResolutions" in plan.data!));
    assert.equal(planNextReportPeriod({ ...f, billingResolutions: [] }).status, "blocked");
  }
});

test("a valid approval can cover a partial re-export but cannot forgive changed clinical facts", () => {
  const f = approvedFixture([135, 150]);
  changeRows(f, 3, (rows) => rows.filter((r) => r.sourceRowHash !== "shifted-charge-1"));
  assert.equal(planNextReportPeriod(f).status, "ready");
  changeRows(f, 3, (rows) => rows.map((r) => r.clientId === "approved-encounter" ? { ...r, cancellationSubtype: "late" } : r));
  assert.equal(planNextReportPeriod(f).status, "blocked");
});

test("approvals never cover extra charges, stale mappings or multiple competing approvals", () => {
  const f = approvedFixture([175, 175]);
  changeRows(f, 3, (rows) => [...rows, { ...rows.find((r) => r.clientId === "approved-encounter")!, sourceRowHash: "unapproved-third" }]);
  assert.equal(planNextReportPeriod(f).status, "blocked");
  const moved = approvedFixture([135, 150]); moved.roster[0].goalId = 2;
  assert.equal(planNextReportPeriod(moved).status, "blocked");
  const competing = approvedFixture([135, 150]);
  competing.billingResolutions = [...competing.billingResolutions, { ...competing.billingResolutions[0], id: "00000000-0000-4000-8000-000000000002" }];
  assert.equal(planNextReportPeriod(competing).status, "blocked");
});

test("selected sources present before or at the latest confirmation cannot auto-enable an old exclusion", () => {
  for (const index of [2, 3]) for (const importedAt of ["2026-10-12T23:59:59Z", "2026-10-13T00:00:00Z", "2026-10-12T20:00:00-04:00"]) {
    const f = fixture();
    f.snapshots[index] = { ...f.snapshots[index], importedAt };
    const before = structuredClone(f);
    blocked(f, /existing excluded or previously reviewed source.*last declaration confirmation/);
    assert.deepEqual(f, before);
  }
});

test("new Oct 22 imports after Oct 13 confirmation remain ready with calendar-derived dates", () => {
  const f = fixture();
  const plan = planNextReportPeriod(f);
  assert.equal(plan.status, "ready", plan.reasons.join(" "));
  assert.deepEqual(plan.period, { start: "2026-10-08", end: "2026-10-21", payDate: "2026-10-22" });
  // A later upload timestamp cannot move the canonical period.
  for (const i of [2, 3]) f.snapshots[i] = { ...f.snapshots[i], importedAt: "2026-10-23T09:00:00Z" };
  assert.deepEqual(planNextReportPeriod(f).period, plan.period);
});

test("already included package stays up-to-date after a later declaration confirmation", () => {
  const f = fixture(), first = planNextReportPeriod(f);
  f.storedDeclarations = { revision: 2, data: first.data!, confirmedAt: "2026-10-22T10:00:00Z" };
  assert.equal(planNextReportPeriod(f).status, "up-to-date");
});

test("available but malformed provenance blocks; optional absent timestamps remain supported", () => {
  const f = fixture();
  f.snapshots[2] = { ...f.snapshots[2], importedAt: "invalid" };
  blocked(f, /provenance timestamps require review/);
  for (const i of [2, 3]) f.snapshots[i] = { ...f.snapshots[i], importedAt: undefined };
  assert.equal(planNextReportPeriod(f).status, "ready");
});
