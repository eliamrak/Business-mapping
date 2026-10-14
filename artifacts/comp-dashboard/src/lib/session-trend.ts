import { daysInclusive, type SessionRecord } from "@workspace/practice";

export type SessionPeriod = { start: string; end: string };
export type SessionAttendanceCoverage = SessionPeriod & { clinicianId: number };
const shift = (date: string, days: number) =>
  new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);

export function containedSessionRecords(records: SessionRecord[], clinicianIds: number[], period: SessionPeriod) {
  const ids = new Set(clinicianIds);
  return records.filter((record) => ids.has(record.clinicianId) &&
    record.start >= period.start && record.end <= period.end && record.start <= record.end);
}

/** Only explicit record ranges and scoped import intervals establish known days. */
export function sessionPeriodObservation(records: SessionRecord[], clinicianIds: number[], period: SessionPeriod, attendanceCoverage: SessionAttendanceCoverage[] = []) {
  const selected = containedSessionRecords(records, clinicianIds, period);
  const allDates = new Set<string>();
  let overlap = false;
  const complete = clinicianIds.length > 0 && period.start <= period.end && clinicianIds.map((id) => {
    const dates = new Set<string>();
    const recordDates = new Set<string>();
    for (const record of selected.filter((item) => item.clinicianId === id)) {
      for (let date = record.start; date <= record.end; date = shift(date, 1)) {
        if (recordDates.has(date)) overlap = true;
        recordDates.add(date);
        // Overlay IDs are negative: visit facts alone do not certify a full service day.
        if (record.id >= 0) dates.add(date);
      }
    }
    for (const range of attendanceCoverage.filter((item) => item.clinicianId === id)) {
      const start = range.start > period.start ? range.start : period.start;
      const end = range.end < period.end ? range.end : period.end;
      for (let date = start; date <= end; date = shift(date, 1)) dates.add(date);
    }
    for (const date of dates) allDates.add(date);
    return dates.size === daysInclusive(period.start, period.end);
  }).every(Boolean);
  const coverageComplete = complete && !overlap;
  const observedCompleted = overlap || (!selected.length && !allDates.size)
    ? null : selected.reduce((sum, record) => sum + record.completed, 0);
  return { observedCompleted, observedCoverageDays: allDates.size, coverageComplete,
    calendarWindowWeeklyEstimate: observedCompleted !== null && period.start <= period.end
      ? observedCompleted * 7 / daysInclusive(period.start, period.end) : null,
    completedWeekly: coverageComplete && observedCompleted !== null ? observedCompleted * 7 / daysInclusive(period.start, period.end) : null };
}

/** Coverage is the union of service dates; rates sum each clinician's observed weekly pace. */
export function selectedPeriodSessionSummary(records: SessionRecord[], clinicianIds: number[], period: SessionPeriod, attendanceCoverage?: SessionAttendanceCoverage[]): {
  completedWeekly: number | null; inPersonWeekly: number | null; observedCoverageDays: number;
  observedCompleted?: number | null; coverageComplete?: boolean;
  calendarWindowWeeklyEstimate?: number | null;
} {
  const selected = containedSessionRecords(records, clinicianIds, period);
  if (attendanceCoverage !== undefined || selected.some((record) => record.id < 0)) {
    const observation = sessionPeriodObservation(records, clinicianIds, period, attendanceCoverage ?? []);
    return { ...observation, inPersonWeekly: observation.coverageComplete && selected.length > 0 && selected.every((record) => record.inPerson != null)
      ? selected.reduce((sum, record) => sum + record.inPerson!, 0) * 7 / daysInclusive(period.start, period.end) : null };
  }
  const dates = new Set<string>();
  for (const record of selected) {
    for (let date = record.start; date <= record.end; date = shift(date, 1)) dates.add(date);
  }
  const covered = clinicianIds.length > 0 && clinicianIds.every((id) => {
    const entries = selected.filter((record) => record.clinicianId === id).sort((a, b) => a.start.localeCompare(b.start));
    return entries.length > 0 && entries.every((record, index) => index === 0 || record.start > entries[index - 1].end);
  });
  const rate = (field: "completed" | "inPerson") => covered
    ? clinicianIds.reduce((total, id) => {
      const entries = selected.filter((record) => record.clinicianId === id);
      const days = entries.reduce((sum, record) => sum + daysInclusive(record.start, record.end), 0);
      return total + entries.reduce((sum, record) => sum + (record[field] ?? 0), 0) * 7 / days;
    }, 0)
    : null;
  return {
    completedWeekly: rate("completed"),
    inPersonWeekly: selected.length && selected.every((record) => record.inPerson != null) ? rate("inPerson") : null,
    observedCoverageDays: dates.size,
  };
}

