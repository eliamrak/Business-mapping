import type { HistoricalPerformancePeriods } from "../../lib/historical-performance-periods.ts";
import { HistoricalPeriodValues } from "./historical-period-values";
import { PercentageKpi } from "./percentage-kpi";
import { overviewHistoricalAttrition, type OverviewHistoricalCapacityPeriod } from "../../lib/overview-historical-capacity.ts";
import type { SectionLayout } from "../../lib/section-widget-layout.ts";
import { SectionWidgetGrid } from "./section-widget-grid";
import "./overview-historical-summary.css";

const number = (value: number | null | undefined) => value == null ? "--" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
const rate = (value: number | null | undefined) => value == null ? "--" : `${number(value)}%`;
const periods = ["3mo", "year"] as const;
const attritionReason = (reason: string) => ({
  "immature-follow-up": "The full window has not reached 90 days of follow-up.",
  "incomplete-window-or-follow-up-coverage": "Attendance coverage is incomplete for the full window and its follow-up.",
  "left-censored-establishment": "Earlier treatment history may change which clients were established.",
  "incomplete-prior-establishment-coverage": "Earlier coverage does not establish every eligible client's treatment history.",
  "uncertain-follow-up-evidence": "Unresolved later evidence could change an ending.",
  "zero-eligible-denominator": "No observed established clients provide a percentage denominator.",
} as Record<string, string>)[reason] ?? reason;
const desiredBasisLabel = (basis: OverviewHistoricalCapacityPeriod["desiredBasis"]) => basis === "unknown"
  ? "Desired caseload unknown" : basis === "current-card-assumptions" ? "Current desired-caseload assumption" : "Dated desired-caseload assumptions";

export function HistoricalDifference({ recent, baseline, unit }: { recent: number | null | undefined; baseline: number | null | undefined; unit: string }) {
  const difference = recent == null || baseline == null ? null : recent - baseline;
  return <p className="pw-historical-difference">{difference == null ? "Comparison unavailable" : `${difference > 0 ? "+" : ""}${number(difference)} ${unit} vs 12-month baseline`}</p>;
}

export type OverviewHistoricalTargets = Partial<Record<"retentionPct" | "closeRatePct" | "attritionPct", number | null>>;

