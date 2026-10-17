import test from "node:test";
import assert from "node:assert/strict";
import {
  allocationSchema, budgetSchema, categorySchema, clinicianSettingSchema,
  emptyWorkspace, eventSchema, forecast, prepareBillingChargeResolution, termSchema,
  type Context, type ImportEvidenceDeclarations,
} from "@workspace/practice/hub";
import { practiceFinancialEstimateRange } from "./practice-financial-estimate.ts";
import { practiceFinancialRange } from "./practice-financial-range.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";
import type { BillingRow, LocalSnapshot } from "./retention-local.ts";
import { sameDayVisitKey } from "./retention-local.ts";

const near = (a: number | null | undefined, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function fixture(start = "2026-01-01", end = "2026-01-14") {
  const workspace = emptyWorkspace(start);
  const context: Context = { clinicians: [{ id: 1, label: "Synthetic", goalId: null, classification: "1099", sessionRate: 100,
    sessionsPerWeek: 700, weeksWorkedPerYear: 52.1786, capEnabled: false, capAmount: 0,
    preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 80, postCapPracticeSplit: 20,
    w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
  const row: BillingRow = { clientId: "Synthetic client", clinician: "Synthetic", serviceDate: start, billingCode: "90837", totalFeeCharged: 50, sourceRowHash: "discount" };
  const billing: Extract<LocalSnapshot, { kind: "billing" }> = { id: "billing", kind: "billing", importedAt: end + "T00:00:00Z", coverageStart: start, coverageEnd: end, reportCoverage: { start, end, complete: true }, sourceHash: "billing-source", rows: [row] };
  const attendance: Extract<LocalSnapshot, { kind: "attendance" }> = { ...billing, id: "attendance", kind: "attendance", sourceHash: "attendance-source", rows: [{ clientId: row.clientId, clinician: row.clinician, serviceDate: start, status: "show", location: null, billingCode: "90837", sourceRowHash: "show" }] };
  const snapshots: LocalSnapshot[] = [billing, attendance];
  const declarations: ImportEvidenceDeclarations = { version: 1, mappings: [], sourceSets: [] };
  return { workspace, context, snapshots, billing, attendance, declarations, range: { start, end }, asOf: end };
}
const estimate = (f: ReturnType<typeof fixture>) => practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations);

test("discounted billed gross drives split pay without finalized financial periods or card-rate fill", () => {
  const f = fixture();
  const before = structuredClone(f);
  const result = estimate(f);
  assert.equal(result.source, "historical-estimate");
  assert.equal(result.status, "available");
  assert.equal(result.billingCoverageComplete, true);
  assert.equal(result.modelComplete, true);
  near(result.values.revenue, 50); near(result.values.clinicianPay, 30); near(result.values.profit, 20);
  near(result.values.sessions, 1);
  assert.equal(result.values.collections, null); assert.equal(result.values.cash, null); assert.equal(result.values.paidPayroll, null);
  const actual = practiceFinancialRange(f.workspace, f.context, f.snapshots, f.asOf, f.range);
  assert.equal(actual.actual.complete, false); assert.equal(actual.actual.values.profit, null);
  assert.deepEqual(f, before);
  assert.deepEqual(estimate(f), result);
});

test("duplicate snapshots are idempotent; globally conflicting excluded evidence stays unknown", () => {
  const f = fixture();
  const first = estimate(f);
  f.snapshots.push({ ...structuredClone(f.billing), id: "copy" });
  assert.deepEqual(estimate(f), first);
  f.snapshots.push({ ...structuredClone(f.billing), id: "excluded-conflict", reportCoverage: undefined, rows: [{ ...f.billing.rows[0], totalFeeCharged: 75 }] });
  const conflict = estimate(f);
  assert.equal(conflict.billingCoverageComplete, false);
  assert.equal(conflict.values.revenue, null); assert.equal(conflict.values.clinicianPay, null);
  assert.equal(conflict.values.profit, null); assert.equal(conflict.status, "partial");
});

test("declared historical billing-only providers are outside current-team scope; unresolved identities still withhold without mutation", () => {
  const f = fixture();
  f.billing.id = "billing-11112222";
  f.declarations.historicalBillingProviders = [];
  for (let index = 0; index < 3; index++) {
    const sourceLabel = `Synthetic former ${index}`;
    f.billing.rows.push({ ...f.billing.rows[0], clinician: sourceLabel, clientId: `Former client ${index}`, totalFeeCharged: 500, sourceRowHash: `former-charge-${index}` });
    f.declarations.historicalBillingProviders.push({ id: crypto.randomUUID(), sourceLabel,
      sourceSets: [{ snapshotIds: [f.billing.id], ...f.range, complete: true }] });
  }
  const before = structuredClone(f);
  const scoped = estimate(f);
  assert.equal(scoped.status, "available");
  assert.equal(scoped.billingCoverageComplete, true); assert.equal(scoped.modelComplete, true);
  near(scoped.values.revenue, 50); near(scoped.values.clinicianPay, 30); near(scoped.values.profit, 20);
  assert.ok(scoped.assumptions.some(assumption => /historical billing-only providers.*excluded/.test(assumption)));
  assert.deepEqual(f, before);

  f.billing.rows[1].clinician = "Truly unknown synthetic provider";
  const unknownBefore = structuredClone(f);
  const unknown = estimate(f);
  assert.equal(unknown.billingCoverageComplete, false); assert.equal(unknown.modelComplete, false);
  assert.equal(unknown.values.revenue, null); assert.equal(unknown.values.profit, null);
  assert.match(unknown.unavailableReasons.join(" "), /provider identity is unresolved/);
  assert.deepEqual(f, unknownBefore);

  f.billing.rows[1].clinician = before.billing.rows[1].clinician;
  f.billing.rows[1].sourceRowHash = f.billing.rows[0].sourceRowHash;
  const conflictBefore = structuredClone(f);
  assert.equal(estimate(f).values.revenue, null, "historical scope exclusion cannot hide a global hash conflict with selected-team evidence");
  assert.deepEqual(f, conflictBefore);
});

test("five pinned billing approvals preserve two charge slots each without doubling attended visits", () => {
  const f = fixture();
  f.billing.rows = [];
  f.attendance.rows = [];
  f.declarations.mappings = [{ sourceLabel: "Synthetic", clinicianId: 1, clinicianLabel: "Synthetic", teamId: null }];
  const approvals: NonNullable<ImportEvidenceDeclarations["billingResolutions"]>[number][] = [];
  f.declarations.billingResolutions = approvals;
  for (let index = 0; index < 5; index++) {
    const clientId = `Synthetic approved ${index}`;
    const rows = [20, 30].map((totalFeeCharged, slot) => ({ ...fixture().billing.rows[0], clientId, totalFeeCharged, sourceRowHash: `approved-${index}-${slot}` }));
    f.billing.rows.push(...rows);
    const draft = prepareBillingChargeResolution(rows.map(row => ({ row, snapshotId: f.billing.id })))!;
    approvals.push({ ...draft, id: crypto.randomUUID(), clinicianId: 1, approvalToken: "a".repeat(64), confirmedAt: "2026-01-15T00:00:00Z", approvalNote: "Synthetic only" });
    f.attendance.rows.push({ ...fixture().attendance.rows[0], clientId, sourceRowHash: `approved-show-${index}` });
  }
  const before = structuredClone(f);
  const result = estimate(f);
  near(result.values.revenue, 250); near(result.values.clinicianPay, 150); near(result.values.sessions, 5);
  assert.equal(result.status, "available");
  f.snapshots.push({ ...structuredClone(f.billing), id: "approval-copy" });
  assert.deepEqual(estimate(f), result);
  assert.deepEqual(f.declarations, before.declarations);
  f.declarations.mappings = [];
  assert.equal(estimate(f).values.revenue, null, "approvals remain bound to confirmed mapping");
});

test("salary accrues on active leap-month dates and respects midmonth terms despite unknown billing", () => {
  const f = fixture("2024-02-01", "2024-03-01");
  f.range = { start: "2024-02-10", end: "2024-02-29" };
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2024-02-10", payMode: "salary", payAmount: 34800, desiredWeeklySessions: 7 }));
  f.workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: "2024-02-20", payAmount: 69600 }));
  f.workspace.settings.familyW2ClinicianId = 1;
  f.billing.reportCoverage = undefined;
  const result = estimate(f);
  near(result.values.clinicianPay, 10 * 100 + 10 * 200);
  near(result.values.coOwnerSalaryPretax, 3000);
  assert.equal(result.values.revenue, null); assert.equal(result.values.profit, null);
  assert.equal(result.billingCoverageComplete, false);
});

