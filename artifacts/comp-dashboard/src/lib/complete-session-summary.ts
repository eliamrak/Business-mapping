import { completeServicePeriodState } from "@workspace/practice/hub";
import type { SessionRecord } from "@workspace/practice";
import { buildSessionTrend, type SessionAttendanceCoverage, type SessionPeriod } from "./session-trend.ts";

const shift = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const datesIn = (start: string, end: string) => {
  const dates: string[] = [];
  for (let date = start; date <= end; date = shift(date, 1)) dates.push(date);
  return dates;
};

export function completeSessionHistoryStart(records: SessionRecord[], clinicianIds: number[], coverage: SessionAttendanceCoverage[], asOf: string): string | null {
  return completeServicePeriodState(records, clinicianIds, asOf, coverage).eligibleCoverage
    .map((proof) => proof.start).sort()[0] ?? null;
}

/** Only complete source periods contribute; excluded calendar days are not zero weeks. */
export function completePeriodSessionSummary(records: SessionRecord[], clinicianIds: number[], period: SessionPeriod, coverage: SessionAttendanceCoverage[] = [], asOf = period.end) {
  const state = completeServicePeriodState(records, clinicianIds, asOf, coverage);
  const byClinician = clinicianIds.map((id) => {
    const eligible = state.eligibleRecords.filter((row) => row.clinicianId === id);
    const known = new Set(state.eligibleCoverage.filter((row) => row.clinicianId === id).flatMap((row) => datesIn(row.start > period.start ? row.start : period.start, row.end < period.end ? row.end : period.end)));
    // An aggregate crossing the query boundary cannot be silently prorated.
    for (const row of eligible.filter((row) => row.start < period.start || row.end > period.end))
      for (const date of datesIn(row.start, row.end)) known.delete(date);
    return { id, eligible, known };
  });
  const commonDays = new Set(byClinician[0] ? [...byClinician[0].known].filter((date) => byClinician.every((person) => person.known.has(date))) : []);
  // One removal can bisect an aggregate already visited for another clinician.
  let previousSize: number;
  do {
    previousSize = commonDays.size;
    for (const person of byClinician) for (const row of person.eligible) {
      const dates = datesIn(row.start, row.end);
      if (dates.some((date) => commonDays.has(date)) && !dates.every((date) => commonDays.has(date)))
        for (const date of dates) commonDays.delete(date);
    }
  } while (commonDays.size < previousSize);
  const selected = state.eligibleRecords.filter((row) => datesIn(row.start, row.end).every((date) => commonDays.has(date)));
  const completed = commonDays.size ? selected.reduce((sum, row) => sum + row.completed, 0) : null;
  const inPerson = completed !== null && selected.every((row) => row.inPerson != null) ? selected.reduce((sum, row) => sum + row.inPerson!, 0) : null;
  return {
    observedCompleted: completed, observedCoverageDays: commonDays.size,
    coverageComplete: commonDays.size > 0 && commonDays.size === (Date.parse(period.end + "T12:00:00Z") - Date.parse(period.start + "T12:00:00Z")) / 86400000 + 1,
    completedWeekly: completed === null ? null : completed * 7 / commonDays.size,
    inPersonWeekly: inPerson === null ? null : inPerson * 7 / commonDays.size,
    calendarWindowWeeklyEstimate: null,
    excludedRecordsCount: state.excludedRecords.length,
    basis: "Complete source pay periods only; incomplete days excluded from totals and averages.",
  };
}

export function buildCompleteSessionTrend(...args: Parameters<typeof buildSessionTrend>) {
  const [records, ids, practiceIds, period, capacity, goal, coverage = []] = args;
  const through = [...coverage.map((row) => row.end), ...records.map((row) => row.end)].sort().at(-1) ?? period.end;
  const state = completeServicePeriodState(records, practiceIds, through, coverage);
  return buildSessionTrend(state.eligibleRecords, ids, practiceIds, period, capacity, goal, state.eligibleCoverage)
    .map((row) => ({ ...row, observedCompleted: null, benchmarkObserved: null }));
}
