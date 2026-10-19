import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { budgetSchema, categorySchema, clinicianSettingSchema, emptyWorkspace, fundGoalSchema, goalSchema, workspaceSchema, conditionSchema, conditionResult, forecast, type Context, type ForecastMonth } from "@workspace/practice/hub";
import { CURRENT_PLANNING_ALLOCATIONS, profitFirstPlanning, type PlanningGoalPurpose, type ProfitFirstPlanningInput } from "./profit-first-planning.ts";
import { financialSessionGoal } from "./financial-session-goal.ts";

const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
function setup(): ProfitFirstPlanningInput {
  const workspace = emptyWorkspace("2026-01-01");
  workspace.settings.overheadFloorMonthly = 1000;
  workspace.settings.overheadFloorOverride = true;
  const context: Context = { clinicians: [], staff: [], sessions: [] };
  return { workspace, context, asOf: "2026-01-15", estimatedMonthlyValues: {
    revenue: 10000, otherIncome: 0, clinicianPay: 3000, ownerClinicalPay: 0,
    coOwnerSalaryPretax: 0, employerBurden: 0, staffCost: 400,
  }, estimateSourcePeriod: "2026-01 monthly billed estimate" };
}
function addGoal(input: ProfitFirstPlanningInput, amount: number, tag: PlanningGoalPurpose, basis: "monthly" | "annual" = "monthly") {
  input.workspace.moneyPlanning ??= {};
  input.workspace.moneyPlanning.goals ??= [];
  input.workspace.moneyPlanning.goals.push({ id: randomUUID(), name: "Synthetic funding", monthlyAmount: amount / (basis === "annual" ? 12 : 1), ...tag });
}
function addBudget(input: ProfitFirstPlanningInput, amount: number, cadence: "annual" | "monthly" | "weekly" | "biweekly" | "once" | "per_session" = "annual", kind: "expense" | "marketing" | "tax" | "reserve" | "owner" | "payroll" = "expense") {
  const category = categorySchema.parse({ id: randomUUID(), name: "Synthetic cost", kind });
  input.workspace.categories.push(category);
  input.workspace.budgets.push(budgetSchema.parse({ id: randomUUID(), name: "Synthetic cost", categoryId: category.id, amount, cadence, start: "2025-01-01" }));
}

test("confirmed current percentages and read-only input remain intact; estimates need no finalized period", () => {
  const input = setup(), before = structuredClone(input);
  const result = profitFirstPlanning(input);
  assert.deepEqual(CURRENT_PLANNING_ALLOCATIONS.map(r => r.percent), [2, 3, 28, 27, 36, 4, 0]);
  close(result.rows.reduce((n, r) => n + r.currentPercent, 0), 100);
  assert.equal(result.status, "estimated");
  assert.equal(result.sourcePeriod, "2026-01 monthly billed estimate");
  assert.deepEqual(input, before);
});

test("annual total / 12, already monthly average unchanged, labeled period retained", () => {
  const input = setup();
  input.overhead = { amount: 24000, basis: "annual-total", sourcePeriod: "2025 annual overhead estimate" };
  close(profitFirstPlanning(input).costs[0].monthly, 2000);
  input.overhead = { amount: 2000, basis: "monthly-average", sourcePeriod: "2025 monthly average estimate" };
  close(profitFirstPlanning(input).costs[0].monthly, 2000);
  assert.match(profitFirstPlanning(input).overheadSource, /2025 monthly average estimate/);
  input.overhead.sourcePeriod = "";
  assert.equal(profitFirstPlanning(input).costs[0].monthly, null);
});

test("default overhead uses previous 12 calendar months; mixed cadence, annual accrual and allowance counted once", () => {
  const input = setup();
  addBudget(input, 24000);
  addBudget(input, 100, "monthly");
  addBudget(input, 70, "weekly");
  addBudget(input, 140, "biweekly");
  addBudget(input, 1200, "once");
  const result = profitFirstPlanning(input);
  close(result.costs[0].monthly, (24000 + 1200 + 3650 + 3650 + 1200) / 12);
  assert.match(result.overheadSource, /2025-01-01 to 2025-12-31/);
  input.workspace.settings.overheadFloorMonthly = 4000;
  close(profitFirstPlanning(input).costs[0].monthly, 4000);
});