test("per-session compensation uses proved daily visits and never period averages", () => {
  const f = fixture();
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: f.range.start, desiredWeeklySessions: 7, payMode: "per_session", payAmount: 12 }));
  f.context.sessions = [{ id: 1, clinicianId: 1, start: f.range.start, end: f.range.end, completed: 100, desired: 100, cancelled: null, noShow: null, revision: 1, updatedAt: "2026-01-14T00:00:00Z" }];
  near(estimate(f).values.clinicianPay, 12);
  f.attendance.reportCoverage = undefined;
  const result = estimate(f);
  assert.equal(result.values.sessions, null); assert.equal(result.values.clinicianPay, null);
  near(result.values.revenue, 50);
  assert.match(result.unavailableReasons.join(" "), /exact attended visits/);
});

test("accepted same-day multi-visit overrides drive per-session pay and processing without changing billed gross", () => {
  const f = fixture();
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: f.range.start, desiredWeeklySessions: 7, payMode: "per_session", payAmount: 12 }));
  Object.assign(f.workspace.settings, { collectionPct: 80, processingFixedPerTransaction: 1, processingTransactionsPerSession: 2 });
  f.attendance.rows.push({ ...f.attendance.rows[0], sourceRowHash: "second-accepted-show" });
  const overrides = { [sameDayVisitKey(f.attendance.rows[0])]: 2 };
  const before = structuredClone({ f, overrides });
  const baseline = estimate(f);
  near(baseline.values.sessions, 1); near(baseline.values.clinicianPay, 12); near(baseline.values.fees, 1.6);
  const result = practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations, overrides);
  assert.equal(result.status, "available");
  near(result.values.sessions, 2); near(result.values.clinicianPay, 24); near(result.values.fees, 3.2);
  near(result.values.revenue, 50); near(result.values.profit, 22.8);
  assert.deepEqual({ f, overrides }, before);
  f.attendance.reportCoverage = undefined;
  const unknown = practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations, overrides);
  assert.equal(unknown.values.sessions, null); assert.equal(unknown.values.clinicianPay, null); assert.equal(unknown.values.fees, null);
});