export function buildSessionTrend(
  records: SessionRecord[], clinicianIds: number[], practiceIds: number[], period: SessionPeriod,
  capacityFor: (date: string) => number, requiredWeeklySessions?: number,
  attendanceCoverage: SessionAttendanceCoverage[] = [],
) {
  const selected = containedSessionRecords(records, clinicianIds, period);
  const practice = containedSessionRecords(records, practiceIds, period);
  const time = (date: string) => Date.parse(date + "T12:00:00Z");
  const rows = new Map<string, {
    date: number; label: string; completed: number | null; periodRate: number | null;
    benchmark: number | null; benchmarkPeriodRate: number | null; capacity: number; required: number | null;
    observedCompleted: number | null; benchmarkObserved: number | null;
  }>();
  const rowFor = (date: string) => {
    let row = rows.get(date);
    if (!row) {
      row = { date: time(date), label: date, completed: null, periodRate: null, observedCompleted: null, benchmarkObserved: null,
        benchmark: null, benchmarkPeriodRate: null, capacity: capacityFor(date),
        required: requiredWeeklySessions != null && Number.isFinite(requiredWeeklySessions) ? requiredWeeklySessions : null };
      rows.set(date, row);
    }
    return row;
  };
  if (period.start > period.end) return [];
  const day = new Date(time(period.start)).getUTCDay();
  let monday = shift(period.start, -((day + 6) % 7));
  for (; monday <= period.end; monday = shift(monday, 7)) {
    const sunday = shift(monday, 6);
    const start = monday < period.start ? period.start : monday;
    const end = sunday > period.end ? period.end : sunday;
    const row = rowFor(start);
    const actual = sessionPeriodObservation(selected, clinicianIds, { start, end }, attendanceCoverage);
    const benchmark = sessionPeriodObservation(practice, practiceIds, { start, end }, attendanceCoverage);
    if (monday >= period.start && sunday <= period.end) {
      row.completed = actual.coverageComplete ? actual.observedCompleted : null;
      row.benchmark = benchmark.coverageComplete ? benchmark.observedCompleted : null;
    }
    row.observedCompleted = row.completed === null ? actual.observedCompleted : null;
    row.benchmarkObserved = row.benchmark === null ? benchmark.observedCompleted : null;
    if (row.observedCompleted !== null || row.completed !== null) row.label = `${start} to ${end}`;
  }
  // Non-calendar-week aggregates remain single period-rate observations at period end.
  const ranges = new Map<string, SessionPeriod>();
  for (const record of [...selected, ...practice]) {
    const isCalendarWeek = daysInclusive(record.start, record.end) === 7 && new Date(time(record.start)).getUTCDay() === 1;
    if (daysInclusive(record.start, record.end) > 1 && !isCalendarWeek) ranges.set(`${record.start}|${record.end}`, record);
  }
  for (const range of ranges.values()) {
    const exact = (entries: SessionRecord[], ids: number[]) => {
      const same = entries.filter((record) => record.start === range.start && record.end === range.end);
      if (!ids.length || !ids.every((id) => same.filter((record) => record.clinicianId === id).length === 1)) return null;
      if (!sessionPeriodObservation(entries, ids, range, attendanceCoverage).coverageComplete) return null;
      return same.reduce((sum, record) => sum + record.completed, 0) * 7 / daysInclusive(range.start, range.end);
    };
    const row = rowFor(range.end);
    row.periodRate = exact(selected, clinicianIds);
    row.benchmarkPeriodRate = exact(practice, practiceIds);
    row.label = `${range.start} to ${range.end}`;
  }
  rowFor(period.end);
  return [...rows.values()].sort((a, b) => a.date - b.date);
}
