import { resolveImportedProvider, type ImportEvidenceDeclarations } from "@workspace/practice/hub";
import { periodClientAttrition } from "./period-client-attrition.ts";
import {
  buildLocalRetentionMetrics,
  estimateLocalClientActivity,
  type ClientActivityOptions,
  type ConsultAttributionOverrideInput,
  type LocalSnapshot,
  type SameDayVisitOverrides,
} from "./retention-local.ts";
import { summarizeBookingConversions as summarizeConsultConversions } from "./consult-booking-conversions.ts";

export type HistoricalPerformancePeriod = "3mo" | "year";
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Original report dates anchor calendar months; asOf independently limits known follow-up. */
export function historicalPerformanceWindow(asOf: string, period: HistoricalPerformancePeriod = "3mo", calendarThrough = asOf) {
  const count = period === "year" ? 12 : 3;
  const monthsThrough = (through: string) => {
    const date = new Date(through + "T12:00:00Z");
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    // Include the current month only when all its days have elapsed.
    const lastDay = iso(new Date(Date.UTC(year, month + 1, 0)));
    const endMonth = month + (through === lastDay ? 1 : 0);
    return {
      start: iso(new Date(Date.UTC(year, endMonth - count, 1))),
      end: iso(new Date(Date.UTC(year, endMonth, 0))),
    };
  };
  const endingObservationCutoff = iso(new Date(Date.parse(asOf + "T12:00:00Z") - 90 * 86400000));
  const anchor = calendarThrough < asOf ? calendarThrough : asOf;
  const cohort = monthsThrough(anchor);
  const matureThrough = iso(new Date(Date.parse(anchor + "T12:00:00Z") - 90 * 86400000));
  return { asOf, calendarThrough: anchor, cohort, attrition: monthsThrough(matureThrough), endingObservationCutoff };
}

export function historicalPerformance({ snapshots, consultSnapshots = snapshots, calendarSnapshots = snapshots, calendarScope, classificationSnapshots = snapshots, overrides = {}, attributions = [], cohortClinicianNames, excludedFollowUpEvidence = [], today, period = "3mo" }: {
  snapshots: LocalSnapshot[];
  consultSnapshots?: LocalSnapshot[];
  /** Original source reports, before canonical admission; dates only, never metric evidence. */
  calendarSnapshots?: LocalSnapshot[];
  /** Resolve original report ownership using the same full-roster/crosswalk rules as admission. */
  calendarScope?: {
    clinicians: readonly { id: number; label: string; goalId?: number | null }[];
    teamId: number | null;
    declarations?: ImportEvidenceDeclarations | null;
  };
  classificationSnapshots?: LocalSnapshot[];
  overrides?: SameDayVisitOverrides;
  attributions?: ConsultAttributionOverrideInput[];
  cohortClinicianNames?: string[];
  excludedFollowUpEvidence?: ClientActivityOptions["excludedFollowUpEvidence"];
  today: string;
  period?: HistoricalPerformancePeriod;
}) {
  const latest = calendarSnapshots.filter((snapshot) => snapshot.kind === "attendance" && (!calendarScope
    || [...snapshot.rows.map((row) => row.clinician), ...(snapshot.coverageClinicians ?? [])].some((label) =>
      resolveImportedProvider(label, calendarScope.clinicians, calendarScope.teamId, calendarScope.declarations) !== null)))
    .map((row) => row.reportCoverage?.complete ? row.reportCoverage.end : row.coverageEnd).sort().at(-1);
  const window = historicalPerformanceWindow(today, period, latest ?? today);
  const options = { classificationSnapshots, excludedFollowUpEvidence };
  const activity = (range: { start: string; end: string }) => estimateLocalClientActivity(snapshots, overrides, 56, 56, 28, window.asOf, 90, range.start, range.end, options);
  const clinicians = (range: { start: string; end: string }) => buildLocalRetentionMetrics(snapshots, {}, overrides, 28, window.asOf, 90, range.start, range.end, options).clientActivityByClinician;
  const retention = activity(window.cohort);
  return {
    window: { ...window, endingObservationCutoff: retention?.endingObservationCutoff ?? window.endingObservationCutoff },
    activity: retention,
    clinicians: clinicians(window.cohort),
    // Monthly ending statistics have their own mature event dates, not retention's cohort.
    attritionActivity: activity(window.attrition),
    attritionClinicians: clinicians(window.attrition),
    periodAttrition: periodClientAttrition({ snapshots, requestedWindow: window.attrition, asOf: window.asOf, overrides, ...options }),
    // Aggregate eligible/evaluated journeys once: never average monthly percentages.
    consults: summarizeConsultConversions(consultSnapshots, overrides, window.cohort.start, window.cohort.end, window.asOf, attributions, { ...options, cohortClinicianNames }),
  };
}
