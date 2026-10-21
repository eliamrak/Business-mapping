import { useId, type ReactNode } from "react";
import type { HistoricalPerformancePeriod } from "../../lib/historical-performance.ts";
import type { HistoricalPerformanceResult } from "../../lib/historical-performance-periods.ts";

export type HistoricalPeriodValue = {
  range: HistoricalPerformanceResult["window"]["cohort"];
  value: ReactNode;
  /** Metric-specific denominator, pending observations, and coverage status. */
  detail: ReactNode;
  children?: ReactNode;
};

export type HistoricalPeriodValuesProps = {
  values: Record<HistoricalPerformancePeriod, HistoricalPeriodValue>;
  difference?: ReactNode;
  className?: string;
  dates?: "visible" | "help";
  periodLabels?: Record<HistoricalPerformancePeriod, string>;
};

export function HistoricalPeriodValues({ values, difference, className = "", dates = "visible", periodLabels }: HistoricalPeriodValuesProps) {
  const id = useId();
  return <div className={`pw-historical-period-values ${className}`}>
    {(["3mo", "year"] as const).map((period) => {
      const { range, value, detail, children } = values[period];
      return <section key={period} className="pw-historical-period-value" data-period={period}
        aria-labelledby={`${id}-${period}-label`}>
        <h4 id={`${id}-${period}-label`}>{periodLabels?.[period] ?? (period === "3mo" ? "Trailing 3 months" : "Trailing year")}</h4>
        {dates === "help" ? <details className="pw-historical-period-date-help">
          <summary>Period dates</summary>
          <p className="pw-historical-period-dates">
            <time dateTime={range.start}>{range.start}</time>{" to "}<time dateTime={range.end}>{range.end}</time>
          </p>
        </details> : <p className="pw-historical-period-dates">
          <time dateTime={range.start}>{range.start}</time>{" to "}<time dateTime={range.end}>{range.end}</time>
        </p>}
        <div className="pw-historical-period-main">{value}</div>
        <div className="pw-historical-period-detail">{detail}</div>
        {children != null && <div className="pw-historical-period-children">{children}</div>}
      </section>;
    })}
    {difference != null && <p className="pw-historical-period-difference">{difference}</p>}
  </div>;
}
