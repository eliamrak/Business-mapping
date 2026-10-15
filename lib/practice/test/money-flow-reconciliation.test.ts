import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, clinicianSettingSchema, allocationSchema, forecast, monthFlow, type Context } from "../src/hub/index.ts";

const close = (actual: number | null, expected: number | null) => assert.ok(actual !== null && expected !== null && Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function fixture(month = "2026-10-01") {
  const workspace = emptyWorkspace(month);
  Object.assign(workspace.settings, { baselineRetentionPct: 100, defaultInPersonPct: 0, organicClientsPerMonth: 0, familyW2ClinicianId: 2, overheadFloorMonthly: 200, processingPct: 3, processingFixedPerTransaction: 0.3 });
  const clinicians = ["owner", "w2", "1099"].map((classification, index) => ({
    id: index + 1, goalId: null, label: `Synthetic ${classification}`, classification,
    sessionRate: 100, sessionsPerWeek: 20, weeksWorkedPerYear: 52.1786,
    capEnabled: false, capAmount: 0, preCapClinicianSplit: index === 0 ? 0 : 60, preCapPracticeSplit: index === 0 ? 100 : 40,
    postCapClinicianSplit: 60, postCapPracticeSplit: 40, w2EmployerFicaPct: 7.65, futaSutaPct: 1, workersCompPct: 0.5, otherEmployerBurdenPct: 0,
  }));
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 2, start: "2026-01-01", desiredWeeklySessions: 20, payMode: "salary", payAmount: 90000, inPersonPct: 0 }));
  const start = month.slice(0, 7) + "-01", end = month.slice(0, 7) + "-14";
  const context: Context = { clinicians, staff: [], sessions: clinicians.map((person) => ({ id: person.id, revision: 1, updatedAt: end + "T12:00:00Z", clinicianId: person.id, start, end, completed: 28, desired: 40, cancelled: null, noShow: null, scheduled: null, inPerson: null, telehealth: null, sourceAttachmentId: null })) };
  return { workspace, context, end };
}

test("projected Money flow and bridge use the same earned costs, not 28-day October checks", () => {
  const { workspace, context, end } = fixture();
  const before = structuredClone({ workspace, context });
  const engine = forecast(workspace, context, [], 1, true, { baselineWeeklyByClinician: { 1: 14, 2: 14, 3: 14 }, useImportedBillingActuals: false })[0];
  const flow = monthFlow(workspace, context, "2026-10-01", end, { fullMonthProjection: true });
  close(flow.revenue, engine.values.revenue);
  close(flow.sessions, engine.values.sessions);
  close(flow.clinicianPay, engine.values.clinicianPay);
  close(flow.employerBurden, engine.values.employerBurden);
  close(flow.staffPay, engine.values.staffCost);
  close(flow.overhead, engine.values.overhead);
  close(flow.processing, engine.values.fees);
  close(flow.profit, engine.values.profit);
  close(flow.familyGrossPay, 7500);
  close(flow.clinicianPay - flow.familyGrossPay, 31 * 2 * 100 * 0.6);
  close(flow.scheduledPayroll!.clinicianPay - flow.scheduledPayroll!.familyGrossPay, 28 * 2 * 100 * 0.6);
  close(flow.clinicianPay - flow.scheduledPayroll!.clinicianPay, 3 * 2 * 100 * 0.6);
  close(flow.revenue, 3 * 31 * 2 * 100);
  assert.deepEqual({ workspace, context }, before);
});

test("earned operating profit stays equal when check counts, capacity, growth, collection timing or salary terms change", () => {
  for (const month of ["2026-01-01", "2026-02-01", "2026-10-01", "2026-12-01"]) {
    const { workspace, context, end } = fixture(month);
    workspace.settings.organicClientsPerMonth = 3;
    workspace.settings.collectionDelayMonths = 1;
    workspace.settings.collectionPct = 80;
    workspace.clinicians[0].desiredWeeklySessions = 2;
    const engine = forecast(workspace, context, [], 1, true, { baselineWeeklyByClinician: { 1: 14, 2: 14, 3: 14 }, useImportedBillingActuals: false })[0];
    const flow = monthFlow(workspace, context, month, end, { fullMonthProjection: true });
    close(flow.profit, engine.values.profit);
    close(flow.revenue, engine.values.revenue);
    close(flow.sessions, engine.values.sessions);
    close(flow.processing, engine.values.fees);
  }
});

test("tax and household distributions stay after operating profit; owner clinical revenue is not paid twice", () => {
  const { workspace, context, end } = fixture();
  const original = monthFlow(workspace, context, "2026-10-01", end, { fullMonthProjection: true });
  workspace.allocations.push(allocationSchema.parse({ id: crypto.randomUUID(), name: "Elia distribution", kind: "distribution", household: true, percent: 25, start: "2026-01-01" }));
  workspace.settings.estimatedIncomeTaxPct = 30;
  const adjusted = monthFlow(workspace, context, "2026-10-01", end, { fullMonthProjection: true });
  close(adjusted.profit, original.profit);
  close(adjusted.familyGrossPay, 7500);
  close(adjusted.distribution, Math.max(0, adjusted.profit!) * 0.25);
  close(adjusted.familyTakeHome, adjusted.estimatedNetPay! + adjusted.distribution!);
  close(adjusted.clinicianPay, 7500 + 31 * 2 * 100 * 0.6);
});
