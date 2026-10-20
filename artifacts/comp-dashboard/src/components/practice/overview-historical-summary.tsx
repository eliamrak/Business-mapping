import type { HistoricalPerformancePeriods } from "../../lib/historical-performance-periods.ts";
import { HistoricalPeriodValues } from "./historical-period-values";
import { overviewHistoricalAttrition, type OverviewHistoricalCapacityPeriod } from "../../lib/overview-historical-capacity.ts";

const number = (value: number | null | undefined) => value == null ? "--" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const rate = (value: number | null | undefined) => value == null ? "--" : `${number(value)}%`;
const periods = ["3mo", "year"] as const;
const desiredBasisLabel = (basis: OverviewHistoricalCapacityPeriod["desiredBasis"]) => basis === "unknown"
  ? "Desired caseload unknown" : basis === "current-card-assumptions" ? "Current desired-caseload assumption" : "Dated desired-caseload assumptions";

export function HistoricalDifference({ recent, baseline, unit }: { recent: number | null | undefined; baseline: number | null | undefined; unit: string }) {
  const difference = recent == null || baseline == null ? null : recent - baseline;
  return <p className="pw-historical-difference">{difference == null ? "Comparison unavailable" : `${difference > 0 ? "+" : ""}${number(difference)} ${unit} vs 12-month baseline`}</p>;
}

