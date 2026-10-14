import type { ForecastMonth, Workspace } from "@workspace/practice/hub";

export function periodOverheadSummary(
  periods: ForecastMonth[],
  periodStart: string,
  periodEnd: string,
) {
  const rows = periods
    .filter((row) => row.date >= periodStart && row.date <= periodEnd)
    .flatMap((row) =>
      row.values.overhead === null || row.values.overhead === undefined
        ? []
        : [{ date: row.date, overhead: row.values.overhead }],
    );
  const values = rows.map((row) => row.overhead);
  return {
    rows,
    values,
    average:
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null,
  };
}

export function fundProjectionSummary(
  goal: Workspace["fundGoals"][number] | undefined,
  allocations: Workspace["allocations"],
  monthlyValues: ForecastMonth["values"],
  monthDate: string | undefined,
) {
  if (!goal) return null;
  const current = goal.currentBalance ?? 0;
  const remaining = Math.max(0, goal.amount - current);
  const lower = goal.name.toLowerCase().replace(" fund", "");
  const allocation = allocations.find((item) =>
    item.name.toLowerCase().includes(lower),
  );
  if (!allocation || !monthDate || remaining <= 0)
    return {
      current,
      remaining,
      contribution: null,
      eta: null,
      anchorDate: goal.balanceDate ?? null,
    };
  const sameKindTotal = allocations
    .filter((item) => item.kind === allocation.kind)
    .reduce((sum, item) => sum + item.percent, 0);
  const kindAmount =
    allocation.kind === "tax"
      ? monthlyValues.taxReserve
      : allocation.kind === "distribution"
        ? monthlyValues.distributions
        : allocation.kind === "retained"
          ? monthlyValues.retainedCash
          : monthlyValues.reserves;
  const contribution =
    kindAmount !== null && kindAmount !== undefined && sameKindTotal > 0
      ? (kindAmount * allocation.percent) / sameKindTotal
      : null;
  const eta =
    contribution && contribution > 0
      ? addMonths(monthDate, Math.ceil(remaining / contribution))
      : null;
  return {
    current,
    remaining,
    contribution,
    eta,
    anchorDate: goal.balanceDate ?? null,
  };
}

function addMonths(date: string, months: number) {
  const d = new Date(date.slice(0, 7) + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
