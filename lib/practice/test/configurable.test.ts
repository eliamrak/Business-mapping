import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID as id } from "node:crypto";
import {
  emptyWorkspace,
  conditionSchema,
  conditionResult,
  ruleSchema,
  ruleResponseEvents,
  workspaceSchema,
  categorySchema,
  budgetSchema,
  categoryReport,
  campaignSchema,
  campaignEconomics,
  periodSchema,
  funnelSchema,
  customKpiSchema,
  calculateCustomKpis,
  forecast,
  goalSearchSchema,
  searchGoals,
  hiringSchema,
  eventSchema,
  budgetForRange,
  type Context,
  type ForecastMonth,
} from "../src/hub/index.ts";
const start = "2026-01-01";
const context: Context = {
  clinicians: [
    {
      id: 1,
      label: "Example",
      goalId: null,
      sessionRate: 100,
      sessionsPerWeek: 20,
      weeksWorkedPerYear: 52.1786,
      capEnabled: false,
      capAmount: 50000,
      preCapClinicianSplit: 60,
      preCapPracticeSplit: 40,
      postCapClinicianSplit: 75,
      postCapPracticeSplit: 25,
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
  const w = emptyWorkspace(start);
  Object.assign(w.settings, {
    baselineMode: "manual",
    baselineWeeklySessions: 20,
    baselineRetentionPct: 100,
    defaultInPersonPct: 0,
    horizonMonths: 6,
    openingCash: 50000,
  });
  return w;
};
const condition = (patch = {}) =>
  conditionSchema.parse({
    id: id(),
    type: "condition",
    metric: "revenue",
    operator: "gte",
    value: 0,
    upper: 100,
    scope: "practice",
    clinicianIds: [],
    periods: 1,
    compareTo: "value",
    ...patch,
  });
const series = (values: (number | null)[]): ForecastMonth[] =>
  values.map((value, i) => ({
    date: `2026-0${i + 1}-01`,
    values: { revenue: value },
    clinicians: {},
    channels: {},
    warnings: [],
    trace: {},
    constraint: "Test",
  }));
test("rolling averages and sums use complete windows, and percentage trends preserve zero denominators", () => {
  const w = setup(),
    m = series([10, 20, 30]);
  assert.equal(
    conditionResult(
      condition({ measure: "average", window: 3, value: 20 }),
      m,
      2,
      w,
    ),
    true,
  );
  assert.equal(
    conditionResult(
      condition({ measure: "sum", window: 3, value: 60 }),
      m,
      2,
      w,
    ),
    true,
  );
  assert.equal(
    conditionResult(condition({ measure: "average", window: 3 }), m, 1, w),
    null,
  );
  assert.equal(
    conditionResult(
      condition({ measure: "changePct", window: 2, value: 200 }),
      m,
      2,
      w,
    ),
    true,
  );
  assert.equal(
    conditionResult(
      condition({ measure: "changePct", window: 1 }),
      series([0, 20]),
      1,
      w,
    ),
    null,
  );
  assert.equal(
    conditionResult(
      condition({ measure: "average", window: 3 }),
      series([10, null, 30]),
      2,
      w,
    ),
    null,
  );
});
test("rule windows reject gaps and restrict active dates", () => {
  const w = setup(),
    m = series([10, 20, 30]);
  m[1].date = "2026-02-14";
  m[1].periodStart = "2026-02-01";
  m[2].date = "2026-03-14";
  m[2].periodStart = "2026-03-01";
  assert.equal(
    conditionResult(condition({ measure: "average", window: 2 }), m, 2, w),
    null,
  );
  assert.equal(
    conditionResult(condition({ start: "2026-04-01" }), series([10]), 0, w),
    false,
  );
});
test("metric, forecast and budget comparisons stay distinct and unknown references do not trigger", () => {
  const w = setup(),
    m = series([200]);
  m[0].values.collections = 150;
  m[0].forecastValues = { revenue: 180 };
  m[0].budgetValues = { revenue: 300 };
  assert.equal(
    conditionResult(
      condition({
        compareTo: "metric",
        comparisonMetric: "collections",
        value: 50,
      }),
      m,
      0,
      w,
    ),
    true,
  );
  assert.equal(
    conditionResult(condition({ compareTo: "forecast", value: 30 }), m, 0, w),
    false,
  );
  assert.equal(
    conditionResult(condition({ compareTo: "budget", value: -100 }), m, 0, w),
    true,
  );
  assert.equal(
    conditionResult(
      condition({ compareTo: "metric", comparisonMetric: "profit" }),
      m,
      0,
      w,
    ),
    null,
  );
});
test("selected-clinician trends compare each person's own observations", () => {
  const w = setup(),
    m = series([1, 2]);
  m[0].clinicians = { "1": { revenue: 10 }, "2": { revenue: 100 } };
  m[1].clinicians = { "1": { revenue: 20 }, "2": { revenue: 110 } };
  assert.equal(
    conditionResult(
      condition({
        scope: "all",
        clinicianIds: [1, 2],
        measure: "change",
        value: 10,
      }),
      m,
      1,
      w,
    ),
    true,
  );
  assert.equal(
    conditionResult(
      condition({
        scope: "all",
        clinicianIds: [1, 3],
        measure: "change",
        value: 10,
      }),
      m,
      1,
      w,
    ),
    null,
  );
});
test("multiple responses become independent draft events and leave the plan untouched", () => {
  const w = setup();
  w.events.push(
    eventSchema.parse({
      id: id(),
      name: "Hire template",
      field: "clinician.hire",
      targetId: "1",
      value: 20,
      date: start,
      enabled: false,
    }),
  );
  const r = ruleSchema.parse({
    id: id(),
    name: "Capacity rule",
    action: "Review demand",
    condition: condition(),
    responses: [
      { id: id(), name: "Hire", eventId: w.events[0].id, offsetMonths: 1 },
    ],
  });
  const before = JSON.stringify(w),
    events = ruleResponseEvents(r, w, "2026-03-01", id);
  assert.equal(events.length, 2);
  assert.equal(events[1].date, "2026-04-01");
  assert.equal(events[1].field, "clinician.hire");
  assert.equal(events[1].enabled, true);
  assert.equal(JSON.stringify(w), before);
  assert.notEqual(events[1].id, w.events[0].id);
});
test("dated KPI formulas preserve previous periods and reject version cycles", () => {
  const w = setup();
  w.kpis.push(
    customKpiSchema.parse({
      id: id(),
      name: "Target allowance",
      key: "allowance",
      left: "revenue",
      operation: "multiply",
      constant: 0.1,
      unit: "currency",
      versions: [
        {
          effectiveDate: "2026-03-01",
          left: "revenue",
          operation: "multiply",
          constant: 0.2,
        },
      ],
    }),
  );
  assert.equal(
    calculateCustomKpis(w, { revenue: 1000 }, "2026-02-28").allowance,
    100,
  );
  assert.equal(
    calculateCustomKpis(w, { revenue: 1000 }, "2026-03-31").allowance,
    200,
  );
  const m = forecast(w, context);
  assert.equal(m[0].values.allowance, m[0].values.revenue! * 0.1);
  assert.equal(m[2].values.allowance, m[2].values.revenue! * 0.2);
  w.kpis[0].versions[0].left = "allowance";
  assert.equal(workspaceSchema.safeParse(w).success, false);
});
test("nested category totals include descendants once and leave incomplete actuals unknown", () => {
  const w = setup();
  const parent = categorySchema.parse({
    id: id(),
    name: "Operations",
    kind: "expense",
  });
  const child = categorySchema.parse({
    id: id(),
    name: "Software",
    parentId: parent.id,
    kind: "expense",
  });
  w.categories.push(parent, child);
  w.budgets.push(
    budgetSchema.parse({
      id: id(),
      name: "Tools",
      categoryId: child.id,
      start,
      cadence: "monthly",
      amount: 100,
    }),
  );
  const report = categoryReport(w, forecast(w, context), {
    start,
    end: "2026-01-31",
  });
  assert.equal(report.rows[0].budget, 100);
  assert.equal(report.rows[0].directBudget, 0);
  assert.equal(report.rows[1].budget, 100);
  assert.equal(report.rows[1].depth, 1);
  assert.equal(report.rows[0].actual, null);
});
test("calendar budgets normalize cross-month periods and exclude planning-only lines from rule budgets", () => {
  const w = setup(),
    category = categorySchema.parse({ id: id(), name: "Ops", kind: "expense" });
  w.categories.push(category);
  const b = budgetSchema.parse({
    id: id(),
    name: "Test",
    categoryId: category.id,
    start,
    cadence: "monthly",
    amount: 310,
  });
  assert.ok(
    Math.abs(budgetForRange(b, "2026-01-25", "2026-02-07") - (70 + 77.5)) <
      1e-8,
  );
  w.budgets.push({ ...b, planningOnly: true });
  assert.equal(forecast(w, context)[0].budgetValues?.overhead, 0);
});
test("campaign economics supports entered and historical unit costs, missing actuals, and retention-limited payback", () => {
  const w = setup();
  const c = campaignSchema.parse({
    id: id(),
    name: "Ads",
    source: "Search",
    start,
    method: "cac",
    cac: 200,
    monthlySpend: 1000,
    economicsSource: "manual",
    revenuePerSession: 100,
    deliveryCostPerSession: 60,
    sessionsPerClientMonth: 4,
    retentionMonths: 3,
  });
  w.campaigns.push(c);
  w.settings.attendancePct = 100;
  let r = campaignEconomics(c, w, context, forecast(w, context), {
    start,
    end: "2026-01-31",
  });
  assert.equal(r.forecast.contributionLtv, 480);
  assert.equal(r.forecast.paybackMonths, 1.25);
  assert.equal(r.actual.netContribution, null);
  const p = periodSchema.parse({
    id: id(),
    name: "January",
    start,
    end: "2026-01-31",
    status: "finalized",
    revenue: 2000,
    expensesComplete: true,
  });
  w.periods.push(p);
  w.funnels.push(
    funnelSchema.parse({
      id: id(),
      periodId: p.id,
      campaignId: c.id,
      spend: 1000,
      leads: 10,
      scheduled: 5,
      attended: 5,
      clients: 5,
      firstSessions: 5,
      attributedSessions: 20,
      attributedRevenue: 2000,
      deliveryCosts: 1200,
    }),
  );
  c.economicsSource = "historical";
  r = campaignEconomics(c, w, context, forecast(w, context), {
    start,
    end: p.end,
  });
  assert.equal(r.forecast.unitCost, 60);
  assert.equal(r.actual.cac, 200);
  assert.equal(r.actual.netContribution, -200);
  c.economicsSource = "manual";
  c.deliveryCostPerSession = 100;
  assert.equal(
    campaignEconomics(c, w, context, forecast(w, context), {
      start,
      end: p.end,
    }).forecast.paybackMonths,
    null,
  );
});
test("goal search uses the shared forecast, configurable hiring delay and cash floor without mutating records", () => {
  const w = setup();
  w.settings.baselineWeeklySessions = 60;
  w.hiring.push(
    hiringSchema.parse({
      id: id(),
      name: "Associate",
      templateClinicianId: 1,
      start,
      delayMonths: 2,
      rampMonths: 1,
      desiredWeeklySessions: 20,
    }),
  );
  const search = goalSearchSchema.parse({
    metric: "sessions",
    target: 130,
    firstStart: start,
    lastStart: start,
    deadline: "2026-06-30",
    hiring: [{ profileId: w.hiring[0].id, maxCount: 1 }],
  });
  const before = JSON.stringify(w),
    result = searchGoals(w, context, search, id);
  assert.equal(result.tested, 2);
  assert.ok(result.feasible > 0);
  assert.equal(result.best[0].hires, 1);
  assert.ok(result.best[0].date! >= "2026-03-01");
  assert.equal(JSON.stringify(w), before);
  const direct = forecast(w, context, result.best[0].events, 1, false);
  assert.deepEqual(result.best[0].months, direct);
  const failed = searchGoals(
    w,
    context,
    { ...search, minimumCash: 100000 },
    id,
  );
  assert.equal(failed.feasible, 0);
  assert.ok(failed.nearest!.additionalCash > 0);
});
test("goal search rejects excessive combinations and out-of-horizon deadlines", () => {
  const w = setup();
  const search = goalSearchSchema.parse({
    metric: "revenue",
    target: 1,
    firstStart: start,
    lastStart: start,
    deadline: "2028-01-31",
  });
  assert.throws(() => searchGoals(w, context, search, id), /horizon/);
  const c = campaignSchema.parse({
    id: id(),
    name: "Ads",
    source: "Search",
    start,
    method: "cpl",
    monthlySpend: 1000,
  });
  w.campaigns.push(c);
  assert.throws(
    () =>
      searchGoals(
        w,
        context,
        {
          ...search,
          deadline: "2026-06-30",
          campaignId: c.id,
          spendMax: 1000,
          spendStep: 1,
        },
        id,
      ),
    /500/,
  );
});
