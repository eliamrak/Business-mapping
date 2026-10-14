import type { ForecastMonth, Workspace } from "@workspace/practice/hub";
import { daysInclusive } from "@workspace/practice";

export type OverheadUnknownReason =
  | "cross-month-period"
  | "missing-period-start"
  | "missing-overhead"
  | "incomplete-month"
  | "overlapping-periods"
  | "incomplete-expenses"
  | "period-total-mismatch"
  | "invalid-expense-date"
  | "unknown-category";

export interface OverheadSource {
  index: number | null;
  periodId: string | null;
  start: string;
  end: string;
  overhead: number | null;
  reportedOverhead: number | null;
  basis: "monthly-input" | "period-total" | "dated-transactions";
  expensesComplete: boolean | null;
  excludedReason: OverheadUnknownReason | null;
  warnings: string[];
  transactions: Workspace["transactions"];
}

export interface OverheadMonth {
  date: string;
  overhead: number | null;
  status: "complete" | "unknown";
  basis: OverheadSource["basis"];
  reasons: OverheadUnknownReason[];
  sources: OverheadSource[];
  transactions: Workspace["transactions"];
}

export interface PeriodOverheadSummary {
  rows: { date: string; overhead: number; sources: OverheadSource[] }[];
  months: OverheadMonth[];
  values: number[];
  average: number | null;
  complete: boolean;
  excludedSources: OverheadSource[];
}

export interface OverheadActualOptions {
  workspace: Pick<Workspace, "periods" | "categories" | "transactions">;
  context?: unknown;
}

/** Without workspace facts, first-of-month rows without periodStart are monthly inputs,
 * not verified actuals. Actual period rows use periodStart through date inclusively. */
