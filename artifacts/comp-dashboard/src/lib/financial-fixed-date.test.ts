import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { budgetSchema, categorySchema, clinicianSettingSchema, emptyWorkspace, eventSchema, type Context, type PaceCoverage } from "@workspace/practice/hub";
import { moneyPlanningForecast } from "./money-planning-forecast.ts";
import { profitFirstPlanning, type ProfitFirstPlanningInput } from "./profit-first-planning.ts";
import * as planner from "./profit-first-planning.ts";

const close = (actual: number | null | undefined, expected: number) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function fixture() {
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { teamId: 7, defaultInPersonPct: 0, collectionPct: 100, processingPct: 3,
    processingFixedPerTransaction: .3, processingTransactionsPerSession: 1, overheadFloorMonthly: 0 });
  workspace.moneyPlanning = { estimatedMonthlyValues: { taxObligations: 0 } };
  const context: Context = { staff: [], sessions: [], clinicians: [{ id: 1, goalId: 7, label: "Synthetic clinician", classification: "1099",
    sessionRate: 100, sessionsPerWeek: 7, weeksWorkedPerYear: 52.1786, capEnabled: false, capAmount: 0,
    preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 60, postCapPracticeSplit: 40,
    w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }] };
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start: "2026-10-16", desiredWeeklySessions: 7, inPersonPct: 0 }));
  context.sessions.push({ id: -1, clinicianId: 1, start: "2026-10-21", end: "2026-10-21", completed: 14, desired: 0,
    scheduled: null, cancelled: null, noShow: null, inPerson: null, telehealth: null, sourceAttachmentId: null });
  const coverage: PaceCoverage[] = [{ clinicianId: 1, start: "2026-10-08", end: "2026-10-21" }];
  const expense = categorySchema.parse({ id: crypto.randomUUID(), name: "Synthetic operating costs", kind: "expense" });
  const marketing = categorySchema.parse({ id: crypto.randomUUID(), name: "Synthetic marketing", kind: "marketing" });
  workspace.categories.push(expense, marketing);
  const perSession = budgetSchema.parse({ id: crypto.randomUUID(), categoryId: expense.id, name: "Per-session service", amount: 10, cadence: "per_session", start: "2026-10-16" });
  const revenueShare = budgetSchema.parse({ id: crypto.randomUUID(), categoryId: expense.id, name: "Revenue-based service", amount: 10, cadence: "percent_revenue", start: "2026-10-16" });
  workspace.budgets.push(perSession, revenueShare,
    budgetSchema.parse({ id: crypto.randomUUID(), categoryId: marketing.id, name: "Explicit no marketing", amount: 0, cadence: "monthly", start: "2026-01-01" }));
  const report = moneyPlanningForecast(workspace, context, "2026-10-23", coverage, "2026-10");
  assert.equal(report.months.length, 1);
  const month = report.months[0];
  const { overhead: _overhead, ...values } = month.values;
  const input: ProfitFirstPlanningInput = {
    workspace, context, asOf: "2026-10-01", costSource: "budget", estimatedMonthlyValues: values,
    estimatedBudgetMonth: report.budgetEstimate, estimateSourcePeriod: report.basis,
  };
  return { workspace, context, coverage, report, month, input, perSession, revenueShare };
}

test("fixed October baseline reconciles dated variable Budget costs without applying active days twice", () => {
  const { month, report, input, perSession, revenueShare } = fixture();
  const original = structuredClone(input);
  assert.equal(report.observedAsOf, "2026-10-23");
  assert.equal(report.clinicianPace[0].usedWeekly, 7);
  close(month.values.sessions, 16);
  close(month.values.revenue, 1600);
  close(month.values.clinicianPay, 960);
  close(month.budgetLines?.[perSession.id], 160);
  close(month.budgetLines?.[revenueShare.id], 160);
  close(month.values.fees, 52.8);
  close(month.values.profit, 267.2);
  const planning = profitFirstPlanning(input);
  close(planning.costs.find(cost => cost.key === "overhead")?.monthly, 320);
  close(planning.rows.find(row => row.key === "operating-expenses")?.costMonthly, 372.8);
  close(planning.costs.find(cost => cost.key === "therapistPay")?.monthly, 960);
  assert.deepEqual(input, original);
});

