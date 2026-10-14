export type PercentageKpiPeriod = { start: string; end: string };

export type PercentageKpiInput = {
  value: number | null | undefined;
  /** Must describe the same metric and reporting period as value. */
  benchmark?: number | null;
  goal?: number | null;
  capacity?: number | null;
  period?: PercentageKpiPeriod;
  /** Supply when the benchmark comes from an independently selected period. */
  benchmarkPeriod?: PercentageKpiPeriod;
};

export function normalizePercentage(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value)) : null;
}

export function formatPercentage(value: number | null): string {
  return value === null ? "-" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

export function buildPercentageKpi(input: PercentageKpiInput) {
  const benchmarkPeriodMatches = !input.benchmarkPeriod || !!input.period &&
    input.period.start === input.benchmarkPeriod.start && input.period.end === input.benchmarkPeriod.end;
  const value = normalizePercentage(input.value);
  const benchmark = benchmarkPeriodMatches ? normalizePercentage(input.benchmark) : null;
  const goal = normalizePercentage(input.goal);
  const capacity = normalizePercentage(input.capacity);
  const angle = (percent: number | null) => percent === null ? null : percent / 100 * 360;
  return {
    value, benchmark, goal, capacity, benchmarkPeriodMatches,
    valueText: formatPercentage(value), benchmarkText: formatPercentage(benchmark),
    goalText: formatPercentage(goal), capacityText: formatPercentage(capacity),
    valueAngle: angle(value), benchmarkAngle: angle(benchmark),
    goalAngle: angle(goal), capacityAngle: angle(capacity),
  };
}
