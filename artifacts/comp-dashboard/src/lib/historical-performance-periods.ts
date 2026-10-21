import { historicalPerformance, type HistoricalPerformancePeriod } from "./historical-performance.ts";
import { buildLocalRetentionMetrics, estimateLocalClientActivity } from "./retention-local.ts";
import { summarizeBookingConversions as summarizeConsultConversions } from "./consult-booking-conversions.ts";
import { periodClientAttrition } from "./period-client-attrition.ts";
import type { SessionAttendanceCoverage, SessionPeriod } from "./session-trend.ts";

export type AvailableHistoryRange = {
  requestedRange: SessionPeriod;
  effectiveRange: SessionPeriod | null;
  coverageComplete: boolean;
  clipped: boolean;
};

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date + "T12:00:00Z"))
  && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;

/** Bounds come only from admitted provider coverage, never visit dates or profile dates.
 * Keep interior gaps in the effective range so completeness cannot be manufactured.
 */
export function clinicianAvailableHistoryRange(requestedRange: SessionPeriod, clinicianId: number,
  attendanceCoverage: readonly SessionAttendanceCoverage[]): AvailableHistoryRange {
  const result: AvailableHistoryRange = { requestedRange: { ...requestedRange }, effectiveRange: null, coverageComplete: false, clipped: false };
  if (!validDate(requestedRange.start) || !validDate(requestedRange.end) || requestedRange.start > requestedRange.end) return result;
  const ranges = attendanceCoverage.filter(row => row.clinicianId === clinicianId
    && validDate(row.start) && validDate(row.end) && row.start <= row.end
    && row.start <= requestedRange.end && row.end >= requestedRange.start)
    .map(row => ({ start: row.start < requestedRange.start ? requestedRange.start : row.start,
      end: row.end > requestedRange.end ? requestedRange.end : row.end }))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!ranges.length) return result;
  let through = ranges[0].end;
  let complete = true;
  for (const row of ranges.slice(1)) {
    if (Date.parse(row.start + "T12:00:00Z") - Date.parse(through + "T12:00:00Z") > 86400000) complete = false;
    if (row.end > through) through = row.end;
  }
  result.effectiveRange = { start: ranges[0].start, end: through };
  result.coverageComplete = complete;
  result.clipped = ranges[0].start !== requestedRange.start || through !== requestedRange.end;
  return result;
}

export type HistoricalPerformanceInput = Omit<Parameters<typeof historicalPerformance>[0], "period">;
export type HistoricalPerformanceResult = ReturnType<typeof historicalPerformance>;
export type HistoricalPerformancePeriods = Record<HistoricalPerformancePeriod, HistoricalPerformanceResult>;
export type ClinicianHistoricalAttrition = Pick<HistoricalPerformanceResult,
  "window" | "attritionActivity" | "attritionClinicians" | "periodAttrition">;

/** Both calendar histories use the same evidence and observation cutoff. */
export function historicalPerformancePeriods(input: HistoricalPerformanceInput): HistoricalPerformancePeriods {
  return {
    "3mo": historicalPerformance({ ...input, period: "3mo" }),
    year: historicalPerformance({ ...input, period: "year" }),
  };
}

/** Re-evaluate both clinician windows without changing the practice baseline or
 * trimming classification/follow-up evidence to the selected event dates.
 * attendanceCoverage must be the post-admission, post-conflict provider proof.
 * ranges/clinician retain cohort availability; attritionRanges/attrition are
 * independent so a missing recent cohort cannot hide usable mature history.
 */