test("missing or mismatched dated basis stays unknown, not a second proration", () => {
  for (const change of [
    (input: ProfitFirstPlanningInput) => { input.estimatedBudgetMonth = undefined; },
    (input: ProfitFirstPlanningInput) => { input.estimatedBudgetMonth!.month.date = "2026-09-01"; },
    (input: ProfitFirstPlanningInput) => { input.estimatedBudgetMonth!.month.periodEnd = "2026-10-21"; },
    (input: ProfitFirstPlanningInput) => { input.estimatedBudgetMonth!.month.budgetLines = {}; },
  ]) {
    const { input } = fixture();
    change(input);
    const original = structuredClone(input);
    const result = profitFirstPlanning(input);
    assert.equal(result.costs.find(cost => cost.key === "overhead")?.monthly, null);
    assert.match(result.reasons.join(" "), /dated Budget estimate is unavailable/);
    assert.deepEqual(input, original);
  }
});

test("changed source costs and changed monthly volume cannot reuse a stale estimate", () => {
  for (const change of [
    (input: ProfitFirstPlanningInput) => { input.workspace.budgets[0].amount = 20; },
    (input: ProfitFirstPlanningInput) => { input.workspace.budgets[0].start = "2026-10-20"; },
    (input: ProfitFirstPlanningInput) => { input.workspace.moneyPlanning!.estimatedMonthlyValues!.revenue = 3200; },
    (input: ProfitFirstPlanningInput) => { input.estimatedMonthlyValues!.sessions = 32; },
    (input: ProfitFirstPlanningInput) => { input.workspace.events.push(eventSchema.parse({ id: crypto.randomUUID(), name: "Dated cost change", field: "budget.amount", targetId: input.workspace.budgets[0].id, date: "2026-10-20", value: 20 })); },
  ]) {
    const { input } = fixture();
    change(input);
    const original = structuredClone(input);
    const result = profitFirstPlanning(input);
    assert.equal(result.costs.find(cost => cost.key === "overhead")?.monthly, null);
    assert.deepEqual(input, original);
  }
});

test("Budget edits produce a fresh dated estimate and full-month variable costs retain their old meaning", () => {
  const { input, context, coverage, workspace, perSession } = fixture();
  perSession.amount = 20;
  const fresh = moneyPlanningForecast(workspace, context, "2026-10-23", coverage);
  input.estimatedBudgetMonth = fresh.budgetEstimate;
  close(profitFirstPlanning(input).costs.find(cost => cost.key === "overhead")?.monthly, 480);
  for (const line of workspace.budgets) line.start = "2026-10-01";
  input.estimatedBudgetMonth = undefined;
  close(profitFirstPlanning(input).costs.find(cost => cost.key === "overhead")?.monthly, 480);
});

test("explicit zero, missing values and scenario mode stay distinct", () => {
  const { input, month, perSession, revenueShare } = fixture();
  month.budgetLines![perSession.id] = month.budgetLines![revenueShare.id] = 0;
  close(profitFirstPlanning(input).costs.find(cost => cost.key === "overhead")?.monthly, 0);
  month.budgetLines![perSession.id] = Number.NaN;
  assert.equal(profitFirstPlanning(input).costs.find(cost => cost.key === "overhead")?.monthly, null);
  input.costSource = "scenario";
  // Existing scenario overhead uses the trailing year ending September, not October.
  close(profitFirstPlanning(input).costs.find(cost => cost.key === "overhead")?.monthly, 0);
  input.costSource = "budget";
  input.estimatedMonthlyValues!.sessions = null;
  assert.equal(profitFirstPlanning(input).costs.find(cost => cost.key === "overhead")?.monthly, null);
});

test("missing tax planning remains missing despite a reconciled cost estimate", () => {
  const { input } = fixture();
  delete input.workspace.moneyPlanning!.estimatedMonthlyValues!.taxObligations;
  const result = profitFirstPlanning(input);
  close(result.costs.find(cost => cost.key === "overhead")?.monthly, 320);
  assert.equal(result.costs.find(cost => cost.key === "taxObligations")?.monthly, null);
  assert.equal(result.totalMonthly, null);
  assert.match(result.reasons.join(" "), /Quarterly tax planning estimate is missing/);
});

