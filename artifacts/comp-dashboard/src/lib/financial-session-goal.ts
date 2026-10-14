import {
  cashAllocationsForRange,
  forecast,
  forecastForPeriods,
  type Context,
  type ForecastMonth,
  type Values,
  type Workspace,
} from "@workspace/practice/hub";
import { linkedGoalFor, linkedFundGoalFor } from "./legacy-practice-goals.ts";
import type { CompensationGoal } from "./workspace-defaults.ts";

export type FinancialGoalRange = { start: string; end: string };
export type FinancialGoalTarget = {
  name: string;
  metric: string;
  amount: number | null;
  basis: "monthly" | "annual" | "period";
  source: string;
};
export type RecurringFundContribution = {
  fundName: string;
  allocationId: string;
  amount: number | null;
  basis: "monthly" | "annual" | "period";
  source: string;
};
export type FinancialSessionGoalInput = {
  /** Already resolved workspace: overhead selection and business facts are preserved. */
  workspace: Workspace;
  context: Context;
  range: FinancialGoalRange;
  /** Optional exact financial periods, contained in range and non-overlapping. */
  periods?: FinancialGoalRange[];
  legacyGoal?: CompensationGoal | null;
  /** Explicit financial scenario mix, never derived from capacity fractions. */
  baselineMix?: { byClinician: Record<number, number>; source: string };
  /** Explicit retainedCash targets or other registered measures, with provenance. */
  additionalTargets?: FinancialGoalTarget[];
  recurringFundContributions?: RecurringFundContribution[];
};
export type FinancialSessionGoalResult = {
  status: "available" | "unavailable";
  practiceWeeklyGoal: number | null;
  individualWeeklyGoals: Record<number, null>;
  knownSourceAssumptions: string[];
  unavailableReasons: string[];
  capacity: {
    weekly: number | null;
    roomWeekly: number | null;
    sufficient: boolean | null;
  };
  details: {
    range: FinancialGoalRange;
    periods: FinancialGoalRange[];
    weeks: number;
    monthUnits: number;
    baselineWeeklyRequired: number | null;
    targets: {
      name: string;
      metric: string;
      source: string;
      target: number | null;
      modeled: number | null;
    }[];
    values: Values | null;
  };
};

const dayMs = 86400000;
const dayNumber = (date: string) => Date.parse(date + "T00:00:00Z") / dayMs;
const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(dayNumber(date)) &&
  new Date(dayNumber(date) * dayMs).toISOString().slice(0, 10) === date;
const monthEnd = (date: string) =>
  new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
const monthIndex = (date: string) =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Inverts the existing forecast; no stored inputs, payroll, margins or targets are rewritten.
 * Minimum is conditional on the explicit scenario mix and existing acquisition/retention.
 * The capped engine cannot establish an unconstrained minimum above dated capacity.
 */
