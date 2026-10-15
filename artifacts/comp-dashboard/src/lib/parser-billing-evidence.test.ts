import test from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, forecast, type Context } from "@workspace/practice/hub";
import { importAttendanceCsv, importBillingCsv } from "./retention-local.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";

const billing = (rows: string[]) => importBillingCsv("Client,Clinician,Date of service,Total fee,Billing code\n" + rows.join("\n")).snapshot;
const attendance = (rows: string[], complete = false) => {
  const snapshot = importAttendanceCsv("Client,Clinician,Date of service,Status,Location\n" + rows.join("\n")).snapshot;
  return complete ? { ...snapshot, reportCoverage: { start: snapshot.coverageStart, end: snapshot.coverageEnd, complete: true as const } } : snapshot;
};
const context: Context = { clinicians: [{ id: 1, label: "Current", goalId: null, classification: "owner", sessionRate: 100, sessionsPerWeek: 7, weeksWorkedPerYear: 52.1786, capEnabled: false, capAmount: 0, preCapClinicianSplit: 0, preCapPracticeSplit: 100, postCapClinicianSplit: 0, postCapPracticeSplit: 100, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
function month(snapshots: Parameters<typeof buildImportedSessionOverlay>[1], weekly = 7) {
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { defaultInPersonPct: 0, horizonMonths: 1, organicClientsPerMonth: 0 });
  const overlay = buildImportedSessionOverlay(context, snapshots, null);
  return { overlay, values: forecast(workspace, overlay.context, [], 1, false, { workingForecast: true, useImportedBillingActuals: true, baselineWeeklyByClinician: { 1: weekly } })[0].values };
}
test("parser-backed shifted row indexes reconcile overlapping exports to 150 without mutating raw snapshots", () => {
  const first = billing(["Same encounter,Current,2026-10-05,100,90837"]);
  const second = billing(["Other encounter,Current,2026-10-04,50,90837", "Same encounter,Current,2026-10-05,100,90837"]);
  assert.notEqual(first.rows[0].sourceRowHash, second.rows[1].sourceRowHash);
  const snapshots = [first, second];
  const before = structuredClone(snapshots);
  const unverified = month(snapshots);
  assert.equal(unverified.overlay.diagnostic.billedFees, 150);
  assert.equal(unverified.overlay.importedBillingActuals.length, 2);
  assert.equal(unverified.values.revenue, null, "billing-only exports do not prove a complete treatment-day replacement");
  assert.equal(summarizeReportedBilling(snapshots, "2026-10-14").currentMonth.chargesToDate, 150);
  const proof = attendance(["Other encounter,Current,2026-10-04,Show,Room", "Same encounter,Current,2026-10-05,Show,Room"], true);
  assert.equal(month([...snapshots, proof]).values.revenue, 3050);
  assert.deepEqual(snapshots, before);
});
test("changed fees or indistinguishable repetitions are unknown, not a winner or an established sum", () => {
  for (const snapshots of [
    [billing(["Same encounter,Current,2026-10-05,100,90837"]), billing(["Another,Current,2026-10-04,50,90837", "Same encounter,Current,2026-10-05,125,90837"])],
    [billing(["Same encounter,Current,2026-10-05,100,90837", "Same encounter,Current,2026-10-05,100,90837"])],
  ]) {
    const before = structuredClone(snapshots);
    const result = month(snapshots);
    assert.equal(result.overlay.diagnostic.billedFees, null);
    assert.ok(result.overlay.diagnostic.billingConflictCount > 0);
    assert.equal(result.values.revenue, null);
    assert.equal(summarizeReportedBilling(snapshots, "2026-10-14").currentMonth.chargesToDate, null);
    assert.deepEqual(snapshots, before);
  }
});
test("distinct same-client/day codes remain distinct clinical charges", () => {
  const bill = billing(["Same encounter,Current,2026-10-05,100,90837", "Same encounter,Current,2026-10-05,25,90785"]);
  const show = attendance(["Same encounter,Current,2026-10-05,Show,Room"], true);
  const result = month([bill, show]);
  assert.equal(result.overlay.diagnostic.billedFees, 125);
  assert.equal(result.overlay.importedBillingActuals.length, 2);
  assert.equal(result.values.revenue, 3125);
});
test("zero PHONE charges do not replace another patient's treatment, while paid PHONE policy stays unknown", () => {
  const show = attendance(["Phone patient,Current,2026-10-05,Show,Phone", "Treatment patient,Current,2026-10-05,Show,Room"], true);
  const zero = month([show, billing(["Phone patient,Current,2026-10-05,0,PHONE"])]);
  assert.equal(zero.overlay.derivedSessions.reduce((sum, row) => sum + row.completed, 0), 1);
  assert.equal(zero.values.revenue, 3100);
  const paidSnapshots = [show, billing(["Phone patient,Current,2026-10-05,25,PHONE"])];
  assert.equal(month(paidSnapshots).values.revenue, null);
  assert.equal(summarizeReportedBilling(paidSnapshots, "2026-10-14").currentMonth.chargesToDate, 25, "reported consultation fees remain facts, not invented treatment revenue");
});
test("one of two treatment patients billed cannot replace a full modeled day", () => {
  const show = attendance(["Patient A,Current,2026-10-05,Show,Room", "Patient B,Current,2026-10-05,Show,Room"], true);
  const bill = billing(["Patient A,Current,2026-10-05,100,90837"]);
  const partial = month([show, bill], 14);
  assert.equal(partial.values.sessions, 62);
  assert.equal(partial.values.revenue, null);
  assert.equal(summarizeReportedBilling([bill], "2026-10-14").currentMonth.chargesToDate, 100);
  const complete = month([show, billing(["Patient A,Current,2026-10-05,100,90837", "Patient B,Current,2026-10-05,100,90837"])], 14);
  assert.equal(complete.values.revenue, 6200);
});
test("unmapped providers cannot hide globally conflicting source identities from the selected team", () => {
  const first = billing(["Patient A,Current,2026-10-05,100,90837"]);
  const outside = billing(["Patient B,Outside team,2026-09-05,200,90837"]);
  outside.rows[0].sourceRowHash = first.rows[0].sourceRowHash;
  const result = month([first, outside]);
  assert.equal(result.overlay.importedBillingActuals.length, 1);
  assert.equal(result.overlay.importedBillingActuals[0].evidenceUnknown, true);
  assert.equal(result.values.revenue, null);
  assert.equal(summarizeReportedBilling([first, outside], "2026-10-14", { clinicianLabels: ["Current"], start: "2026-10-01", end: "2026-10-14" }).currentMonth.chargesToDate, null);
});