export function OverviewHistoricalSummary({ reports, capacity: providedCapacity, contributor = "Whole Practice", contributorIdentityVerified = true, onSessions }: { reports: HistoricalPerformancePeriods; capacity: Record<"3mo" | "year", OverviewHistoricalCapacityPeriod>; contributor?: string; contributorIdentityVerified?: boolean; onSessions: () => void }) {
  const capacityFor = (period: typeof periods[number]): OverviewHistoricalCapacityPeriod => {
    const row = providedCapacity[period];
    return contributor === "Whole Practice" || contributorIdentityVerified ? row : {
      ...row, weekly: null, desiredWeekly: null, utilizationPct: null, observedCompleted: null,
      desiredBasis: "unknown", historicalDesiredWeekly: null, currentDesiredWeekly: null,
      coverageComplete: false, desiredCoverageComplete: false,
      reasons: ["Clinician identity is unverified; resolve the clinician mapping before comparing capacity."],
    };
  };
  const capacity = { "3mo": capacityFor("3mo"), year: capacityFor("year") };
  const normalize = (name: string | null) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const clinician = (period: typeof periods[number]) => contributorIdentityVerified ? reports[period].clinicians.find(row => normalize(row.clinician) === normalize(contributor)) : undefined;
  const retention = (period: typeof periods[number]) => contributor === "Whole Practice" ? {
    rate: reports[period].activity?.initialRetentionRate == null ? null : reports[period].activity.initialRetentionRate * 100,
    retained: reports[period].activity?.retainedClientPairs, denominator: reports[period].activity?.initialRetentionDenominator,
    pending: reports[period].activity?.immatureClientPairsExcluded, verified: reports[period].activity?.initialRetentionCoverageVerified,
  } : { rate: clinician(period)?.initialRetentionPct, retained: clinician(period)?.retainedClients, denominator: clinician(period)?.initialRetentionDenominator, pending: clinician(period)?.pendingInitialClients, verified: clinician(period)?.initialRetentionCoverageVerified };
  const consultation = (period: typeof periods[number]) => contributor === "Whole Practice" ? reports[period].consults.practice : contributorIdentityVerified ? reports[period].consults.byClinician.find(row => normalize(row.clinician) === normalize(contributor)) : undefined;
  const attrition = overviewHistoricalAttrition(reports, contributor === "Whole Practice" ? undefined : contributorIdentityVerified ? contributor : "");
  const monthlyAttrition = (period: typeof periods[number]) => contributor === "Whole Practice" ? reports[period].activity?.averageClientEndingsPerFullMonth : clinician(period)?.averageClientEndingsPerFullMonth;
  return <div className="pw-overview-historical-summary">
    <section className="pw-overview-desired-capacity" aria-label="Overview desired session utilization">
      <h3>Desired caseload</h3>
      <HistoricalPeriodValues values={{ "3mo": { range: capacity["3mo"].range, value: <strong>{rate(capacity["3mo"].utilizationPct)} full</strong>, detail: <><span>{number(capacity["3mo"].weekly)} actual / {number(capacity["3mo"].desiredWeekly)} desired sessions per week</span><small>{desiredBasisLabel(capacity["3mo"].desiredBasis)}</small><details><summary>Coverage and assumptions</summary>{capacity["3mo"].reasons.map(reason => <p key={reason}>{reason}</p>)}</details></> }, year: { range: capacity.year.range, value: <strong>{rate(capacity.year.utilizationPct)} full</strong>, detail: <><span>{number(capacity.year.weekly)} actual / {number(capacity.year.desiredWeekly)} desired sessions per week</span><small>{desiredBasisLabel(capacity.year.desiredBasis)}</small><details><summary>Coverage and assumptions</summary>{capacity.year.reasons.map(reason => <p key={reason}>{reason}</p>)}</details></> } }} />
      <HistoricalDifference recent={capacity["3mo"].weekly} baseline={capacity.year.weekly} unit="sessions / week" />
      <HistoricalDifference recent={capacity["3mo"].utilizationPct} baseline={capacity.year.utilizationPct} unit="percentage points full" />
    </section>
    <section aria-label="Overview initial retention">
      <h3>Retention</h3>
      <HistoricalPeriodValues values={Object.fromEntries(periods.map(period => {
        const report = reports[period];
        const activity = retention(period);
        return [period, { range: report.window.cohort,
          value: <strong>{rate(activity.rate)}</strong>,
          detail: <details><summary>Counts and definition</summary><p>{number(activity.retained)} retained / {number(activity.denominator)} evaluated starts; {number(activity.pending)} pending. Three attended treatment sessions with initial gaps no longer than 28 days; PHONE excluded. {activity.verified ? "Report coverage verified." : "Observed history; coverage unverified."}</p></details> }];
      })) as Parameters<typeof HistoricalPeriodValues>[0]["values"]} />
      <HistoricalDifference recent={retention("3mo").rate} baseline={retention("year").rate} unit="percentage points" />
    </section>
    <section aria-label="Overview consult conversion">
      <h3>Close rate</h3>
      <HistoricalPeriodValues values={Object.fromEntries(periods.map(period => {
        const report = reports[period];
        const consult = consultation(period);
        return [period, { range: report.window.cohort, value: <strong>{rate(consult?.conversionRate)}</strong>,
          detail: <><span>{number(consult?.consultations)} consultations → {number(consult?.converted)} {contributor === "Whole Practice" ? "started treatment" : "confirmed closes"}</span><small>{number(consult?.pending)} pending</small><details><summary>Counts and definition</summary><p>{number(consult?.evaluated)} evaluated journeys. Started treatment means an attended qualifying treatment visit, not completed onboarding or a booking. One calendar-month follow-up; practice conversions counted once. Clinician closer credit requires the existing attribution rules. {report.consults.coverageVerified ? "Report coverage verified." : "Observed history; coverage unverified."}</p></details></> }];
      })) as Parameters<typeof HistoricalPeriodValues>[0]["values"]} />
      <HistoricalDifference recent={consultation("3mo")?.conversionRate} baseline={consultation("year")?.conversionRate} unit="percentage points" />
    </section>
    <section aria-label="Overview average monthly attrition">
      <h3>Attrition</h3>
      <HistoricalPeriodValues values={Object.fromEntries(periods.map(period => {
        const report = reports[period];
        const activity = attrition[period];
        return [period, { range: report.window.attrition,
          value: <><strong>{number(activity.total)} clients</strong><span>{rate(activity.attritionPct)}</span></>,
          detail: <><span>{number(monthlyAttrition(period))} / mature month</span><details><summary>Counts and definition</summary><p>{number(activity.coveredMatureMonths)} covered mature months; 90-day follow-up through {report.window.asOf}. The unique eligible-client denominator for a whole-window percentage is not established; percentage remains unknown rather than borrowing a latest-month or client-month denominator.</p></details></> }];
      })) as Parameters<typeof HistoricalPeriodValues>[0]["values"]} />
      <HistoricalDifference recent={monthlyAttrition("3mo")} baseline={monthlyAttrition("year")} unit="clients / mature month" />
    </section>
    <button type="button" className="pw-text-button" onClick={onSessions}>Sessions</button>
  </div>;
}
