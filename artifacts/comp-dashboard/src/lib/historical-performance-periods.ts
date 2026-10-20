import { historicalPerformance, type HistoricalPerformancePeriod } from "./historical-performance.ts";

export type HistoricalPerformanceInput = Omit<Parameters<typeof historicalPerformance>[0], "period">;
export type HistoricalPerformanceResult = ReturnType<typeof historicalPerformance>;
export type HistoricalPerformancePeriods = Record<HistoricalPerformancePeriod, HistoricalPerformanceResult>;

/** Both calendar histories use the same evidence and observation cutoff. */
export function historicalPerformancePeriods(input: HistoricalPerformanceInput): HistoricalPerformancePeriods {
  return {
    "3mo": historicalPerformance({ ...input, period: "3mo" }),
    year: historicalPerformance({ ...input, period: "year" }),
  };
}

export function historicalPeriodDifference(recent: number | null | undefined, baseline: number | null | undefined): number | null {
  return recent == null || baseline == null || !Number.isFinite(recent) || !Number.isFinite(baseline)
    ? null : recent - baseline;
}
