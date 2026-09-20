import { daysInclusive } from "../index.ts";
import type { Condition, Workspace } from "./model.ts";
import type { ForecastMonth, Values } from "./engine.ts";

type Leaf = Extract<Condition, { type: "condition" }>;
type Result = boolean | null;
const combine = (results: Result[], all: boolean): Result =>
  all
    ? results.includes(false)
      ? false
      : results.includes(null)
        ? null
        : true
    : results.includes(true)
      ? true
      : results.includes(null)
        ? null
        : false;

function monthlyFraction(start: string, end: string) {
  let result = 0;
  let date = start;
  while (date <= end) {
    const d = new Date(date + "T12:00:00Z");
    const last = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12),
    );
    const stop =
      last.toISOString().slice(0, 10) < end
        ? last.toISOString().slice(0, 10)
        : end;
    result += daysInclusive(date, stop) / last.getUTCDate();
    date = new Date(Date.parse(stop + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
  }
  return result;
}

/** Three-valued evaluation keeps absent observations distinct from a failed rule. */
export function conditionResult(
  c: Condition,
  series: ForecastMonth[],
  index: number,
  workspace: Workspace,
): Result {
  if (c.type === "group")
    return combine(
      c.children.map((child) =>
        conditionResult(child, series, index, workspace),
      ),
      c.logic === "all",
    );
  if (index < 0 || index >= series.length || index + 1 < c.periods) return null;
  const size = c.window ?? 1;
  const measure = c.measure ?? "value";
  const contiguous = (from: number, to: number) => {
    if (from < 0) return false;
    for (let i = from + 1; i <= to; i++) {
      const previous = series[i - 1],
        current = series[i];
      if (current.periodStart) {
        if (daysInclusive(previous.date, current.periodStart) !== 2)
          return false;
      } else {
        const d = new Date(previous.date + "T12:00:00Z");
        d.setUTCMonth(d.getUTCMonth() + 1);
        if (d.toISOString().slice(0, 7) !== current.date.slice(0, 7))
          return false;
      }
    }
    return true;
  };
  const ids = (at: number) =>
    c.clinicianIds.length
      ? c.clinicianIds.map(String)
      : Object.keys(series[at].clinicians);
  const raw = (
    at: number,
    id?: string,
    metric = c.metric,
    basis?: "forecast" | "budget",
  ): number | null => {
    if (at < 0) return null;
    const m = series[at];
    if (basis)
      return (
        (basis === "forecast" ? m.forecastValues : m.budgetValues)?.[metric] ??
        null
      );
    if (id) return m.clinicians[id]?.[metric] ?? null;
    if (c.scope === "practice") return m.values[metric] ?? null;
    const selected = ids(at).map((key) => m.clinicians[key]?.[metric] ?? null);
    if (!selected.length) return null;
    if (c.scope === "count") return selected.filter((v) => v !== null).length;
    if (selected.some((v) => v === null)) return null;
    if (c.scope === "percentage")
      return (
        (selected.filter((v) => v! >= c.upper).length / selected.length) * 100
      );
    return (
      selected.reduce<number>((sum, v) => sum + v!, 0) /
      (c.scope === "average" ? selected.length : 1)
    );
  };
  const measured = (
    at: number,
    id?: string,
    metric = c.metric,
    basis?: "forecast" | "budget",
  ): number | null => {
    const from =
      measure === "value"
        ? at
        : measure === "average" || measure === "sum"
          ? at - size + 1
          : at - size;
    if (!contiguous(from, at)) return null;
    const now = raw(at, id, metric, basis);
    if (measure === "value") return now;
    const samples = Array.from({ length: at - from + 1 }, (_, i) =>
      raw(from + i, id, metric, basis),
    );
    if (samples.some((v) => v === null)) return null;
    if (measure === "average" || measure === "sum")
      return (
        samples.reduce<number>((sum, v) => sum + v!, 0) /
        (measure === "average" ? samples.length : 1)
      );
    const before = samples[0]!;
    return measure === "change"
      ? now! - before
      : before === 0
        ? null
        : ((now! - before) / Math.abs(before)) * 100;
  };
  const compare = (at: number, id?: string): Result => {
    const value = measured(at, id);
    if (c.operator === "missing") return value === null;
    if (value === null) return null;
    let target: number | null = c.value;
    if (c.compareTo === "previous") {
      const prior = measured(at - 1, id);
      target = prior === null ? null : prior + c.value;
    } else if (c.compareTo === "goal") {
      const goals = workspace.goals
        .filter((g) => !g.archived && g.metric === c.metric)
        .sort((a, b) => a.date.localeCompare(b.date));
      const goal = goals.find((g) => g.date >= series[at].date) ?? goals.at(-1);
      target = goal ? goal.amount / (goal.basis === "annual" ? 12 : 1) : null;
      if (target !== null && series[at].periodStart)
        target *= monthlyFraction(series[at].periodStart!, series[at].date);
    } else if (
      c.compareTo === "metric" ||
      c.compareTo === "forecast" ||
      c.compareTo === "budget"
    ) {
      const reference = measured(
        at,
        id,
        c.compareTo === "metric" ? c.comparisonMetric : c.metric,
        c.compareTo === "metric" ? undefined : c.compareTo,
      );
      target = reference === null ? null : reference + c.value;
    }
    if (target === null) return null;
    switch (c.operator) {
      case "gt":
        return value > target;
      case "gte":
        return value >= target;
      case "lt":
        return value < target;
      case "lte":
        return value <= target;
      case "eq":
        return Math.abs(value - target) < 1e-8;
      case "between":
        return value >= target && value <= c.upper;
    }
  };
  const first = index - c.periods + 1;
  if (!contiguous(first, index)) return null;
  return combine(
    Array.from({ length: c.periods }, (_, offset) => {
      const at = first + offset;
      const date = series[at].date;
      if ((c.start && date < c.start) || (c.end && date > c.end)) return false;
      if (c.scope !== "all" && c.scope !== "any") return compare(at);
      const selected = ids(at);
      return selected.length
        ? combine(
            selected.map((id) => compare(at, id)),
            c.scope === "all",
          )
        : null;
    }),
    true,
  );
}