test("caps replay discounted dollars from year start, crossing cap exactly once", () => {
  const f = fixture("2026-01-01", "2026-02-25");
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  f.billing.rows[0].totalFeeCharged = 200;
  f.billing.rows.push({ ...f.billing.rows[0], clientId: "Later synthetic", serviceDate: "2026-02-01", totalFeeCharged: 100, sourceRowHash: "later" });
  f.range = { start: "2026-02-01", end: "2026-02-10" };
  const result = estimate(f);
  near(result.values.revenue, 100);
  near(result.values.clinicianPay, 70);
});

test("unknown prior cap progress withholds pay; dated opening contribution restores it", () => {
  const f = fixture("2026-07-02", "2026-07-15");
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  const unknown = estimate(f);
  near(unknown.values.revenue, 50); assert.equal(unknown.values.clinicianPay, null); assert.equal(unknown.values.profit, null);
  assert.match(unknown.unavailableReasons.join(" "), /cap progress/);
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-07-02", openingCapContribution: 100, desiredWeeklySessions: 7 }));
  near(estimate(f).values.clinicianPay, 40);
});

test("cap progress resets on January 1, not every selected month", () => {
  const f = fixture("2025-12-18", "2026-01-14");
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2025-12-18", openingCapContribution: 100, desiredWeeklySessions: 7 }));
  f.billing.rows.push({ ...f.billing.rows[0], clientId: "New year", serviceDate: "2026-01-01", sourceRowHash: "new-year" });
  f.range = { start: "2026-01-01", end: "2026-01-14" };
  near(estimate(f).values.clinicianPay, 30);
});

