import { daysInclusive } from "../index.ts";
import type { PaceCoverage } from "./observed-pace.ts";
import { completeServicePeriodState } from "./complete-periods.ts";

type Record = { id?: number; clinicianId: number; start: string; end: string; completed: number };
const shift = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export function rollingThreeMonthStart(through: string) {
  const date = new Date(through + "T12:00:00Z");
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 3);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return shift(date.toISOString().slice(0, 10), 1);
}

/** Only completed, proved service periods enter history; unreported gaps are not zero. */
export function workingSessionPace(records: Record[], clinicianId: number, asOf: string, coverage: PaceCoverage[] = []) {
  const state = completeServicePeriodState(records, [clinicianId], asOf, coverage);
  const through = state.latestCompleteThrough;
  const lookbackStart = through ? rollingThreeMonthStart(through) : asOf;
  const completePeriods = state.completePeriods.filter((row) => row.start >= lookbackStart);
  const windowStart = completePeriods[0]?.start ?? lookbackStart;
  const denominatorDays = completePeriods.length * 14;
  const available = denominatorDays > 0;
  const completed = completePeriods.reduce((sum, row) => sum + row.completed, 0);
  const outsideWindow = state.eligibleRecords.filter((row) => row.start < windowStart);
  return {
    weekly: available ? completed * 7 / denominatorDays : null,
    completed: available ? completed : null,
    denominatorDays,
    recordedDays: denominatorDays,
    through, windowStart, windowEnd: through ?? asOf,
    lookbackStart,
    coverageComplete: available && denominatorDays === daysInclusive(windowStart, through!),
    completePeriods,
    excludedRecords: [...state.excludedRecords, ...outsideWindow],
    excludedPeriods: state.excludedPeriods,
    excludedRecordCount: state.excludedRecords.length + outsideWindow.length,
    basis: available ? "recorded sessions / completed 14-day service periods in rolling three calendar months" : "working session average unavailable: no complete service-period proof",
  };
}
