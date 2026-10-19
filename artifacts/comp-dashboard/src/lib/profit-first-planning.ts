import {
  budgetAmount, clinicianModelAt, clinicianTermsAt, monthEnd, staffMemberAt,
  type Context, type Values, type Workspace,
} from "@workspace/practice/hub";
import { calculateStaffMemberCost, staffCompensationKnown } from "@workspace/practice/compensation";
import { currentPracticeClinicians } from "./practice-scope.ts";
import { linkedGoalFor } from "./legacy-practice-goals.ts";
import type { CompensationGoal } from "./workspace-defaults.ts";

/** User-confirmed current allocations; these are facts, not recommended defaults. */
export const CURRENT_PLANNING_ALLOCATIONS = [
  { key: "business-profit", label: "Business profit", percent: 2 },
  { key: "taxes", label: "Taxes", percent: 3 },
  { key: "operating-expenses", label: "Operating expenses", percent: 28 },
  { key: "owner-payroll", label: "Owner payroll", percent: 27 },
  { key: "therapist-payroll", label: "Therapist payroll", percent: 36 },
  { key: "admin-payroll", label: "Admin payroll", percent: 4 },
  { key: "distributions", label: "Distributions", percent: 0 },
] as const;
export type PlanningBucket = typeof CURRENT_PLANNING_ALLOCATIONS[number]["key"];
export type PlanningGoalPurpose = {
  bucket: PlanningBucket;
  mode: "additional" | "bucket-total" | "marketing-total";
};
export type PlanningFundingGoal = PlanningGoalPurpose & {
  id: string;
  name: string;
  monthlyAmount: number | null;
  archived?: boolean;
};
/** Parent may persist this optional object on Workspace; never encode expenses as metric goals. */
export type { MoneyPlanningSettings } from "@workspace/practice/hub";
export type PlanningOverhead = {
  amount: number | null;
  basis: "annual-total" | "monthly-average";
  sourcePeriod: string;
};
export type ProfitFirstPlanningInput = {
  workspace: Workspace;
  context: Context;
  asOf: string;
  /** Monthly billed estimates, never collections. Explicit null overrides derived assumptions. */
  estimatedMonthlyValues?: Values;
  estimateSourcePeriod?: string;
  overhead?: PlanningOverhead;
  legacyGoal?: CompensationGoal | null;
  /** Optional scenario floors. Percentages may exceed 100; costs are never reduced to fit. */
  scenarioPercents?: Partial<Record<PlanningBucket, number | null>>;
};
export type PlanningCost = { key: string; label: string; monthly: number | null; source: string };
export type PlanningRow = {
  key: PlanningBucket; label: string; currentPercent: number; currentMonthly: number | null;
  costMonthly: number | null; requiredMonthly: number | null; requiredPercent: number | null;
  scenarioPercent: number | null;
};
const known = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const sum = (ns: (number | null)[]): number | null => ns.every(known) ? ns.reduce<number>((a, b) => a + b!, 0) : null;
const monthly = (amount: number, basis: "annual" | "monthly") => basis === "annual" ? amount / 12 : amount;
const dateValid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + "T12:00:00Z")) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
const monthAt = (date: string, offset: number) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + offset, 1)).toISOString().slice(0, 10);

