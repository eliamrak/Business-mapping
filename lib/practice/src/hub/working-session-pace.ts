import { daysInclusive } from "../index.ts";
import type { PaceCoverage } from "./observed-pace.ts";

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

/** Available reported history, including quiet calendar weeks; never desired volume. */
export function workingSessionPace(records: Record[], clinicianId: number, asOf: string, coverage: PaceCoverage[] = []) {
  const history = records.filter((row) => row.clinicianId === clinicianId && row.start <= row.end && row.end <= asOf && Number.isFinite(row.completed) && row.completed >= 0);
  const covered = coverage.filter((row) => row.clinicianId === clinicianId && row.start <= asOf && row.start <= row.end);
  const ends = [...history.map((row) => row.end), ...covered.map((row) => row.end < asOf ? row.end : asOf)].sort();
  const through = ends.at(-1) ?? null;
  const availableStart = [...history.map((row) => row.start), ...covered.map((row) => row.start)].sort()[0];
  const windowStart = through ? [rollingThreeMonthStart(through), availableStart].sort().at(-1)! : asOf;
  const selected = through ? history.filter((row) => row.start >= windowStart && row.end <= through) : [];
  const boundaryAggregate = through !== null && history.some((row) => row.start < windowStart && row.end >= windowStart && row.end <= through);
  const dates = new Set<string>();
  const proof = new Set<string>();
  let overlap = false;
  for (const row of selected) for (let date = row.start; date <= row.end; date = shift(date, 1)) {
    if (dates.has(date)) overlap = true;
    dates.add(date);
    if ((row.id ?? 0) >= 0) proof.add(date);
  }
  if (through) for (const row of covered) for (let date = row.start > windowStart ? row.start : windowStart; date <= (row.end < through ? row.end : through); date = shift(date, 1)) proof.add(date);
  const denominatorDays = through ? daysInclusive(windowStart, through) : 0;
  const available = through !== null && !overlap && !boundaryAggregate && (selected.length > 0 || proof.size === denominatorDays);
  const completed = selected.reduce((sum, row) => sum + row.completed, 0);
  return {
    weekly: available ? completed * 7 / denominatorDays : null,
    completed: available ? completed : null,
    denominatorDays,
    recordedDays: proof.size,
    through, windowStart, windowEnd: through ?? asOf,
    coverageComplete: available && proof.size === denominatorDays,
    basis: available ? "recorded sessions / available calendar weeks in rolling three months" : "working session average unavailable",
  };
}