export function clinicianHistoricalPerformancePeriods(input: HistoricalPerformanceInput & {
  clinicianId: number;
  attendanceCoverage: readonly SessionAttendanceCoverage[];
  practiceReports?: HistoricalPerformancePeriods;
}) {
  const practice = input.practiceReports ?? historicalPerformancePeriods(input);
  const ranges = {} as Record<HistoricalPerformancePeriod, AvailableHistoryRange>;
  const attritionRanges = {} as Record<HistoricalPerformancePeriod, AvailableHistoryRange>;
  const attrition = {} as Record<HistoricalPerformancePeriod, ClinicianHistoricalAttrition | null>;
  const clinician = {} as Record<HistoricalPerformancePeriod, HistoricalPerformanceResult | null>;
  for (const period of ["3mo", "year"] as const) {
    const base = practice[period];
    const resolved = clinicianAvailableHistoryRange(base.window.cohort, input.clinicianId, input.attendanceCoverage);
    ranges[period] = resolved;
    const resolvedAttrition = clinicianAvailableHistoryRange(base.window.attrition, input.clinicianId, input.attendanceCoverage);
    attritionRanges[period] = resolvedAttrition;
    const attritionRange = resolvedAttrition.effectiveRange;
    const options = () => ({ classificationSnapshots: input.classificationSnapshots ?? input.snapshots,
      excludedFollowUpEvidence: input.excludedFollowUpEvidence ?? [] });
    if (!attritionRange || !resolvedAttrition.coverageComplete) {
      attrition[period] = null;
    } else if (!resolvedAttrition.clipped) {
      attrition[period] = base;
    } else {
      attrition[period] = {
        window: { ...base.window, attrition: { ...attritionRange } },
        attritionActivity: estimateLocalClientActivity(input.snapshots, input.overrides ?? {}, 56, 56, 28,
          base.window.asOf, 90, attritionRange.start, attritionRange.end, options()),
        attritionClinicians: buildLocalRetentionMetrics(input.snapshots, {}, input.overrides ?? {}, 28,
          base.window.asOf, 90, attritionRange.start, attritionRange.end, options()).clientActivityByClinician,
        periodAttrition: periodClientAttrition({ snapshots: input.snapshots, requestedWindow: attritionRange,
          asOf: base.window.asOf, overrides: input.overrides ?? {}, ...options() }),
      };
    }
    const range = resolved.effectiveRange;
    if (!range || !resolved.coverageComplete) {
      clinician[period] = null;
      continue;
    }
    if (!resolved.clipped && attrition[period] === base) {
      clinician[period] = base;
      continue;
    }
    const activity = resolved.clipped ? estimateLocalClientActivity(input.snapshots, input.overrides ?? {}, 56, 56, 28,
      base.window.asOf, 90, range.start, range.end, options()) : base.activity;
    const attritionReport = attrition[period];
    clinician[period] = {
      window: { ...base.window, cohort: { ...range }, attrition: { ...(attritionReport?.window.attrition ?? base.window.attrition) },
        endingObservationCutoff: activity?.endingObservationCutoff ?? base.window.endingObservationCutoff },
      activity,
      clinicians: resolved.clipped ? buildLocalRetentionMetrics(input.snapshots, {}, input.overrides ?? {}, 28,
        base.window.asOf, 90, range.start, range.end, options()).clientActivityByClinician : base.clinicians,
      attritionActivity: attritionReport?.attritionActivity ?? null,
      attritionClinicians: attritionReport?.attritionClinicians ?? [],
      periodAttrition: attritionReport?.periodAttrition ?? periodClientAttrition({ snapshots: [],
        requestedWindow: base.window.attrition, asOf: base.window.asOf }),
      consults: resolved.clipped ? summarizeConsultConversions(input.consultSnapshots ?? input.snapshots, input.overrides ?? {},
        range.start, range.end, base.window.asOf, input.attributions ?? [],
        { ...options(), cohortClinicianNames: input.cohortClinicianNames }) : base.consults,
    };
  }
  return { practice, clinician, ranges, attrition, attritionRanges };
}

export function historicalPeriodDifference(recent: number | null | undefined, baseline: number | null | undefined): number | null {
  return recent == null || baseline == null || !Number.isFinite(recent) || !Number.isFinite(baseline)
    ? null : recent - baseline;
}
