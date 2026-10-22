import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  budgetAmount,
  budgetForRange,
  budgetSchema,
  categoryReport,
  categorySchema,
  emptyWorkspace,
  eventSchema,
  forecast,
  quarterlyBudgetBillingDates,
  quarterlyBudgetBillingWindow,
  workspaceSchema,
  type Context,
  type Workspace,
} from "../src/hub/index.ts";

type Budget = Workspace["budgets"][number];
const categoryId = randomUUID();
const quarterly = (overrides: Partial<Budget> = {}): Budget =>
  budgetSchema.parse({
    id: randomUUID(),
    name: "Synthetic quarterly expense",
    categoryId,
    start: "2026-01-01",
    amount: 900,
    cadence: "quarterly",
    ...overrides,
  });
const close = (actual: number | null | undefined, expected: number) =>
  assert.ok(
    actual != null && Math.abs(actual - expected) < 1e-8,
    `${actual} != ${expected}`,
  );
const unchanged = <T, R>(input: T, call: () => R): R => {
  const before = structuredClone(input);
  try {
    return call();
  } finally {
    assert.deepEqual(input, before, "domain calls must not mutate their inputs");
  }
};
const amount = (budget: Budget, start: string, end: string) =>
  unchanged(budget, () => budgetAmount(budget, start, end));
const dates = (budget: Budget, start: string, end: string) =>
  unchanged(budget, () => quarterlyBudgetBillingDates(budget, start, end));

test("planned billing windows cover twelve calendar months and clamp year-9999 overflow", () => {
  const cases = [
    { start: "2026-01-01", end: "2026-12-31", due: ["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"] },
    { start: "2026-02-01", end: "2027-01-31", due: ["2026-02-01", "2026-05-01", "2026-08-01", "2026-11-01"] },
    { start: "9999-01-01", end: "9999-12-31", due: ["9999-01-01", "9999-04-01", "9999-07-01", "9999-10-01"] },
    { start: "9999-02-01", end: "9999-12-31", due: ["9999-02-01", "9999-05-01", "9999-08-01", "9999-11-01"] },
    { start: "9999-12-01", end: "9999-12-31", due: ["9999-12-01"] },
  ];
  for (const { start, end, due } of cases) {
    const window = quarterlyBudgetBillingWindow(start);
    assert.deepEqual(window, { start, end });
    const planned = unchanged(window, () => dates(quarterly({ start }), window.start, window.end));
    assert.deepEqual(planned, due);
    for (const date of [window.start, window.end, ...planned]) {
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
      assert.ok(date >= start && date <= end);
    }
  }
});

test("budget schema accepts quarterly cadence and preserves its amount and dates", () => {
  const budget = quarterly({
    amount: 1234.56,
    start: "2026-01-16",
    end: "2027-04-30",
    billingReferenceStart: "2025-10-31",
    billingDay: 31,
  });
  assert.equal(budget.cadence, "quarterly");
  assert.equal(budget.amount, 1234.56);
  assert.equal(budget.start, "2026-01-16");
  assert.equal(budget.end, "2027-04-30");
  assert.equal(budget.billingReferenceStart, "2025-10-31");
});

test("quarterly accrual uses the 90 calendar days in Q1 2026", () => {
  const budget = quarterly();
  close(amount(budget, "2026-01-01", "2026-03-31"), 900);
  close(amount(budget, "2026-01-01", "2026-01-31"), 310);
  close(amount(budget, "2026-02-01", "2026-02-28"), 280);
  close(amount(budget, "2026-03-01", "2026-03-31"), 310);
  close(amount(budget, "2026-02-14", "2026-02-14"), 10);
});

test("leap-year Q1 accrual uses 91 days including February 29", () => {
  const budget = quarterly({ start: "2024-01-01" });
  close(amount(budget, "2024-01-01", "2024-03-31"), 900);
  close(amount(budget, "2024-01-01", "2024-01-31"), 900 * 31 / 91);
  close(amount(budget, "2024-02-01", "2024-02-29"), 900 * 29 / 91);
  close(amount(budget, "2024-02-29", "2024-02-29"), 900 / 91);
});

test("accrual splits quarter and year boundaries using each calendar quarter", () => {
  const budget = quarterly();
  close(amount(budget, "2026-03-31", "2026-04-01"), 10 + 900 / 91);
  close(amount(budget, "2026-03-15", "2026-04-15"), 170 + 900 * 15 / 91);
  close(amount(budget, "2026-04-01", "2026-06-30"), 900);
  close(amount(budget, "2026-12-31", "2027-01-01"), 900 / 92 + 10);
});

