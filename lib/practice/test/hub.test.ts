import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  emptyWorkspace,
  workspaceSchema,
  categorySchema,
  budgetSchema,
  campaignSchema,
  roomSchema,
  periodSchema,
  funnelSchema,
  eventSchema,
  customKpiSchema,
  ruleSchema,
  forecast,
  estimateCampaign,
  budgetAmount,
  observed,
  calculateCustomKpis,
  eventIssues,
  evaluateRules,
  type Context,
} from "../src/hub/index.ts";
const id = () => randomUUID();
const start = "2026-01-01";
const clinician = {
  id: 1,
  label: "Test clinician",
  goalId: null,
  sessionRate: 100,
  sessionsPerWeek: 40,
  weeksWorkedPerYear: 52.1786,
  capEnabled: false,
  capAmount: 50000,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  postCapClinicianSplit: 75,
  postCapPracticeSplit: 25,
  classification: "w2",
  w2EmployerFicaPct: 7.65,
  futaSutaPct: 1,
  workersCompPct: 0.5,
  otherEmployerBurdenPct: 0.85,
};
const context: Context = { clinicians: [clinician], staff: [], sessions: [] };
const setup = () => {
  const w = emptyWorkspace(start);
  w.settings.baselineMode = "manual";
  w.settings.baselineWeeklySessions = 20;
  w.settings.baselineRetentionPct = 100;
  w.settings.defaultInPersonPct = 0;
  w.settings.horizonMonths = 12;
  return w;
};
const close = (a: number | null | undefined, b: number) =>
  assert.ok(a != null && Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test("shared forecast reconciles revenue, compensation, burden and profit", () => {
  const v = forecast(setup(), context)[0].values;
  close(v.sessions, (20 * 31) / 7);
  close(v.revenue, ((20 * 31) / 7) * 100);
  close(v.clinicianPay, (v.revenue ?? 0) * 0.6);
  close(v.employerBurden, (v.clinicianPay ?? 0) * 0.1);
  close(v.profit, (v.revenue ?? 0) * 0.34);
});
test("recurring budgets normalize calendar days and effective dates", () => {
  const c = categorySchema.parse({ id: id(), name: "Rent", kind: "expense" });
  const b = budgetSchema.parse({
    id: id(),
    name: "Rent",
    categoryId: c.id,
    start: "2026-01-16",
    amount: 3100,
    cadence: "monthly",
  });
  close(budgetAmount(b, start, "2026-01-31"), 1600);
  close(
    budgetAmount(
      { ...b, cadence: "biweekly", amount: 140 },
      start,
      "2026-01-31",
    ),
    160,
  );
  close(budgetAmount({ ...b, cadence: "once" }, "2026-02-01", "2026-02-28"), 0);
});
test("CPL and CAC methods converge with compatible funnel rates", () => {
  const w = setup(),
    c = campaignSchema.parse({
      id: id(),
      name: "Search",
      source: "Search",
      start,
      method: "cpl",
      monthlySpend: 1000,
      cpl: 50,
      consultationPct: 100,
      attendancePct: 100,
      closePct: 25,
    });
  const a = estimateCampaign(c, w),
    b = estimateCampaign({ ...c, method: "cac", cac: 200 }, w);
  close(a.leads, 20);
  close(a.clients, 5);
  close(b.clients, 5);
  close(b.leads, 20);
  assert.equal(b.inferredLeads, true);
  assert.equal(
    estimateCampaign({ ...c, method: "cac", cac: 200, closePct: 0 }, w).leads,
    null,
  );
});
test("click funnel and explicit manual volume work without conflating CAC and CPL", () => {
  const w = setup(),
    c = campaignSchema.parse({
      id: id(),
      name: "Display",
      source: "Display",
      start,
      method: "clicks",
      monthlySpend: 1000,
      cpm: 10,
      ctrPct: 2,
      clickToLeadPct: 5,
      consultationPct: 100,
      attendancePct: 100,
      closePct: 50,
    });
  close(estimateCampaign(c, w).leads, 100);
  close(estimateCampaign(c, w).clients, 50);
  close(
    estimateCampaign(
      { ...c, method: "manual", manualClients: 7, manualLeads: 20 },
      w,
    ).clients,
    7,
  );
});
test("historical marketing yield only uses finalized selected periods", () => {
  const w = setup(),
    c = campaignSchema.parse({
      id: id(),
      name: "Search",
      source: "Search",
      start,
      method: "historical",
      monthlySpend: 500,
    });
  w.campaigns.push(c);
  const p = periodSchema.parse({
    id: id(),
    name: "January",
    start,
    end: "2026-01-31",
    status: "finalized",
    revenue: 0,
    expensesComplete: true,
  });
  w.periods.push(p);
  w.funnels.push(
    funnelSchema.parse({
      id: id(),
      periodId: p.id,
      campaignId: c.id,
      spend: 1000,
      leads: 20,
      scheduled: 10,
      attended: 8,
      clients: 4,
      firstSessions: 4,
    }),
  );
  close(estimateCampaign(c, w).clients, 2);
  w.periods[0].status = "draft";
  assert.ok(estimateCampaign(c, w).warnings.length);
});
test("capacity is shared between layered campaigns and extra spend cannot invent sessions", () => {
  const w = setup();
  w.settings.baselineWeeklySessions = 100;
  w.campaigns = [
    campaignSchema.parse({
      id: id(),
      name: "Search",
      source: "Search",
      start,
      method: "cac",
      monthlySpend: 1000,
      cac: 10,
    }),
  ];
  const v = forecast(w, context)[0].values;
  close(v.sessions, (40 * 31) / 7);
  close(v.netRoi, -100);
  close(v.roas, 0);
});
test("room capacity limits in-person sessions but not telehealth", () => {
  const w = setup();
  w.rooms = [
    roomSchema.parse({
      id: id(),
      name: "Room",
      start,
      weeklyHours: 5,
      usablePct: 100,
    }),
  ];
  w.settings.defaultInPersonPct = 100;
  close(forecast(w, context)[0].values.sessions, (5 * 31) / 7);
  w.settings.defaultInPersonPct = 0;
  close(forecast(w, context)[0].values.sessions, (20 * 31) / 7);
});
test("cash collection delays remain distinct from earned revenue", () => {
  const w = setup();
  w.settings.collectionDelayMonths = 1;
  w.settings.openingReceivables = 1000;
  const m = forecast(w, context);
  close(m[0].values.collections, 1000);
  close(m[1].values.collections, m[0].values.revenue!);
  assert.notEqual(m[0].values.cash, m[0].values.profit);
});
test("owner cash waterfall reconciles without double-counting reserves or distributions", () => {
  const w = setup();
  w.settings.taxPct = 20;
  w.settings.reservePct = 10;
  w.settings.distributionPct = 50;
  w.settings.ownerPayrollMonthly = 500;
  w.settings.householdWithholdingPct = 10;
  w.settings.openingCash = 10000;
  const v = forecast(w, context)[0].values;
  close(v.taxReserve, v.profit! * 0.2);
  close(v.reserves, v.profit! * 0.1);
  close(v.distributions, v.profit! * 0.5);
  close(v.retainedCash, v.profit! * 0.2);
  close(v.cash, 10000 + v.retainedCash!);
  close(v.familyTakeHome, (500 + v.distributions!) * 0.9);
});
test("saved workspace rejects cycles, overlaps and invalid allocations", () => {
  const w = setup(),
    a = categorySchema.parse({ id: id(), name: "A", kind: "expense" }),
    b = categorySchema.parse({
      id: id(),
      name: "B",
      kind: "expense",
      parentId: a.id,
    });
  a.parentId = b.id;
  w.categories = [a, b];
  assert.equal(workspaceSchema.safeParse(w).success, false);
  w.categories = [];
  w.settings.taxPct = 90;
  w.settings.reservePct = 20;
  assert.equal(workspaceSchema.safeParse(w).success, false);
});
test("draft financial periods do not become actuals and missing actual costs stay unknown", () => {
  const w = setup();
  w.periods.push(
    periodSchema.parse({
      id: id(),
      name: "Jan",
      start,
      end: "2026-01-31",
      revenue: 1000,
    }),
  );
  assert.equal(
    observed(w, context, start, "2026-01-31").values.collections,
    null,
  );
  w.periods[0].status = "finalized";
  w.periods[0].expensesComplete = true;
  const v = observed(w, context, start, "2026-01-31").values;
  assert.equal(v.collections, 1000);
  assert.equal(v.profit, null);
});
test("sandbox changes do not mutate actuals or the active workspace", () => {
  const w = setup();
  const before = JSON.stringify(w);
  const e = eventSchema.parse({
    id: id(),
    name: "Rate increase",
    date: start,
    field: "clinician.rate",
    targetId: "1",
    value: 150,
  });
  assert.ok(
    forecast(w, context, [e])[0].values.revenue! >
      forecast(w, context)[0].values.revenue!,
  );
  assert.equal(JSON.stringify(w), before);
  close(
    forecast(w, context, [{ ...e, enabled: false }])[0].values.revenue,
    forecast(w, context)[0].values.revenue!,
  );
});
test("event dependency and same-target conflicts cannot silently resolve by edit order", () => {
  const a = eventSchema.parse({
      id: id(),
      name: "Rate A",
      date: start,
      field: "clinician.rate",
      targetId: "1",
      value: 100,
    }),
    b = { ...a, id: id(), name: "Rate B" };
  assert.ok(eventIssues([a, b]).length);
  assert.ok(eventIssues([{ ...a, dependsOn: [id()] }]).length);
  assert.ok(
    eventIssues([
      { ...a, dependsOn: [b.id] },
      { ...b, field: "custom", dependsOn: [a.id] },
    ]).length,
  );
});
test("custom KPI expressions are bounded operations, preserve missing data and cannot execute code", () => {
  const w = setup();
  w.kpis = [
    customKpiSchema.parse({
      id: id(),
      name: "Margin",
      key: "margin",
      left: "profit",
      operation: "divide",
      right: "revenue",
      unit: "percent",
    }),
  ];
  close(calculateCustomKpis(w, { profit: 25, revenue: 100 }).margin, 25);
  assert.equal(calculateCustomKpis(w, { profit: 25, revenue: 0 }).margin, null);
  w.kpis[0].left = "margin";
  assert.equal(calculateCustomKpis(w, { revenue: 100 }).margin, null);
});
test("nested rules evaluate all selected clinicians and consecutive windows", () => {
  const w = setup();
  w.rules = [
    ruleSchema.parse({
      id: id(),
      name: "Hire",
      action: "Begin recruiting",
      condition: {
        id: id(),
        type: "group",
        logic: "all",
        children: [
          {
            id: id(),
            type: "condition",
            metric: "utilization",
            operator: "gte",
            value: 40,
            upper: 100,
            scope: "all",
            clinicianIds: [1],
            periods: 2,
            compareTo: "value",
          },
        ],
      },
    }),
  ];
  const results = evaluateRules(w, forecast(w, context));
  assert.equal(results[0].date, "2026-02-01");
  w.rules[0].condition = {
    id: id(),
    type: "condition",
    metric: "utilization",
    operator: "gte",
    value: 40,
    upper: 100,
    scope: "all",
    clinicianIds: [1, 999],
    periods: 1,
    compareTo: "value",
  };
  assert.equal(evaluateRules(w, forecast(w, context))[0].date, null);
});
test("zero demand and zero capacity never produce NaN or infinite metrics", () => {
  const w = setup();
  w.settings.baselineWeeklySessions = 0;
  for (const m of forecast(w, { clinicians: [], staff: [], sessions: [] }))
    for (const v of Object.values(m.values))
      assert.ok(v === null || Number.isFinite(v));
});
