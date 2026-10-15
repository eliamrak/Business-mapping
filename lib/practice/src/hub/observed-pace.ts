import { daysInclusive } from "../index.ts";

type PaceRecord = { id?: number; clinicianId: number; start: string; end: string; completed: number };
export type PaceCoverage = { clinicianId: number; start: string; end: string };
const shift = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);

/** Forecast estimates from recorded activity only. Goals/capacity are never missing-data substitutes. */
export function observedSessionPace(records: PaceRecord[], clinicianId: number, asOf: string, start = shift(asOf, -55), coverage: PaceCoverage[] = []) {
  const history = records.filter((record) => record.clinicianId === clinicianId && record.start <= record.end && record.end <= asOf && Number.isFinite(record.completed) && record.completed >= 0);
  let windowStart = start;
  let windowEnd = asOf;
  let selected = history.filter((record) => record.start >= windowStart && record.end <= windowEnd);
  let historicalFallback = false;
  const currentCoverage = coverage.some((range) => range.clinicianId === clinicianId && range.start <= asOf && range.end >= start);
  if (!selected.length && history.length && !currentCoverage) {
    windowEnd = history.map((record) => record.end).sort().at(-1)!;
    windowStart = shift(windowEnd, -55);
    selected = history.filter((record) => record.start >= windowStart && record.end <= windowEnd);
    historicalFallback = true;
  }
  const dates = new Set<string>();
  let overlap = false;
  for (const record of selected) for (let date = record.start; date <= record.end; date = shift(date, 1)) {
    if (dates.has(date)) overlap = true;
    dates.add(date);
  }
  const completed = selected.reduce((sum, record) => sum + record.completed, 0);
  const coveredDates = new Set<string>();
  for (const range of coverage.filter((range) => range.clinicianId === clinicianId)) {
    const from = range.start > windowStart ? range.start : windowStart;
    const through = range.end < windowEnd ? range.end : windowEnd;
    for (let date = from; date <= through; date = shift(date, 1)) coveredDates.add(date);
  }
  const sortedDates = [...dates].sort();
  const contiguous = sortedDates.length >= 7 && daysInclusive(sortedDates[0], sortedDates.at(-1)!) === sortedDates.length;
  const reportedPeriods = selected.length > 0 && selected.every((record) => (record.id ?? 0) >= 0 && daysInclusive(record.start, record.end) >= 7);
  const periodAverage = selected.every((record) => (record.id ?? 0) >= 0) && (reportedPeriods || contiguous);
  const coveredAverage = coveredDates.size >= 7 && sortedDates.every((date) => coveredDates.has(date));
  const denominatorDays = coveredAverage ? coveredDates.size : periodAverage ? dates.size : daysInclusive(windowStart, windowEnd);
  const available = (selected.length > 0 || coveredAverage) && !overlap && denominatorDays > 0;
  return {
    weekly: available ? completed * 7 / denominatorDays : null,
    completed: available ? completed : null,
    denominatorDays,
    recordedDays: coveredAverage ? coveredDates.size : periodAverage ? dates.size : 0,
    through: sortedDates.at(-1) ?? null,
    windowStart,
    windowEnd,
    historicalFallback,
    basis: !available ? "unavailable" : coveredAverage ? "reported-calendar average" : periodAverage ? "reported-period average" : "observed calendar-window estimate; coverage unverified",
  };
}