export function financialSessionGoal(
  input: FinancialSessionGoalInput,
): FinancialSessionGoalResult {
  const { workspace, context, range } = input;
  const periods = [...(input.periods ?? [range])].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  const assumptions = [
    "Uses existing forecast compensation, dated fees/pay, employer burden, chosen overhead, collections, taxes and cash allocations without rewriting business facts.",
    "Salary is already an expense before operating profit; salary and distribution targets are tested as separate measures, not added to payroll again.",
    "Operating profit and retained cash are distinct; a profit goal is not silently relabeled as retained profit.",
    "Active monthly/annual goals are recurring rates; their date is a deadline, not an effective start date.",
    "No personal minimum is attributed from clinician capacity or sessionsPerWeek fractions.",
  ];
  const reasons: string[] = [];
  const result: FinancialSessionGoalResult = {
    status: "unavailable",
    practiceWeeklyGoal: null,
    individualWeeklyGoals: Object.fromEntries(
      context.clinicians.map((c) => [c.id, null]),
    ),
    knownSourceAssumptions: assumptions,
    unavailableReasons: reasons,
    capacity: { weekly: null, roomWeekly: null, sufficient: null },
    details: {
      range: { ...range },
      periods,
      weeks: 0,
      monthUnits: 0,
      baselineWeeklyRequired: null,
      targets: [],
      values: null,
    },
  };
  if (
    !validDate(range.start) ||
    !validDate(range.end) ||
    range.start > range.end ||
    !periods.length ||
    periods.some(
      (p, i) =>
        !validDate(p.start) ||
        !validDate(p.end) ||
        p.start > p.end ||
        p.start < range.start ||
        p.end > range.end ||
        (i > 0 && periods[i - 1].end >= p.start),
    )
  ) {
    reasons.push(
      "Selected calendar window/financial periods are invalid or overlap.",
    );
    return result;
  }
  result.details.weeks = periods.reduce(
    (sum, p) => sum + (dayNumber(p.end) - dayNumber(p.start) + 1) / 7,
    0,
  );
  for (const p of periods) {
    let date = p.start;
    while (date <= p.end) {
      const end = monthEnd(date);
      const stop = end < p.end ? end : p.end;
      result.details.monthUnits +=
        (dayNumber(stop) - dayNumber(date) + 1) / Number(end.slice(8));
      date = new Date((dayNumber(stop) + 1) * dayMs).toISOString().slice(0, 10);
    }
  }
  const horizon = monthIndex(range.end) - monthIndex(range.start) + 1;
  if (horizon > 60) {
    reasons.push(
      "Selected window exceeds the forecast's 60-month supported horizon.",
    );
    return result;
  }
  // Financial flows are monthly in forecastForPeriods. Daily salary alone cannot
  // justify prorating changing revenue/pay/capacity into an arbitrary subwindow.
  const partialMonths = new Set<string>();
  for (const p of periods) {
    if (!p.start.endsWith("-01")) partialMonths.add(p.start.slice(0, 7));
    if (p.end !== monthEnd(p.end)) partialMonths.add(p.end.slice(0, 7));
  }
  const changingDates = [
    ...workspace.terms.map((t) => t.effectiveDate),
    ...workspace.staffTerms.flatMap((t) => [t.effectiveDate, t.end]),
    ...workspace.clinicians.flatMap((c) => [c.start, c.end]),
    ...workspace.allocations.flatMap((a) => [a.start, a.end]),
    ...workspace.events
      .filter((e) => e.enabled)
      .flatMap((e) => [e.date, e.end]),
  ];
  if (
    changingDates.some(
      (date) =>
        date && !date.endsWith("-01") && partialMonths.has(date.slice(0, 7)),
    )
  )
    reasons.push(
      "Partial-month window has dated changes; monthly financial proration cannot establish an exact minimum. Daily financial aggregation is required.",
    );
  const selected = context.clinicians.filter((c) =>
    workspace.settings.teamId === null
      ? c.goalId == null
      : c.goalId === workspace.settings.teamId,
  );
  let mix = input.baselineMix?.byClinician;
  if (!mix && selected.length === 1) {
    mix = { [selected[0].id]: 1 };
    assumptions.push(
      "The selected practice has one clinician; all variable baseline sessions belong to that clinician.",
    );
  } else if (input.baselineMix) {
    assumptions.push(
      `Minimum is conditional on supplied clinician mix: ${input.baselineMix.source}. It is not a global optimization across alternate clinician mixes.`,
    );
  }
  if (
    !selected.length ||
    !mix ||
    selected.some((c) => !nonnegative(mix?.[c.id])) ||
    !selected.some((c) => (mix?.[c.id] ?? 0) > 0) ||
    (input.baselineMix && !input.baselineMix.source.trim())
  ) {
    reasons.push(
      "A defensible, complete selected-clinician financial scenario mix is unavailable.",
    );
  }
  const targets: FinancialGoalTarget[] = workspace.goals
    .filter((g) => !g.archived)
    .map((g) => ({ ...g, source: `workspace goal ${g.id}` }));
  for (const name of [
    "Owner Pay",
    "Co-Owner Pay",
    "Business Profit",
    "Desired Clinicians",
  ]) {
    const binding = linkedGoalFor(name, workspace, input.legacyGoal);
    if (binding.origin === "legacy" && binding.goal)
      targets.push({ ...binding.goal, source: `linked legacy ${name}` });
  }
  // The settings field has no unset marker: zero is not evidence of an explicit target.
  if (
    !targets.some((t) => t.metric === "profit") &&
    workspace.settings.targetProfitMonthly > 0
  )
    targets.push({
      name: "Operating profit",
      metric: "profit",
      amount: workspace.settings.targetProfitMonthly,
      basis: "monthly",
      source: "settings.targetProfitMonthly",
    });
  targets.push(...(input.additionalTargets ?? []));
  const fundConstraints: {
    target: FinancialGoalTarget;
    allocation: Workspace["allocations"][number];
  }[] = [];
  const funds = [...workspace.fundGoals.filter((f) => !f.archived)];
  for (const name of ["Building Fund", "Emergency Reserve", "Growth Fund"]) {
    const linked = linkedFundGoalFor(name, workspace, input.legacyGoal);
    if (linked.origin === "legacy" && linked.goal) {
      const contribution = input.recurringFundContributions?.find(
        (c) => c.fundName.toLowerCase() === name.toLowerCase(),
      );
      if (!contribution && linked.goal.amount > 0)
        reasons.push(
          `${name}: balance target has no evidenced recurring contribution.`,
        );
    }
  }
  for (const fund of funds) {
    if (
      fund.amount > 0 &&
      (fund.currentBalance == null || fund.currentBalance < fund.amount) &&
      !input.recurringFundContributions?.some(
        (c) => c.fundName.toLowerCase() === fund.name.toLowerCase(),
      )
    )
      reasons.push(
        `${fund.name}: fund balance/deadline does not establish a recurring contribution.`,
      );
  }
  for (const contribution of input.recurringFundContributions ?? []) {
    const allocation = workspace.allocations.find(
      (a) => !a.archived && a.id === contribution.allocationId,
    );
    if (!allocation || !contribution.source.trim()) {
      reasons.push(
        `${contribution.fundName}: recurring contribution needs an exact cash allocation and known source.`,
      );
      continue;
    }
    const metric =
      allocation.kind === "tax"
        ? "taxReserve"
        : allocation.kind === "distribution"
          ? "distributions"
          : allocation.kind === "retained"
            ? "retainedCash"
            : "reserves";
    const target = {
      name: `${contribution.fundName} recurring contribution`,
      metric,
      amount: contribution.amount,
      basis: contribution.basis,
      source: contribution.source,
    };
    if (fundConstraints.some((f) => f.allocation.id === allocation.id))
      reasons.push(
        `${contribution.fundName}: multiple contribution targets share one allocation; their distinct attribution is unavailable.`,
      );
    fundConstraints.push({ target, allocation });
    targets.push(target);
    assumptions.push(
      `${contribution.fundName}: tests the dated allocation percentage of positive cash basis (retained cash + tax reserve + reserves + distributions); unassigned retained cash and total fund balance are not the named fund contribution.`,
    );
  }
  const scale = (t: FinancialGoalTarget) =>
    t.metric === "activeClinicalHeadcount" || t.basis === "period"
      ? 1
      : result.details.monthUnits / (t.basis === "annual" ? 12 : 1);
  result.details.targets = targets.map((t) => ({
    name: t.name,
    metric: t.metric,
    source: t.source,
    target: nonnegative(t.amount) ? t.amount * scale(t) : null,
    modeled: null,
  }));
  if (!targets.length)
    reasons.push("No explicit current financial or metric target is set.");
  for (const t of targets)
    if (!nonnegative(t.amount) || !t.source.trim())
      reasons.push(
        `${t.name}: target or source is missing/invalid; explicit zero is supported.`,
      );
  const supportedMeasures = new Set([
    "sessions",
    "revenue",
    "profit",
    "familyTakeHome",
    "activeClinicalHeadcount",
    "ownerDistributionsPretax",
    "coOwnerSalaryPretax",
    "retainedCash",
    "reserves",
    "taxReserve",
    "distributions",
  ]);
  for (const t of targets)
    if (!supportedMeasures.has(t.metric))
      reasons.push(
        `${t.name}: ${t.metric} has no supported flow/headcount aggregation for this inverse.`,
      );
  if (reasons.length) return result;
  const mixTotal = selected.reduce((sum, c) => sum + mix![c.id], 0);
  const projectionWorkspace: Workspace = {
    ...workspace,
    settings: {
      ...workspace.settings,
      forecastStart: range.start.slice(0, 7) + "-01",
      horizonMonths: horizon,
    },
  };
  assumptions.push(
    "Forecast is anchored to the selected calendar window; selected financial periods determine totals and weekly denominator. Partial-month amounts use the engine's forecastForPeriods proration (gross salary uses daily measures).",
  );
  assumptions.push(
    "Existing organic/marketing acquisition and retention remain in the scenario; reported weekly Goal is delivered sessions, not baseline demand or current pace.",
  );
  const needsCostCoverage = targets.some(
    (t) => t.metric !== "sessions" && t.metric !== "activeClinicalHeadcount",
  );
  if (needsCostCoverage)
    assumptions.push(
      "Financial Goal requires covering modeled practice costs and allocations: operating profit and retained cash must be nonnegative. This adds no desired margin or personal pay target.",
    );
  assumptions.push(
    "Binary inversion assumes financial measures are nondecreasing with baseline demand in this scenario; it does not certify alternate mixes or arbitrary nonmonotone custom models.",
  );
  const aggregate = (months: ForecastMonth[], metric: string) => {
    const known = forecastForPeriods(months, periods);
    if (Object.hasOwn(known, metric)) return known[metric];
    let sum = 0;
    for (const p of periods)
      for (const month of months) {
        const start = month.date > p.start ? month.date : p.start;
        const end = monthEnd(month.date) < p.end ? monthEnd(month.date) : p.end;
        if (start > end) continue;
        const value = month.values[metric];
        if (value == null || !Number.isFinite(value)) return null;
        sum +=
          (value * (dayNumber(end) - dayNumber(start) + 1)) /
          Number(monthEnd(month.date).slice(8));
      }
    return sum;
  };
  const evaluate = (weekly: number) => {
    const months = forecast(projectionWorkspace, context, [], 1, false, {
      baselineWeeklyByClinician: Object.fromEntries(
        selected.map((c) => [c.id, (weekly * mix![c.id]) / mixTotal]),
      ),
    });
    const values = forecastForPeriods(months, periods);
    values.retainedCash = aggregate(months, "retainedCash");
    const modeled = targets.map((t) => {
      const fund = fundConstraints.find((f) => f.target === t);
      if (!fund) return aggregate(months, t.metric);
      let total = 0;
      for (const p of periods)
        for (const m of months) {
          const start = p.start > m.date ? p.start : m.date;
          const end = p.end < monthEnd(m.date) ? p.end : monthEnd(m.date);
          if (start > end) continue;
          const components = [
            "retainedCash",
            "taxReserve",
            "reserves",
            "distributions",
          ].map((metric) => m.values[metric]);
          if (
            components.some((value) => value == null || !Number.isFinite(value))
          )
            return null;
          const cashBasis = Math.max(
            0,
            components.reduce<number>((sum, value) => sum + value!, 0),
          );
          const sliceBasis =
            (cashBasis * (dayNumber(end) - dayNumber(start) + 1)) /
            Number(monthEnd(m.date).slice(8));
          // The exact allocation, not the entire cash-kind total, owns this share.
          // The engine helper clips its effective dates within the selected slice.
          const { buckets } = cashAllocationsForRange(
            [fund.allocation],
            sliceBasis,
            start,
            end,
          );
          total += buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
        }
      return total;
    });
    const costsCovered =
      !needsCostCoverage ||
      (values.profit != null &&
        values.retainedCash != null &&
        values.profit >= -1e-8 &&
        values.retainedCash >= -1e-8);
    return {
      months,
      values,
      modeled,
      met:
        costsCovered &&
        modeled.every(
          (v, i) =>
            v != null &&
            Number.isFinite(v) &&
            v + 1e-8 >= result.details.targets[i].target!,
        ),
    };
  };
  const zero = evaluate(0);
  result.capacity.weekly =
    zero.values.capacity == null
      ? null
      : zero.values.capacity / result.details.weeks;
  const rooms = aggregate(zero.months, "roomCapacity");
  result.capacity.roomWeekly =
    rooms == null ? null : rooms / result.details.weeks;
  assumptions.push(...new Set(zero.months.flatMap((m) => m.warnings)));
  if (
    zero.months.some((m) =>
      m.warnings.some(
        (warning) =>
          !warning.startsWith("Historical session coverage is incomplete") &&
          /unknown|missing|incomplete|unavailable|unverified|not found|choose|must be|exceed 100%/i.test(warning),
      ),
    )
  ) {
    reasons.push(
      "Forecast reports missing financial assumptions, unverified capacity or invalid allocations; its fallback assumptions cannot establish a financial minimum.",
    );
    return result;
  }
  if (zero.modeled.some((v) => v == null || !Number.isFinite(v))) {
    reasons.push(
      "At least one selected-window goal measure is unavailable; no substitution from household pay or fund balances is made.",
    );
    return result;
  }
  // A zero lower bound is essential: the current forecast can already exceed the minimum.
  let low = 0,
    high = 1,
    upper = zero;
  if (!zero.met) {
    let previous = zero;
    for (let i = 0; i < 40; i++, high *= 2) {
      upper = evaluate(high);
      if (
        upper.modeled.some(
          (v, index) =>
            v == null ||
            previous.modeled[index] == null ||
            v + 1e-8 < previous.modeled[index]!,
        )
      ) {
        reasons.push(
          "Goal measures decrease or become unavailable as demand increases; binary inversion cannot certify the minimum in this scenario.",
        );
        return result;
      }
      if (upper.met) break;
      if (
        i > 0 &&
        upper.values.sessions === previous.values.sessions &&
        upper.modeled.every((v, index) => v === previous.modeled[index])
      ) {
        reasons.push(
          "Targets cannot be reconciled within the dated, capacity-constrained forecast. An uncapped financial engine is needed to establish a minimum above capacity; capacity is not substituted as Goal.",
        );
        result.capacity.sufficient = false;
        return result;
      }
      previous = upper;
      if (i === 39) {
        reasons.push(
          "Targets cannot be reconciled within the dated, capacity-constrained forecast. An uncapped financial engine is needed to establish a minimum above capacity; capacity is not substituted as Goal.",
        );
        result.capacity.sufficient = false;
        return result;
      }
    }
    for (let i = 0; i < 42; i++) {
      const middle = (low + high) / 2;
      const candidate = evaluate(middle);
      if (candidate.met) {
        high = middle;
        upper = candidate;
      } else low = middle;
    }
  } else high = 0;
  result.status = "available";
  result.practiceWeeklyGoal =
    upper.values.sessions == null
      ? null
      : upper.values.sessions / result.details.weeks;
  result.details.baselineWeeklyRequired = high;
  result.details.values = upper.values;
  result.details.targets.forEach((t, i) => {
    t.modeled = upper.modeled[i];
  });
  result.capacity.sufficient = true;
  return result;
}
