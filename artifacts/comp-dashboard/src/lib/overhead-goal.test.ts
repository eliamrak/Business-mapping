import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  emptyWorkspace,
  workspaceSchema,
  settingsSchema,
  forecast,
  monthFlow,
  budgetSchema,
  categorySchema,
  overheadGoalAllowance,
  type Context,
} from "@workspace/practice/hub";
import { overheadGoalPatch, overheadGoalSummary } from "./overhead-goal.ts";
import { resolveWorkspaceDefaults } from "./workspace-defaults.ts";

const context: Context = {
  clinicians: [
    {
      id: 1,
      label: "Lane",
      goalId: null,
      sessionRate: 100,
      sessionsPerWeek: 20,
      weeksWorkedPerYear: 52.1786,
      capEnabled: false,
      capAmount: 0,
      preCapClinicianSplit: 60,
      preCapPracticeSplit: 40,
      postCapClinicianSplit: 60,
      postCapPracticeSplit: 40,
      classification: "1099",
      w2EmployerFicaPct: 0,
      futaSutaPct: 0,
      workersCompPct: 0,
      otherEmployerBurdenPct: 0,
    },
  ],
  staff: [],
  sessions: [],
};
const setup = () => {
  const workspace = emptyWorkspace("2026-01-01");
  Object.assign(workspace.settings, {
    baselineMode: "manual",
    baselineWeeklySessions: 20,
    baselineRetentionPct: 100,
    attendancePct: 100,
    defaultInPersonPct: 0,
    horizonMonths: 1,
    overheadFloorMonthly: 1200,
  });
  return workspace;
};
const close = (actual: number | null | undefined, expected: number) =>
  assert.ok(
    actual !== null &&
      actual !== undefined &&
      Math.abs(actual - expected) < 0.001,
    `${actual} != ${expected}`,
  );
const withActuals = (count = 10): Context => ({
  ...context,
  sessions: [
    {
      id: 1,
      revision: 1,
      updatedAt: "2026-01-15T00:00:00Z",
      clinicianId: 1,
      start: "2026-01-01",
      end: "2026-01-15",
      completed: count,
      desired: 20,
      cancelled: null,
      noShow: null,
      scheduled: null,
      inPerson: null,
      telehealth: null,
      sourceAttachmentId: null,
    },
  ],
});
function addBudget(
  workspace: ReturnType<typeof setup>,
  amount: number,
  cadence: "monthly" | "percent_revenue" = "monthly",
) {
  const category = categorySchema.parse({
    id: randomUUID(),
    name: "Operating",
    kind: "expense",
  });
  workspace.categories.push(category);
  workspace.budgets.push(
    budgetSchema.parse({
      id: randomUUID(),
      name: "Operating",
      categoryId: category.id,
      amount,
      cadence,
      start: "2026-01-01",
    }),
  );
}

test("legacy settings acquire no new goal or percentage and preserve round-trip behavior", () => {
  const workspace = setup();
  assert.equal(workspace.settings.overheadGoalBasis, undefined);
  assert.equal(workspace.settings.overheadGoalPercent, undefined);
  assert.equal(overheadGoalAllowance(workspace.settings, 10000), null);
  const dormantPercent = structuredClone(workspace);
  dormantPercent.settings.overheadGoalPercent = 30;
  assert.deepEqual(
    forecast(dormantPercent, context),
    forecast(workspace, context),
  );
  const restored = workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(forecast(restored, context), forecast(workspace, context));
  assert.deepEqual(
    monthFlow(restored, withActuals(), "2026-01-01", "2026-01-15"),
    monthFlow(workspace, withActuals(), "2026-01-01", "2026-01-15"),
  );
});

test("percentage schema rejects missing, excessive and nonfinite percentages and accepts explicit zero", () => {
  const settings = setup().settings;
  for (const overheadGoalPercent of [undefined, -1, 101, NaN, Infinity]) {
    assert.equal(
      settingsSchema.safeParse({
        ...settings,
        overheadGoalBasis: "fixed_percent",
        overheadGoalPercent,
      }).success,
      false,
    );
  }
  assert.equal(
    settingsSchema.parse({
      ...settings,
      overheadGoalBasis: "fixed_percent",
      overheadGoalPercent: 0,
    }).overheadGoalPercent,
    0,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...settings,
      overheadGoalBasis: "entered_expenses",
    }).success,
    false,
  );
});

