/** Page 68 calendar-response model. Pure aggregate mathematics; no records,
 * persistence, provider calls or default substitution for missing evidence. */
export const REVIEWED_GROWTH_VERSION = "calendar-response-68-v1";
export type DelayRoute = { days: number; weight: number };
export type Kernel = readonly (number | null)[];
export type CalendarMonth = { month: string; startDay: number; endDay: number };
const finite = (n: number) => Number.isFinite(n);
const nonnegative = (n: number) => finite(n) && n >= 0;
const positiveSquare = (n: number) => Math.max(0, n) ** 2;

/** Area in the target × arrival rectangle for target - arrival >= delay. */
function tailArea(
  t0: number,
  t1: number,
  a0: number,
  a1: number,
  delay: number,
) {
  return (
    (positiveSquare(t1 - a0 - delay) -
      positiveSquare(t1 - a1 - delay) -
      positiveSquare(t0 - a0 - delay) +
      positiveSquare(t0 - a1 - delay)) /
    2
  );
}
export function integrateResponse(
  kernel: Kernel,
  t0: number,
  t1: number,
  a0: number,
  a1: number,
  delay: number,
): number | null {
  if (![t0, t1, a0, a1, delay].every(finite) || t1 < t0 || a1 < a0 || delay < 0)
    return null;
  let total = 0;
  const maxAge = Math.max(0, Math.ceil(t1 - a0 - delay));
  for (let age = 0; age < maxAge; age++) {
    const area = Math.max(
      0,
      tailArea(t0, t1, a0, a1, age + delay) -
        tailArea(t0, t1, a0, a1, age + 1 + delay),
    );
    if (!finite(area)) return null;
    if (area < 1e-10) continue;
    const value = kernel[age];
    if (value == null || !nonnegative(value)) return null;
    total += area * value;
    if (!finite(total)) return null;
  }
  return total;
}
export function forecastCalendar(
  cutoff: string,
  count: number,
): CalendarMonth[] {
  const date = new Date(cutoff + "T00:00:00Z");
  if (
    !finite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== cutoff ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 120
  )
    return [];
  const origin = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return Array.from({ length: count }, (_, i) => {
    const start = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1 + i,
      1,
    );
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2 + i, 1);
    return {
      month: new Date(start).toISOString().slice(0, 7),
      startDay: (start - origin) / 86400000,
      endDay: (end - origin) / 86400000,
    };
  });
}
export type ResponseInput = {
  months: readonly CalendarMonth[];
  kernel: Kernel;
  routes: readonly DelayRoute[];
  startsPerLead: number;
  historicalLeadsPerDay: number;
};
export type Response = {
  matrix: number[][];
  cumulative: number[];
  pipeline: number[];
  pendingStarts: number;
};
export function calendarResponse(input: ResponseInput): Response | null {
  const {
    months,
    kernel,
    routes,
    startsPerLead: p,
    historicalLeadsPerDay: r,
  } = input;
  if (
    !months.length ||
    !nonnegative(p) ||
    !nonnegative(r) ||
    !routes.length ||
    routes.some((d) => !nonnegative(d.days) || !nonnegative(d.weight)) ||
    Math.abs(routes.reduce((s, d) => s + d.weight, 0) - 1) > 1e-8 ||
    months.some(
      (m, i) =>
        !finite(m.startDay) ||
        !finite(m.endDay) ||
        m.endDay <= m.startDay ||
        m.startDay < 0 ||
        (i > 0 && m.startDay !== months[i - 1]!.endDay),
    )
  )
    return null;
  const matrix: number[][] = [],
    pipeline: number[] = [];
  for (const target of months) {
    const row: number[] = [];
    for (const arrival of months) {
      let sum = 0;
      if (p > 0)
        for (const route of routes) {
          if (route.weight === 0) continue;
          const area = integrateResponse(
            kernel,
            target.startDay,
            target.endDay,
            arrival.startDay,
            arrival.endDay,
            route.days,
          );
          if (area === null) return null;
          sum +=
            (p * route.weight * area) / (arrival.endDay - arrival.startDay);
        }
      if (!finite(sum)) return null;
      row.push(sum);
    }
    matrix.push(row);
    let pending = 0;
    if (r * p > 0)
      for (const route of routes) {
        if (route.days === 0 || route.weight === 0) continue;
        const area = integrateResponse(
          kernel,
          target.startDay,
          target.endDay,
          0,
          route.days,
          0,
        );
        if (area === null) return null;
        pending += r * p * route.weight * area;
      }
    if (!finite(pending)) return null;
    pipeline.push(pending);
  }
  if (matrix.some((row) => !finite(row.reduce((s, v) => s + v, 0))))
    return null;
  if (!finite(r * p * routes.reduce((s, d) => s + d.days * d.weight, 0)))
    return null;
  return {
    matrix,
    cumulative: matrix.map((row) => row.reduce((s, n) => s + n, 0)),
    pipeline,
    pendingStarts: r * p * routes.reduce((s, d) => s + d.days * d.weight, 0),
  };
}
export type ProjectionInput = {
  months: readonly CalendarMonth[];
  response: Response;
  baseline: readonly number[];
  capacity: readonly number[];
  reserve: readonly number[];
  leads: readonly number[];
  occupancy: number;
  goalMonths: number;
  workingWeeksPerMonth: number;
};
export type Projection = {
  workload: number[];
  goalPace: number | null;
  physicalLeadCeiling: number | null;
  feasibleGoalPace: number | null;
  roundedGoalPace: number | null;
  roundedPhysicalCeiling: number | null;
  goalStatus: "met" | "reachable" | "unattainable" | "capacity-limited";
  baselineOverload: boolean;
  limitingMonth: string | null;
  physicalCrossing: string | null;
  occupancyCrossing: string | null;
  extraWeeklyCapacity: number | null;
  goalWorkload: number[] | null;
  roundedGoalFits: boolean | null;
  alternativeGoalMonths: number | null;
};
export function projectGrowth(input: ProjectionInput): Projection | null {
  const {
    months,
    response,
    baseline,
    capacity,
    reserve,
    leads,
    occupancy,
    goalMonths,
    workingWeeksPerMonth,
  } = input;
  const n = months.length;
  if (
    !n ||
    !Number.isInteger(goalMonths) ||
    goalMonths < 1 ||
    goalMonths > n ||
    !nonnegative(occupancy) ||
    occupancy > 1 ||
    !finite(workingWeeksPerMonth) ||
    workingWeeksPerMonth <= 0 ||
    [
      baseline,
      capacity,
      reserve,
      leads,
      response.pipeline,
      response.cumulative,
    ].some((a) => a.length !== n || a.some((v) => !nonnegative(v))) ||
    response.matrix.length !== n ||
    response.matrix.some(
      (row) => row.length !== n || row.some((v) => !nonnegative(v)),
    ) ||
    response.matrix.some(
      (row, i) =>
        Math.abs(row.reduce((s, v) => s + v, 0) - response.cumulative[i]!) >
        1e-8,
    )
  )
    return null;
  const base = baseline.map((b, i) => b + response.pipeline[i]!);
  const usable = capacity.map((c, i) => c - reserve[i]!);
  const run = (series: readonly number[]) =>
    base.map(
      (b, i) =>
        b + response.matrix[i]!.reduce((s, r, a) => s + r * series[a]!, 0),
    );
  const workload = run(leads);
  if ([...base, ...usable, ...workload].some((v) => !finite(v))) return null;
  const baselineOverload = base.some((b, i) => b > usable[i]! + 1e-9);
  let physicalLeadCeiling: number | null = null,
    limitingMonth: string | null = null;
  if (!baselineOverload)
    response.cumulative.forEach((q, i) => {
      if (q <= 0) return;
      const ceiling = Math.max(0, (usable[i]! - base[i]!) / q);
      if (physicalLeadCeiling === null || ceiling < physicalLeadCeiling) {
        physicalLeadCeiling = ceiling;
        limitingMonth = months[i]!.month;
      }
    });
  const h = goalMonths - 1,
    unmet = Math.max(0, occupancy * capacity[h]! - base[h]!);
  const goalPace =
    unmet === 0
      ? 0
      : response.cumulative[h]! > 0
        ? unmet / response.cumulative[h]!
        : null;
  if (goalPace !== null && !finite(goalPace)) return null;
  const goalWorkload = goalPace === null ? null : run(Array(n).fill(goalPace));
  if (goalWorkload?.some((v) => !finite(v))) return null;
  const goalFits =
    goalWorkload !== null &&
    !goalWorkload.some((w, i) => w > usable[i]! + 1e-9);
  const roundedGoalPace = goalPace === null ? null : Math.ceil(goalPace);
  const roundedGoalFits =
    roundedGoalPace === null
      ? null
      : run(Array(n).fill(roundedGoalPace)).every(
          (w, i) => w <= usable[i]! + 1e-9,
        );
  if (physicalLeadCeiling !== null && !finite(physicalLeadCeiling)) return null;
  let alternativeGoalMonths: number | null = null;
  if (!goalFits && !baselineOverload)
    for (let i = h + 1; i < n; i++) {
      const gap = Math.max(0, occupancy * capacity[i]! - base[i]!);
      const pace =
        gap === 0
          ? 0
          : response.cumulative[i]! > 0
            ? gap / response.cumulative[i]!
            : null;
      if (
        pace !== null &&
        finite(pace) &&
        run(Array(n).fill(pace)).every(
          (w, j) => finite(w) && w <= usable[j]! + 1e-9,
        )
      ) {
        alternativeGoalMonths = i + 1;
        break;
      }
    }
  return {
    workload,
    goalPace,
    physicalLeadCeiling,
    alternativeGoalMonths,
    feasibleGoalPace:
      baselineOverload || goalPace === null
        ? null
        : physicalLeadCeiling === null
          ? goalPace
          : Math.min(goalPace, physicalLeadCeiling),
    roundedGoalPace,
    roundedPhysicalCeiling:
      physicalLeadCeiling === null ? null : Math.floor(physicalLeadCeiling),
    goalStatus:
      goalPace === null
        ? "unattainable"
        : !goalFits
          ? "capacity-limited"
          : goalPace === 0
            ? "met"
            : "reachable",
    baselineOverload,
    limitingMonth,
    physicalCrossing:
      months.find((_, i) => workload[i]! > usable[i]! + 1e-9)?.month ?? null,
    occupancyCrossing:
      months.find((_, i) => workload[i]! >= occupancy * capacity[i]! - 1e-9)
        ?.month ?? null,
    extraWeeklyCapacity:
      goalWorkload === null
        ? null
        : Math.max(
            0,
            ...goalWorkload.map((w, i) => w + reserve[i]! - capacity[i]!),
          ) / workingWeeksPerMonth,
    goalWorkload,
    roundedGoalFits,
  };
}