test("monthly overhead input never divided again; unknown volume budgets stay unknown", () => {
  const input = setup();
  input.estimatedMonthlyValues!.overhead = 2100;
  close(profitFirstPlanning(input).costs[0].monthly, 2100);
  delete input.estimatedMonthlyValues!.overhead;
  addBudget(input, 10, "per_session");
  assert.equal(profitFirstPlanning(input).costs[0].monthly, null);
});

test("configured Erin salary protected even against a smaller supplied value; not counted twice in clinician pay", () => {
  const input = setup();
  input.workspace.settings.familyW2ClinicianId = 2;
  input.context.clinicians.push({ id: 2, label: "Synthetic Erin", classification: "w2", goalId: null } as Context["clinicians"][number]);
  input.workspace.clinicians.push(clinicianSettingSchema.parse({ id: randomUUID(), clinicianId: 2, start: "2025-01-01", desiredWeeklySessions: 10, payMode: "salary", payAmount: 24000 }));
  const result = profitFirstPlanning(input);
  close(result.protectedErinMonthly, 2000);
  close(result.rows.find(r => r.key === "owner-payroll")!.requiredMonthly, 2000);
  close(result.rows.find(r => r.key === "therapist-payroll")!.requiredMonthly, 1000);
  close(result.totalMonthly, 4900);
  addGoal(input, 20000, { bucket: "business-profit", mode: "additional" });
  close(profitFirstPlanning(input).protectedErinMonthly, 2000);
  assert.equal(profitFirstPlanning(input).status, "infeasible");
});

test("inconsistent clinician subsets stay unknown, never negative payroll", () => {
  const input = setup();
  input.estimatedMonthlyValues!.ownerClinicalPay = 4000;
  const result = profitFirstPlanning(input);
  assert.equal(result.rows.find(r => r.key === "therapist-payroll")!.requiredMonthly, null);
  assert.match(result.reasons.join(" "), /exceeds.*clinician-pay/);
});

test("calendar-day salary accrual residue does not make zero remaining therapist payroll unknown", () => {
  const input = setup();
  input.estimatedMonthlyValues!.clinicianPay = 7999.999999999999;
  input.estimatedMonthlyValues!.coOwnerSalaryPretax = 8000;
  const report = profitFirstPlanning(input);
  close(report.costs.find(c => c.key === "therapistPay")!.monthly, 0);
  assert.equal(report.status, "estimated");
  assert.deepEqual(report.reasons, []);
});

test("building additional funding and marketing total goals count existing cost once", () => {
  const input = setup();
  input.estimatedMonthlyValues!.marketing = 500;
  addGoal(input, 24000, { bucket: "business-profit", mode: "additional" }, "annual");
  addGoal(input, 1000, { bucket: "operating-expenses", mode: "marketing-total" });
  addGoal(input, 800, { bucket: "operating-expenses", mode: "marketing-total" });
  const result = profitFirstPlanning(input);
  close(result.rows.find(r => r.key === "business-profit")!.requiredMonthly, 2200);
  close(result.rows.find(r => r.key === "operating-expenses")!.requiredMonthly, 2000);
  close(result.totalMonthly, 7900);
  input.workspace.moneyPlanning!.goals![1].monthlyAmount = 400;
  input.workspace.moneyPlanning!.goals![2].monthlyAmount = 300;
  close(profitFirstPlanning(input).rows.find(r => r.key === "operating-expenses")!.requiredMonthly, 1500);
});

test("bucket total target uses max rather than adding an existing expense", () => {
  const input = setup();
  addGoal(input, 800, { bucket: "operating-expenses", mode: "bucket-total" });
  close(profitFirstPlanning(input).rows.find(r => r.key === "operating-expenses")!.requiredMonthly, 1000);
  input.workspace.moneyPlanning!.goals![0].monthlyAmount = 2000;
  close(profitFirstPlanning(input).rows.find(r => r.key === "operating-expenses")!.requiredMonthly, 2000);
});

