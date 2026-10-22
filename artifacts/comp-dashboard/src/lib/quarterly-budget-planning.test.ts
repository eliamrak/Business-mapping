import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  budgetSchema,
  categorySchema,
  emptyWorkspace,
  workspaceSchema,
  type Workspace,
} from "@workspace/practice/hub";
import { profitFirstPlanning, type ProfitFirstPlanningInput } from "./profit-first-planning.ts";

type Budget = Workspace["budgets"][number];
const close = (actual: number | null | undefined, expected: number) =>
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function addBudget(
  input: ProfitFirstPlanningInput,
  amount: number,
  kind: "expense" | "marketing" = "expense",
  overrides: Partial<Budget> = {},
) {
  const category = categorySchema.parse({ id: randomUUID(), name: `Synthetic ${kind}`, kind });
  const budget = budgetSchema.parse({
    id: randomUUID(), name: `Synthetic quarterly ${kind}`, categoryId: category.id,
    start: "2026-01-01", amount, cadence: "quarterly", ...overrides,
  });
  input.workspace.categories.push(category);
  input.workspace.budgets.push(budget);
  return budget;
}

function setup(): ProfitFirstPlanningInput {
  const input: ProfitFirstPlanningInput = {
    workspace: emptyWorkspace("2026-01-01"),
    context: { clinicians: [], staff: [], sessions: [] },
    asOf: "2026-01-15",
    costSource: "budget",
    estimatedMonthlyValues: {
      revenue: 10000, otherIncome: 0, clinicianPay: 0, ownerClinicalPay: 0,
      coOwnerSalaryPretax: 0, employerBurden: 0, staffCost: 0, taxObligations: 0, fees: 0,
    },
  };
  addBudget(input, 0, "marketing");
  return input;
}

function plan(input: ProfitFirstPlanningInput) {
  const before = structuredClone(input);
  try {
    return profitFirstPlanning(input);
  } finally {
    assert.deepEqual(input, before, "planning must preserve every source input");
    assert.deepEqual(input.workspace.periods, []);
    assert.deepEqual(input.workspace.transactions, []);
    assert.deepEqual(input.workspace.familyPaychecks, []);
    assert.deepEqual(input.context.sessions, []);
  }
}

test("Money budget costs use the selected calendar month for quarterly 900", () => {
  const input = setup();
  addBudget(input, 900);
  for (const [asOf, expected] of [
    ["2026-03-31", 310], ["2026-01-01", 310], ["2026-02-14", 280], ["2026-01-31", 310],
    ["2026-04-15", 900 * 30 / 91],
  ] as const) {
    input.asOf = asOf;
    const report = plan(input);
    close(report.costs.find(cost => cost.key === "overhead")?.monthly, expected);
    close(report.rows.find(row => row.key === "operating-expenses")?.costMonthly, expected);
    assert.match(report.overheadSource, new RegExp(`${asOf.slice(0, 7)}-01 to`));
  }
});

test("explicit quarterly zero ignores preserved Money overrides and overhead goals", () => {
  const input = setup();
  addBudget(input, 0);
  input.workspace.settings.overheadFloorMonthly = 12000;
  input.workspace.settings.overheadFloorOverride = true;
  input.workspace.moneyPlanning = { estimatedMonthlyValues: { overhead: 9999, marketing: 8888 } };
  input.estimatedMonthlyValues!.overhead = 7777;
  input.estimatedMonthlyValues!.marketing = 6666;
  const report = plan(input);
  close(report.costs.find(cost => cost.key === "overhead")?.monthly, 0);
  close(report.costs.find(cost => cost.key === "marketing")?.monthly, 0);
  close(report.rows.find(row => row.key === "operating-expenses")?.costMonthly, 0);
});

test("quarterly effective dates clip active days in Money's selected month", () => {
  const input = setup();
  addBudget(input, 900, "expense", { start: "2026-01-16", end: "2026-03-15" });
  for (const [asOf, expected] of [
    ["2025-12-31", 0], ["2026-01-01", 160], ["2026-02-28", 280],
    ["2026-03-31", 150], ["2026-04-01", 0],
  ] as const) {
    input.asOf = asOf;
    close(plan(input).costs.find(cost => cost.key === "overhead")?.monthly, expected);
  }
});

test("quarterly marketing enters operating costs once and saved Money duplicates are ignored", () => {
  const input = setup();
  addBudget(input, 100, "expense", { cadence: "monthly" });
  const marketing = input.workspace.budgets[0];
  marketing.amount = 900;
  marketing.billingReferenceStart = "2026-02-28";
  input.workspace.moneyPlanning = { estimatedMonthlyValues: { overhead: 9999, marketing: 8888 } };
  input.estimatedMonthlyValues!.marketing = 7777;
  input.estimatedMonthlyValues!.fees = 5;
  for (const [asOf, expectedMarketing] of [
    ["2026-01-15", 310], ["2026-02-15", 280], ["2026-03-15", 310],
  ] as const) {
    input.asOf = asOf;
    const report = plan(input);
    close(report.costs.find(cost => cost.key === "overhead")?.monthly, 100);
    close(report.costs.find(cost => cost.key === "marketing")?.monthly, expectedMarketing);
    close(report.rows.find(row => row.key === "operating-expenses")?.costMonthly, 100 + expectedMarketing + 5);
  }
  input.workspace.moneyPlanning.goals = [{
    id: randomUUID(), name: "Synthetic marketing total", monthlyAmount: 500,
    bucket: "operating-expenses", mode: "marketing-total",
  }];
  const report = plan(input);
  close(report.costs.find(cost => cost.key === "marketing")?.monthly, 310);
  close(report.rows.find(row => row.key === "operating-expenses")?.costMonthly, 605);
  close(report.rows.find(row => row.key === "operating-expenses")?.requiredMonthly, 605);
});

test("2028 leap-year Money costs accrue the actual 91-day calendar quarter", () => {
  const input = setup();
  addBudget(input, 900, "expense", { start: "2028-01-01", billingReferenceStart: "2028-02-29" });
  const amounts = ([
    ["2028-01-15", 900 * 31 / 91], ["2028-02-29", 900 * 29 / 91], ["2028-03-15", 900 * 31 / 91],
  ] as const).map(([asOf, expected]) => {
    input.asOf = asOf;
    const value = plan(input).costs.find(cost => cost.key === "overhead")!.monthly;
    close(value, expected);
    return value!;
  });
  close(amounts.reduce((sum, value) => sum + value, 0), 900);
});

test("reloaded workspace retains quarterly sources and legacy overrides while Money reads selected-month costs", () => {
  const input = setup();
  const budget = addBudget(input, 900, "expense", {
    start: "2026-01-16", end: "2026-03-15", billingReferenceStart: "2025-10-31", billingDay: 31,
  });
  input.workspace.moneyPlanning = { estimatedMonthlyValues: { overhead: 9999, marketing: 8888 } };
  const original = structuredClone(input.workspace);
  input.workspace = workspaceSchema.parse(JSON.parse(JSON.stringify(input.workspace)));
  assert.deepEqual(input.workspace, original);
  assert.deepEqual(input.workspace.budgets.find(line => line.id === budget.id), budget);
  for (const [asOf, expected] of [["2026-01-15", 160], ["2026-02-15", 280], ["2026-03-15", 150]] as const) {
    input.asOf = asOf;
    close(plan(input).costs.find(cost => cost.key === "overhead")?.monthly, expected);
  }
  assert.deepEqual(input.workspace, original);
});
