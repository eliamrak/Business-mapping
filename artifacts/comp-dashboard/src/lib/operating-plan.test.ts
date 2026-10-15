import { test } from "node:test";
import assert from "node:assert/strict";
import {
  campaignSchema,
  budgetSchema,
  categorySchema,
  clinicianSettingSchema,
  emptyWorkspace,
  forecast,
  periodSchema,
  funnelSchema,
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
  const summary = summarizeOperatingPlan(workspace, month, 6, "2026-09-01", context)!;

  assert.ok((summary.weeklySessions ?? 0) > 16);
  assert.equal(summary.sessionsPerClientMonth, 4);
  assert.ok(Math.abs(summary.monthlyAttritionPct - 10) < 1e-9);
  assert.equal(summary.activeClients, summary.sessions! / 4);
  assert.ok(Math.abs((summary.leadToClientRate ?? 0) - 0.2) < 1e-9);
  assert.ok(summary.leadsNeeded !== null && summary.leadsNeeded > 0);
  assert.equal(summary.sessionsToCloseGap, null);
  assert.match(summary.warnings.join(" "), /cannot be reached within configured/);
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

function salaryFixture() {
  const workspace = emptyWorkspace("2026-11-01");
  Object.assign(workspace.settings, {
    teamId: 7, forecastStart: "2026-11-01", horizonMonths: 1,
    baselineMode: "manual", baselineWeeklySessions: 7,
    baselineRetentionPct: 100, defaultInPersonPct: 0,
    organicClientsPerMonth: 0, sessionsPerClientMonth: 2, attendancePct: 100,
    targetProfitMonthly: 3000, overheadMode: "detailed",
  });
  const people: Context = {
    clinicians: [{ ...clinician, sessionRate: 100, weeksWorkedPerYear: 52.1786 }],
    staff: [], sessions: [],
  };
  workspace.clinicians.push(clinicianSettingSchema.parse({
    id: crypto.randomUUID(), clinicianId: 1, start: "2026-01-01",
    desiredWeeklySessions: 20, inPersonPct: 0,
    payMode: "salary", payAmount: 12000,
  }));
  return { workspace, context: people };
}

test("fixed monthly salary is paid once: 30 sessions at 100 need 10 extra to move profit from 2000 to 3000", () => {
  const source = salaryFixture(), before = structuredClone(source);
  const month = forecast(source.workspace, source.context, [], 1, false)[0];
  assert.ok(Math.abs(month.values.sessions! - 30) < 1e-8);
  assert.ok(Math.abs(month.values.profit! - 2000) < 1e-8);
  const summary = summarizeOperatingPlan(source.workspace, month, 6, "2026-11-01", source.context)!;
  assert.equal(summary.sessionsToCloseGap, 10);
  assert.ok(Math.abs(summary.contributionPerSession! - 100) < 1e-7);
  assert.deepEqual(source, before);
});

test("incremental engine includes per-session compensation, employer burden, fees and variable budgets", () => {
  const source = salaryFixture();
  source.workspace.clinicians[0].payMode = "per_session";
  source.workspace.clinicians[0].payAmount = 25;
  source.context.clinicians[0].classification = "w2";
  source.context.clinicians[0].w2EmployerFicaPct = 10;
  source.workspace.settings.processingPct = 2;
  const category = categorySchema.parse({ id: crypto.randomUUID(), name: "Session supplies", kind: "expense" });
  source.workspace.categories.push(category);
  source.workspace.budgets.push(budgetSchema.parse({
    id: crypto.randomUUID(), name: "Supplies", categoryId: category.id,
    start: "2026-01-01", amount: 10, cadence: "per_session",
  }));
  const month = forecast(source.workspace, source.context, [], 1, false)[0];
  source.workspace.settings.targetProfitMonthly = month.values.profit! + 605;
  const summary = summarizeOperatingPlan(source.workspace, month, 6, "2026-11-01", source.context)!;
  assert.ok(Math.abs(summary.contributionPerSession! - 60.5) < 1e-7);
  assert.equal(summary.sessionsToCloseGap, 10);
});

test("incremental engine crosses a split cap rather than extrapolating the current marginal share", () => {
  const source = salaryFixture();
  source.workspace.clinicians[0].payMode = "existing_split";
  source.workspace.clinicians[0].openingCapContribution = 0;
  Object.assign(source.context.clinicians[0], { capEnabled: true, capAmount: 1400, postCapClinicianSplit: 80, postCapPracticeSplit: 20 });
  source.workspace.settings.targetProfitMonthly = 1600;
  const month = forecast(source.workspace, source.context, [], 1, false)[0];
  assert.ok(Math.abs(month.values.profit! - 1200) < 1e-8);
  const summary = summarizeOperatingPlan(source.workspace, month, 6, "2026-11-01", source.context)!;
  assert.ok(Math.abs(summary.contributionPerSession! - 40) < 1e-7);
  assert.equal(summary.sessionsToCloseGap, 15);
});

test("selected-month inversion preserves preceding months' cap earnings", () => {
  const source = salaryFixture();
  source.workspace.settings.forecastStart = "2026-10-01";
  source.workspace.settings.horizonMonths = 2;
  source.workspace.clinicians[0].payMode = "existing_split";
  source.workspace.clinicians[0].openingCapContribution = 0;
  Object.assign(source.context.clinicians[0], { capEnabled: true, capAmount: 1400, postCapClinicianSplit: 80, postCapPracticeSplit: 20 });
  const month = forecast(source.workspace, source.context, [], 1, false)[1];
  source.workspace.settings.targetProfitMonthly = month.values.profit! + 200;
  const summary = summarizeOperatingPlan(source.workspace, month, 6, "2026-11-01", source.context)!;
  assert.ok(Math.abs(summary.contributionPerSession! - 20) < 1e-7);
  assert.equal(summary.sessionsToCloseGap, 10);
});

test("zero gap needs zero sessions; missing context and unreachable capacity cannot fabricate a requirement", () => {
  const source = salaryFixture();
  const month = forecast(source.workspace, source.context, [], 1, false)[0];
  const unknown = summarizeOperatingPlan(source.workspace, month)!;
  assert.equal(unknown.sessionsToCloseGap, null);
  assert.equal(unknown.contributionPerSession, null);
  assert.match(unknown.warnings.join(" "), /requires clinician context/);
  source.workspace.settings.targetProfitMonthly = 0;
  assert.equal(summarizeOperatingPlan(source.workspace, month)!.sessionsToCloseGap, 0);
  source.workspace.settings.targetProfitMonthly = 1000000;
  const unreachable = summarizeOperatingPlan(source.workspace, month, 6, "2026-11-01", source.context)!;
  assert.equal(unreachable.sessionsToCloseGap, null);
  assert.match(unreachable.warnings.join(" "), /configured clinician and room capacity/);
});

test("a fixed hourly roster cost also stays fixed for incremental sessions", () => {
  const source = salaryFixture();
  source.workspace.clinicians[0].payMode = "hourly";
  source.workspace.clinicians[0].payAmount = 20;
  source.workspace.clinicians[0].paidHoursPerWeek = 10;
  const month = forecast(source.workspace, source.context, [], 1, false)[0];
  source.workspace.settings.targetProfitMonthly = month.values.profit! + 1000;
  const summary = summarizeOperatingPlan(source.workspace, month, 6, "2026-11-01", source.context)!;
  assert.equal(summary.sessionsToCloseGap, 10);
  assert.ok(Math.abs(summary.contributionPerSession! - 100) < 1e-7);
});

test("incremental financial feasibility stays unknown with missing staff costs, even at zero displayed gap", () => {
  const source = salaryFixture();
  source.context.staff.push({ id: 1, goalId: 7, label: "Unknown support", annualSalary: null, hourlyRate: null, hoursPerWeek: null, weeksPerYear: 48, classification: "w2", w2EmployerFicaPct: 7.65, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 });
  source.workspace.settings.targetProfitMonthly = 0;
  const month = forecast(source.workspace, source.context, [], 1, false)[0];
  const before = structuredClone(source);
  const result = summarizeOperatingPlan(source.workspace, month, 6, "2026-11-01", source.context)!;
  assert.equal(result.sessionsToCloseGap, null);
  assert.match(result.warnings.join(" "), /Unknown support.*pay.*unavailable/);
  assert.deepEqual(source, before);
});

test("working forecasts do not manufacture incremental acquisition to answer a planning inverse", () => {
  const source = salaryFixture();
  const options = { workingForecast: true, useImportedBillingActuals: true, baselineWeeklyByClinician: { 1: 7 } };
  const month = forecast(source.workspace, source.context, [], 1, false, options)[0];
  const result = summarizeOperatingPlan(source.workspace, month, 6, "2026-11-01", source.context, options)!;
  assert.equal(result.sessionsToCloseGap, null);
  assert.match(result.warnings.join(" "), /observed session pace fixed.*planning scenario/);
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
      archived: false, funnelComplete: true,
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

test("numeric lead rows need completed reports before they can replace campaign assumptions", () => {
  const { workspace, context: people } = salaryFixture();
  workspace.campaigns.push(campaignSchema.parse({ id: crypto.randomUUID(), name: "Synthetic campaign", method: "cpl", monthlySpend: 1000, cpl: 50, consultationPct: 50, attendancePct: 80, closePct: 50, start: "2026-11-01" }));
  for (const month of ["2026-08", "2026-09", "2026-10"]) {
    const period = periodSchema.parse({ id: crypto.randomUUID(), name: month, start: month + "-01", end: month + "-28", funnelComplete: false });
    workspace.periods.push(period);
    workspace.funnels.push(funnelSchema.parse({ id: crypto.randomUUID(), periodId: period.id, scope: "practice", spend: 0, leads: 20, scheduled: 10, attended: 8, clients: 0, firstSessions: 0 }));
  }
  const month = forecast(workspace, people)[0];
  const before = structuredClone({ workspace, people });
  const incomplete = summarizeOperatingPlan(workspace, month, 6, "2026-11-01", people)!;
  assert.equal(incomplete.leadRateSource, "campaign");
  assert.ok(Math.abs(incomplete.leadToClientRate! - 0.2) < 1e-8);
  assert.deepEqual({ workspace, people }, before);
  workspace.periods[0].funnelComplete = true;
  workspace.periods[1].funnelComplete = true;
  assert.equal(summarizeOperatingPlan(workspace, month, 6, "2026-11-01", people)!.leadRateSource, "campaign");
  workspace.periods[2].funnelComplete = true;
  const complete = summarizeOperatingPlan(workspace, month, 6, "2026-11-01", people)!;
  assert.equal(complete.leadRateSource, "recorded");
  assert.equal(complete.leadToClientRate, 0, "a complete recorded zero outranks a campaign estimate");
  workspace.periods[2].funnelComplete = false;
  workspace.campaigns = [];
  const unknown = summarizeOperatingPlan(workspace, { ...month, channels: {} }, 6, "2026-11-01", people)!;
  assert.equal(unknown.leadToClientRate, null);
  assert.equal(unknown.leadsNeeded, null);
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