test("fund stock targets and collections do not become spending or billed income", () => {
  const input = setup();
  const base = profitFirstPlanning(input);
  input.workspace.fundGoals.push(fundGoalSchema.parse({ id: randomUUID(), name: "Building", amount: 100000, currentBalance: 10000 }));
  input.estimatedMonthlyValues!.collections = 999999;
  const result = profitFirstPlanning(input);
  close(result.totalMonthly, base.totalMonthly!);
  close(result.income, 10000);
  assert.match(result.assumptions.join(" "), /not monthly costs/);
});

test("costs, staffing, income and goals change required percentages and needed revenue", () => {
  const input = setup();
  const base = profitFirstPlanning(input);
  input.estimatedMonthlyValues!.revenue = 20000;
  close(profitFirstPlanning(input).rows.find(r => r.key === "admin-payroll")!.requiredPercent, 2);
  delete input.estimatedMonthlyValues!.staffCost;
  input.context.staff.push({ id: 1, label: "Synthetic staff", annualSalary: 24000, weeksPerYear: 48, classification: "1099", w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 });
  close(profitFirstPlanning(input).rows.find(r => r.key === "admin-payroll")!.requiredPercent, 10);
  addGoal(input, 2000, { bucket: "business-profit", mode: "additional" });
  assert.ok(profitFirstPlanning(input).neededRevenue! > base.neededRevenue!);
  close(profitFirstPlanning(input).neededRevenue, 8000 / 0.95);
});

test("infeasible allocations remain above 100 with exact dollars and needed revenue", () => {
  const input = setup();
  addGoal(input, 8000, { bucket: "business-profit", mode: "additional" });
  const result = profitFirstPlanning(input);
  close(result.totalPercent, 129);
  close(result.shortfall, 2900);
  close(result.neededRevenue, 12400 / 0.95);
  close(result.additionalRevenueNeeded, 12400 / 0.95 - 10000);
  assert.equal(result.status, "infeasible");
  input.scenarioPercents = { "business-profit": 120 };
  const excessive = profitFirstPlanning(input);
  assert.ok(excessive.totalPercent! > 200);
  assert.equal(excessive.noFiniteRevenueSolution, true);
  assert.equal(excessive.neededRevenue, null);
});

test("zero and unknown income preserve cost estimates without NaN or guessed percentages", () => {
  const input = setup();
  input.estimatedMonthlyValues!.revenue = 0;
  const zero = profitFirstPlanning(input);
  assert.equal(zero.totalPercent, null);
  assert.equal(zero.exceedsIncome, true);
  close(zero.shortfall, 4400);
  input.estimatedMonthlyValues!.revenue = null;
  const unknown = profitFirstPlanning(input);
  assert.equal(unknown.income, null);
  assert.equal(unknown.totalMonthly, null);
  assert.equal(unknown.neededRevenue, null);
  close(unknown.costs[0].monthly, 1000);
  assert.equal(unknown.status, "incomplete");
});

test("exactly 100% floors permit a finite minimum when every cost fits its share", () => {
  const input = setup();
  input.estimatedMonthlyValues!.clinicianPay = 6000;
  input.workspace.moneyPlanning = { scenarioPercents: Object.fromEntries(CURRENT_PLANNING_ALLOCATIONS.map(r => [r.key, r.percent])) };
  const low = profitFirstPlanning(input);
  close(low.shortfall, 2400);
  close(low.neededRevenue, 6000 / 0.36);
  assert.equal(low.noFiniteRevenueSolution, false);
  input.estimatedMonthlyValues!.revenue = 20000;
  const high = profitFirstPlanning(input);
  assert.equal(high.status, "estimated");
  close(high.neededRevenue, low.neededRevenue!);
  addGoal(input, 1, { bucket: "business-profit", mode: "additional" });
  assert.equal(profitFirstPlanning(input).noFiniteRevenueSolution, true);
  input.workspace.moneyPlanning.goals = [];
  input.workspace.moneyPlanning.scenarioPercents!["therapist-payroll"] = 0;
  input.workspace.moneyPlanning.scenarioPercents!["owner-payroll"] = 63;
  assert.equal(profitFirstPlanning(input).noFiniteRevenueSolution, true);
});

