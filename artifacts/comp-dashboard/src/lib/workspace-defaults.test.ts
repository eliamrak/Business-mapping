import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  forecast,
  type Context,
} from "@workspace/practice/hub";
import { resolveWorkspaceDefaults } from "./workspace-defaults.ts";

const clinician = {
  id: 1,
  goalId: 7,
  label: "Test Clinician",
  roleType: "associate",
  classification: "1099" as const,
  sessionRate: 150,
  sessionsPerWeek: 20,
  weeksWorkedPerYear: 48,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  capEnabled: false,
  capAmount: 0,
  postCapClinicianSplit: 60,
  postCapPracticeSplit: 40,
  w2EmployerFicaPct: 0,
  futaSutaPct: 0,
  workersCompPct: 0,
  otherEmployerBurdenPct: 0,
  nonClinicalHoursPerWeek: 0,
  nonClinicalHourlyRate: 0,
};

const context: Context = { clinicians: [clinician], staff: [], sessions: [] };
const goals = [
  {
    id: 7,
    name: "Current plan",
    ownerPayGoal: 90_000,
    secondOwnerPayGoal: 30_000,
    annualOverheadGoal: 120_000,
    businessProfitGoal: 24_000,
  },
];

test("an empty workspace starts from the existing compensation plan", () => {
  const result = resolveWorkspaceDefaults(
    emptyWorkspace("2026-09-20"),
    context,
    goals,
  );

  assert.equal(result.workspace.settings.teamId, 7);
  assert.equal(result.workspace.settings.baselineMode, "manual");
  assert.equal(result.workspace.settings.baselineWeeklySessions, 20);
  assert.equal(result.workspace.settings.ownerPayrollMonthly, 10_000);
  assert.equal(result.workspace.settings.targetProfitMonthly, 2_000);
  assert.equal(result.forecastWorkspace.budgets.length, 1);
  assert.equal(result.forecastWorkspace.budgets[0].amount, 120_000);
  assert.equal(result.forecastWorkspace.budgets[0].cadence, "annual");
  const firstMonth = forecast(result.forecastWorkspace, context)[0];
  assert.ok((firstMonth.values.revenue ?? 0) > 0);
  assert.ok((firstMonth.values.overhead ?? 0) > 9_000);
});

test("detailed workspace values are not replaced by compensation defaults", () => {
  const workspace = emptyWorkspace("2026-09-20");
  workspace.settings.teamId = 7;
  workspace.settings.ownerPayrollMonthly = 500;
  workspace.settings.targetProfitMonthly = 700;

  const result = resolveWorkspaceDefaults(workspace, context, goals);

  assert.equal(result.workspace.settings.ownerPayrollMonthly, 500);
  assert.equal(result.workspace.settings.targetProfitMonthly, 700);
  assert.equal(result.inherited.ownerPay, false);
  assert.equal(result.inherited.profitGoal, false);
  assert.equal(result.inherited.overhead, true);
  assert.equal(result.forecastWorkspace.budgets[0].amount, 120_000);
});