test("accepted gross and treatment compensation stay distinct; only nonzero free PHONE violates policy", () => {
  const f = fixture();
  f.workspace.settings.processingPct = 3.15;
  f.workspace.settings.processingFixedPerTransaction = 0.3;
  f.workspace.settings.processingTransactionsPerSession = 1;
  for (const [code, amount] of [["30003", 60], ["2", 25], ["PHONE", 0], ["0", 0]] as const)
    f.billing.rows.push({ ...f.billing.rows[0], clientId: code, billingCode: code, sourceRowHash: code, totalFeeCharged: amount });
  const known = estimate(f);
  near(known.values.reportedBilledGross, 135); near(known.values.revenue, 135);
  near(known.values.clinicianPay, 30); near(known.values.sessions, 1);
  near(known.values.fees, 135 * 0.0315 + 0.3);
  assert.equal(known.billingCoverageComplete, true);
  f.billing.rows.find(row => row.billingCode === "PHONE")!.totalFeeCharged = 5;
  const anomaly = estimate(f);
  near(anomaly.values.reportedBilledGross, 140);
  assert.equal(anomaly.values.revenue, null);
  assert.equal(anomaly.values.profit, null);
  assert.match(anomaly.unavailableReasons.join(" "), /nonzero PHONE/);
});

test("unclassified accepted charges preserve gross and percentage processing, not treatment pay certification", () => {
  const f = fixture(); f.billing.rows[0].billingCode = "UNCLASSIFIED";
  Object.assign(f.workspace.settings, { processingPct: 3.15, processingFixedPerTransaction: 0.3, processingTransactionsPerSession: 1 });
  const result = estimate(f);
  near(result.values.reportedBilledGross, 50); near(result.values.revenue, 50);
  near(result.values.fees, 50 * 0.0315 + 0.3); near(result.values.sessions, 1);
  assert.equal(result.values.clinicianPay, null); assert.equal(result.values.profit, null);
  assert.match(result.unavailableReasons.join(" "), /unclassified service code/);
  assert.doesNotMatch(result.unavailableReasons.join(" "), /source coverage|Processing|processing/);
});

test("later current-pay configuration is an explicit scenario, never silently backdated or persisted", () => {
  const f = fixture("2026-09-24", "2026-10-07"); f.asOf = "2026-10-17";
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-10-08", desiredWeeklySessions: 7 }));
  const before = structuredClone(f);
  const dated = estimate(f);
  near(dated.values.revenue, 50); assert.equal(dated.values.clinicianPay, null);
  assert.match(dated.unavailableReasons.join(" "), /later-configured pay is not historical proof/);
  const scenario = practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations, {}, { payBasis: "current-assumptions" });
  near(scenario.values.clinicianPay, 30); near(scenario.values.profit, 20);
  assert.match(scenario.assumptions.join(" "), /configured from 2026-10-08.*not verified historical compensation/);
  assert.deepEqual(f, before);
  f.workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: "2026-09-01", clinicianSplit: 40 }));
  const datedPriority = practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations, {}, { payBasis: "current-assumptions" });
  near(datedPriority.values.clinicianPay, 20);
  Object.assign(f.context.clinicians[0], { capEnabled: true, capAmount: 100 });
  const capUnknown = practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations, {}, { payBasis: "current-assumptions" });
  assert.equal(capUnknown.values.clinicianPay, null);
  assert.match(capUnknown.unavailableReasons.join(" "), /prior annual cap progress/);
});