test("dated amount changes reuse the model's actual daily Budget slices", () => {
  const { input, workspace, context, coverage, perSession } = fixture();
  workspace.events.push(eventSchema.parse({ id: crypto.randomUUID(), name: "Dated service price", date: "2026-10-20", field: "budget.amount", targetId: perSession.id, value: 20 }));
  const fresh = moneyPlanningForecast(workspace, context, "2026-10-23", coverage);
  input.estimatedBudgetMonth = fresh.budgetEstimate;
  close(fresh.months[0].budgetLines?.[perSession.id], 4 * 10 + 12 * 20);
  close(profitFirstPlanning(input).costs.find(cost => cost.key === "overhead")?.monthly, 440);
});

test("quarterly and annual dated accruals are estimates, not invoice or payment dates", () => {
  const { input, workspace, context, coverage, perSession } = fixture();
  workspace.budgets.push(budgetSchema.parse({ id: crypto.randomUUID(), name: "Annual service", categoryId: perSession.categoryId, amount: 365, cadence: "annual", start: "2026-10-16" }),
    budgetSchema.parse({ id: crypto.randomUUID(), name: "Quarterly service", categoryId: perSession.categoryId, amount: 92, cadence: "quarterly", start: "2026-10-16" }));
  const fresh = moneyPlanningForecast(workspace, context, "2026-10-23", coverage);
  input.estimatedBudgetMonth = fresh.budgetEstimate;
  close(profitFirstPlanning(input).costs.find(cost => cost.key === "overhead")?.monthly, 320 + 16 + 16);
  assert.deepEqual(workspace.transactions, []);
});

test("fixed-date protected salary is counted once and imported charges do not rewrite the planning baseline", () => {
  const { input, workspace, context, coverage } = fixture();
  workspace.settings.familyW2ClinicianId = 1;
  workspace.clinicians[0].payMode = "salary";
  workspace.clinicians[0].payAmount = 12000;
  const fresh = moneyPlanningForecast(workspace, context, "2026-10-23", coverage);
  input.estimatedBudgetMonth = fresh.budgetEstimate;
  const { overhead: _overhead, ...values } = fresh.months[0].values;
  input.estimatedMonthlyValues = values;
  const original = structuredClone({ workspace, context, coverage });
  const planning = profitFirstPlanning(input);
  close(planning.protectedErinMonthly, 1000 * 16 / 31);
  close(planning.costs.find(cost => cost.key === "therapistPay")?.monthly, 0);
  close(planning.rows.find(row => row.key === "owner-payroll")?.costMonthly, 1000 * 16 / 31);
  assert.deepEqual({ workspace, context, coverage }, original);
  context.importedBillingActuals = [{ clinicianId: 1, serviceDate: "2026-10-21", totalFeeCharged: 9999, sourceRowHash: "synthetic-charge-not-a-forecast-fee" }];
  const withCharges = moneyPlanningForecast(workspace, context, "2026-10-23", coverage);
  close(withCharges.months[0].values.revenue, 1600);
  assert.deepEqual(withCharges.months[0].values, fresh.months[0].values);
});

test("actual planning component forwards the dated basis and renders the corrected rounded Budget need without saving", () => {
  const require = createRequire(import.meta.url);
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const code = ts.transpileModule(readFileSync(new URL("../components/practice/profit-first-planning.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} as { default?: unknown } };
  vm.runInNewContext(code, { module, exports: module.exports, crypto: globalThis.crypto, require(name: string) {
    if (name === "@/lib/profit-first-planning") return planner;
    if (name === "@/components/hub/use-unsaved") return { useUnsaved() {} };
    if (name === "@/components/ui/popover") return { Popover: ({ children }: { children: unknown }) => children, PopoverTrigger: ({ children }: { children: unknown }) => children, PopoverContent: () => null };
    if (name.endsWith(".css")) return {};
    return require(name);
  } });
  const { input } = fixture();
  const original = structuredClone(input);
  const html = renderToStaticMarkup(React.createElement(module.exports.default, { ...input, renderMode: "allocations", onPlanningChange() { throw Error("Render must not save any planning inputs"); } }));
  const operatingRow = html.match(/<tr[^>]*>\s*<th[^>]*>Operating expenses[\s\S]*?<\/tr>/)?.[0];
  assert.ok(operatingRow, "Operating expenses row is present");
  assert.match(operatingRow, /\$373/);
  assert.doesNotMatch(operatingRow, /\$218/);
  assert.match(html, /planning|estimate/i);
  assert.deepEqual(input, original);
});