test("unconfigured family clinician plus null forecast salary is known absent", () => {
  const input = setup();
  const { overhead, ...values } = forecast(input.workspace, input.context)[0].values;
  assert.equal(values.coOwnerSalaryPretax, null);
  const result = profitFirstPlanning({ ...input, estimatedMonthlyValues: values });
  close(result.protectedErinMonthly, 0);
  close(result.rows.find(r => r.key === "owner-payroll")!.requiredMonthly, 0);
  assert.equal(result.status, "infeasible");
  assert.deepEqual(result.reasons, []);
  input.workspace.settings.familyW2ClinicianId = 99;
  assert.equal(profitFirstPlanning({ ...input, estimatedMonthlyValues: values }).protectedErinMonthly, null);
});

test("tax, reserve and owner obligations map once by bucket; explicit overrides remain resolvable", () => {
  const input = setup();
  addBudget(input, 1000, "monthly", "tax");
  addBudget(input, 500, "monthly", "reserve");
  addBudget(input, 700, "monthly", "owner");
  const report = profitFirstPlanning(input);
  close(report.rows.find(r => r.key === "taxes")!.requiredMonthly, 1000);
  close(report.rows.find(r => r.key === "business-profit")!.requiredMonthly, 500);
  close(report.rows.find(r => r.key === "owner-payroll")!.requiredMonthly, 700);
  assert.equal(report.status, "estimated");
  input.estimatedMonthlyValues!.ownerPayroll = 700;
  close(profitFirstPlanning(input).rows.find(r => r.key === "owner-payroll")!.requiredMonthly, 700);
  input.workspace.moneyPlanning = { estimatedMonthlyValues: { taxObligations: 1200, reserveObligations: 600 } };
  const overridden = profitFirstPlanning(input);
  close(overridden.rows.find(r => r.key === "taxes")!.requiredMonthly, 1200);
  close(overridden.rows.find(r => r.key === "business-profit")!.requiredMonthly, 600);
  assert.equal(overridden.status, "estimated");
  addBudget(input, 400, "monthly", "payroll");
  assert.equal(profitFirstPlanning(input).status, "incomplete");
  input.workspace.moneyPlanning.estimatedMonthlyValues!.payrollObligations = 0;
  const resolved = profitFirstPlanning(input);
  assert.equal(resolved.status, "estimated");
  close(resolved.rows.find(r => r.key === "admin-payroll")!.requiredMonthly, 400);
  input.workspace.moneyPlanning.estimatedMonthlyValues!.payrollObligations = 300;
  close(profitFirstPlanning(input).rows.find(r => r.key === "admin-payroll")!.requiredMonthly, 700);
});

test("missing costs differ from no spending record; explicit zero remains editable", () => {
  const input = setup();
  input.workspace.settings.overheadFloorOverride = false;
  input.workspace.settings.overheadFloorMonthly = 0;
  const result = profitFirstPlanning(input);
  assert.equal(result.costs[0].monthly, null);
  assert.match(result.reasons.join(" "), /absence of spending records is not a zero/);
  input.estimatedMonthlyValues!.overhead = 0;
  assert.equal(profitFirstPlanning(input).status, "estimated");
});

test("planning settings round-trip JSON, permit over 100%, and stay separate from metric goals", () => {
  const input = setup();
  addGoal(input, 2000, { bucket: "business-profit", mode: "additional" });
  addGoal(input, 1000, { bucket: "operating-expenses", mode: "marketing-total" });
  input.workspace.moneyPlanning!.scenarioPercents = { "business-profit": 120 };
  input.workspace.moneyPlanning!.estimatedMonthlyValues = { overhead: 2000, revenue: null };
  const stored = workspaceSchema.parse(JSON.parse(JSON.stringify(input.workspace)));
  assert.deepEqual(stored.moneyPlanning, input.workspace.moneyPlanning);
  assert.deepEqual(stored.goals, []);
  assert.equal(workspaceSchema.safeParse(emptyWorkspace("2026-01-01")).success, true);
  stored.moneyPlanning!.goals![0].bucket = "taxes";
  stored.moneyPlanning!.goals![0].mode = "marketing-total";
  assert.equal(workspaceSchema.safeParse(stored).success, false);
});