test("source-derived six-provider fixed-window fixture reconciles 17425 gross, 107 visits and configured processing independently of pay history", () => {
  const f = fixture("2026-09-24", "2026-10-07"); f.asOf = "2026-10-17";
  const original = f.context.clinicians[0];
  f.context.clinicians = Array.from({ length: 6 }, (_, index) => ({ ...original, id: index + 1, label: `Synthetic ${index + 1}`, preCapClinicianSplit: index === 0 ? 0 : 60 }));
  f.billing.rows = Array.from({ length: 107 }, (_, index) => ({ ...f.billing.rows[0], clientId: `Synthetic encounter ${index}`, clinician: f.context.clinicians[index % 6].label,
    serviceDate: index % 2 ? "2026-10-01" : "2026-09-24", totalFeeCharged: index === 0 ? 2415 : 140, sourceRowHash: `treatment-${index}` }));
  for (let index = 0; index < 8; index++) f.billing.rows.push({ ...f.billing.rows[0], clientId: `Non-treatment ${index}`, clinician: f.context.clinicians[index % 3].label,
    billingCode: index % 2 ? "30003" : "2", totalFeeCharged: index === 0 ? 100 : index === 1 ? 70 : 0, sourceRowHash: `non-treatment-${index}` });
  f.attendance.rows = f.billing.rows.slice(0, 107).map(row => ({ ...f.attendance.rows[0], ...row, status: "show" as const }));
  f.snapshots.push({ ...structuredClone(f.billing), id: "duplicate-export", rows: structuredClone(f.billing.rows.slice(0, 111)).map(row => ({ ...row, sourceRowHash: "copy-" + row.sourceRowHash })) });
  for (const id of [1, 2]) f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: id, start: "2026-10-08", desiredWeeklySessions: 7 }));
  Object.assign(f.workspace.settings, { processingPct: 3.15, processingFixedPerTransaction: 0.3, processingTransactionsPerSession: 1, collectionPct: 100 });
  const before = structuredClone(f);
  const dated = estimate(f);
  near(dated.values.revenue, 17425); near(dated.values.reportedBilledGross, 17425); near(dated.values.sessions, 107);
  const reported = summarizeReportedBilling(f.snapshots, f.asOf, f.range);
  assert.equal(reported.evidence.rawRowCount, 226); assert.equal(reported.evidence.uniqueRowCount, 115); assert.equal(reported.evidence.duplicateRowCount, 111);
  near(reported.months.reduce((sum, row) => sum + row.charges!, 0), dated.values.revenue!);
  near(dated.values.fees, 17425 * 0.0315 + 107 * 0.3);
  assert.equal(dated.values.clinicianPay, null); assert.equal(dated.billingCoverageComplete, true);
  assert.doesNotMatch(dated.unavailableReasons.join(" "), /billed source coverage|processing|classified/);
  const scenario = practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations, {}, { payBasis: "current-assumptions" });
  assert.notEqual(scenario.values.clinicianPay, null); assert.notEqual(scenario.values.profit, null);
  assert.equal(scenario.components.find(row => row.key === "sessions")!.unit, "number");
  const actual = practiceFinancialRange(f.workspace, f.context, f.snapshots, f.asOf, f.range);
  assert.equal(actual.actual.complete, false); assert.equal(actual.actual.values.profit, null);
  assert.deepEqual(f, before);
});

test("known dated salary remains usable before a later profile configuration, in either estimate scenario", () => {
  const f = fixture("2026-09-24", "2026-10-07"); f.asOf = "2026-10-17";
  f.workspace.settings.familyW2ClinicianId = 1;
  f.workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-10-08", payMode: "salary", payAmount: 120000, desiredWeeklySessions: 7 }));
  f.workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: "2026-01-01", payMode: "salary", payAmount: 90000 }));
  for (const payBasis of ["dated", "current-assumptions"] as const) {
    const result = practiceFinancialEstimateRange(f.workspace, f.context, f.snapshots, f.asOf, f.range, f.declarations, {}, { payBasis });
    near(result.values.clinicianPay, 7500 * (7 / 30 + 7 / 31));
    near(result.values.coOwnerSalaryPretax, result.values.clinicianPay!);
    assert.doesNotMatch(result.assumptions.join(" "), /current pay assumptions configured from/);
  }
});

