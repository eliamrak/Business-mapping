import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  emptyWorkspace,
  forecast,
  eventSchema,
  roomSchema,
  locationSchema,
  clinicianSettingSchema,
  campaignSchema,
  periodSchema,
  ruleSchema,
  evaluateObservedRules,
  observed,
  datedValue,
  affordablePay,
  transitionInitiative,
  proposalSchema,
  workspaceSchema,
  forecastForPeriods,
  type Context,
  budgetSchema,
  categorySchema,
  termSchema,
  evaluateCondition,
} from "../src/hub/index.ts";
const id = () => randomUUID(),
  start = "2026-01-01";
const person = {
  id: 1,
  label: "123",
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
  classification: "1099",
  w2EmployerFicaPct: 0,
  futaSutaPct: 0,
  workersCompPct: 0,
  otherEmployerBurdenPct: 0,
};
const context: Context = { clinicians: [person], staff: [], sessions: [] };
const setup = () => {
  const w = emptyWorkspace(start);
  Object.assign(w.settings, {
    baselineMode: "manual",
    baselineWeeklySessions: 20,
    baselineRetentionPct: 100,
    defaultInPersonPct: 0,
    horizonMonths: 3,
  });
  return w;
};
const close = (a: number | null | undefined, b: number) =>
  assert.ok(a != null && Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test("dated changes apply only to active days and expire back to previous assumptions", () => {
  close(
    datedValue(
      100,
      [{ date: "2026-01-16", end: "2026-01-20", value: 200 }],
      start,
      "2026-01-31",
    ),
    (26 * 100 + 5 * 200) / 31,
  );
  const w = setup();
  w.events = [
    eventSchema.parse({
      id: id(),
      name: "Rate",
      date: "2026-01-16",
      field: "clinician.rate",
      targetId: "1",
      value: 200,
    }),
  ];
  close(
    forecast(w, context)[0].values.revenue,
    (20 / 7) * (15 * 100 + 16 * 200),
  );
});
test("simultaneous marketing price and spend changes integrate each day before aggregation", () => {
  const w = setup(),
    c = campaignSchema.parse({
      id: id(),
      name: "Search",
      source: "Search",
      start,
      method: "cac",
      monthlySpend: 3100,
      cac: 100,
    });
  w.campaigns = [c];
  w.events = [
    eventSchema.parse({
      id: id(),
      name: "More spend",
      date: "2026-01-16",
      field: "marketing.spend",
      targetId: c.id,
      value: 6200,
    }),
    eventSchema.parse({
      id: id(),
      name: "Higher CAC",
      date: "2026-01-16",
      field: "marketing.cac",
      targetId: c.id,
      value: 200,
    }),
  ];
  const m = forecast(w, context)[0];
  close(m.values.clients, 31);
  close(m.values.marketing, 4700);
});
test("room assignments cannot borrow another location's capacity", () => {
  const w = setup(),
    a = locationSchema.parse({ id: id(), name: "North" }),
    b = locationSchema.parse({ id: id(), name: "South" });
  w.locations = [a, b];
  w.rooms = [
    roomSchema.parse({
      id: id(),
      name: "North 1",
      locationId: a.id,
      start,
      weeklyHours: 5,
      usablePct: 100,
    }),
    roomSchema.parse({
      id: id(),
      name: "South 1",
      locationId: b.id,
      start,
      weeklyHours: 100,
      usablePct: 100,
    }),
  ];
  w.clinicians = [
    clinicianSettingSchema.parse({
      id: id(),
      clinicianId: 1,
      start,
      desiredWeeklySessions: 40,
      inPersonPct: 100,
      locationId: a.id,
    }),
  ];
  close(forecast(w, context)[0].values.sessions, (5 * 31) / 7);
});
test("telehealth consumes assigned office capacity only when configured", () => {
  const w = setup(),
    r = roomSchema.parse({
      id: id(),
      name: "Room",
      start,
      weeklyHours: 5,
      usablePct: 100,
      telehealthUsesRoom: true,
    });
  w.rooms = [r];
  w.clinicians = [
    clinicianSettingSchema.parse({
      id: id(),
      clinicianId: 1,
      start,
      desiredWeeklySessions: 40,
      inPersonPct: 0,
      roomId: r.id,
    }),
  ];
  close(forecast(w, context)[0].values.sessions, (5 * 31) / 7);
  w.rooms[0].telehealthUsesRoom = false;
  close(forecast(w, context)[0].values.sessions, (20 * 31) / 7);
});
test("salary is prorated to active dates and opening cap balances affect the forecast", () => {
  const w = setup();
  w.clinicians = [
    clinicianSettingSchema.parse({
      id: id(),
      clinicianId: 1,
      start: "2026-01-16",
      desiredWeeklySessions: 40,
      payMode: "salary",
      payAmount: 120000,
    }),
  ];
  close(forecast(w, context)[0].values.clinicianPay, (10000 * 16) / 31);
  w.settings.forecastStart = "2026-09-01";
  w.clinicians[0].payMode = "existing_split";
  w.clinicians[0].openingCapContribution = 50000;
  const c = { ...person, capEnabled: true };
  close(
    forecast(w, { ...context, clinicians: [c] })[0].values.clinicianPay,
    forecast(w, { ...context, clinicians: [c] })[0].values.revenue! * 0.75,
  );
});
test("recorded family pay excludes outside household income and costs", () => {
  const w = setup();
  w.settings.otherHouseholdIncome = 310;
  w.settings.householdBenefitsCost = 155;
  w.settings.includeOwnerClinical = true;
  w.periods = [
    periodSchema.parse({
      id: id(),
      name: "Half month",
      start,
      end: "2026-01-15",
      status: "finalized",
      revenue: 1200,
      earnedRevenue: 2000,
      expensesComplete: true,
      ownerPay: 500,
      ownerClinicalPay: 50,
      distributions: 70,
    }),
  ];
  const v = observed(w, context, start, "2026-01-31").values;
  close(v.revenue, 2000);
  close(v.collections, 1200);
  close(v.familyTakeHome, 620);
});
test("recorded rules require contiguous finalized periods and do not count missing intervals", () => {
  const w = setup();
  const p = (begin: string, end: string) =>
    periodSchema.parse({
      id: id(),
      name: begin,
      start: begin,
      end,
      status: "finalized",
      revenue: 1000,
      expensesComplete: true,
    });
  w.periods = [p("2026-01-01", "2026-01-14"), p("2026-01-16", "2026-01-29")];
  w.rules = [
    ruleSchema.parse({
      id: id(),
      name: "Collections",
      action: "Review",
      condition: {
        id: id(),
        type: "condition",
        metric: "collections",
        operator: "gte",
        value: 500,
        upper: 100,
        scope: "practice",
        clinicianIds: [],
        periods: 2,
        compareTo: "value",
      },
    }),
  ];
  assert.equal(
    evaluateObservedRules(w, context)[0].status,
    "insufficient data",
  );
  w.periods[1].start = "2026-01-15";
  assert.equal(evaluateObservedRules(w, context)[0].status, "triggered");
});

test("shared room allocation neither double-counts nor artificially loses capacity", () => {
  const w = setup();
  w.settings.baselineWeeklySessions = 40;
  w.settings.defaultInPersonPct = 100;
  w.rooms = [
    roomSchema.parse({
      id: id(),
      name: "Shared room",
      start,
      weeklyHours: 60,
      usablePct: 100,
    }),
  ];
  const result = forecast(w, {
    ...context,
    clinicians: [person, { ...person, id: 2, label: "Second" }],
  })[0];
  close(result.values.sessions, (40 * 31) / 7);
  close(result.values.roomUtilization, (40 / 60) * 100);
});
test("affordable salary and split maintain the selected profit floor without altering the plan", () => {
  const w = setup(),
    before = JSON.stringify(w),
    revenue = ((20 * 31) / 7) * 100;
  close(
    affordablePay(w, context, 1, "salary", 0, 1000).maximum,
    Math.floor((revenue - 1000) * 12 * 100) / 100,
  );
  const split = affordablePay(w, context, 1, "split", 0, 1000);
  assert.ok(split.maximum > 88 && split.maximum < 89);
  assert.equal(JSON.stringify(w), before);
  assert.equal(affordablePay(w, context, 1, "hourly", 0, 0).maximum, null);
});
test("initiative pause and resume preserve historical segments and original end dates", () => {
  const w = setup(),
    change = eventSchema.parse({
      id: id(),
      name: "Spend",
      date: start,
      end: "2026-12-31",
      field: "custom",
      value: 0,
      oneTimeCost: 100,
    });
  const p = proposalSchema.parse({
    id: id(),
    name: "Initiative",
    status: "active",
    approvedAt: "2026-01-01T00:00:00Z",
    approvedIds: [change.id],
    changes: [change],
  });
  w.proposals = [p];
  w.events = [{ ...change, initiativeId: p.id }];
  const paused = transitionInitiative(w, p.id, "paused", "2026-02-01", id);
  assert.equal(paused.events[0].end, "2026-01-31");
  const resumed = transitionInitiative(
    paused,
    p.id,
    "active",
    "2026-03-01",
    id,
  );
  assert.equal(resumed.events[0].end, "2026-01-31");
  assert.equal(resumed.events[1].date, "2026-03-01");
  assert.equal(resumed.events[1].oneTimeCost, 0);
  assert.equal(resumed.events[1].end, "2026-12-31");
  assert.equal(workspaceSchema.safeParse(resumed).success, true);
  const future = transitionInitiative(w, p.id, "paused", "2025-12-01", id);
  assert.equal(future.events[0].enabled, false);
  assert.equal(future.events[0].end, "2026-12-31");
});
test("approved expectations can be compared to exact financial periods without prorating actuals", () => {
  const w = setup(),
    m = forecast(w, context);
  close(
    forecastForPeriods(m, [{ start, end: "2026-01-15" }]).revenue,
    (m[0].values.revenue! * 15) / 31,
  );
  assert.equal(
    forecastForPeriods(m, [{ start: "2025-12-15", end: "2026-01-15" }]).revenue,
    null,
  );
});

test("mid-month pay mode changes use each day's terms", () => {
  const w = setup();
  w.terms = [
    termSchema.parse({
      id: id(),
      clinicianId: 1,
      effectiveDate: "2026-01-16",
      payMode: "salary",
      payAmount: 120000,
    }),
  ];
  close(
    forecast(w, context)[0].values.clinicianPay,
    (20 / 7) * 15 * 100 * 0.6 + (10000 * 16) / 31,
  );
  w.terms[0].payMode = "per_session";
  w.terms[0].payAmount = 80;
  close(
    forecast(w, context)[0].values.clinicianPay,
    (20 / 7) * (15 * 60 + 16 * 80),
  );
});
test("weekly room blocks follow calendar weekdays including new-room events", () => {
  const w = setup();
  const room = roomSchema.parse({
    id: id(),
    name: "Mondays",
    start,
    weeklyHours: 8,
    usablePct: 100,
    blocks: [{ day: 1, startHour: 9, endHour: 17 }],
  });
  w.rooms = [room];
  close(forecast(w, context)[0].values.roomCapacity, 32);
  w.rooms[0].planningOnly = true;
  assert.equal(forecast(w, context)[0].values.roomCapacity, null);
  w.events = [
    eventSchema.parse({
      id: id(),
      name: "Open room",
      date: "2026-01-16",
      field: "room.add",
      targetId: room.id,
      value: 1,
    }),
  ];
  close(forecast(w, context)[0].values.roomCapacity, 16);
});
test("planning templates contribute only during scheduled segments, including pause gaps", () => {
  const w = setup(),
    category = categorySchema.parse({
      id: id(),
      name: "Expansion",
      kind: "expense",
    });
  w.categories = [category];
  const budget = budgetSchema.parse({
    id: id(),
    name: "New rent",
    start,
    amount: 3100,
    cadence: "monthly",
    categoryId: category.id,
    planningOnly: true,
  });
  const campaign = campaignSchema.parse({
    id: id(),
    name: "New campaign",
    source: "Search",
    start,
    monthlySpend: 3100,
    cac: 100,
    method: "cac",
    planningOnly: true,
  });
  w.budgets = [budget];
  w.campaigns = [campaign];
  close(forecast(w, context)[0].values.overhead, 0);
  close(forecast(w, context)[0].values.marketing, 0);
  w.events = [
    eventSchema.parse({
      id: id(),
      name: "Rent begins",
      date: "2026-01-16",
      end: "2026-01-20",
      field: "budget.amount",
      targetId: budget.id,
      value: 3100,
    }),
    eventSchema.parse({
      id: id(),
      name: "Rent resumes",
      date: "2026-01-25",
      end: "2026-01-31",
      field: "budget.amount",
      targetId: budget.id,
      value: 3100,
    }),
    eventSchema.parse({
      id: id(),
      name: "Campaign",
      date: "2026-01-16",
      end: "2026-01-20",
      field: "marketing.spend",
      targetId: campaign.id,
      value: 3100,
    }),
  ];
  const m = forecast(w, context);
  close(m[0].values.overhead, 1200);
  close(m[0].values.marketing, 500);
  close(m[0].values.clients, 5);
  close(m[1].values.overhead, 0);
});
test("previous-period rules compare selected clinicians to their own prior values", () => {
  const w = setup(),
    m = forecast(w, context),
    condition = {
      id: id(),
      type: "condition" as const,
      metric: "sessions",
      operator: "gt" as const,
      value: 0,
      upper: 100,
      scope: "all" as const,
      clinicianIds: [1],
      periods: 1,
      compareTo: "previous" as const,
    };
  m[0].values.sessions = 1000;
  m[0].clinicians["1"].sessions = 10;
  m[1].clinicians["1"].sessions = 11;
  assert.equal(evaluateCondition(condition, m, 1, w), true);
});
test("forecast close rates exclude organic and delayed clients from the current funnel", () => {
  const w = setup();
  w.settings.organicClientsPerMonth = 20;
  w.campaigns = [
    campaignSchema.parse({
      id: id(),
      name: "Search",
      source: "Search",
      start,
      method: "cpl",
      monthlySpend: 1000,
      cpl: 50,
      consultationPct: 100,
      attendancePct: 80,
      closePct: 25,
      conversionDelayMonths: 1,
    }),
  ];
  close(forecast(w, context)[0].values.closePct, 25);
});
test("recurring event costs apply to room and custom expansions from their effective dates", () => {
  const w = setup();
  w.events = [
    eventSchema.parse({
      id: id(),
      name: "Facility expansion",
      date: "2026-01-16",
      end: "2026-01-31",
      field: "custom",
      value: 0,
      oneTimeCost: 1000,
      monthlyCost: 3100,
    }),
  ];
  const m = forecast(w, context);
  close(m[0].values.overhead, 2600);
  close(m[1].values.overhead, 0);
});
