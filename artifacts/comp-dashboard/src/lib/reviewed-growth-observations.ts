import type { Workspace } from "@workspace/practice/hub";
import { acquisitionFunnel } from "./acquisition-funnel.ts";
import {
  calendarResponse,
  forecastCalendar,
  projectGrowth,
  REVIEWED_GROWTH_VERSION,
  type Kernel,
} from "./reviewed-growth-engine.ts";
export type GrowthVisit = {
  clientId: string;
  clinicianId: number;
  date: string;
};
export type GrowthCoverage = {
  clinicianId: number;
  start: string;
  end: string;
};
export type GrowthSettings = {
  occupancy: number;
  goalMonths: number;
  checkMonths: number;
  leadConsultDays: number;
  otherRouteDays: number;
  reserve: number;
  recruitmentMonths: number | null;
  onboardingMonths: number | null;
  rampMonths: number | null;
  monthlyLeads?: Record<string, number>;
  staffing?: {
    id: string;
    startMonth: string;
    weeklyCapacity: number;
    rampMonths: number;
  }[];
};
export const DEFAULT_GROWTH_SETTINGS: GrowthSettings = {
  occupancy: 0.8,
  goalMonths: 4,
  checkMonths: 6,
  leadConsultDays: 5,
  otherRouteDays: 5,
  reserve: 0,
  recruitmentMonths: null,
  onboardingMonths: null,
  rampMonths: null,
};
const DAY = 86400000;
const stamp = (d: string) => Date.parse(d + "T00:00:00Z") / DAY;
const iso = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);
const monthStart = (month: string) => month + "-01";
const monthEnd = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
function monthBefore(date: string, offset: number) {
  const d = new Date(date + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - offset, 1))
    .toISOString()
    .slice(0, 7);
}
function covered(
  start: string,
  end: string,
  ids: readonly number[],
  coverage: readonly GrowthCoverage[],
) {
  return (
    ids.length > 0 &&
    ids.every((id) => {
      let next = stamp(start);
      for (const r of coverage
        .filter((r) => r.clinicianId === id && r.start <= end && r.end >= start)
        .sort((a, b) => a.start.localeCompare(b.start))) {
        if (stamp(r.start) > next) return false;
        next = Math.max(next, stamp(r.end) + 1);
      }
      return next > stamp(end);
    })
  );
}
export type GrowthObservationInput = {
  today: string;
  visits: readonly GrowthVisit[];
  consults: readonly GrowthVisit[];
  coverage: readonly GrowthCoverage[];
  clinicianIds: readonly number[];
  workspace: Pick<Workspace, "periods" | "funnels">;
  weeklyCapacity: number | null;
  weeksPerYear: number;
  settings: GrowthSettings;
  scenario: boolean;
  excludedTreatmentEvidence?: readonly GrowthVisit[];
};
/** Input visits have already passed canonical admission and same-day exception
 * handling. Counts and all follow-up are cut off together before indexing. */
