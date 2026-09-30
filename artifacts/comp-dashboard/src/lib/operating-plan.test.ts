import { test } from "node:test";
import assert from "node:assert/strict";
import {
  campaignSchema,
  emptyWorkspace,
  forecast,
  type Context,
} from "@workspace/practice/hub";
import { compareOperatingPlans, summarizeOperatingPlan } from "./operating-plan.ts";

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

test("operating plan connects selected-period sessions, money, and monthly lead need", () => {
  const workspace = emptyWorkspace("2026-09-01");
  workspace.settings.teamId = 7;
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 16;
  workspace.settings.targetProfitMonthly = 8000;
  workspace.settings.sessionsPerClientMonth = 4;
  workspace.settings.baselineRetentionPct = 90;
  workspace.settings.collectionPct = 100;
  workspace.settings.defaultInPersonPct = 0;
  workspace.settings.horizonMonths = 1;
  workspace.campaigns.push(campaignSchema.parse({
    id: crypto.randomUUID(),
    name: "Search",
    source: "Google Ads",
    method: "cpl",
    monthlySpend: 1000,
    cpl: 50,
    consultationPct: 50,
    attendancePct: 80,
    closePct: 50,
    start: "2026-09-01",
  }));
  const month = forecast(workspace, context)[0];
  const summary = summarizeOperatingPlan(workspace, month)!;

  assert.ok((summary.weeklySessions ?? 0) > 16);
  assert.equal(summary.sessionsPerClientMonth, 4);
  assert.equal(summary.activeClients, summary.sessions! / 4);
  assert.ok(Math.abs((summary.leadToClientRate ?? 0) - 0.2) < 1e-9);
  assert.ok(summary.leadsNeeded !== null && summary.leadsNeeded > 0);
  assert.ok(summary.sessionsToCloseGap !== null && summary.sessionsToCloseGap > 0);
  assert.equal(summary.fillHorizonMonths, 6);
  assert.equal(summary.fillClients, (summary.sessionCapacity! - summary.sessions!) / 4 / 6);
  const slowerFill = summarizeOperatingPlan(workspace, month, 12)!;
  assert.equal(slowerFill.fillClients, summary.fillClients! / 2);
  assert.ok(slowerFill.leadsNeeded! < summary.leadsNeeded!);
  assert.equal(summary.operatingExpense,
    (month.values.staffCost ?? 0) + (month.values.overhead ?? 0) +
    (month.values.marketing ?? 0) + (month.values.fees ?? 0) +
    (month.values.ownerPayroll ?? 0) * (1 + workspace.settings.ownerPayrollBurdenPct / 100));
  assert.ok(Math.abs(summary.estimatedRevenue! + summary.otherIncome! -
    summary.clinicianCompensation - summary.operatingExpense - summary.estimatedProfit!) < 0.001);
  assert.equal(summary.leadRateSource, "campaign");
});

test("operating plan keeps lead requirements unknown when conversion assumptions are missing", () => {
  const workspace = emptyWorkspace("2026-09-01");
  workspace.settings.teamId = 7;
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 16;
  workspace.settings.sessionsPerClientMonth = 4;
  workspace.settings.baselineRetentionPct = 90;
  workspace.settings.defaultInPersonPct = 0;
  workspace.settings.horizonMonths = 1;

  const summary = summarizeOperatingPlan(workspace, forecast(workspace, context)[0])!;

  assert.equal(summary.leadToClientRate, null);
  assert.equal(summary.leadsNeeded, null);
  assert.match(summary.warnings.join(" "), /Lead requirements/);
});