test("fixed dollars remain fixed while their matching-period percentage changes", () => {
  const settings = {
    ...setup().settings,
    ...overheadGoalPatch("fixed_dollars", 1200),
  };
  assert.equal(overheadGoalSummary(settings, 10000).dollars, 1200);
  assert.equal(overheadGoalSummary(settings, 20000).dollars, 1200);
  assert.equal(overheadGoalSummary(settings, 10000).percent, 12);
  assert.equal(overheadGoalSummary(settings, 20000).percent, 6);
  assert.equal(overheadGoalSummary(settings, 5000, 0.5).percent, 12);
  assert.equal(overheadGoalSummary(settings, null).percent, null);
  assert.equal(overheadGoalSummary(settings, 0).percent, null);
});

test("fixed percentage remains fixed while dollars change; absent revenue stays unknown", () => {
  const settings = {
    ...setup().settings,
    ...overheadGoalPatch("fixed_percent", 12),
  };
  assert.equal(overheadGoalSummary(settings, 10000).dollars, 1200);
  assert.equal(overheadGoalSummary(settings, 20000).dollars, 2400);
  assert.equal(overheadGoalSummary(settings, 20000).percent, 12);
  assert.equal(overheadGoalSummary(settings, null).dollars, null);
  assert.equal(overheadGoalSummary(settings, 0).dollars, 0);
  assert.equal(settings.overheadFloorMonthly, 1200);
  assert.equal(settings.overheadMode, "baseline");
});

test("staging changes only the chosen input and never opts in from calculated equivalents", () => {
  const settings = setup().settings;
  const before = structuredClone(settings);
  overheadGoalSummary(settings, 10000);
  assert.deepEqual(settings, before);
  assert.deepEqual(overheadGoalPatch("fixed_percent", 15), {
    overheadGoalBasis: "fixed_percent",
    overheadGoalPercent: 15,
    overheadFloorOverride: true,
  });
  assert.deepEqual(overheadGoalPatch("fixed_dollars", 500), {
    overheadGoalBasis: "fixed_dollars",
    overheadFloorMonthly: 500,
    overheadFloorOverride: true,
  });
  for (const value of [NaN, Infinity, -1, 101])
    assert.throws(() => overheadGoalPatch("fixed_percent", value));
});

test("forecast respects the explicit percentage as revenue changes and ignores dormant dollar floor", () => {
  const workspace = setup();
  Object.assign(workspace.settings, overheadGoalPatch("fixed_percent", 10));
  const first = forecast(workspace, context)[0];
  const second = forecast(workspace, {
    ...context,
    clinicians: context.clinicians.map((person) => ({
      ...person,
      sessionRate: 200,
    })),
  })[0];
  close(first.values.overhead, first.values.revenue! * 0.1);
  close(second.values.overhead, second.values.revenue! * 0.1);
  close(second.values.overhead, first.values.overhead! * 2);
  assert.equal(workspace.settings.overheadGoalPercent, 10);
  assert.equal(workspace.settings.overheadFloorMonthly, 1200);
});

test("detailed budgets count toward the goal rather than being doubled, including budgets above the goal", () => {
  const workspace = setup();
  Object.assign(workspace.settings, overheadGoalPatch("fixed_percent", 10));
  addBudget(workspace, 200);
  addBudget(workspace, 3, "percent_revenue");
  let month = forecast(workspace, context)[0];
  close(
    month.values.overhead,
    Math.max(200 + month.values.revenue! * 0.03, month.values.revenue! * 0.1),
  );
  addBudget(workspace, 2000);
  month = forecast(workspace, context)[0];
  close(month.values.overhead, 2200 + month.values.revenue! * 0.03);
});

