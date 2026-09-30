import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  emptyWorkspace, workspaceSchema, clinicianSettingSchema,
  familyPaycheckSchema, allocationSchema, monthFlow, forecast,
  additionalWithholdingPctFromNet, semiMonthlyChecksThrough, type Context,
} from "../src/hub/index.ts";

const wife = {
  id: 1, label: "W2 owner", goalId: null, sessionRate: 150,
  sessionsPerWeek: 20, weeksWorkedPerYear: 52.1786,
  capEnabled: false, capAmount: 0,
  preCapClinicianSplit: 60, preCapPracticeSplit: 40,
  postCapClinicianSplit: 60, postCapPracticeSplit: 40,
  classification: "w2", w2EmployerFicaPct: 7.65,
  futaSutaPct: 1, workersCompPct: 0.5, otherEmployerBurdenPct: 0.85,
};
const record = (start: string, end: string, completed: number) => ({
  id: 1, revision: 1, updatedAt: "2026-02-11T00:00:00Z",
  clinicianId: 1, start, end, completed, desired: 20,
  cancelled: null, noShow: null, scheduled: null,
  inPerson: null, telehealth: null, sourceAttachmentId: null,
});
const setup = () => {
  const workspace = emptyWorkspace("2026-01-15");
  workspace.settings.familyW2ClinicianId = 1;
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 20;
  workspace.settings.defaultInPersonPct = 0;
  workspace.clinicians.push(clinicianSettingSchema.parse({
    id: randomUUID(), clinicianId: 1, start: "2026-01-01",
    desiredWeeklySessions: 20, payMode: "salary", payAmount: 120000,
    expectedSessionRevenue: 80,
  }));
  return workspace;
};
const context = (sessions: Context["sessions"]): Context => ({
  clinicians: [wife], staff: [], sessions,
});
const close = (actual: number | null, expected: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);

test("W2 salary estimates net family pay without using recorded deposits", () => {
  const workspace = setup();
  workspace.familyPaychecks.push(familyPaycheckSchema.parse({
    id: randomUUID(), clinicianId: 1, date: "2026-01-09", netAmount: 2000,
  }));
  const flow = monthFlow(workspace, context([record("2026-01-01", "2026-01-15", 20)]), "2026-01-01", "2026-01-15");
  assert.equal(flow.through, "2026-01-15");
  close(flow.revenue, 1600);
  close(flow.familyGrossPay, 120000 / 24);
  close(flow.familyEmployerBurden, flow.familyGrossPay * 0.1);
  close(flow.profit, 1600 - flow.familyGrossPay - flow.familyEmployerBurden - flow.processing);
  assert.equal(flow.distribution, 0);
  close(flow.estimatedEmployeePayrollTax, flow.familyGrossPay * 0.0765);
  close(flow.estimatedAdditionalWithholding, flow.familyGrossPay * 0.15);
  close(flow.estimatedNetPay, flow.familyGrossPay * (1 - 0.0765 - 0.15));
  close(flow.familyTakeHome, flow.estimatedNetPay!);
  assert.notEqual(flow.familyTakeHome, 2000);
});

test("cross-month biweekly records are estimated by days and future periods are excluded", () => {
  const workspace = setup();
  const data = context([
    record("2026-01-28", "2026-02-10", 14),
    { ...record("2026-02-11", "2026-02-24", 14), id: 2 },
  ]);
  const january = monthFlow(workspace, data, "2026-01-01", "2026-02-11");
  const february = monthFlow(workspace, data, "2026-02-01", "2026-02-11");
  close(january.sessions, 4);
  close(february.sessions, 10);
  assert.equal(january.splitPeriods, true);
  assert.equal(february.splitPeriods, true);
  assert.equal(february.through, "2026-02-10");
});

test("missing session data remains unknown and old workspaces gain the tax estimate", () => {
  const workspace = setup();
  const old = structuredClone(workspace) as Record<string, unknown>;
  delete old.familyPaychecks;
  delete (old.settings as Record<string, unknown>).estimatedIncomeTaxPct;
  const restored = workspaceSchema.parse(old);
  assert.deepEqual(restored.familyPaychecks, []);
  assert.equal(restored.settings.estimatedIncomeTaxPct, 15);
  const flow = monthFlow(restored, context([]), "2026-01-01", "2026-01-15");
  assert.equal(flow.revenue, null);
  assert.equal(flow.profit, null);
  assert.equal(flow.familyTakeHome, null);
});

test("the forecast uses expected average revenue without changing fixed W2 salary", () => {
  const workspace = setup();
  const modeled = forecast(workspace, context([]))[0].values;
  const listed = structuredClone(workspace);
  listed.clinicians[0].expectedSessionRevenue = null;
  const original = forecast(listed, context([]))[0].values;
  close(modeled.revenue, (original.revenue ?? 0) * 80 / 150);
  close(modeled.clinicianPay, original.clinicianPay ?? 0);
  close(modeled.familyTakeHome, 120000 / 12 * (1 - 0.0765 - 0.15));
});