export function periodOverheadSummary(
  periods: ForecastMonth[],
  periodStart: string,
  periodEnd: string,
  options?: OverheadActualOptions,
): PeriodOverheadSummary {
  const sources = options
    ? actualOverheadSources(options.workspace, periods)
    : periods.map((row, index): OverheadSource => {
        const monthly = !row.periodStart && row.date.endsWith("-01");
        const start = row.periodStart ?? row.date.slice(0, 7) + "-01";
        const end = monthly ? calendarMonthEnd(row.date) : row.date;
        const excludedReason =
          !row.periodStart && !monthly
            ? "missing-period-start"
            : start.slice(0, 7) !== end.slice(0, 7)
              ? "cross-month-period"
              : null;
        return {
          index,
          periodId: null,
          start,
          end,
          overhead: row.values.overhead ?? null,
          reportedOverhead: row.values.overhead ?? null,
          basis: monthly ? "monthly-input" : "period-total",
          expensesComplete: null,
          excludedReason,
          warnings: row.warnings ?? [],
          transactions: [],
        };
      });
  // Overall-range sentinels mean available history, not thousands of empty years.
  let rangeStart: string | null = periodStart.slice(0, 7) + "-01";
  let rangeEnd: string | null = periodEnd;
  if (periodStart.startsWith("0000-")) {
    const earliest = sources.reduce<string | null>(
      (date, source) =>
        date === null || source.start < date ? source.start : date,
      null,
    );
    rangeStart = earliest === null ? null : earliest.slice(0, 7) + "-01";
  }
  if (periodEnd.startsWith("9999-")) {
    const latest = sources.reduce<string | null>(
      (date, source) =>
        date === null || source.end > date ? source.end : date,
      null,
    );
    rangeEnd = latest === null ? null : calendarMonthEnd(latest);
  }
  const months: OverheadMonth[] = [];
  if (periodStart <= periodEnd && rangeStart !== null && rangeEnd !== null) {
    for (let date = rangeStart; date <= rangeEnd; date = addMonths(date, 1)) {
      const end = calendarMonthEnd(date);
      const overlapping = sources
        .filter((source) => source.start <= end && source.end >= date)
        .sort(
          (a, b) =>
            a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
        );
      const reasons = new Set<OverheadUnknownReason>();
      let nextUncovered = date;
      for (const source of overlapping) {
        if (source.excludedReason) {
          reasons.add(source.excludedReason);
          continue;
        }
        if (source.overhead === null) reasons.add("missing-overhead");
        const coveredStart = source.start < date ? date : source.start;
        const coveredEnd = source.end > end ? end : source.end;
        if (coveredStart > nextUncovered) reasons.add("incomplete-month");
        if (coveredStart < nextUncovered) reasons.add("overlapping-periods");
        const after = nextCalendarDay(coveredEnd);
        if (after > nextUncovered) nextUncovered = after;
      }
      if (nextUncovered <= end) reasons.add("incomplete-month");
      const transactions = overlapping
        .flatMap((source) => source.transactions)
        .filter(
          (transaction) => transaction.date >= date && transaction.date <= end,
        )
        .sort(
          (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
        );
      const overhead =
        reasons.size > 0
          ? null
          : options
            ? transactions.reduce(
                (sum, transaction) => sum + transaction.amount,
                0,
              )
            : overlapping.reduce((sum, source) => sum + source.overhead!, 0);
      months.push({
        date,
        overhead,
        status: overhead === null ? "unknown" : "complete",
        basis: options
          ? "dated-transactions"
          : overlapping.every((source) => source.basis === "monthly-input")
            ? "monthly-input"
            : "period-total",
        reasons: [...reasons],
        sources: overlapping,
        transactions,
      });
    }
  }
  const rows = months.flatMap((month) =>
    month.overhead === null
      ? []
      : [
          {
            date: month.date,
            overhead: month.overhead,
            sources: month.sources,
          },
        ],
  );
  const values = rows.map((row) => row.overhead);
  const complete =
    months.length > 0 && months.every((month) => month.status === "complete");
  const selectedSources = new Set(months.flatMap((month) => month.sources));
  return {
    rows,
    months,
    values,
    complete,
    average: complete
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null,
    excludedSources: [...selectedSources].filter(
      (source) => source.excludedReason !== null,
    ),
  };
}

function actualOverheadSources(
  workspace: OverheadActualOptions["workspace"],
  series: ForecastMonth[],
): OverheadSource[] {
  const categories = new Map(
    workspace.categories.map((category) => [category.id, category.kind]),
  );
  const byPeriod = new Map<string, Workspace["transactions"]>();
  for (const transaction of workspace.transactions) {
    const transactions = byPeriod.get(transaction.periodId) ?? [];
    transactions.push(transaction);
    byPeriod.set(transaction.periodId, transactions);
  }
  return workspace.periods
    .filter((period) => !period.archived && period.status === "finalized")
    .map((period): OverheadSource => {
      const index = series.findIndex(
        (row) => row.periodStart === period.start && row.date === period.end,
      );
      const reportedOverhead =
        index >= 0 ? (series[index].values.overhead ?? null) : null;
      const recorded = byPeriod.get(period.id) ?? [];
      const transactions = recorded.filter((transaction) =>
        ["expense", "facility"].includes(
          categories.get(transaction.categoryId) ?? "",
        ),
      );
      const overhead = period.expensesComplete
        ? transactions.reduce((sum, transaction) => sum + transaction.amount, 0)
        : null;
      const excludedReason: OverheadUnknownReason | null =
        !period.expensesComplete
          ? "incomplete-expenses"
          : recorded.some(
                (transaction) =>
                  transaction.date < period.start ||
                  transaction.date > period.end,
              )
            ? "invalid-expense-date"
            : recorded.some(
                  (transaction) => !categories.has(transaction.categoryId),
                )
              ? "unknown-category"
              : reportedOverhead !== null &&
                  overhead !== null &&
                  Math.abs(reportedOverhead - overhead) > 0.005
                ? "period-total-mismatch"
                : null;
      return {
        index: index >= 0 ? index : null,
        periodId: period.id,
        start: period.start,
        end: period.end,
        overhead,
        reportedOverhead,
        basis: "dated-transactions",
        expensesComplete: period.expensesComplete,
        excludedReason,
        warnings: index >= 0 ? (series[index].warnings ?? []) : [],
        transactions,
      };
    });
}

function calendarMonthEnd(date: string) {
  const next = new Date(addMonths(date.slice(0, 7) + "-01", 1) + "T12:00:00Z");
  next.setUTCDate(0);
  return next.toISOString().slice(0, 10);
}

function nextCalendarDay(date: string) {
  const next = new Date(date + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export interface FundTrajectoryPoint {
  date: string;
  balance: number;
  kind: "actual" | "projected";
}

export interface FundProjectionSummary {
  current: number;
  remaining: number;
  contribution: number | null;
  eta: string | null;
  anchorDate: string | null;
  projectionStartDate: string | null;
  projectionLineStyle: "dotted";
  trajectory: FundTrajectoryPoint[];
  trajectoryTruncated: boolean;
  assumptions: string[];
}

export function fundProjectionSummary(
  goal: Pick<Workspace["fundGoals"][number], "name" | "amount" | "currentBalance" | "balanceDate"> | undefined,
  allocations: Workspace["allocations"],
  monthlyValues: ForecastMonth["values"],
  monthDate: string | undefined,
): FundProjectionSummary | null {
  if (!goal) return null;
  const balanceWasBlank =
    goal.currentBalance === null || goal.currentBalance === undefined;
  const current = goal.currentBalance ?? 0;
  const remaining = Math.max(0, goal.amount - current);
  const anchorDate = goal.balanceDate ?? null;
  let projectionStartDate = anchorDate ?? monthDate ?? null;
  const assumptions: string[] = [];
  if (balanceWasBlank)
    assumptions.push("The blank current balance is assumed to be 0.");
  if (!anchorDate && monthDate) {
    assumptions.push(
      "No balance date is recorded; the selected month is the assumed projection start, not an actual balance observation.",
    );
  } else if (!projectionStartDate) {
    assumptions.push(
      "No balance date or selected month is available; the projection cannot be dated.",
    );
  }
  const lower = goal.name.toLowerCase().replace(" fund", "");
  const effectivePercent = (item: Workspace["allocations"][number]) => {
    if (item.archived) return 0;
    if (!monthDate) return item.percent;
    const start = monthDate.slice(0, 7) + "-01";
    const end = calendarMonthEnd(start);
    const from = item.start > start ? item.start : start;
    const through = item.end && item.end < end ? item.end : end;
    return from > through ? 0 : item.percent * daysInclusive(from, through) / daysInclusive(start, end);
  };
  const candidates = allocations.filter((item) => effectivePercent(item) > 0 &&
    item.name.toLowerCase().includes(lower),
  );
  const allocation = candidates.length === 1 ? candidates[0] : undefined;
  if (allocation && projectionStartDate && allocation.start > projectionStartDate) {
    projectionStartDate = allocation.start;
    assumptions.push("Projection contributions begin at the allocation start; no earlier contribution is assumed.");
  }
  const sameKindTotal = allocations
    .filter((item) => item.kind === allocation?.kind)
    .reduce((sum, item) => sum + effectivePercent(item), 0);
  const kindAmount =
    allocation?.kind === "tax"
      ? monthlyValues.taxReserve
      : allocation?.kind === "distribution"
        ? monthlyValues.distributions
        : allocation?.kind === "retained"
          ? monthlyValues.retainedCash
          : monthlyValues.reserves;
  const cashParts = [monthlyValues.retainedCash, monthlyValues.taxReserve, monthlyValues.reserves, monthlyValues.distributions];
  const cashBasis = cashParts.every((value) => typeof value === "number" && Number.isFinite(value))
    ? Math.max(0, cashParts.reduce<number>((sum, value) => sum + value!, 0)) : null;
  const contribution = allocation?.kind === "retained"
    ? remaining > 0 && cashBasis !== null ? cashBasis * effectivePercent(allocation) / 100 : null
    :
    allocation &&
    remaining > 0 &&
    kindAmount !== null &&
    kindAmount !== undefined &&
    sameKindTotal > 0
      ? (kindAmount * effectivePercent(allocation)) / sameKindTotal
      : null;
  const monthsToGoal =
    contribution !== null && contribution > 0 && !allocation?.end
      ? Math.ceil(remaining / contribution - 1e-9)
      : null;
  const eta =
    projectionStartDate && monthsToGoal !== null
      ? addMonths(projectionStartDate, monthsToGoal)
      : null;
  if (remaining <= 0) {
    assumptions.push(
      "The recorded balance already meets the goal; no additional contributions are projected.",
    );
  } else if (contribution === null) {
    assumptions.push(
      "Monthly contribution is unavailable; no growth or ETA is projected.",
    );
  } else {
    assumptions.push(
      `Assumes a constant monthly contribution of ${contribution} from the supplied forecast values and allocation percentages, with no withdrawals, interest, or investment returns.`,
    );
    if (allocation?.end) assumptions.push("The allocation has an effective end date; a constant ongoing contribution and goal ETA cannot be established from this month alone.");
  }
  const trajectory: FundTrajectoryPoint[] = projectionStartDate
    ? [
        {
          date: anchorDate ?? projectionStartDate,
          balance: current,
          kind: anchorDate && !balanceWasBlank ? "actual" : "projected",
        },
      ]
    : [];
  if (projectionStartDate && anchorDate && projectionStartDate > anchorDate)
    trajectory.push({ date: projectionStartDate, balance: current, kind: "projected" });
  // Keep chart data bounded even when a small contribution puts the ETA far away.
  const trajectoryTruncated =
    projectionStartDate !== null && monthsToGoal !== null && monthsToGoal > 120;
  if (trajectoryTruncated)
    assumptions.push(
      "The chart shows only the first 120 projected months; ETA uses the full monthly calculation.",
    );
  if (projectionStartDate && monthsToGoal !== null && contribution !== null) {
    for (let offset = 1; offset <= Math.min(monthsToGoal, 120); offset++) {
      trajectory.push({
        date: addMonths(projectionStartDate, offset),
        balance: current + contribution * offset,
        kind: "projected",
      });
    }
  }
  return {
    current,
    remaining,
    contribution,
    eta,
    anchorDate,
    projectionStartDate,
    projectionLineStyle: "dotted",
    trajectory,
    trajectoryTruncated,
    assumptions,
  };
}

function addMonths(date: string, months: number) {
  const anchor = new Date(date + "T12:00:00Z");
  const d = new Date(anchor);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  return d.toISOString().slice(0, 10);
}
