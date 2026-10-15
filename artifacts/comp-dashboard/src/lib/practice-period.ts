import { lastCompleted1099ServicePeriod } from "./session-overview.ts";
export type PracticePeriod = "30d" | "60d" | "90d" | "6m" | "year" | "overall" | "4pay" | "4weeks" | "custom";
const shift = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export function practicePeriodRange(period: PracticePeriod, today: string, custom: { start: string; end: string }) {
  if (period === "custom") return custom;
  if (period === "overall") return { start: "0000-01-01", end: today };
  if (period === "year") return { start: today.slice(0, 4) + "-01-01", end: today };
  if (period === "4pay") {
    const latest = lastCompleted1099ServicePeriod(today);
    return latest ? { start: shift(latest.start, -42), end: latest.end } : { start: today, end: today };
  }
  if (period === "4weeks") {
    const weekday = new Date(today + "T12:00:00Z").getUTCDay();
    const end = shift(today, -(weekday === 0 ? 7 : weekday));
    return { start: shift(end, -27), end };
  }
  const days = period === "60d" ? 60 : period === "90d" ? 90 : period === "6m" ? 183 : 30;
  return { start: shift(today, 1 - days), end: today };
}