test("named savings funds are allocations after profit, not business costs", () => {
  const workspace = setup();
  workspace.clinicians[0].payAmount = 0;
  workspace.familyPaychecks.push(familyPaycheckSchema.parse({
    id: randomUUID(), clinicianId: 1, date: "2026-01-09", netAmount: 2000,
  }));
  workspace.allocations.push(
    allocationSchema.parse({ id: randomUUID(), name: "Tax fund", kind: "tax", percent: 20, start: "2026-01-01" }),
    allocationSchema.parse({ id: randomUUID(), name: "Furniture fund", kind: "reserve", percent: 15, start: "2026-01-01" }),
    allocationSchema.parse({ id: randomUUID(), name: "Your distribution", kind: "distribution", percent: 25, start: "2026-01-01" }),
  );
  const flow = monthFlow(workspace, context([record("2026-01-01", "2026-01-14", 20)]), "2026-01-01", "2026-01-15");
  close(flow.profit, 1600);
  close(flow.allocations.find((item) => item.name === "Furniture fund")?.amount ?? null, 240);
  close(flow.distribution, 400);
  close(flow.retained, 640);
  close(flow.familyTakeHome, 400);
});

test("income-tax assumption changes net pay, not business profit", () => {
  const workspace = setup();
  const data = context([record("2026-01-01", "2026-01-15", 20)]);
  const original = monthFlow(workspace, data, "2026-01-01", "2026-01-15");
  workspace.settings.estimatedIncomeTaxPct = 20;
  const adjusted = monthFlow(workspace, data, "2026-01-01", "2026-01-15");
  close(adjusted.profit, original.profit!);
  close(adjusted.familyTakeHome, original.familyTakeHome! - original.familyGrossPay * 0.05);
  const modeled = forecast(workspace, context([]))[0].values;
  close(modeled.familyTakeHome, 120000 / 12 * (1 - 0.0765 - 0.20));
});

test("month-to-date processing uses the existing successful-payment assumption", () => {
  const workspace = setup();
  workspace.settings.collectionPct = 75;
  workspace.settings.processingPct = 3.15;
  workspace.settings.processingFixedPerTransaction = 0.30;
  workspace.settings.processingTransactionsPerSession = 1;
  const flow = monthFlow(workspace, context([record("2026-01-01", "2026-01-14", 20)]), "2026-01-01", "2026-01-15");
  close(flow.revenue, 1200);
  close(flow.processing, 1200 * 0.0315 + 20 * 0.75 * 0.30);
});

test("planned clinicians remain outside Today's operating totals", () => {
  const workspace = setup();
  workspace.clinicians[0].status = "planned";
  const flow = monthFlow(workspace, context([record("2026-01-01", "2026-01-14", 20)]), "2026-01-01", "2026-01-15");
  close(flow.revenue, 0);
  close(flow.clinicianPay, 0);
});

test("month-to-date pay uses the clinician setup active in the selected month", () => {
  const workspace = setup();
  workspace.clinicians[0].end = "2026-01-31";
  workspace.clinicians.push(clinicianSettingSchema.parse({
    id: randomUUID(), clinicianId: 1, start: "2026-02-01",
    desiredWeeklySessions: 20, payMode: "salary", payAmount: 60000,
  }));
  const data = context([
    record("2026-01-01", "2026-01-15", 20),
    { ...record("2026-02-01", "2026-02-15", 20), id: 2 },
  ]);
  const january = monthFlow(workspace, data, "2026-01-01", "2026-02-15");
  const february = monthFlow(workspace, data, "2026-02-01", "2026-02-15");
  close(january.familyGrossPay, 120000 / 24);
  close(february.familyGrossPay, 60000 / 24);
});

test("a known net paycheck calibrates withholding and two scheduled checks", () => {
  const workspace = setup();
  workspace.clinicians[0].payAmount = 90000;
  const additionalPct = additionalWithholdingPctFromNet(90000 / 24, 2741.42);
  assert.ok(additionalPct !== null);
  workspace.settings.estimatedIncomeTaxPct = additionalPct;
  close(additionalPct, 19.245466666666662);
  assert.equal(semiMonthlyChecksThrough("2026-02-01", "2026-02-27", "2026-02-01"), 1);
  assert.equal(semiMonthlyChecksThrough("2026-02-01", "2026-02-28", "2026-02-01"), 2);
  const beforeFirst = monthFlow(workspace, context([record("2026-09-01", "2026-09-14", 20)]), "2026-09-01", "2026-09-28");
  close(beforeFirst.familyGrossPay, 0);
  const first = monthFlow(workspace, context([record("2026-09-01", "2026-09-23", 20)]), "2026-09-01", "2026-09-28");
  close(first.familyGrossPay, 3750);
  close(first.estimatedEmployeePayrollTax, 286.875);
  close(first.estimatedAdditionalWithholding, 721.705);
  close(first.estimatedNetPay, 2741.42);
  close(first.employerBurden, 375);
  close(first.profit, first.revenue! - 3750 - 375 - first.processing);
  close(first.familyTakeHome, 2741.42);
  const full = monthFlow(workspace, context([record("2026-09-01", "2026-09-30", 20)]), "2026-09-01", "2026-09-30");
  close(full.familyGrossPay, 7500);
  close(full.estimatedNetPay, 5482.84);
  close(forecast(workspace, context([]))[0].values.familyTakeHome, 5482.84);
});

test("semi-monthly pay uses the 30th instead of waiting for a 31st", () => {
  assert.equal(semiMonthlyChecksThrough("2026-01-01", "2026-01-29", "2026-01-01"), 1);
  assert.equal(semiMonthlyChecksThrough("2026-01-01", "2026-01-30", "2026-01-01"), 2);
  assert.equal(semiMonthlyChecksThrough("2026-01-01", "2026-01-31", "2026-01-01"), 2);
  assert.equal(semiMonthlyChecksThrough("2026-02-01", "2026-02-28", "2026-02-01"), 2);
});