test("owner clinical pay and family salary are subsets; separate owner payroll is deducted once", () => {
  const f = fixture(); f.context.clinicians[0].classification = "owner";
  f.workspace.settings.familyW2ClinicianId = 1;
  f.workspace.settings.ownerPayrollMonthly = 31;
  f.workspace.settings.ownerPayrollBurdenPct = 10;
  const result = estimate(f);
  near(result.values.ownerClinicalPay, 30);
  near(result.values.ownerPayroll, 14);
  near(result.values.profit, 50 - 30 - 14 - 1.4);
  near(result.values.coOwnerSalaryPretax, 0);
});

test("annual $350 expense beginning November 15 accrues only selected active dates without transactions", () => {
  const f = fixture("2026-11-05", "2026-12-02");
  const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Software", kind: "expense" });
  f.workspace.categories.push(category);
  f.workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: "Annual software", categoryId: category.id, start: "2026-11-15", amount: 350, cadence: "annual" }));
  f.range = { start: "2026-11-15", end: "2026-11-30" };
  near(estimate(f).values.overhead, 350 * 16 / 365);
  assert.equal(f.workspace.transactions.length, 0);
});

test("processing and dated household distributions use declared assumptions, never cash facts", () => {
  const f = fixture();
  Object.assign(f.workspace.settings, { collectionPct: 80, processingPct: 3, processingFixedPerTransaction: 1, processingTransactionsPerSession: 2 });
  f.workspace.allocations.push(allocationSchema.parse({ id: crypto.randomUUID(), name: "Household", start: "2026-01-08", kind: "distribution", percent: 50, household: true }));
  const result = estimate(f);
  near(result.values.fees, 50 * .8 * .03 + 1 * .8 * 2);
  near(result.values.profit, 17.2);
  near(result.values.ownerDistributionsPretax, 17.2 * .5 * 7 / 14);
  assert.equal(result.values.collections, null); assert.equal(result.values.bankTransfers, null);
  f.workspace.settings.openingCash = 100000;
  f.workspace.settings.openingReceivables = 90000;
  assert.deepEqual(estimate(f), result);
});

test("detailed overhead and floor use max; unsupported events and payroll overlap withhold profit", () => {
  const f = fixture();
  const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Operating", kind: "expense" });
  f.workspace.categories.push(category);
  f.workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: "Rent", categoryId: category.id, start: "2026-01-01", amount: 31, cadence: "monthly" }));
  f.workspace.settings.overheadFloorMonthly = 62;
  near(estimate(f).values.overhead, 28);
  f.workspace.events.push(eventSchema.parse({ id: crypto.randomUUID(), name: "Unsupported split", date: "2026-01-01", field: "clinician.split", value: 80 }));
  assert.equal(estimate(f).values.profit, null);
  assert.equal(estimate(f).values.clinicianPay, null);
  assert.match(estimate(f).unavailableReasons.join(" "), /unsupported/);
  f.workspace.events = [];
  f.workspace.budgets[0].name = "Payroll";
  assert.equal(estimate(f).values.profit, null);
});

test("monthly overhead matches engine max semantics for lumpy detail, percentage revenue and detailed-mode floors", () => {
  for (const scenario of ["once", "percent", "detailed-floor"] as const) {
    const f = fixture("2026-01-01", "2026-02-11");
    f.range = { start: "2026-01-01", end: "2026-01-31" };
    f.billing.rows[0].totalFeeCharged = 1000;
    f.workspace.settings.horizonMonths = 1;
    const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Operating", kind: "expense" });
    f.workspace.categories.push(category);
    f.workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: "Operating cost", categoryId: category.id, start: "2026-01-01", amount: 100, cadence: scenario === "once" ? "once" : "monthly" }));
    if (scenario === "percent") Object.assign(f.workspace.settings, { overheadGoalBasis: "fixed_percent", overheadGoalPercent: 10 });
    else Object.assign(f.workspace.settings, { overheadFloorMonthly: 310, overheadFloorOverride: true, overheadMode: scenario === "detailed-floor" ? "detailed" : "baseline" });
    const before = structuredClone(f);
    const result = estimate(f);
    const monthly = forecast(f.workspace, f.context, [], 1, false, {
      workingForecast: true, useImportedBillingActuals: false, baselineWeeklyByClinician: { 1: 70 / 31 },
    })[0];
    const expected = scenario === "percent" ? 100 : 310;
    assert.equal(result.status, "available");
    near(result.values.overhead, expected); near(monthly.values.overhead, expected);
    near(result.values.profit, 400 - expected);
    assert.deepEqual(f, before);
  }
});