test("Money percentage uses matching observed revenue rather than prorated forecast revenue", () => {
  const workspace = setup();
  Object.assign(workspace.settings, overheadGoalPatch("fixed_percent", 15));
  const first = monthFlow(
    workspace,
    withActuals(10),
    "2026-01-01",
    "2026-01-15",
  );
  const second = monthFlow(
    workspace,
    withActuals(20),
    "2026-01-01",
    "2026-01-15",
  );
  close(first.revenue, 1000);
  close(first.overhead, 150);
  close(second.overhead, 300);
  addBudget(workspace, 10, "percent_revenue");
  close(
    monthFlow(workspace, withActuals(10), "2026-01-01", "2026-01-15").overhead,
    150,
  );
  addBudget(workspace, 20, "percent_revenue");
  close(
    monthFlow(workspace, withActuals(10), "2026-01-01", "2026-01-15").overhead,
    300,
  );
});

test("explicit dollar mode preserves the period fraction and explicit zero does not resurrect legacy floor", () => {
  const workspace = setup();
  Object.assign(workspace.settings, overheadGoalPatch("fixed_dollars", 1200));
  close(
    monthFlow(workspace, withActuals(), "2026-01-01", "2026-01-15").overhead,
    (1200 * 15) / 31,
  );
  Object.assign(workspace.settings, overheadGoalPatch("fixed_percent", 0));
  close(forecast(workspace, context)[0].values.overhead, 0);
  close(
    monthFlow(workspace, withActuals(), "2026-01-01", "2026-01-15").overhead,
    0,
  );
});

test("explicit choice bypasses inherited compensation overhead and legacy detailed mode remains intact", () => {
  const workspace = setup();
  workspace.settings.teamId = 7;
  const goals = [
    {
      id: 7,
      name: "Practice",
      ownerPayGoal: 0,
      secondOwnerPayGoal: 0,
      annualOverheadGoal: 120000,
      businessProfitGoal: 0,
    },
  ];
  const selected = {
    ...context,
    clinicians: context.clinicians.map((person) => ({ ...person, goalId: 7 })),
  };
  assert.equal(
    resolveWorkspaceDefaults(workspace, selected, goals).forecastWorkspace
      .settings.overheadFloorMonthly,
    10000,
  );
  workspace.settings.overheadMode = "detailed";
  assert.equal(
    resolveWorkspaceDefaults(workspace, selected, goals).forecastWorkspace
      .settings.overheadFloorMonthly,
    0,
  );
  Object.assign(workspace.settings, overheadGoalPatch("fixed_dollars", 1200));
  const dollars = resolveWorkspaceDefaults(workspace, selected, goals);
  assert.equal(dollars.inherited.overhead, false);
  assert.equal(dollars.forecastWorkspace.settings.overheadFloorMonthly, 1200);
  Object.assign(workspace.settings, overheadGoalPatch("fixed_percent", 8));
  const percentage = resolveWorkspaceDefaults(workspace, selected, goals);
  assert.equal(percentage.inherited.overhead, false);
  const month = forecast(percentage.forecastWorkspace, selected)[0];
  close(month.values.overhead, month.values.revenue! * 0.08);
});

test("matching-period Money excludes future operating budgets instead of doubling the allowance", () => {
  const workspace = setup();
  Object.assign(workspace.settings, overheadGoalPatch("fixed_percent", 15));
  addBudget(workspace, 3000);
  workspace.budgets[0].start = "2026-01-20";
  close(
    monthFlow(workspace, withActuals(10), "2026-01-01", "2026-01-15").overhead,
    150,
  );
});

test("explicit percentages survive workspace serialization without opting into the legacy expense mode", () => {
  const workspace = setup();
  workspace.settings.overheadMode = "detailed";
  Object.assign(workspace.settings, overheadGoalPatch("fixed_percent", 12));
  const restored = workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)));
  assert.equal(restored.settings.overheadGoalBasis, "fixed_percent");
  assert.equal(restored.settings.overheadGoalPercent, 12);
  assert.equal(restored.settings.overheadMode, "detailed");
  const month = forecast(restored, context)[0];
  close(month.values.overhead, month.values.revenue! * 0.12);
});
