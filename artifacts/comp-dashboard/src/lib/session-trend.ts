import { daysInclusive, type SessionRecord } from "@workspace/practice";

export type SessionPeriod = { start: string; end: string };
const shift = (date: string, days: number) =>
  new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);

export function containedSessionRecords(records: SessionRecord[], clinicianIds: number[], period: SessionPeriod) {
  const ids = new Set(clinicianIds);
  return records.filter((record) => ids.has(record.clinicianId) &&
    record.start >= period.start && record.end <= period.end && record.start <= record.end);
}

/** Coverage is the union of service dates; rates sum each clinician's observed weekly pace. */
export function selectedPeriodSessionSummary(records: SessionRecord[], clinicianIds: number[], period: SessionPeriod) {
  const selected = containedSessionRecords(records, clinicianIds, period);
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
) {
  const selected = containedSessionRecords(records, clinicianIds, period);
  const practice = containedSessionRecords(records, practiceIds, period);
  const time = (date: string) => Date.parse(date + "T12:00:00Z");
  const rows = new Map<string, {
    date: number; label: string; completed: number | null; periodRate: number | null;
    benchmark: number | null; benchmarkPeriodRate: number | null; capacity: number; required: number | null;
  }>();
  const rowFor = (date: string) => {
    let row = rows.get(date);
    if (!row) {
      row = { date: time(date), label: date, completed: null, periodRate: null,
        benchmark: null, benchmarkPeriodRate: null, capacity: capacityFor(date),
        required: requiredWeeklySessions != null && Number.isFinite(requiredWeeklySessions) ? requiredWeeklySessions : null };
      rows.set(date, row);
    }
    return row;
  };
  const weeklyTotal = (entries: SessionRecord[], ids: number[], start: string, end: string) => {
    if (!ids.length) return null;
    let total = 0;
    for (const id of ids) {
      const within = entries.filter((record) => record.clinicianId === id && record.start >= start && record.end <= end);
      const dates = new Set<string>();
      for (const record of within) {
        for (let date = record.start; date <= record.end; date = shift(date, 1)) {
          if (dates.has(date)) return null;
          dates.add(date);
        }
      }
      if (dates.size !== 7) return null;
      total += within.reduce((sum, record) => sum + record.completed, 0);
    }
    return total;
  };
  if (period.start > period.end) return [];
  const day = new Date(time(period.start)).getUTCDay();
  let monday = shift(period.start, -((day + 6) % 7));
  for (; monday <= period.end; monday = shift(monday, 7)) {
    const sunday = shift(monday, 6);
    const row = rowFor(monday < period.start ? period.start : monday);
    if (monday >= period.start && sunday <= period.end) {
      row.completed = weeklyTotal(selected, clinicianIds, monday, sunday);
      row.benchmark = weeklyTotal(practice, practiceIds, monday, sunday);
    }
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