test("monthly overhead keeps dated event costs additive after max and feeds corrected profit into allocations", () => {
  const f = fixture("2026-01-01", "2026-02-11");
  f.range = { start: "2026-01-01", end: "2026-01-31" };
  f.billing.rows[0].totalFeeCharged = 1000;
  Object.assign(f.workspace.settings, { overheadMode: "detailed", overheadFloorMonthly: 310, horizonMonths: 1 });
  const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Operating", kind: "expense" });
  f.workspace.categories.push(category);
  f.workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: "Lumpy detail", categoryId: category.id, start: "2026-01-01", amount: 100, cadence: "once" }));
  f.workspace.events.push(eventSchema.parse({ id: crypto.randomUUID(), name: "Dated additional cost", field: "custom", date: "2026-01-16", value: 0, monthlyCost: 31, oneTimeCost: 10 }));
  f.workspace.allocations.push(allocationSchema.parse({ id: crypto.randomUUID(), name: "Household", start: "2026-01-01", kind: "distribution", percent: 50, household: true }));
  const result = estimate(f);
  const monthly = forecast(f.workspace, f.context, [], 1, false, {
    workingForecast: true, useImportedBillingActuals: false, baselineWeeklyByClinician: { 1: 70 / 31 },
  })[0];
  near(result.values.overhead, 310 + 16 + 10);
  near(result.values.overhead, monthly.values.overhead!);
  near(result.values.profit, 64);
  near(result.values.ownerDistributionsPretax, 32);
});

test("partial-month overhead allowance is prorated before monthly comparison", () => {
  const f = fixture();
  f.billing.rows[0].totalFeeCharged = 1000;
  Object.assign(f.workspace.settings, { overheadMode: "detailed", overheadFloorMonthly: 310 });
  const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Operating", kind: "expense" });
  f.workspace.categories.push(category);
  f.workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: "Once", categoryId: category.id, start: "2026-01-01", amount: 100, cadence: "once" }));
  near(estimate(f).values.overhead, 140);
  f.workspace.settings.overheadGoalBasis = "fixed_percent";
  f.workspace.settings.overheadGoalPercent = undefined;
  const unknown = estimate(f);
  assert.equal(unknown.values.overhead, null); assert.equal(unknown.values.profit, null);
  assert.equal(unknown.status, "partial");
});

test("unknown staff compensation remains unknown; known billed revenue survives", () => {
  const f = fixture();
  f.context.staff.push({ id: 1, label: "Unknown synthetic staff", goalId: null, classification: "w2", annualSalary: null, hourlyRate: null, hoursPerWeek: null, weeksPerYear: 52, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 });
  const result = estimate(f);
  assert.equal(result.status, "partial"); assert.equal(result.modelComplete, false);
  assert.equal(result.values.staffCost, null); assert.equal(result.values.profit, null);
  near(result.values.revenue, 50);
  assert.match(result.unavailableReasons.join(" "), /staff.*unknown/i);
});

test("range is clipped to asOf; invalid and wholly future windows are unavailable", () => {
  const f = fixture(); f.range.end = "2026-12-31";
  assert.deepEqual(estimate(f).range, { start: "2026-01-01", end: "2026-01-14" });
  f.range.start = "2026-02-01";
  assert.equal(estimate(f).range, null); assert.equal(estimate(f).status, "unavailable");
  f.range = { start: "2026-02-30", end: "2026-03-01" };
  assert.equal(estimate(f).billingCoverageComplete, false);
});