test("effective start and end clip accrual inclusively without resetting the quarter", () => {
  const budget = quarterly({ start: "2026-01-16", end: "2026-03-15" });
  close(amount(budget, "2026-01-01", "2026-03-31"), 590);
  close(amount(budget, "2026-01-01", "2026-01-31"), 160);
  close(amount(budget, "2026-03-01", "2026-03-31"), 150);
  close(amount(budget, "2026-01-16", "2026-01-16"), 10);
  close(amount(budget, "2026-03-15", "2026-03-15"), 10);
  close(amount(budget, "2026-01-01", "2026-01-15"), 0);
  close(amount(budget, "2026-03-16", "2026-04-30"), 0);
  close(amount(quarterly({ amount: 0 }), "2026-01-01", "2026-03-31"), 0);
  close(amount(quarterly({ archived: true }), "2026-01-01", "2026-03-31"), 0);
});

test("billing references and billing day do not change calendar-quarter accrual", () => {
  for (const billingReferenceStart of [null, "2025-11-30", "2026-02-28", "2027-01-31"]) {
    const budget = quarterly({ billingReferenceStart, billingDay: 27 });
    close(amount(budget, "2026-01-01", "2026-03-31"), 900);
    close(amount(budget, "2026-02-01", "2026-02-28"), 280);
    close(amount(budget, "2026-03-31", "2026-04-01"), 10 + 900 / 91);
  }
});

test("planned billing dates fall every three months from start without month-end drift", () => {
  const budget = quarterly({ start: "2026-01-31", billingDay: 5 });
  assert.deepEqual(dates(budget, "2026-01-01", "2027-01-31"), [
    "2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31", "2027-01-31",
  ]);
  assert.deepEqual(dates(budget, "2026-04-30", "2026-04-30"), ["2026-04-30"]);
  assert.deepEqual(dates(budget, "2026-05-01", "2026-07-30"), []);
});

test("reference anchor controls billing phase while effective and query dates clip it", () => {
  const budget = quarterly({
    start: "2026-03-15",
    end: "2026-10-30",
    billingReferenceStart: "2026-01-31",
    billingDay: 12,
  });
  assert.deepEqual(dates(budget, "2025-01-01", "2027-12-31"), ["2026-04-30", "2026-07-31"]);
  assert.deepEqual(dates(budget, "2026-05-01", "2026-07-31"), ["2026-07-31"]);
  const inclusiveEnd = { ...budget, end: "2026-10-31" };
  assert.deepEqual(dates(inclusiveEnd, "2026-07-31", "2026-10-31"), ["2026-07-31", "2026-10-31"]);
  const futureAnchor = quarterly({ billingReferenceStart: "2026-05-20" });
  assert.deepEqual(dates(futureAnchor, "2025-01-01", "2026-05-19"), []);
  assert.deepEqual(dates(futureAnchor, "2026-01-01", "2026-11-20"), [
    "2026-05-20", "2026-08-20", "2026-11-20",
  ]);
});

test("February 29 anchor keeps day 29 until a non-leap February requires clamping", () => {
  const budget = quarterly({ start: "2024-02-29" });
  assert.deepEqual(dates(budget, "2024-01-01", "2025-05-29"), [
    "2024-02-29", "2024-05-29", "2024-08-29", "2024-11-29", "2025-02-28", "2025-05-29",
  ]);
});

test("archived and legacy cadences have no quarterly planned billing dates", () => {
  assert.deepEqual(dates(quarterly({ archived: true }), "2026-01-01", "2026-12-31"), []);
  const legacyCadences = [
    "monthly", "weekly", "biweekly", "annual", "once", "per_session", "percent_revenue",
  ] as const;
  for (const cadence of legacyCadences) {
    const budget = quarterly({ cadence, amount: 10 });
    assert.deepEqual(dates(budget, "2026-01-01", "2026-12-31"), [], cadence);
  }
});

test("workspace JSON roundtrip preserves quarterly IDs, money and dates", () => {
  const workspace = emptyWorkspace("2026-01-01");
  workspace.categories.push(categorySchema.parse({ id: categoryId, name: "Synthetic expense", kind: "expense" }));
  workspace.budgets.push(quarterly({
    amount: 1234.56,
    start: "2026-01-16",
    end: "2027-07-31",
    billingReferenceStart: "2025-10-31",
    billingDay: 31,
  }));
  const restored = unchanged(workspace, () => workspaceSchema.parse(JSON.parse(JSON.stringify(workspace))));
  assert.deepEqual(restored, workspace);
  assert.deepEqual(restored.budgets[0], workspace.budgets[0]);
});

