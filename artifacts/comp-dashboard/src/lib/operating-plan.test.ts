import { test } from "node:test";
import assert from "node:assert/strict";
import {
  campaignSchema,
  emptyWorkspace,
  forecast,
  hiringSchema,
  type Context,
} from "@workspace/practice/hub";
import { summarizeOperatingPlan } from "./operating-plan.ts";

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

test("operating plan connects selected-period sessions, estimates, lead need, and hire contribution", () => {
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
  workspace.hiring.push(hiringSchema.parse({
    id: crypto.randomUUID(),
    name: "Associate hire",
    templateClinicianId: 1,
    start: "2026-09-01",
    desiredWeeklySessions: 20,
    rampMonths: 4,
    monthlySupport: 500,
  }));

  const month = forecast(workspace, context)[0];
  const summary = summarizeOperatingPlan(workspace, context, month)!;

  assert.ok((summary.weeklySessions ?? 0) > 16);
  assert.equal(summary.sessionsPerClientMonth, 4);
  assert.equal(summary.activeClients, summary.sessions! / 4);
  assert.ok(Math.abs((summary.leadToClientRate ?? 0) - 0.2) < 1e-9);
  assert.ok(summary.leadsNeeded !== null && summary.leadsNeeded > 0);
  assert.ok(summary.sessionsToCloseGap !== null && summary.sessionsToCloseGap > 0);
  assert.equal(summary.hire?.name, "Associate hire");
  assert.ok((summary.hire?.contribution ?? 0) > 0);
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

  const summary = summarizeOperatingPlan(workspace, context, forecast(workspace, context)[0])!;

  assert.equal(summary.leadToClientRate, null);
  assert.equal(summary.leadsNeeded, null);
  assert.match(summary.warnings.join(" "), /Lead requirements/);
});
