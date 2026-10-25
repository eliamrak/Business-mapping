export type ProgressionPeriod = "all" | "year" | "six-months" | "custom";
export function progressionPeriodRange(period: ProgressionPeriod, asOf: string, custom: {start: string; end: string}) {
  if (period === "custom") return custom;
  if (period === "all") return {start: "0000-01-01", end: asOf};
  const date = new Date(`${asOf}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - (period === "year" ? 12 : 6));
  const last = new Date(date.getTime()); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return {start: date.toISOString().slice(0,10), end: asOf};
}
export function validProgressionRange(range: {start:string;end:string}, asOf:string) {
  const valid = (s:string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s;
  return valid(range.start) && valid(range.end) && range.start <= range.end && range.end <= asOf;
}