export function OverviewHistoricalSummary({ reports, capacity: providedCapacity, contributor = "Whole Practice", contributorIdentityVerified = true, targets, layout, onLayoutChange }: { reports: HistoricalPerformancePeriods; capacity: Record<"3mo" | "year", OverviewHistoricalCapacityPeriod>; contributor?: string; contributorIdentityVerified?: boolean; targets?: OverviewHistoricalTargets; layout?: SectionLayout; onLayoutChange?: (layout: SectionLayout | undefined) => void }) {
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
  const monthlyAttrition = (period: typeof periods[number]) => {
    const report = reports[period];
    if (contributor === "Whole Practice") return report.attritionActivity?.averageClientEndingsPerFullMonth;
    if (!contributorIdentityVerified) return null;
    const matches = report.attritionClinicians?.filter(row => normalize(row.clinician) === normalize(contributor)) ?? [];
    return matches.length === 1 ? matches[0].averageClientEndingsPerFullMonth : null;
  };
  const percentage = (label: string, period: typeof periods[number], value: number | null | undefined, baseline: number | null | undefined, goal?: number | null) => {
    const aboveScale = value != null && Number.isFinite(value) && value > 100;
    const baselineAboveScale = period === "3mo" && baseline != null && Number.isFinite(baseline) && baseline > 100;
    const context = [aboveScale ? `${rate(value)} full; ring capped at 100%.` : null,
      baselineAboveScale ? `Year baseline ${rate(baseline)}; above ring scale.` : null].filter(Boolean).join(" ");
    const ring = <PercentageKpi label={aboveScale ? `${label}: ${rate(value)}, above the 100% ring scale` : label} value={value}
      benchmark={period === "3mo" && !baselineAboveScale ? baseline : undefined} benchmarkLabel="Year baseline"
      observed={context || undefined}
      goal={contributor === "Whole Practice" || contributorIdentityVerified ? goal : undefined} />;
    return aboveScale ? <div className="pw-overview-percentage-overflow">{ring}<span className="pw-overview-percentage-actual" aria-hidden="true">{rate(value)}</span></div> : ring;
  };
  return <div className="pw-overview-historical-summary pw-overview-kpi-grid">
    <SectionWidgetGrid section="summary" layout={layout} onChange={next => onLayoutChange?.(next)} styledCards={false} items={[
      { id: "caseload", title: "Caseload", defaultSize: "medium", content: <section className="pw-overview-desired-capacity" aria-label="Overview desired session utilization">
      <h3>Caseload</h3>
      <HistoricalPeriodValues dates="accessible" values={Object.fromEntries(periods.map(period => {
        const row = capacity[period];
        return [period, { range: row.range,
          value: percentage("Caseload full", period, row.utilizationPct, capacity.year.utilizationPct, row.desiredWeekly != null && row.desiredWeekly > 0 ? 100 : undefined),
          detail: <><strong className="pw-overview-target">Target {number(row.desiredWeekly)} / week</strong><span>{number(row.weekly)} actual / week</span><details><summary>Coverage</summary><p>{desiredBasisLabel(row.desiredBasis)}</p><p>{number(row.weekly)} actual / {number(row.desiredWeekly)} desired sessions per week</p>{row.reasons.map(reason => <p key={reason}>{reason}</p>)}</details></> }];
      })) as Parameters<typeof HistoricalPeriodValues>[0]["values"]} />
      <div className="sr-only">
        <HistoricalDifference recent={capacity["3mo"].weekly} baseline={capacity.year.weekly} unit="sessions / week" />
        <HistoricalDifference recent={capacity["3mo"].utilizationPct} baseline={capacity.year.utilizationPct} unit="percentage points full" />
      </div>
    </section> },
      { id: "retention", title: "Retention", defaultSize: "medium", content: <section aria-label="Overview initial retention">
      <h3>Retention</h3>
      <HistoricalPeriodValues dates="accessible" values={Object.fromEntries(periods.map(period => {
        const report = reports[period];
        const activity = retention(period);
        return [period, { range: report.window.cohort,
          value: percentage("Initial retention", period, activity.rate, retention("year").rate, targets?.retentionPct),
          detail: <div className="sr-only"><p>{number(activity.retained)} retained / {number(activity.denominator)} evaluated starts; {number(activity.pending)} pending. Three attended treatment sessions with initial gaps no longer than 28 days; PHONE excluded. {activity.verified ? "Report coverage verified." : "Observed history; coverage unverified."}</p></div> }];
      })) as Parameters<typeof HistoricalPeriodValues>[0]["values"]} />
      <div className="sr-only"><HistoricalDifference recent={retention("3mo").rate} baseline={retention("year").rate} unit="percentage points" /></div>
    </section> },
      { id: "close-rate", title: "Observed close rate", defaultSize: "medium", content: <section aria-label="Overview consult conversion">
      <h3>Observed close rate</h3>
      <HistoricalPeriodValues dates="accessible" values={Object.fromEntries(periods.map(period => {
        const report = reports[period];
        const consult = consultation(period);
        return [period, { range: { start: report.consults.periodStart, end: report.consults.periodEnd }, value: percentage("Observed close rate", period, consult?.observedConversionRate, consultation("year")?.observedConversionRate, targets?.closeRatePct),
          detail: <><span>{number(consult?.converted)} of {number(consult?.evaluated)} evaluated</span><small>{number(consult?.pending)} unresolved · {number(consult?.internalReferralsProtected)} referrals excluded</small>{(consult?.pending ?? 0) > 0 ? <small>Some cohort outcomes unresolved</small> : !report.consults.coverageVerified && <small>Coverage unverified</small>}<div className="sr-only"><p>{number(consult?.consultations)} consultations. Observed close rate is same-clinician closes divided by evaluated outcomes; unresolved cases and referrals are excluded, not treated as failures. This does not assert the entire cohort is resolved. A consultation followed by a qualifying full-session appointment under the same clinician counts as a close; attendance is not required. The recorded appointment sequence and one-calendar-month follow-up window are used, not a fabricated booking-created timestamp. Practice clients count once. {number(consult?.observedTreatmentStarts)} completed treatment starts are separate from scheduled appointments. {report.consults.coverageVerified ? "Appointment coverage verified." : "Appointment coverage is unverified; missing follow-up is not a failure."} {report.consults.bookingLimitation}</p></div></> }];
      })) as Parameters<typeof HistoricalPeriodValues>[0]["values"]} />
      <div className="sr-only"><HistoricalDifference recent={consultation("3mo")?.observedConversionRate} baseline={consultation("year")?.observedConversionRate} unit="percentage points" /></div>
    </section> },
      { id: "attrition", title: "Attrition", defaultSize: "medium", content: <section aria-label="Overview average monthly attrition">
      <h3>Attrition</h3>
      <HistoricalPeriodValues dates="accessible" periodLabels={{ "3mo": "Last 3 mature months", year: "Last 12 mature months" }} values={Object.fromEntries(periods.map(period => {
        const report = reports[period];
        const activity = attrition[period];
        return [period, { range: report.window.attrition,
          value: <figure role="img" className="pw-attrition-count-kpi" data-state={monthlyAttrition(period) == null ? "unknown" : "known"} aria-label={`Average monthly client endings: ${monthlyAttrition(period) == null ? "unknown" : number(monthlyAttrition(period)) + " per covered mature month"}`}>
            <div className="pw-attrition-count-ring" aria-hidden="true">{number(monthlyAttrition(period))}</div>
            <figcaption>Client endings / month</figcaption>
          </figure>,
          detail: <>{monthlyAttrition(period) == null ? <span>Not enough covered history.</span> : <span>{activity.coveredMatureMonths == null ? "Covered mature months only" : `${number(activity.coveredMatureMonths)} covered mature months`}</span>}{activity.coverageComplete && activity.total != null && <span>{number(activity.total)} clients ended in the full window{activity.attritionPct != null ? ` · ${rate(activity.attritionPct)}` : ""}</span>}{activity.coverageComplete && activity.attritionPct != null && targets?.attritionPct != null && <span>Full-window goal {rate(targets.attritionPct)}</span>}<div className="sr-only"><p>{number(activity.total)} ended / {number(activity.eligibleClients)} unique observed established clients in the full labeled window. Established means three distinct attended treatment dates and active during the window. Count and percentage require covered follow-up through 90 days after that window; earlier unobserved clients are not certified.</p><p>Attrition windows lag by 90 days so there is time to observe whether clients return. Mature dates alone do not verify coverage or earlier treatment history.</p><p>Monthly average separately uses {number(activity.coveredMatureMonths)} covered mature months, with observations through {report.window.asOf}.</p>{activity.reasons.map(reason => <p key={reason}>{attritionReason(reason)}</p>)}{activity.observedMaturePortion && <p>Separate mature observed portion: {activity.observedMaturePortion.requestedWindow.start} to {activity.observedMaturePortion.requestedWindow.end}: {number(activity.observedMaturePortion.totalEnded)} ended / {number(activity.observedMaturePortion.totalEligible)} eligible, {rate(activity.observedMaturePortion.percentage)}. This is not the full trailing window.</p>}</div></> }];
      })) as Parameters<typeof HistoricalPeriodValues>[0]["values"]} />
      <div className="sr-only"><HistoricalDifference recent={attrition["3mo"].attritionPct} baseline={attrition.year.attritionPct} unit="percentage points" /></div>
    </section> },
    ]} />
  </div>;
}
