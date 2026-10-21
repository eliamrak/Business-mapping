import { daysInclusive } from "@workspace/practice";
import type { Context, Workspace } from "@workspace/practice/hub";
import { clinicianAvailableHistoryRange, type HistoricalPerformancePeriods } from "./historical-performance-periods.ts";
import { selectedPeriodSessionSummary, type SessionAttendanceCoverage, type SessionPeriod } from "./session-trend.ts";

export type OverviewHistoricalCapacityInput = {
  workspace: Workspace;
  context: Context;
  attendanceCoverage: SessionAttendanceCoverage[];
  historicalReports: Record<"3mo" | "year", { window: { cohort: SessionPeriod } }>;
  selectedClinicianIds: number[];
  today: string;
  /** Opt in only for an individual; practice totals retain their calendar basis. */
  historyBasis?: "calendar" | "available-history";
};

export type OverviewHistoricalCapacityPeriod = {
  range: SessionPeriod;
  requestedRange?: SessionPeriod;
  effectiveRange?: SessionPeriod | null;
  weekly: number | null;
  observedCompleted: number | null;
  desiredWeekly: number | null;
  utilizationPct: number | null;
  desiredBasis: "dated-profile-assumptions" | "current-card-assumptions" | "unknown";
  historicalDesiredWeekly: number | null;
  currentDesiredWeekly: number | null;
  coverageComplete: boolean;
  desiredCoverageComplete: boolean;
  unknownDesiredDays: number;
  reasons: string[];
};

const shift = (date: string) => new Date(Date.parse(date + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date + "T12:00:00Z")) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;

/** Complete calendar attendance / desired sessions, never room or maximum capacity.
 * Dated profiles are model assumptions, not audited historical capacity. Gaps use
 * a separately disclosed whole-window current-card scenario, never a blended rate.
 */
