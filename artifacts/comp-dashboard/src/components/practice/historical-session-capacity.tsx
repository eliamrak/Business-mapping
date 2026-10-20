import { HistoricalPeriodValues, type HistoricalPeriodValue } from "./historical-period-values.tsx";
import { historicalPeriodDifference, type HistoricalPerformancePeriods } from "../../lib/historical-performance-periods.ts";
import type { overviewHistoricalCapacity } from "../../lib/overview-historical-capacity.ts";

export type HistoricalSessionCapacityProps = {
  capacity: ReturnType<typeof overviewHistoricalCapacity> | undefined;
  reports: HistoricalPerformancePeriods;
};

const number = (value: number | null | undefined) => value == null ? "Unknown" : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const differenceText = (recent: number | null | undefined, baseline: number | null | undefined, unit: string) => {
  const delta = historicalPeriodDifference(recent, baseline);
  return `3 months - year: ${delta == null ? "Unknown" : `${delta > 0 ? "+" : ""}${number(delta)} ${unit}`}`;
};

export function HistoricalSessionCapacity({ capacity, reports }: HistoricalSessionCapacityProps) {
  const periodValue = (period: "3mo" | "year"): HistoricalPeriodValue => {
    const row = capacity?.[period];
    return {
      range: row?.range ?? reports[period].window.cohort,
      value: <><strong>{number(row?.weekly)} actual / week</strong><span>{number(row?.desiredWeekly)} desired / week</span>
        <span>{row?.utilizationPct == null ? "Unknown" : `${number(row.utilizationPct)}%`} full</span></>,
      detail: <details><summary>Coverage and assumptions</summary>
        <p>{number(row?.observedCompleted)} observed sessions; attendance coverage {row?.coverageComplete ? "verified" : "unverified"}.</p>
        <p>{row?.desiredBasis === "dated-profile-assumptions" ? "Dated desired-session profile assumptions"
          : row?.desiredBasis === "current-card-assumptions" ? "Current clinician-card desired-session assumptions; historical desired capacity unverified"
          : "Desired sessions unknown"}</p>
        {row?.reasons.map((reason) => <p key={reason}>{reason}</p>)}
      </details>,
    };
  };
  return <HistoricalPeriodValues values={{ "3mo": periodValue("3mo"), year: periodValue("year") }}
    difference={<>{differenceText(capacity?.["3mo"].weekly, capacity?.year.weekly, "sessions / week")}<br />
      {differenceText(capacity?.["3mo"].utilizationPct, capacity?.year.utilizationPct, "percentage points full")}</>} />;
}