test("persisted monthly overrides win over forecast inputs, retain zero and unknown, and do not redivide overhead", () => {
  const input = setup();
  input.overhead = { amount: 24000, basis: "annual-total", sourcePeriod: "Synthetic annual estimate" };
  input.workspace.moneyPlanning = { estimatedMonthlyValues: { revenue: 20000, overhead: 0 }, scenarioPercents: { "admin-payroll": 120 } };
  const result = profitFirstPlanning(input);
  close(result.income, 20000);
  close(result.costs[0].monthly, 0);
  close(result.rows.find(r => r.key === "admin-payroll")!.requiredPercent, 120);
  input.workspace.moneyPlanning.estimatedMonthlyValues!.overhead = 2000;
  close(profitFirstPlanning(input).costs[0].monthly, 2000);
  input.workspace.moneyPlanning.estimatedMonthlyValues!.revenue = null;
  assert.equal(profitFirstPlanning(input).income, null);
  input.workspace.moneyPlanning.scenarioPercents!["admin-payroll"] = -1;
  assert.equal(workspaceSchema.safeParse(input.workspace).success, false);
});

test("archived funding goals are excluded and missing monthly funding remains unknown", () => {
  const input = setup();
  addGoal(input, 2000, { bucket: "business-profit", mode: "additional" });
  input.workspace.moneyPlanning!.goals![0].archived = true;
  assert.equal(profitFirstPlanning(input).goals.length, 0);
  input.workspace.moneyPlanning!.goals![0].archived = false;
  input.workspace.moneyPlanning!.goals![0].monthlyAmount = null;
  assert.equal(profitFirstPlanning(input).status, "incomplete");
  assert.match(profitFirstPlanning(input).reasons.join(" "), /monthly funding estimate/);
});

test("funding persistence cannot change existing financial-session targets or metric goal conditions", () => {
  const input = setup();
  Object.assign(input.workspace.settings, { baselineMode: "manual", baselineWeeklySessions: 100, baselineRetentionPct: 100, defaultInPersonPct: 0, weeksPerYear: 52.1786 });
  input.context.clinicians.push({ id: 1, label: "Synthetic clinician", classification: "owner", sessionRate: 100, sessionsPerWeek: 100, weeksWorkedPerYear: 52.1786, capEnabled: false, capAmount: 0, preCapClinicianSplit: 0, preCapPracticeSplit: 100, postCapClinicianSplit: 0, postCapPracticeSplit: 100, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 });
  input.workspace.goals.push(goalSchema.parse({ id: randomUUID(), name: "Profit", metric: "profit", amount: 400 }));
  const request = { workspace: input.workspace, context: input.context, range: { start: "2026-01-01", end: "2026-01-31" } };
  const before = financialSessionGoal(request);
  assert.equal(before.status, "available");
  const condition = conditionSchema.parse({ id: randomUUID(), type: "condition", metric: "profit", operator: "gte", value: 0, upper: 100, scope: "practice", clinicianIds: [], periods: 1, compareTo: "goal" });
  const series: ForecastMonth[] = [{ date: "2026-01-31", values: { profit: 500 }, clinicians: {}, channels: {}, trace: {}, warnings: [], constraint: "Synthetic" }];
  assert.equal(conditionResult(condition, series, 0, input.workspace), true);
  const metricGoals = structuredClone(input.workspace.goals);
  addGoal(input, 8000, { bucket: "business-profit", mode: "additional" });
  addGoal(input, 5000, { bucket: "operating-expenses", mode: "marketing-total" });
  assert.deepEqual(financialSessionGoal(request), before);
  assert.equal(conditionResult(condition, series, 0, input.workspace), true);
  assert.deepEqual(input.workspace.goals, metricGoals);
});