test("recorded conversion outranks campaign estimates, including a recorded zero", () => {
  const workspace = emptyWorkspace("2026-09-01");
  workspace.settings.teamId = 7;
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 16;
  workspace.settings.sessionsPerClientMonth = 2;
  workspace.settings.horizonMonths = 1;
  workspace.campaigns.push(campaignSchema.parse({
    id: crypto.randomUUID(), name: "Search", source: "Google Ads", method: "cpl",
    monthlySpend: 1000, cpl: 50, consultationPct: 50,
    attendancePct: 80, closePct: 50, start: "2026-09-01",
  }));
  for (const [index, month] of ["2026-06", "2026-07", "2026-08"].entries()) {
    const periodId = crypto.randomUUID();
    workspace.periods.push({
      id: periodId, name: month, start: `${month}-01`, end: `${month}-30`,
      archived: false,
    } as typeof workspace.periods[number]);
    workspace.funnels.push({
      id: crypto.randomUUID(), periodId, scope: "practice", leads: 20,
      clients: 0, scheduled: 10, attended: 8,
    } as typeof workspace.funnels[number]);
  }
  const summary = summarizeOperatingPlan(workspace, forecast(workspace, context)[0])!;
  assert.equal(summary.leadRateSource, "recorded");
  assert.equal(summary.leadToClientRate, 0);
  assert.equal(summary.leadsNeeded, null);
  assert.match(summary.warnings.join(" "), /zero conversion rate/);
  const beforeRecordedMonths = summarizeOperatingPlan(
    workspace, forecast(workspace, context)[0], 6, "2026-07-01",
  )!;
  assert.equal(beforeRecordedMonths.leadRateSource, "campaign");
});

test("selected forecast month changes operating totals without changing assumptions", () => {
  const workspace = emptyWorkspace("2026-09-01");
  workspace.settings.teamId = 7;
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 16;
  workspace.settings.sessionsPerClientMonth = 2;
  workspace.settings.horizonMonths = 2;
  const months = forecast(workspace, context);
  const september = summarizeOperatingPlan(workspace, months[0])!;
  const october = summarizeOperatingPlan(workspace, months[1])!;
  assert.equal(september.month, "2026-09-01");
  assert.equal(october.month, "2026-10-01");
  assert.notEqual(september.sessions, october.sessions);
  assert.equal(september.sessionsPerClientMonth, october.sessionsPerClientMonth);
});

test("planning comparison isolates added capacity and lead ramp", () => {
  const baseline = emptyWorkspace("2026-09-01");
  baseline.settings.teamId = 7;
  baseline.settings.baselineMode = "manual";
  baseline.settings.baselineWeeklySessions = 12;
  baseline.settings.sessionsPerClientMonth = 2;
  baseline.settings.horizonMonths = 1;
  const scenario = structuredClone(baseline);
  scenario.settings.baselineWeeklySessions = 18;
  const scenarioContext: Context = {
    ...context,
    clinicians: [context.clinicians[0], { ...clinician, id: 2, label: "New clinician", sessionsPerWeek: 10 }],
  };
  scenario.campaigns.push(campaignSchema.parse({
    id: crypto.randomUUID(), name: "Search", source: "Google Ads", method: "cpl",
    monthlySpend: 1000, cpl: 50, consultationPct: 50,
    attendancePct: 80, closePct: 50, start: "2026-09-01",
  }));
  const baselinePlan = summarizeOperatingPlan(baseline, forecast(baseline, context)[0])!;
  const scenarioPlan = summarizeOperatingPlan(scenario, forecast(scenario, scenarioContext)[0])!;
  const delta = compareOperatingPlans(baselinePlan, scenarioPlan)!;
  assert.ok(delta.profit !== null);
  assert.ok(delta.revenue !== null);
  assert.ok(delta.addedCapacitySessions !== null && delta.addedCapacitySessions > 0);
  assert.equal(delta.addedClientsPerMonth,
    delta.addedCapacitySessions! / scenario.settings.sessionsPerClientMonth / 6);
  assert.equal(delta.addedLeadsPerMonth,
    Math.ceil(delta.addedClientsPerMonth! / scenarioPlan.leadToClientRate!));
});