test("forecast and category report sum variable months without creating financial actuals", () => {
  const workspace = emptyWorkspace("2026-01-01");
  workspace.settings.horizonMonths = 6;
  workspace.categories.push(categorySchema.parse({ id: categoryId, name: "Synthetic expense", kind: "expense" }));
  const budget = quarterly({ billingReferenceStart: "2026-02-28" });
  workspace.budgets.push(budget);
  const context: Context = { clinicians: [], staff: [], sessions: [] };
  const months = unchanged({ workspace, context }, () => forecast(workspace, context));
  const expected = [310, 280, 310, 900 * 30 / 91, 900 * 31 / 91, 900 * 30 / 91];
  assert.equal(months.length, 6);
  months.forEach((month, index) => close(month.budgetLines[budget.id], expected[index]));
  close(months.slice(0, 3).reduce((sum, month) => sum + month.budgetLines[budget.id], 0), 900);
  close(months.slice(3).reduce((sum, month) => sum + month.budgetLines[budget.id], 0), 900);
  close(unchanged(budget, () => budgetForRange(budget, "2026-01-01", "2026-06-30")), 1800);
  close(unchanged(budget, () => budgetForRange(budget, "2026-03-31", "2026-04-01")), 10 + 900 / 91);
  const range = { start: "2026-01-01", end: "2026-06-30" };
  const { rows } = unchanged({ workspace, months, range }, () => categoryReport(workspace, months, range));
  const row = rows.find((item) => item.id === categoryId);
  assert.ok(row);
  close(row.budget, 1800);
  close(row.forecast, 1800);
  assert.equal(row.actual, null);
  assert.deepEqual(dates(budget, range.start, range.end), ["2026-02-28", "2026-05-28"]);
  assert.deepEqual(workspace.periods, []);
  assert.deepEqual(workspace.transactions, []);
  assert.deepEqual(workspace.familyPaychecks, []);
  assert.deepEqual(context.sessions, []);
});

test("dated quarterly amount changes accrue only during the event and preserve the original budget", () => {
  const workspace = emptyWorkspace("2026-01-01");
  workspace.settings.horizonMonths = 3;
  workspace.categories.push(categorySchema.parse({ id: categoryId, name: "Synthetic expense", kind: "expense" }));
  const budget = quarterly();
  workspace.budgets.push(budget);
  workspace.events.push(eventSchema.parse({
    id: randomUUID(), name: "Temporary quarterly increase", date: "2026-01-16", end: "2026-01-20",
    field: "budget.amount", targetId: budget.id, value: 1800,
  }));
  const context: Context = { clinicians: [], staff: [], sessions: [] };
  const months = unchanged({ workspace, context }, () => forecast(workspace, context));
  assert.equal(months.length, 3);
  [360, 280, 310].forEach((expected, index) => {
    close(months[index].budgetLines[budget.id], expected);
    close(months[index].values.overhead, expected);
  });
  close(months.reduce((sum, month) => sum + month.budgetLines[budget.id], 0), 950);
  assert.equal(budget.amount, 900);
  assert.deepEqual(workspace.periods, []);
  assert.deepEqual(workspace.transactions, []);
  assert.deepEqual(workspace.familyPaychecks, []);
});

test("planning-only quarterly budgets accrue only inside scheduled event segments", () => {
  const workspace = emptyWorkspace("2026-01-01");
  workspace.settings.horizonMonths = 6;
  workspace.categories.push(categorySchema.parse({ id: categoryId, name: "Synthetic expansion", kind: "expense" }));
  const budget = quarterly({ planningOnly: true });
  workspace.budgets.push(budget);
  const context: Context = { clinicians: [], staff: [], sessions: [] };
  const baseline = unchanged({ workspace, context }, () => forecast(workspace, context));
  assert.equal(baseline.length, 6);
  baseline.forEach(month => {
    close(month.budgetLines[budget.id], 0);
    close(month.values.overhead, 0);
  });
  workspace.events.push(eventSchema.parse({
    id: randomUUID(), name: "Quarterly template begins", date: "2026-01-16", end: "2026-01-20",
    field: "budget.amount", targetId: budget.id, value: 900,
  }));
  const januaryOnly = unchanged({ workspace, context }, () => forecast(workspace, context));
  januaryOnly.forEach((month, index) => close(month.budgetLines[budget.id], index === 0 ? 50 : 0));
  workspace.events.push(eventSchema.parse({
    id: randomUUID(), name: "Quarterly template resumes", date: "2026-02-01", end: "2026-02-28",
    field: "budget.amount", targetId: budget.id, value: 900,
  }));
  const months = unchanged({ workspace, context }, () => forecast(workspace, context));
  [50, 280, 0, 0, 0, 0].forEach((expected, index) => {
    close(months[index].budgetLines[budget.id], expected);
    close(months[index].values.overhead, expected);
  });
  assert.equal(budget.amount, 900);
  assert.equal(budget.planningOnly, true);
  assert.deepEqual(workspace.periods, []);
  assert.deepEqual(workspace.transactions, []);
  assert.deepEqual(workspace.familyPaychecks, []);
});