export function reviewedGrowth(input: GrowthObservationInput) {
  const { settings } = input,
    ids = new Set(input.clinicianIds);
  const candidates = Array.from({ length: 24 }, (_, i) =>
    monthBefore(input.today, i + 1),
  );
  const cutoffMonth = candidates.find((m) =>
    covered(monthStart(m), monthEnd(m), input.clinicianIds, input.coverage),
  );
  const empty = {
    version: REVIEWED_GROWTH_VERSION,
    cutoff: null as string | null,
    stock: null as { established: number; early: number } | null,
    families: [] as GrowthFamily[],
    reason: "Complete attendance coverage for the current roster is needed.",
  };
  if (!cutoffMonth) return empty;
  const cutoff = monthEnd(cutoffMonth),
    cut = stamp(cutoff);
  if (!covered(iso(cut - 89), cutoff, input.clinicianIds, input.coverage))
    return {
      ...empty,
      cutoff,
      reason:
        "Continuous 90-day attendance coverage is needed for current active stock.",
    };
  const visits = input.visits
    .filter((v) => v.date <= cutoff)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const clients = new Map<string, GrowthVisit[]>();
  for (const v of visits) {
    const rows = clients.get(v.clientId) ?? [];
    rows.push(v);
    clients.set(v.clientId, rows);
  }
  const histories = [...clients].map(([clientId, rows]) => {
    const dates = [...new Set(rows.map((v) => v.date))];
    return {
      clientId,
      rows,
      dates,
      first: dates[0]!,
      qualified: dates[2] ?? null,
    };
  });
  const ownerAt = (rows: GrowthVisit[], day: string) => {
    const latest = rows.filter((v) => v.date <= day).at(-1);
    if (!latest || stamp(latest.date) + 90 <= stamp(day)) return null;
    const owners = new Set(
      rows.filter((v) => v.date === latest.date).map((v) => v.clinicianId),
    );
    return [...owners].some((id) => ids.has(id)) ? true : null;
  };
  const uncertain = (input.excludedTreatmentEvidence ?? []).some(
    (v) =>
      v.date <= cutoff &&
      (stamp(v.date) > cut - 90 ||
        histories.some(
          (h) => h.clientId === v.clientId && ownerAt(h.rows, cutoff) !== null,
        )),
  );
  if (uncertain)
    return {
      ...empty,
      cutoff,
      reason:
        "Unresolved treatment evidence could change current client status. Review import details.",
    };
  const current = histories.filter((h) => {
    const owner = ownerAt(h.rows, cutoff);
    return owner !== null;
  });
  const early = new Set(
    current.filter((h) => h.qualified === null).map((h) => h.clientId),
  );
  const stock = { established: current.length - early.size, early: early.size };
  const months = forecastCalendar(cutoff, settings.checkMonths);
  const availableLeadMonths = Array.from({ length: 12 }, (_, i) =>
    monthBefore(cutoff, i),
  )
    .reverse()
    .flatMap((m) => {
      const period = input.workspace.periods.filter(
        (p) =>
          !p.archived && p.start === monthStart(m) && p.end === monthEnd(m),
      );
      if (
        period.length !== 1 ||
        !covered(monthStart(m), monthEnd(m), input.clinicianIds, input.coverage)
      )
        return [];
      // Preserve overlap/duplicate validation while permitting explicitly provisional totals.
      const result = acquisitionFunnel(
        {
          ...input.workspace,
          periods: input.workspace.periods.map((p) => ({
            ...p,
            funnelComplete: true,
          })),
        },
        [m],
      );
      return result.leads === null
        ? []
        : [
            {
              month: m,
              leads: result.leads,
              complete: !!period[0]!.funnelComplete,
            },
          ];
    });
  const families: GrowthFamily[] = [];
  for (const length of [3, 12]) {
    const historyMonths = Array.from({ length }, (_, i) =>
      monthBefore(cutoff, i),
    ).reverse();
    const supported = historyMonths.filter((m) =>
      covered(
        iso(stamp(monthStart(m)) - 89),
        monthEnd(m),
        input.clinicianIds,
        input.coverage,
      ),
    );
    const leadMonths = availableLeadMonths.filter(
      (m) => length === 12 || historyMonths.includes(m.month),
    );
    let establishedVisits = 0,
      establishedDays = 0,
      earlyVisits = 0,
      earlyDays = 0;
    for (const h of histories)
      for (const m of supported) {
        for (let d = stamp(monthStart(m)); d <= stamp(monthEnd(m)); d++) {
          const date = iso(d),
            owner = ownerAt(h.rows, date);
          if (owner === null) continue;
          const count = h.rows.filter(
            (v) => v.date === date && ids.has(v.clinicianId),
          ).length;
          if (h.qualified !== null && h.qualified <= date) {
            establishedDays++;
            establishedVisits += count;
          } else if (early.has(h.clientId)) {
            earlyDays++;
            earlyVisits += count;
          }
        }
      }
    const firstInScope = histories.filter((h) =>
      h.rows.some((v) => v.date === h.first && ids.has(v.clinicianId)),
    );
    const cohort = firstInScope.filter((h) =>
      leadMonths.some((m) => h.first.slice(0, 7) === m.month),
    );
    const kernelFor = (selected: typeof cohort): Kernel =>
      Array.from(
        { length: Math.max(210, Math.ceil(months.at(-1)?.endDay ?? 0)) },
        (_, age) => {
          const intervalStart = Math.floor(age / 30) * 30;
          const eligible = selected.filter(
            (h) =>
              stamp(h.first) + intervalStart + 29 <= cut &&
              covered(
                iso(stamp(h.first) + intervalStart),
                iso(stamp(h.first) + intervalStart + 29),
                input.clinicianIds,
                input.coverage,
              ),
          );
          if (!eligible.length) return null;
          return (
            eligible.reduce(
              (sum, h) =>
                sum +
                h.rows.filter(
                  (v) =>
                    stamp(v.date) - stamp(h.first) === age &&
                    ids.has(v.clinicianId),
                ).length,
              0,
            ) / eligible.length
          );
        },
      );
    const nativeKernel = kernelFor(cohort);
    const longerCohort = firstInScope.filter((h) =>
      availableLeadMonths.some((m) => h.first.slice(0, 7) === m.month),
    );
    const longerKernel = kernelFor(longerCohort);
    const fallbackAges: number[] = [];
    const kernel =
      length === 3
        ? nativeKernel.map((value, age) => {
            if (value === null && longerKernel[age] != null) {
              fallbackAges.push(age);
              return longerKernel[age]!;
            }
            return value;
          })
        : nativeKernel;
    const routes = new Map<number, number>();
    let priorConsults = 0;
    for (const h of cohort) {
      const consult = input.consults
        .filter(
          (c) =>
            c.clientId === h.clientId && c.date < h.first && c.date <= cutoff,
        )
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      const delay = consult
        ? stamp(h.first) - stamp(consult.date) + settings.leadConsultDays
        : settings.otherRouteDays;
      if (consult) priorConsults++;
      routes.set(delay, (routes.get(delay) ?? 0) + 1);
    }
    const leads = leadMonths.reduce((s, m) => s + m.leads, 0),
      leadDays = leadMonths.reduce(
        (s, m) => s + stamp(monthEnd(m.month)) - stamp(monthStart(m.month)) + 1,
        0,
      );
    const estFrequency =
      stock.established === 0
        ? 0
        : establishedDays > 0
          ? establishedVisits / establishedDays
          : null;
    const earlyFrequency =
      stock.early === 0 ? 0 : earlyDays > 0 ? earlyVisits / earlyDays : null;
    const baseline =
      estFrequency === null || earlyFrequency === null
        ? null
        : months.map(
            (m) =>
              (m.endDay - m.startDay) *
              (stock.established * estFrequency + stock.early * earlyFrequency),
          );
    const response =
      leads > 0
        ? calendarResponse({
            months,
            kernel,
            routes: cohort.length
              ? [...routes].map(([days, n]) => ({
                  days,
                  weight: n / cohort.length,
                }))
              : [{ days: 0, weight: 1 }],
            startsPerLead: cohort.length / leads,
            historicalLeadsPerDay: leads / leadDays,
          })
        : null;
    const weekly = input.weeklyCapacity;
    const capacity =
      weekly !== null && Number.isFinite(weekly) && weekly >= 0
        ? months.map((m) => {
            const overlays = input.scenario ? (settings.staffing ?? []) : [];
            const additions = overlays.reduce((s, person) => {
              const elapsed =
                (Number(m.month.slice(0, 4)) -
                  Number(person.startMonth.slice(0, 4))) *
                  12 +
                Number(m.month.slice(5)) -
                Number(person.startMonth.slice(5));
              return (
                s +
                (elapsed < 0
                  ? 0
                  : person.weeklyCapacity *
                    (person.rampMonths <= 0
                      ? 1
                      : Math.min(1, (elapsed + 1) / person.rampMonths)))
              );
            }, 0);
            return ((weekly + additions) * input.weeksPerYear) / 12;
          })
        : null;
    const standardLeadPace = leadMonths.length
      ? leads / leadMonths.length
      : null;
    const leadSeries =
      standardLeadPace === null
        ? null
        : months.map((m) =>
            input.scenario
              ? (settings.monthlyLeads?.[m.month] ?? standardLeadPace)
              : standardLeadPace,
          );
    const uncertainHistory = (input.excludedTreatmentEvidence ?? []).some(
      (v) =>
        v.date <= cutoff &&
        v.date >= iso(stamp(monthStart(historyMonths[0]!)) - 89),
    );
    const projection =
      !uncertainHistory && response && baseline && capacity && leadSeries
        ? projectGrowth({
            months,
            response,
            baseline,
            capacity,
            reserve: months.map(() => settings.reserve),
            leads: leadSeries,
            occupancy: settings.occupancy,
            goalMonths: settings.goalMonths,
            workingWeeksPerMonth: input.weeksPerYear / 12,
          })
        : null;
    const reason = projection
      ? null
      : uncertainHistory
        ? "Unresolved historical treatment evidence affects this estimate."
        : !supported.length
          ? "No covered attendance months."
          : !leads
            ? "Positive entered lead totals needed."
            : !cohort.length
              ? "No observed starters in the lead months."
              : !response
                ? "Complete age-response follow-up needed for this horizon."
                : !baseline
                  ? "Current-client exposure is unavailable."
                  : !capacity
                    ? "Configured weekly capacity is unavailable."
                    : "Check the planning inputs.";
    families.push({
      historyMonths: length,
      coveredMonths: supported.length,
      leadMonths: leadMonths.map((m) => m.month),
      provisional: leadMonths.some((m) => !m.complete),
      latestCompleteLeadMonth:
        leadMonths.filter((m) => m.complete).at(-1)?.month ?? null,
      leads,
      starts: cohort.length,
      priorConsults,
      standardLeadPace,
      establishedVisits,
      establishedDays,
      earlyVisits,
      earlyDays,
      fallbackAges,
      months,
      baseline,
      response,
      projection,
      capacity,
      leadSeries,
      reason,
    });
  }
  return {
    version: REVIEWED_GROWTH_VERSION,
    cutoff,
    stock,
    families,
    reason: null,
  };
}
export type GrowthFamily = {
  historyMonths: number;
  coveredMonths: number;
  leadMonths: string[];
  provisional: boolean;
  latestCompleteLeadMonth: string | null;
  leads: number;
  starts: number;
  priorConsults: number;
  standardLeadPace: number | null;
  establishedVisits: number;
  establishedDays: number;
  earlyVisits: number;
  earlyDays: number;
  fallbackAges: number[];
  months: ReturnType<typeof forecastCalendar>;
  baseline: number[] | null;
  response: ReturnType<typeof calendarResponse>;
  projection: ReturnType<typeof projectGrowth>;
  capacity: number[] | null;
  leadSeries: number[] | null;
  reason: string | null;
};
export type ReviewedGrowth = ReturnType<typeof reviewedGrowth>;