export function overviewHistoricalCapacity(input: OverviewHistoricalCapacityInput): Record<"3mo" | "year", OverviewHistoricalCapacityPeriod> {
  const { workspace, context, attendanceCoverage, historicalReports, today } = input;
  const ids = [...new Set(input.selectedClinicianIds)];
  const summarize = (period: "3mo" | "year"): OverviewHistoricalCapacityPeriod => {
    const range = { ...historicalReports[period].window.cohort };
    const requestedRange = { ...range };
    let admittedRangeComplete = true;
    const reasons = new Set<string>();
    const result: OverviewHistoricalCapacityPeriod = {
      range, requestedRange, effectiveRange: { ...range }, weekly: null, observedCompleted: null, desiredWeekly: null, utilizationPct: null,
      desiredBasis: "unknown", historicalDesiredWeekly: null, currentDesiredWeekly: null,
      coverageComplete: false, desiredCoverageComplete: false, unknownDesiredDays: 0, reasons: [],
    };
    const finish = () => ({ ...result, reasons: [...reasons] });
    if (!validDate(today) || !validDate(range.start) || !validDate(range.end) || range.start > range.end || range.end > today) {
      reasons.add("Historical window or observation cutoff is invalid or extends beyond today.");
      return finish();
    }
    const end = new Date(range.end + "T12:00:00Z");
    const expectedStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1 - (period === "3mo" ? 3 : 12), 1)).toISOString().slice(0, 10);
    const expectedEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (range.start !== expectedStart || range.end !== expectedEnd) {
      reasons.add("Historical window must contain the requested complete calendar months.");
      return finish();
    }
    const people = ids.map(id => context.clinicians.filter(person => person.id === id));
    if (!ids.length || people.some(matches => matches.length !== 1 || (matches[0].goalId ?? null) !== workspace.settings.teamId)) {
      reasons.add("Select unique, known clinician IDs belonging to the workspace team.");
      return finish();
    }
    if (input.historyBasis === "available-history") {
      if (ids.length !== 1) {
        result.effectiveRange = null;
        reasons.add("Available history requires one unique clinician; practice totals use complete calendar windows.");
        return finish();
      }
      const resolved = clinicianAvailableHistoryRange(requestedRange, ids[0], attendanceCoverage);
      admittedRangeComplete = resolved.coverageComplete;
      result.effectiveRange = resolved.effectiveRange;
      if (!resolved.effectiveRange) {
        reasons.add("No admitted attendance history is available in the requested window.");
        return finish();
      }
      Object.assign(range, resolved.effectiveRange);
      reasons.add(`Available attendance history: ${range.start} to ${range.end}; requested ${requestedRange.start} to ${requestedRange.end}. These dates do not establish employment tenure.`);
    }
    // Crossing aggregates cannot establish the selected calendar total, even if
    // separate coverage proves every date. Never prorate or silently drop them.
    const crossing = context.sessions.some(row => ids.includes(row.clinicianId)
      && row.start <= range.end && row.end >= range.start && (row.start < range.start || row.end > range.end));
    const summary = selectedPeriodSessionSummary(context.sessions, ids, range, attendanceCoverage);
    result.observedCompleted = crossing ? null : summary.observedCompleted ?? null;
    result.coverageComplete = summary.coverageComplete === true && !crossing && admittedRangeComplete;
    result.weekly = result.coverageComplete ? summary.completedWeekly : null;
    if (crossing) reasons.add("A session aggregate crosses the calendar boundary; its count cannot be prorated or silently omitted.");
    if (!result.coverageComplete) reasons.add("Actual weekly sessions require nonoverlapping attendance evidence covering every selected clinician and every calendar day; missing days are unknown, not zero.");
    let desiredSum = 0;
    for (const [index, id] of ids.entries()) {
      const profiles = workspace.clinicians.filter(row => row.clinicianId === id);
      let unknownDays = 0;
      for (let date = range.start; date <= range.end; date = shift(date)) {
        const matching = profiles.filter(row => row.start <= date && (row.end === null || row.end >= date));
        const profile = matching.length === 1 ? matching[0] : null;
        // onTeam is a current roster switch, not dated employment evidence.
        // Archived/planned rows and overlapping configurations do not prove a goal.
        if (!profile || profile.status !== "active" || !nonnegative(profile.desiredWeeklySessions)) unknownDays++;
        else desiredSum += profile.desiredWeeklySessions;
      }
      result.unknownDesiredDays += unknownDays;
      if (unknownDays) reasons.add(`${people[index][0].label}: desired sessions are unknown on ${unknownDays} clinician-days with missing, overlapping, archived or planned profiles.`);
    }
    result.desiredCoverageComplete = result.unknownDesiredDays === 0;
    if (result.desiredCoverageComplete) result.historicalDesiredWeekly = desiredSum / daysInclusive(range.start, range.end);
    const currentPeople = people.map(matches => matches[0]);
    if (currentPeople.every(person => nonnegative(person.sessionsPerWeek))) {
      result.currentDesiredWeekly = currentPeople.reduce((sum, person) => sum + person.sessionsPerWeek, 0);
    }
    result.desiredWeekly = result.historicalDesiredWeekly ?? result.currentDesiredWeekly;
    result.desiredBasis = result.historicalDesiredWeekly !== null ? "dated-profile-assumptions"
      : result.currentDesiredWeekly !== null ? "current-card-assumptions" : "unknown";
    if (result.desiredBasis === "unknown") reasons.add("Neither complete dated desired profiles nor valid current-card desired sessions/week are available.");
    else reasons.add(result.desiredBasis === "current-card-assumptions"
      ? "Desired denominator uses current clinician-card sessions/week for the whole window; historical staffing and desired capacity are unverified. This is an assumption comparison, not actual historical capacity."
      : "Dated desired-session profiles are model assumptions, not verified actual historical capacity; room limits, maximum capacity, working-week discounts and planning events are not desired-session goals.");
    if (result.weekly !== null && result.desiredWeekly !== null && result.desiredWeekly > 0) {
      result.utilizationPct = result.weekly / result.desiredWeekly * 100;
    }
    if (result.desiredWeekly === 0) reasons.add("Desired sessions/week is zero; percent full is undefined.");
    return finish();
  };
  return { "3mo": summarize("3mo"), year: summarize("year") };
}

/** Whole-window count and percentage share one unique observed-client cohort.
 * Monthly averages retain their separate mature-month basis.
 */
export function overviewHistoricalAttrition(reports: HistoricalPerformancePeriods, clinicianName?: string) {
  const summarize = (period: "3mo" | "year") => {
    const report = reports[period];
    const matches = clinicianName === undefined ? [] : report.clinicians.filter(row =>
      row.clinician.trim().replace(/\s+/g, " ").toLowerCase() === clinicianName.trim().replace(/\s+/g, " ").toLowerCase());
    const source = clinicianName === undefined ? report.activity : matches.length === 1 ? matches[0] : null;
    const months = source?.endingFullMonthDenominator;
    const periodMatches = clinicianName === undefined ? [] : (report.periodAttrition?.byClinician ?? []).filter(row =>
      row.clinician.trim().replace(/\s+/g, " ").toLowerCase() === clinicianName.trim().replace(/\s+/g, " ").toLowerCase());
    const periodSource = clinicianName === undefined ? report.periodAttrition?.practice : periodMatches.length === 1 ? periodMatches[0] : undefined;
    return {
      range: { ...report.window.attrition }, total: periodSource?.totalEnded ?? null,
      coveredMatureMonths: months ?? null, eligibleClients: periodSource?.totalEligible ?? null, attritionPct: periodSource?.percentage ?? null,
      coverageComplete: periodSource?.coverageComplete ?? false,
      cohortQualifier: periodSource?.cohortQualifier ?? "observed-established-clients",
      observedMaturePortion: periodSource?.observedMaturePortion ?? null,
      reasons: periodSource?.reasons ?? ["Whole-window client evidence is unavailable."],
    };
  };
  return { "3mo": summarize("3mo"), year: summarize("year") };
}
