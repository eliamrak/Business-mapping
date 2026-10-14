import { daysInclusive, type SessionRecord } from "@workspace/practice";
import { sessionPeriodObservation, type SessionAttendanceCoverage } from "./session-trend.ts";

export function monthlySessionObservations(records: SessionRecord[], clinicianIds: number[], coverage: SessionAttendanceCoverage[], asOf: string) {
  const selected = records.filter((record) => clinicianIds.includes(record.clinicianId) && record.start <= asOf);
  const intervals = coverage.filter((range) => clinicianIds.includes(range.clinicianId) && range.start <= asOf);
  const starts = [...selected.map((record) => record.start), ...intervals.map((range) => range.start)].sort();
  const ends = [...selected.map((record) => record.end), ...intervals.map((range) => range.end)].sort();
  if (!starts.length || !ends.length) return [];
  let month = starts[0].slice(0, 7) + "-01";
  const last = (ends.at(-1)! < asOf ? ends.at(-1)! : asOf).slice(0, 7);
  const result = [];
  while (month.slice(0, 7) <= last) {
    const next = new Date(month + "T12:00:00Z");
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextMonth = next.toISOString().slice(0, 10);
    const end = new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
    const observation = sessionPeriodObservation(selected, clinicianIds, { start: month, end }, intervals);
    const complete = end <= asOf && observation.coverageComplete;
    const value = complete ? observation.observedCompleted : null;
    const days = daysInclusive(month, end);
    result.push({ date: end, value, observedTotal: observation.observedCompleted, complete,
      weekly: value === null ? null : value * 7 / days,
      averageMonthEquivalent: value === null ? null : value * 30.4375 / days });
    month = nextMonth;
  }
  return result;
}