/** Independent monthly funding estimate. No ledger, transfer, finalization or stored-input writes. */
export function profitFirstPlanning(input: ProfitFirstPlanningInput) {
  const { workspace: w, context, asOf } = input;
  const validDate = dateValid(asOf);
  const date = validDate ? asOf : "2000-01-01";
  const periodStart = monthAt(date, 0), periodEnd = monthEnd(date);
  const sourcePeriod = input.estimateSourcePeriod?.trim() || `${periodStart} to ${periodEnd} (monthly planning assumptions as of ${asOf})`;
  const overheadStart = monthAt(date, -12), overheadEnd = monthEnd(monthAt(date, -1));
  const reasons: string[] = validDate ? [] : ["Enter a valid planning date."];
  const assumptions = [
    "Planning estimates use billed income, not collections or bank balances. No spending record is required to plan configured costs.",
    "Current percentages are the user-confirmed baseline. Required percentages fund configured costs and goals; they are not normalized to 100%.",
    "Owner clinical pay and configured co-owner salary are subsets of clinician pay and are moved to Owner payroll once. Aggregate clinician employer burden remains in Therapist payroll unless supplied separately in a future model.",
    "Revenue needed holds monthly costs and contribution goals constant, retaining percentage floors. It is a funding estimate, not a volume forecast; rerun payroll and variable costs for a changed income or staffing scenario.",
  ];
  const planning = w.moneyPlanning ?? {};
  const values = { ...input.estimatedMonthlyValues, ...planning.estimatedMonthlyValues };
  const read = (key: string, fallback: () => number | null): number | null => {
    const value = Object.hasOwn(values, key) ? values[key] : fallback();
    return known(value) ? value : null;
  };
  const people = currentPracticeClinicians(w, context, date);
  const revenue = read("revenue", () => null);
  const otherIncome = read("otherIncome", () => {
    const incomeLines = w.budgets.filter(b => !b.archived && !b.planningOnly && w.categories.some(c => c.id === b.categoryId && !c.archived && c.kind === "income"));
    return budgetSum(incomeLines, periodStart, periodEnd);
  });
  const income = validDate ? sum([revenue, otherIncome]) : null;
  function budgetSum(lines: Workspace["budgets"], start: string, end: string): number | null {
    return sum(lines.map(b => {
      if (b.start > end || b.end && b.end < start) return 0;
      if (b.cadence === "per_session" && !known(values.sessions) || b.cadence === "percent_revenue" && !known(revenue)) return null;
      return budgetAmount(b, start, end, values.sessions ?? 0, revenue ?? 0);
    }));
  }
  const linesFor = (kinds: string[]) => w.budgets.filter(b => !b.archived && !b.planningOnly && w.categories.some(c => c.id === b.categoryId && !c.archived && kinds.includes(c.kind)));
  const taxObligations = read("taxObligations", () => budgetSum(linesFor(["tax"]), periodStart, periodEnd));
  const reserveObligations = read("reserveObligations", () => budgetSum(linesFor(["reserve"]), periodStart, periodEnd));
  const payrollLines = linesFor(["payroll"]).filter(b => b.start <= periodEnd && (!b.end || b.end >= periodStart));
  const payrollNeedsCombinedEstimate = payrollLines.length > 0 && !Object.hasOwn(planning.estimatedMonthlyValues ?? {}, "payrollObligations");
  // Payroll budgets do not identify whether they duplicate roster pay. A separate
  // explicit uncovered amount resolves that ambiguity without adding wages twice.
  const payrollObligations = payrollNeedsCombinedEstimate ? null : read("payrollObligations", () => 0);
  if (payrollNeedsCombinedEstimate) reasons.push("Payroll budgets may overlap roster compensation. Enter uncovered payroll obligations (zero if already included in monthly payroll estimates).");
  let overheadSource = `${overheadStart} to ${overheadEnd}; configured operating budget accrual / 12`;
  function deriveOverhead(): number | null {
    if (Object.hasOwn(planning.estimatedMonthlyValues ?? {}, "overhead")) {
      overheadSource = `${sourcePeriod}; saved monthly planning overhead override`;
      return known(values.overhead) ? values.overhead : null;
    }
    if (input.overhead) {
      overheadSource = `${input.overhead.sourcePeriod}; ${input.overhead.basis}`;
      if (!input.overhead.sourcePeriod.trim() || !known(input.overhead.amount)) return null;
      return input.overhead.basis === "annual-total" ? input.overhead.amount / 12 : input.overhead.amount;
    }
    if (Object.hasOwn(values, "overhead")) {
      overheadSource = `${sourcePeriod}; supplied monthly overhead estimate`;
      return known(values.overhead) ? values.overhead : null;
    }
    const lines = linesFor(["expense", "facility"]);
    const hasFloor = w.settings.overheadFloorOverride || w.settings.overheadGoalBasis === "fixed_dollars" || w.settings.overheadFloorMonthly > 0;
    // A recurring allowance and its budget detail represent the same overhead, not two expenses.
    const totals = Array.from({ length: 12 }, (_, i) => {
      const start = monthAt(date, i - 12);
      const detail = budgetSum(lines, start, monthEnd(start));
      if (detail === null) return null;
      const floor = hasFloor ? w.settings.overheadFloorMonthly : 0;
      return Math.max(detail, floor);
    });
    if (lines.length || hasFloor) {
      const annual = sum(totals);
      return annual === null ? null : annual / 12;
    }
    if (w.settings.overheadGoalBasis === "fixed_percent") {
      overheadSource = `${sourcePeriod}; configured overhead percentage of billed revenue`;
      return revenue !== null && known(w.settings.overheadGoalPercent) ? revenue * w.settings.overheadGoalPercent / 100 : null;
    }
    if (input.legacyGoal && known(input.legacyGoal.annualOverheadGoal)) {
      overheadSource = "Legacy labeled annual overhead target / 12 (planning assumption)";
      return input.legacyGoal.annualOverheadGoal / 12;
    }
    return null;
  }
  const overhead = deriveOverhead();
  const marketing = read("marketing", () => {
    const lines = linesFor(["marketing"]);
    const campaigns = w.campaigns.filter(c => !c.archived && !c.planningOnly && (!c.start || c.start <= periodEnd) && (!c.end || c.end >= periodStart));
    if (campaigns.some(c => !c.start || lines.some(b => b.campaignId === c.id))) {
      reasons.push("Marketing campaign and budget coverage needs an explicit combined monthly estimate to avoid overlap.");
      return null;
    }
    return sum([budgetSum(lines, periodStart, periodEnd), ...campaigns.map(c => {
      if (!known(c.monthlySpend)) return null;
      const first = c.start! > periodStart ? c.start! : periodStart;
      const last = c.end && c.end < periodEnd ? c.end : periodEnd;
      const days = (Date.parse(last) - Date.parse(first)) / 86400000 + 1;
      return (c.monthlySpend + (c.otherMonthlyCost ?? 0)) * days / Number(periodEnd.slice(8));
    })]);
  });
  const clinicianPay = read("clinicianPay", () => people.length ? null : 0);
  const ownerClinical = read("ownerClinicalPay", () => people.some(p => p.classification === "owner") ? null : 0);
  const erin = people.find(p => p.id === w.settings.familyW2ClinicianId);
  const configuredErinSalary = (() => {
    if (!erin) return w.settings.familyW2ClinicianId === null ? 0 : null;
    const profile = clinicianModelAt(w, erin.id, date), term = clinicianTermsAt(w, erin.id, date);
    const mode = term.payMode ?? profile?.payMode;
    const amount = term.payAmount ?? profile?.payAmount;
    return mode === "salary" && known(amount) ? amount / 12 : mode ? 0 : null;
  })();
  const suppliedErinSalary = read("coOwnerSalaryPretax", () => configuredErinSalary);
  const erinSalary = w.settings.familyW2ClinicianId === null && values.coOwnerSalaryPretax == null ? 0 : configuredErinSalary === null || suppliedErinSalary === null ? null : Math.max(configuredErinSalary, suppliedErinSalary);
  let therapistPay = sum([clinicianPay, ownerClinical, erinSalary]) === null ? null : clinicianPay! - ownerClinical! - erinSalary!;
  if (therapistPay !== null && therapistPay < -0.000001) {
    reasons.push("Owner clinical pay plus co-owner salary exceeds the supplied clinician-pay total; reconcile monthly estimate subsets.");
    therapistPay = null;
  }
  // Calendar-day accrual can leave a sub-microdollar residue when removing salary.
  if (therapistPay !== null && therapistPay < 0) therapistPay = 0;
  const burden = read("employerBurden", () => people.length ? null : 0);
  const ownerSeparate = read("ownerPayroll", () => sum([w.settings.ownerPayrollMonthly, budgetSum(linesFor(["owner"]), periodStart, periodEnd)]));
  const ownerBurden = read("ownerPayrollBurden", () => ownerSeparate === null ? null : ownerSeparate * w.settings.ownerPayrollBurdenPct / 100);
  const staff = context.staff.filter(s => (s.goalId ?? null) === w.settings.teamId);
  const staffCost = read("staffCost", () => sum(staff.map(s => {
    const effective = staffMemberAt(w, s, date);
    return staffCompensationKnown(effective) ? calculateStaffMemberCost(effective).totalAnnualCost / 12 : null;
  })));
  const fees = read("fees", () => {
    const pct = w.settings.processingPct === 0 ? 0 : revenue === null ? null : revenue * w.settings.collectionPct / 100 * w.settings.processingPct / 100;
    const fixed = w.settings.processingFixedPerTransaction === 0 ? 0 : known(values.sessions) ? values.sessions * w.settings.collectionPct / 100 * w.settings.processingTransactionsPerSession * w.settings.processingFixedPerTransaction : null;
    return sum([pct, fixed]);
  });
  const costs: PlanningCost[] = [
    { key: "overhead", label: "Overhead set-aside estimate", monthly: overhead, source: overheadSource },
    { key: "marketing", label: "Existing marketing estimate", monthly: marketing, source: sourcePeriod },
    { key: "fees", label: "Processing cost estimate", monthly: fees, source: sourcePeriod },
    { key: "ownerClinicalPay", label: "Owner clinical payroll estimate", monthly: ownerClinical, source: sourcePeriod },
    { key: "coOwnerSalaryPretax", label: "Protected Erin / configured co-owner salary estimate", monthly: erinSalary, source: `${sourcePeriod}; configured family clinician, included in clinician pay` },
    { key: "ownerPayroll", label: "Separate owner payroll estimate", monthly: ownerSeparate, source: sourcePeriod },
    { key: "ownerPayrollBurden", label: "Separate owner employer cost estimate", monthly: ownerBurden, source: sourcePeriod },
    { key: "therapistPay", label: "Other therapist payroll estimate", monthly: therapistPay, source: `${sourcePeriod}; clinician pay less owner clinical pay and co-owner salary` },
    { key: "employerBurden", label: "Clinician employer cost estimate", monthly: burden, source: sourcePeriod },
    { key: "staffCost", label: "Admin payroll estimate", monthly: staffCost, source: `${sourcePeriod}; supplied monthly total or dated staff compensation with employer burden` },
    { key: "taxObligations", label: "Configured tax obligations estimate", monthly: taxObligations, source: `${periodStart} to ${periodEnd}; dated tax budgets or explicit monthly override` },
    { key: "reserveObligations", label: "Configured reserve funding estimate", monthly: reserveObligations, source: `${periodStart} to ${periodEnd}; dated reserve budgets or explicit monthly override; included in Business profit funding` },
    { key: "payrollObligations", label: "Uncovered payroll obligations estimate", monthly: payrollObligations, source: `${periodStart} to ${periodEnd}; additional payroll not already included in roster compensation; included in Admin payroll` },
  ];
  const base: Record<PlanningBucket, number | null> = {
    "business-profit": reserveObligations === null ? null : Math.max(w.settings.targetProfitMonthly, reserveObligations),
    taxes: taxObligations, "operating-expenses": sum([overhead, marketing, fees]),
    "owner-payroll": sum([ownerSeparate, ownerBurden, ownerClinical, erinSalary]),
    "therapist-payroll": sum([therapistPay, burden]), "admin-payroll": sum([staffCost, payrollObligations]), distributions: 0,
  };
  const additions = Object.fromEntries(CURRENT_PLANNING_ALLOCATIONS.map(r => [r.key, 0])) as Record<PlanningBucket, number>;
  const goals: { id: string; label: string; monthly: number | null; tag: PlanningGoalPurpose; source: string }[] = [];
  for (const goal of (planning.goals ?? []).filter(g => !g.archived)) {
    if (!CURRENT_PLANNING_ALLOCATIONS.some(r => r.key === goal.bucket) || !["additional", "bucket-total", "marketing-total"].includes(goal.mode) || goal.mode === "marketing-total" && goal.bucket !== "operating-expenses") {
      reasons.push(`${goal.name}: invalid funding goal purpose.`);
      continue;
    }
    goals.push({ id: goal.id, label: goal.name, monthly: known(goal.monthlyAmount) ? goal.monthlyAmount : null, tag: { bucket: goal.bucket, mode: goal.mode }, source: "Monthly Money planning contribution goal" });
  }
  for (const goal of w.goals.filter(g => !g.archived)) {
    if (["profit", "ownerDistributionsPretax", "coOwnerSalaryPretax"].includes(goal.metric)) {
      goals.push({ id: goal.id, label: goal.name, monthly: monthly(goal.amount, goal.basis), tag: { bucket: goal.metric === "profit" ? "business-profit" : goal.metric === "ownerDistributionsPretax" ? "distributions" : "owner-payroll", mode: "bucket-total" }, source: `Workspace goal; ${goal.basis}` });
    }
  }
  for (const name of ["Business Profit", "Owner Pay", "Co-Owner Pay"]) {
    const linked = linkedGoalFor(name, w, input.legacyGoal);
    if (linked.origin === "legacy" && linked.goal && !w.goals.some(g => g.metric === linked.goal!.metric)) goals.push({ id: `legacy:${name}`, label: name, monthly: monthly(linked.goal.amount, linked.goal.basis), tag: { bucket: name === "Business Profit" ? "business-profit" : name === "Owner Pay" ? "distributions" : "owner-payroll", mode: "bucket-total" }, source: "Legacy annual goal / 12" });
  }
  let marketingTarget = marketing;
  for (const goal of goals) {
    const key = goal.tag.bucket;
    if (!known(goal.monthly)) { base[key] = null; reasons.push(`${goal.label}: enter a monthly funding estimate.`); continue; }
    if (goal.tag.mode === "additional") additions[key] += goal.monthly;
    else if (goal.tag.mode === "marketing-total") marketingTarget = marketingTarget === null ? null : Math.max(marketingTarget, goal.monthly);
    else if (base[key] !== null) base[key] = Math.max(base[key]!, goal.monthly);
  }
  if (goals.some(g => g.tag.mode === "marketing-total")) {
    const operatingCost = sum([overhead, marketingTarget, fees]);
    base["operating-expenses"] = operatingCost === null || base["operating-expenses"] === null ? null : Math.max(base["operating-expenses"], operatingCost);
  }
  // Goal totals and explicitly additional contributions are combined separately, once.
  const floors = CURRENT_PLANNING_ALLOCATIONS.map(row => {
    const scenarioPercents = { ...input.scenarioPercents, ...planning.scenarioPercents };
    const supplied = Object.hasOwn(scenarioPercents, row.key);
    const value = supplied ? scenarioPercents[row.key] : ["business-profit", "taxes", "distributions"].includes(row.key) ? row.percent : 0;
    if (!known(value)) reasons.push(`${row.label}: enter a nonnegative scenario percentage.`);
    return known(value) ? value / 100 : null;
  });
  function requirements(atIncome: number): (number | null)[] {
    return CURRENT_PLANNING_ALLOCATIONS.map((row, i) => base[row.key] === null || floors[i] === null ? null : Math.max(base[row.key]!, floors[i]! * atIncome) + additions[row.key]);
  }
  const amounts = requirements(income ?? 0);
  const rows: PlanningRow[] = CURRENT_PLANNING_ALLOCATIONS.map((row, i) => ({
    key: row.key, label: row.label, currentPercent: row.percent,
    currentMonthly: income === null ? null : income * row.percent / 100,
    costMonthly: base[row.key] === null ? null : base[row.key]! + additions[row.key],
    requiredMonthly: income === null && floors[i] !== 0 ? null : amounts[i],
    requiredPercent: income !== null && income > 0 && amounts[i] !== null ? amounts[i]! / income * 100 : null,
    scenarioPercent: floors[i] === null ? null : floors[i]! * 100,
  }));
  for (const cost of costs) if (cost.monthly === null) reasons.push(`${cost.label}: monthly model assumption is missing; absence of spending records is not a zero cost.`);
  if (revenue === null) reasons.push("Monthly billed revenue estimate is missing.");
  if (otherIncome === null) reasons.push("Other monthly income assumption is missing.");
  if (!input.estimateSourcePeriod && Object.keys(values).length) assumptions.push("Supplied values are treated as monthly estimates for the displayed planning month; the caller did not provide a separate source-period label.");
  if (w.events.some(e => e.enabled) || w.hiring.some(h => !h.archived)) assumptions.push("Event and hiring effects must be included in supplied monthly estimates; this planner does not replay those scenarios independently.");
  if (w.fundGoals.some(g => !g.archived)) assumptions.push("Fund targets and balances are not monthly costs. Enter an explicit recurring contribution as a planning goal to include funding.");
  const knownMonthly = amounts.reduce<number>((a, n) => a + (n ?? 0), 0);
  const totalMonthly = income === null ? null : sum(amounts);
  const exceedsIncome = income !== null && knownMonthly > income + 0.005;
  const shortfall = income === null ? null : Math.max(0, knownMonthly - income);
  let neededRevenue: number | null = null;
  const floorSum = sum(floors);
  const complete = validDate && reasons.length === 0 && amounts.every(known);
  const exactlyFull = floorSum !== null && Math.abs(floorSum - 1) < 1e-12;
  if (complete && exactlyFull) {
    const noAdditions = Object.values(additions).every(n => n === 0);
    const noUnfundedZeroShare = CURRENT_PLANNING_ALLOCATIONS.every((row, i) => floors[i]! > 0 || base[row.key] === 0);
    if (noAdditions && noUnfundedZeroShare) neededRevenue = Math.max(0, ...CURRENT_PLANNING_ALLOCATIONS.map((row, i) => floors[i]! > 0 ? base[row.key]! / floors[i]! : 0));
  } else if (complete && floorSum !== null && floorSum < 1) {
    let low = 0, high = Math.max(1, knownMonthly / (1 - floorSum));
    for (let i = 0; i < 80; i++) {
      const mid = (low + high) / 2;
      if (sum(requirements(mid))! > mid) low = mid; else high = mid;
    }
    neededRevenue = high;
  } else if (complete && floorSum !== null && floorSum > 1 && knownMonthly === 0) neededRevenue = 0;
  return {
    sourcePeriod, overheadSource, income, revenue, otherIncome, rows, costs, goals,
    totalMonthly, knownMonthly, totalPercent: income !== null && income > 0 && totalMonthly !== null ? totalMonthly / income * 100 : null,
    exceedsIncome, shortfall, neededRevenue,
    additionalRevenueNeeded: neededRevenue !== null && income !== null ? Math.max(0, neededRevenue - income) : null,
    status: complete && income !== null ? exceedsIncome ? "infeasible" as const : "estimated" as const : "incomplete" as const,
    reasons, assumptions, protectedErinMonthly: erinSalary,
    noFiniteRevenueSolution: complete && neededRevenue === null && floorSum !== null && (floorSum > 1 || exactlyFull),
  };
}
