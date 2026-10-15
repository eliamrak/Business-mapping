import type { PaceCoverage } from "./observed-pace.ts";

export const SERVICE_PERIOD_ANCHOR = "2026-01-01";
const DAY = 86400000;
const time = (date: string) => Date.parse(date + "T12:00:00Z");
const dateAt = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(time(date)) && dateAt(time(date)) === date;
const validRange = (row: { start: string; end: string }) => validDate(row.start) && validDate(row.end) && row.start <= row.end;
export type ServicePeriodRecord = { id?: number; clinicianId: number; start: string; end: string; completed: number };
export type CompleteServicePeriod = PaceCoverage & { completed: number };

/** Calendar service periods, independent of upload dates, pay dates and time zones. */
export function canonicalServicePeriod(date: string): { start: string; end: string } {
  if (!validDate(date)) throw new Error("Service periods require a valid calendar date.");
  const start = time(SERVICE_PERIOD_ANCHOR) + Math.floor((time(date) - time(SERVICE_PERIOD_ANCHOR)) / (14 * DAY)) * 14 * DAY;
  return { start: dateAt(start), end: dateAt(start + 13 * DAY) };
}

/** Completeness is report evidence, never the min/max dates of occupied visits. */
export function completeServicePeriodState<T extends ServicePeriodRecord>(
  records: readonly T[],
  clinicianIds: readonly number[],
  asOf: string,
  coverage: readonly PaceCoverage[] = [],
) {
  if (!validDate(asOf)) throw new Error("Complete service periods require a valid as-of date.");
  const ids = [...new Set(clinicianIds)];
  const selected = records.filter((row) => ids.includes(row.clinicianId));
  const eligible = new Set<T>();
  const completePeriods: CompleteServicePeriod[] = [];
  const excludedPeriods: (PaceCoverage & { reason: string })[] = [];
  for (const clinicianId of ids) {
    const history = selected.filter((row) => row.clinicianId === clinicianId && validRange(row));
    const declared = coverage.filter((row) => row.clinicianId === clinicianId && validRange(row));
    const ranges = [...history, ...declared].filter((row) => row.start <= asOf);
    if (!ranges.length) continue;
    const first = ranges.map((row) => row.start).sort()[0];
    const last = ranges.map((row) => row.end < asOf ? row.end : asOf).sort().at(-1)!;
    for (let stamp = time(canonicalServicePeriod(first).start); stamp <= time(last); stamp += 14 * DAY) {
      const start = dateAt(stamp), end = dateAt(stamp + 13 * DAY);
      const intersecting = history.filter((row) => row.start <= end && row.end >= start);
      const relevant = intersecting.length > 0 || declared.some((row) => row.start <= end && row.end >= start);
      if (!relevant) continue;
      const reject = (reason: string) => excludedPeriods.push({ clinicianId, start, end, reason });
      if (end > asOf) { reject("service period has not ended"); continue; }
      const declaredFull = declared.some((row) => row.start <= start && row.end >= end);
      // Retained partial evidence cannot invalidate a later complete source report.
      const admitted = intersecting.filter((row) => row.id === undefined || row.id > 0
        ? row.start === start && row.end === end
        : row.id < 0 && declaredFull && row.start >= start && row.end <= end);
      const exactManual = admitted.some((row) => row.id === undefined || row.id > 0);
      if (!exactManual && !declaredFull) { reject("complete service-period coverage is not declared"); continue; }
      if (admitted.some((row) => !Number.isFinite(row.completed) || row.completed < 0 || !Number.isInteger(row.completed))) { reject("session count is invalid"); continue; }
      const ordered = [...admitted].sort((a, b) => a.start.localeCompare(b.start));
      if (ordered.some((row, index) => index > 0 && row.start <= ordered[index - 1].end)) { reject("overlapping session counts are ambiguous"); continue; }
      completePeriods.push({ clinicianId, start, end, completed: admitted.reduce((sum, row) => sum + row.completed, 0) });
      for (const row of admitted) eligible.add(row);
    }
  }
  completePeriods.sort((a, b) => a.start.localeCompare(b.start) || a.clinicianId - b.clinicianId);
  const eligibleRecords = selected.filter((row) => eligible.has(row));
  const excludedRecords = selected.filter((row) => !eligible.has(row));
  const eligibleCoverage = completePeriods.map(({ clinicianId, start, end }) => ({ clinicianId, start, end }));
  const byClinician = ids.map((clinicianId) => {
    const periods = completePeriods.filter((row) => row.clinicianId === clinicianId);
    return {
      clinicianId,
      through: periods.at(-1)?.end ?? null,
      completePeriods: periods,
      eligibleRecords: eligibleRecords.filter((row) => row.clinicianId === clinicianId),
      eligibleCoverage: eligibleCoverage.filter((row) => row.clinicianId === clinicianId),
      excludedRecords: excludedRecords.filter((row) => row.clinicianId === clinicianId),
      excludedPeriods: excludedPeriods.filter((row) => row.clinicianId === clinicianId),
      completed: periods.reduce((sum, row) => sum + row.completed, 0),
      denominatorDays: periods.length * 14,
    };
  });
  const latestCompleteThrough = completePeriods.filter((period) => ids.every((clinicianId) => completePeriods.some((row) => row.clinicianId === clinicianId && row.end === period.end)))
    .map((period) => period.end).sort().at(-1) ?? null;
  return { eligibleRecords, eligibleCoverage, completePeriods, latestCompleteThrough, byClinician, excludedRecords, excludedPeriods };
}
