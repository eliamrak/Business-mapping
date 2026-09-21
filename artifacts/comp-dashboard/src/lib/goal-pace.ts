export type PacePoint = { date: string; value: number | null };
export type GoalPace = {
  latest: { date: string; actual: number; planned: number | null };
  prior: { date: string; actual: number; planned: number | null } | null;
  target: number;
  targetDate: string;
  variance: number | null;
  priorVariance: number | null;
  monthlyGainNeeded: number;
  recentMonthlyGain: number | null;
  estimatedFinishDate: string | null;
  rows: {
    date: string;
    actual: number;
    planned: number | null;
    variance: number | null;
  }[];
};

const monthIndex = (date: string) =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const addMonths = (date: string, count: number) => {
  const d = new Date(date.slice(0, 7) + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + count);
  return d.toISOString().slice(0, 10);
};

export function calculateGoalPace(
  plan: PacePoint[],
  actuals: PacePoint[],
): GoalPace | null {
  const planned = new Map(
    plan
      .filter(
        (point): point is { date: string; value: number } =>
          point.value !== null,
      )
      .map((point) => [point.date.slice(0, 7), point.value]),
  );
  const targetPoint = [...plan].reverse().find((point) => point.value !== null);
  const rows = actuals
    .filter(
      (point): point is { date: string; value: number } => point.value !== null,
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((point) => {
      const goal = planned.get(point.date.slice(0, 7)) ?? null;
      return {
        date: point.date,
        actual: point.value,
        planned: goal,
        variance: goal === null ? null : point.value - goal,
      };
    });
  if (!targetPoint || targetPoint.value === null || !rows.length) return null;
  const latest = rows.at(-1)!;
  const prior =
    rows.length >= 4 ? rows.at(-4)! : rows[0] === latest ? null : rows[0];
  const monthsRemaining = Math.max(
    1,
    monthIndex(targetPoint.date) - monthIndex(latest.date),
  );
  const recent = rows.slice(-4);
  let slope: number | null = null;
  if (recent.length >= 2) {
    const xMean =
      recent.reduce((sum, _, index) => sum + index, 0) / recent.length;
    const yMean =
      recent.reduce((sum, row) => sum + row.actual, 0) / recent.length;
    const denominator = recent.reduce(
      (sum, _, index) => sum + (index - xMean) ** 2,
      0,
    );
    slope = denominator
      ? recent.reduce(
          (sum, row, index) => sum + (index - xMean) * (row.actual - yMean),
          0,
        ) / denominator
      : null;
  }
  const monthsToTarget =
    latest.actual >= targetPoint.value
      ? 0
      : slope !== null && slope > 0
        ? Math.ceil((targetPoint.value - latest.actual) / slope)
        : null;
  return {
    latest: {
      date: latest.date,
      actual: latest.actual,
      planned: latest.planned,
    },
    prior: prior
      ? { date: prior.date, actual: prior.actual, planned: prior.planned }
      : null,
    target: targetPoint.value,
    targetDate: targetPoint.date,
    variance: latest.variance,
    priorVariance: prior?.variance ?? null,
    monthlyGainNeeded:
      Math.max(0, targetPoint.value - latest.actual) / monthsRemaining,
    recentMonthlyGain: slope,
    estimatedFinishDate:
      monthsToTarget === null ? null : addMonths(latest.date, monthsToTarget),
    rows: rows.slice(-6),
  };
}
