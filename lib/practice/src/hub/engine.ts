import {
  calculateClinicianMetrics,
  calculateStaffMemberCost,
  type ClinicianMetricsInput,
  type StaffCostInput,
} from "../compensation.ts";
import {
  daysInclusive,
  summarizeSessions,
  type SessionRecord,
} from "../index.ts";
import type {
  Campaign,
  PlanEvent,
  Workspace,
  Condition,
  Rule,
} from "./model.ts";
import { conditionResult } from "./conditions.ts";

export type Clinician = ClinicianMetricsInput & {
  id: number;
  label: string;
  goalId?: number | null;
};
export type Staff = StaffCostInput & { goalId?: number | null };
export type Context = {
  clinicians: Clinician[];
  staff: Staff[];
  sessions: SessionRecord[];
};
export type Values = Record<string, number | null>;
export type ForecastMonth = {
  date: string;
  periodStart?: string;
  values: Values;
  clinicians: Record<string, Values>;
  channels: Record<string, FunnelEstimate>;
  budgetLines?: Record<string, number>;
  budgetValues?: Values;
  forecastValues?: Values;
  trace: Record<string, string>;
  warnings: string[];
  constraint: string;
};
import { metrics, metricMap } from "./metrics.ts";
export { metrics, metricMap } from "./metrics.ts";
export const registeredMetrics = (
  workspace: Workspace,
): readonly (readonly [
  string,
  string,
  "number" | "currency" | "percent",
  string,
])[] => [
  ...metrics,
  ...workspace.kpis
    .filter((k) => !k.archived)
    .map((k) => [k.key, k.name, k.unit, "Custom"] as const),
];
export const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export const monthDate = (date: string, offset = 0) => {
  const d = new Date(date.slice(0, 7) + "-01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
};
export const monthEnd = (date: string) =>
  new Date(Date.parse(monthDate(date, 1) + "T12:00:00Z") - 86400000)
    .toISOString()
    .slice(0, 10);
const monthIndex = (date: string, start: string) =>
  (Number(date.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
  Number(date.slice(5, 7)) -
  Number(start.slice(5, 7));
const active = (
  record: { start: string; end: string | null; archived?: boolean },
  start: string,
  end: string,
) =>
  !record.archived &&
  record.start <= end &&
  (!record.end || record.end >= start);
const activeDays = (
  record: { start: string; end: string | null },
  start: string,
  end: string,
) =>
  Math.max(
    0,
    daysInclusive(
      record.start > start ? record.start : start,
      record.end && record.end < end ? record.end : end,
    ),
  );

const datesIn = (start: string, end: string) =>
  Array.from({ length: Math.max(0, daysInclusive(start, end)) }, (_, i) =>
    new Date(Date.parse(start + "T12:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10),
  );
export function datedValue(
  base: number,
  changes: { date: string; end?: string | null; value: number }[],
  start: string,
  end: string,
) {
  const sorted = changes
    .map((change, index) => ({ ...change, index }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index);
  const days = datesIn(start, end);
  return days.length
    ? days.reduce(
        (sum, date) =>
          sum +
          (sorted.find((e) => e.date <= date && (!e.end || e.end >= date))
            ?.value ?? base),
        0,
      ) / days.length
    : base;
}

export type FunnelEstimate = {
  leads: number | null;
  consultations: number | null;
  clients: number;
  spend: number;
  warnings: string[];
  inferredLeads: boolean;
};
export function estimateCampaign(
  c: Campaign,
  workspace: Workspace,
  custom: Values = {},
  date = workspace.settings.forecastStart,
): FunnelEstimate {
  const conversion =
    ((((c.consultationPct / 100) * c.attendancePct) / 100) * c.closePct) / 100;
  let leads: number | null = null,
    clients = 0;
  const warnings: string[] = [];
  if (c.method === "cpl") {
    leads = ratio(c.monthlySpend, c.cpl);
    clients = (leads ?? 0) * conversion;
    if (leads === null)
      warnings.push(`${c.name}: cost per lead must be positive.`);
  }
  if (c.method === "cac") {
    clients = ratio(c.monthlySpend, c.cac) ?? 0;
    leads = conversion > 0 ? clients / conversion : null;
    if (!c.cac) warnings.push(`${c.name}: CAC must be positive.`);
  }
  if (c.method === "clicks") {
    leads =
      c.cpm > 0
        ? ((((c.monthlySpend / c.cpm) * 1000 * c.ctrPct) / 100) *
            c.clickToLeadPct) /
          100
        : null;
    clients = (leads ?? 0) * conversion;
    if (!c.cpm) warnings.push(`${c.name}: CPM must be positive.`);
  }
  if (c.method === "manual") {
    leads = c.manualLeads;
    clients = c.manualClients;
  }
  if (c.method === "custom") {
    const kpi = workspace.kpis.find((k) => k.id === c.customKpiId);
    const values = calculateCustomKpis(
      workspace,
      {
        ...custom,
        spend: c.monthlySpend,
        cpl: c.cpl,
        cac: c.cac,
        closePct: c.closePct,
      },
      date,
    );
    const value = kpi ? values[kpi.key] : null;
    clients = value == null ? 0 : Math.max(0, value);
    if (value == null)
      warnings.push(`${c.name}: custom client formula is unavailable.`);
  }
  if (c.method === "historical") {
    const periods = workspace.periods.filter(
      (p) =>
        p.status === "finalized" &&
        !p.archived &&
        (!c.historicalStart || p.start >= c.historicalStart) &&
        (!c.historicalEnd || p.end <= c.historicalEnd),
    );
    const records = workspace.funnels.filter(
      (f) => f.campaignId === c.id && periods.some((p) => p.id === f.periodId),
    );
    const spend = records.reduce((n, r) => n + (r.spend ?? 0), 0);
    if (
      !records.length ||
      spend <= 0 ||
      records.some((r) => r.spend === null || r.clients === null)
    )
      warnings.push(
        `${c.name}: historical yield needs finalized spend and client totals.`,
      );
    else {
      clients =
        (c.monthlySpend * records.reduce((n, r) => n + (r.clients ?? 0), 0)) /
        spend;
      leads = records.some((r) => r.leads === null)
        ? null
        : (c.monthlySpend * records.reduce((n, r) => n + (r.leads ?? 0), 0)) /
          spend;
    }
  }
  return {
    leads,
    consultations: leads === null ? null : (leads * c.consultationPct) / 100,
    clients: clients * (1 - c.overlapPct / 100),
    spend: c.monthlySpend + c.otherMonthlyCost,
    warnings,
    inferredLeads: c.method === "cac" && leads !== null,
  };
}

export function calculateCustomKpis(
  workspace: Pick<Workspace, "kpis">,
  base: Values,
  date?: string,
): Values {
  const values = { ...base };
  const visiting = new Set<string>();
  const evaluate = (key: string): number | null => {
    if (Object.hasOwn(values, key)) return values[key];
    const k = workspace.kpis.find((x) => x.key === key && !x.archived);
    if (!k || visiting.has(key)) return null;
    visiting.add(key);
    const definition = date
      ? ([...(k.versions ?? [])]
          .filter((v) => v.effectiveDate <= date)
          .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ??
        k)
      : k;
    const a = evaluate(definition.left),
      b = definition.constant ?? evaluate(definition.right);
    let result: number | null = null;
    if (a !== null && b !== null) {
      switch (definition.operation) {
        case "add":
          result = a + b;
          break;
        case "subtract":
          result = a - b;
          break;
        case "multiply":
          result = a * b;
          break;
        case "divide":
          result = b === 0 ? null : (a / b) * (k.unit === "percent" ? 100 : 1);
          break;
        case "min":
          result = Math.min(a, b);
          break;
        case "max":
          result = Math.max(a, b);
          break;
      }
    }
    visiting.delete(key);
    values[key] = result !== null && Number.isFinite(result) ? result : null;
    return values[key];
  };
  workspace.kpis.forEach((k) => evaluate(k.key));
  return values;
}

export function eventIssues(events: PlanEvent[]): string[] {
  const issues: string[] = [];
  const enabled = events.filter((e) => e.enabled);
  for (const e of enabled) {
    for (const dependency of e.dependsOn) {
      const parent = enabled.find((x) => x.id === dependency);
      if (!parent) issues.push(`${e.name}: dependency is missing or disabled.`);
      else if (parent.date > e.date)
        issues.push(`${e.name}: dependency starts later.`);
    }
    if (
      enabled.some(
        (x) =>
          x.id !== e.id &&
          x.field === e.field &&
          x.targetId === e.targetId &&
          x.date === e.date &&
          !["clinician.hire", "room.add", "custom"].includes(e.field),
      )
    )
      issues.push(
        `${e.name}: conflicting change for the same target and date.`,
      );
    const walk = (id: string, seen: Set<string>): boolean => {
      if (seen.has(id)) return true;
      const next = new Set(seen).add(id);
      return (enabled.find((x) => x.id === id)?.dependsOn ?? []).some((d) =>
        walk(d, next),
      );
    };
    if (walk(e.id, new Set())) issues.push(`${e.name}: circular dependency.`);
  }
  return [...new Set(issues)];
}

export function budgetAmount(
  b: Workspace["budgets"][number],
  start: string,
  end: string,
  sessions = 0,
  revenue = 0,
): number {
  if (!active(b, start, end)) return 0;
  const days = activeDays(b, start, end),
    fraction = days / daysInclusive(start, end);
  switch (b.cadence) {
    case "monthly":
      return (
        (b.amount * days) / daysInclusive(monthDate(start), monthEnd(start))
      );
    case "weekly":
      return (b.amount * days) / 7;
    case "biweekly":
      return (b.amount * days) / 14;
    case "annual":
      return (
        (b.amount * days) /
        daysInclusive(
          start.slice(0, 4) + "-01-01",
          start.slice(0, 4) + "-12-31",
        )
      );
    case "once":
      return b.start >= start && b.start <= end ? b.amount : 0;
    case "per_session":
      return b.amount * sessions * fraction;
    case "percent_revenue":
      return (b.amount / 100) * revenue * fraction;
  }
}

export function budgetForRange(
  b: Workspace["budgets"][number],
  start: string,
  end: string,
  sessions = 0,
  revenue = 0,
): number {
  let total = 0;
  for (let date = monthDate(start); date <= end; date = monthDate(date, 1)) {
    const first = date > start ? date : start,
      last = monthEnd(date) < end ? monthEnd(date) : end;
    const fraction = daysInclusive(first, last) / daysInclusive(start, end);
    total += budgetAmount(
      b,
      first,
      last,
      sessions * fraction,
      revenue * fraction,
    );
  }
  return total;
}

export function forecast(
  workspace: Workspace,
  context: Context,
  proposed: PlanEvent[] = [],
  demandMultiplier = 1,
  compareMarketing = true,
): ForecastMonth[] {
  const settings = workspace.settings;
  const issues = eventIssues([...workspace.events, ...proposed]);
  const events = issues.length
    ? workspace.events.filter((e) => e.enabled)
    : [...workspace.events, ...proposed].filter((e) => e.enabled);
  const selected = context.clinicians.filter((c) =>
    settings.teamId === null ? c.goalId == null : c.goalId === settings.teamId,
  );
  const staff = context.staff.filter((c) =>
    settings.teamId === null ? c.goalId == null : c.goalId === settings.teamId,
  );
  const history = selected.map((c) =>
    summarizeSessions(
      context.sessions.filter((s) => s.clinicianId === c.id),
      { start: settings.historicalStart, end: settings.historicalEnd },
    ),
  );
  const historicalWeekly = history.some(
    (h) => h.averagePerRecordedWeek !== null,
  )
    ? history.reduce((n, h) => n + (h.averagePerRecordedWeek ?? 0), 0)
    : null;
  const baseWeekly =
    settings.baselineMode === "manual"
      ? settings.baselineWeeklySessions
      : historicalWeekly;
  const results: ForecastMonth[] = [];
  let cash = settings.openingCash;
  let baselineRetained = 1;
  const capEarned: Record<string, number> = {};
  const cohorts: {
    start: number;
    clients: number;
    sessions: number;
    retention: number;
  }[] = [];
  const futureClients: Record<number, typeof cohorts> = {};
  for (let m = 0; m < settings.horizonMonths; m++) {
    const start = monthDate(settings.forecastStart, m),
      end = monthEnd(start),
      days = daysInclusive(start, end),
      weeks = days / 7;
    const warnings = [...issues];
    if (baseWeekly === null)
      warnings.push(
        "Baseline sessions are missing; only new acquisition is modeled.",
      );
    if (
      settings.baselineMode === "historical" &&
      history.some((h) => h.averagePerRecordedWeek === null)
    )
      warnings.push(
        "Historical session coverage is incomplete for the selected team.",
      );
    if (start.endsWith("-01-01") || m === 0)
      for (const key of Object.keys(capEarned)) delete capEarned[key];
    if (m === 0 && !start.endsWith("-01-01"))
      for (const c of selected) {
        const op = workspace.clinicians.find((o) => o.clinicianId === c.id);
        capEarned[String(c.id)] = op?.openingCapContribution ?? 0;
        if (
          c.capEnabled &&
          c.capAmount > 0 &&
          op?.openingCapContribution == null
        )
          warnings.push(
            `${c.label}: opening annual cap contribution is unknown; forecast assumes zero. Set it in the operating roster.`,
          );
      }
    const effective = events
      .filter((e) => e.date <= end && (!e.end || e.end >= start))
      .sort((a, b) => a.date.localeCompare(b.date));
    const setting = { ...settings };
    if (settings.attendanceMode === "historical") {
      const summary = summarizeSessions(
        context.sessions.filter((s) =>
          selected.some((c) => c.id === s.clinicianId),
        ),
        { start: settings.historicalStart, end: settings.historicalEnd },
      );
      if (summary.attendance !== null)
        setting.attendancePct = summary.attendance;
      else
        warnings.push(
          "Historical attendance is unavailable; manual attendance assumption is used until scheduled counts are recorded.",
        );
    }
    const settingFields: Record<string, string> = {
      "assumption.retention": "baselineRetentionPct",
      "assumption.attendance": "attendancePct",
      "assumption.collection": "collectionPct",
      "assumption.organic": "organicClientsPerMonth",
      "assumption.ownerPay": "ownerPayrollMonthly",
    };
    for (const [field, key] of Object.entries(settingFields)) {
      const values = setting as unknown as Record<string, number>;
      values[key] = datedValue(
        values[key],
        effective.filter((e) => e.field === field),
        start,
        end,
      );
    }
    let leads: number | null = 0,
      consultations: number | null = 0,
      attended: number | null = 0,
      acquiredClients = 0,
      newClients = 0,
      marketing = 0,
      adSpend = 0;
    const channels: Record<string, FunnelEstimate> = {};
    for (const original of workspace.campaigns.filter(
      (c) =>
        active(c, start, end) &&
        (!c.planningOnly ||
          effective.some(
            (e) => e.targetId === c.id && e.field === "marketing.spend",
          )),
    )) {
      const c = { ...original };
      const f: FunnelEstimate = {
        leads: 0,
        consultations: 0,
        clients: 0,
        spend: 0,
        warnings: [],
        inferredLeads: false,
      };
      for (const date of datesIn(
        c.start > start ? c.start : start,
        c.end && c.end < end ? c.end : end,
      )) {
        if (
          c.planningOnly &&
          !effective.some(
            (e) =>
              e.targetId === c.id &&
              e.field === "marketing.spend" &&
              e.date <= date &&
              (!e.end || e.end >= date),
          )
        )
          continue;
        const daily = { ...c };
        for (const e of effective.filter(
          (e) =>
            e.targetId === c.id && e.date <= date && (!e.end || e.end >= date),
        )) {
          if (e.field === "marketing.spend") daily.monthlySpend = e.value;
          if (e.field === "marketing.cpl") daily.cpl = e.value;
          if (e.field === "marketing.cac") daily.cac = e.value;
          if (e.field === "marketing.closePct") daily.closePct = e.value;
        }
        const estimate = estimateCampaign(daily, workspace, {}, date);
        acquiredClients += (estimate.clients / days) * demandMultiplier;
        attended =
          attended === null || estimate.consultations === null
            ? null
            : attended +
              ((estimate.consultations * daily.attendancePct) / 100 / days) *
                demandMultiplier;
        adSpend += daily.monthlySpend / days;
        f.clients += (estimate.clients / days) * demandMultiplier;
        f.spend += estimate.spend / days;
        f.leads =
          f.leads === null || estimate.leads === null
            ? null
            : f.leads + (estimate.leads / days) * demandMultiplier;
        f.consultations =
          f.consultations === null || estimate.consultations === null
            ? null
            : f.consultations +
              (estimate.consultations / days) * demandMultiplier;
        f.inferredLeads ||= estimate.inferredLeads;
        f.warnings = [...new Set([...f.warnings, ...estimate.warnings])];
      }
      channels[c.id] = f;
      warnings.push(...f.warnings);
      leads = leads === null || f.leads === null ? null : leads + f.leads;
      consultations =
        consultations === null || f.consultations === null
          ? null
          : consultations + f.consultations;
      marketing += f.spend;
      const when = m + c.conversionDelayMonths;
      (futureClients[when] ??= []).push({
        start: when,
        clients: f.clients,
        sessions: c.sessionsPerClientMonth,
        retention: c.retentionMonths,
      });
    }
    (futureClients[m] ??= []).push({
      start: m,
      clients: setting.organicClientsPerMonth * demandMultiplier,
      sessions: setting.sessionsPerClientMonth,
      retention: setting.retentionMonths,
    });
    for (const cohort of futureClients[m]) {
      cohorts.push(cohort);
      newClients += cohort.clients;
    }
    if (m > 0) baselineRetained *= setting.baselineRetentionPct / 100;
    const baselineDemand = (baseWeekly ?? 0) * weeks * baselineRetained;
    const acquiredDemand = cohorts.reduce(
      (n, c) =>
        n + c.clients * c.sessions * Math.pow(1 - 1 / c.retention, m - c.start),
      0,
    );
    const demand =
      baselineDemand + (acquiredDemand * setting.attendancePct) / 100;
    const roster = selected.map((c) => ({
      ...c,
      instance: String(c.id),
      capKey: String(c.id),
      ramp: 1,
      extraCost: 0,
      op: workspace.clinicians.find((o) => o.clinicianId === c.id),
    }));
    for (const e of effective.filter((e) => e.field === "clinician.hire")) {
      const template = context.clinicians.find(
        (c) => String(c.id) === e.targetId,
      );
      const original = events.find((x) => x.id === e.sourceChangeId) ?? e;
      const elapsed = monthIndex(start, original.date) - original.delayMonths;
      if (!template) {
        warnings.push(`${e.name}: choose a clinician template.`);
        continue;
      }
      if (elapsed < 0) continue;
      roster.push({
        ...template,
        instance: e.id,
        capKey: e.sourceChangeId ?? e.id,
        ramp: Math.min(1, (elapsed + 1) / e.rampMonths),
        extraCost: e.monthlyCost,
        op: {
          id: e.id,
          clinicianId: template.id,
          start: [
            e.date,
            monthDate(original.date, original.delayMonths).slice(0, 8) +
              String(
                Math.min(
                  Number(original.date.slice(8)),
                  Number(
                    monthEnd(
                      monthDate(original.date, original.delayMonths),
                    ).slice(8),
                  ),
                ),
              ).padStart(2, "0"),
          ]
            .sort()
            .at(-1)!,
          end: e.end,
          status: "active",
          desiredWeeklySessions: e.value,
          inPersonPct: setting.defaultInPersonPct,
          locationId: null,
          roomId: null,
          payMode: "existing_split",
          payAmount: 0,
          paidHoursPerWeek: 0,
          openingCapContribution: 0,
        },
      });
    }
    const people = roster
      .filter(
        (c) => !c.op || (c.op.status === "active" && active(c.op, start, end)),
      )
      .map((c) => {
        const firstDay = c.op && c.op.start > start ? c.op.start : start,
          lastDay = c.op?.end && c.op.end < end ? c.op.end : end;
        const terms = workspace.terms
          .filter((t) => t.clinicianId === c.id)
          .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
        const changes = (
          field: PlanEvent["field"],
          key: "sessionRate" | "clinicianSplit" | "capacity" | "payAmount",
        ) => [
          ...terms
            .filter((t) => t[key] !== null)
            .map((t) => ({ date: t.effectiveDate, value: t[key]! })),
          ...effective.filter(
            (e) => e.targetId === String(c.id) && e.field === field,
          ),
        ];
        const rates = changes("clinician.rate", "sessionRate"),
          splits = changes("clinician.split", "clinicianSplit"),
          capacities = changes("clinician.capacity", "capacity"),
          payChanges = changes("clinician.payAmount", "payAmount");
        const daily = datesIn(firstDay, lastDay).map((date) => {
          const mode =
            [...terms]
              .reverse()
              .find((t) => t.effectiveDate <= date && t.payMode !== null)
              ?.payMode ??
            c.op?.payMode ??
            "existing_split";
          return {
            date,
            mode,
            amount: datedValue(c.op?.payAmount ?? 0, payChanges, date, date),
            rate: datedValue(c.sessionRate, rates, date, date),
            split: datedValue(c.preCapClinicianSplit, splits, date, date),
            capacity:
              (datedValue(
                c.op?.desiredWeeklySessions ?? c.sessionsPerWeek,
                capacities,
                date,
                date,
              ) /
                7) *
              (c.weeksWorkedPerYear / 52.1786) *
              c.ramp,
          };
        });
        return {
          ...c,
          daily,
          capacity: daily.reduce((n, d) => n + d.capacity, 0),
          inPerson: (c.op?.inPersonPct ?? setting.defaultInPersonPct) / 100,
          activeFraction: daily.length / days,
        };
      });
    const capacity = people.reduce((n, c) => n + c.capacity, 0),
      inPerson = capacity
        ? people.reduce((n, c) => n + c.capacity * c.inPerson, 0) / capacity
        : setting.defaultInPersonPct / 100;
    let roomCapacity = 0,
      roomCount = 0;
    const roomPools: {
      id: string;
      locationId: string | null;
      telehealthUsesRoom: boolean;
      capacity: number;
    }[] = [];
    const roomAvailability = (
      r: Workspace["rooms"][number],
      from: string,
      to: string | null,
    ) => {
      const weekly = r.blocks.length
        ? r.blocks.reduce((n, b) => n + b.endHour - b.startHour, 0)
        : r.weeklyHours;
      return datesIn(
        from > start ? from : start,
        to && to < end ? to : end,
      ).reduce((n, date) => {
        const hours = datedValue(
          weekly,
          effective.filter(
            (e) => e.targetId === r.id && e.field === "room.hours",
          ),
          date,
          date,
        );
        const daily = r.blocks.length
          ? r.blocks
              .filter(
                (b) => b.day === new Date(date + "T12:00:00Z").getUTCDay(),
              )
              .reduce((sum, b) => sum + b.endHour - b.startHour, 0) *
            (weekly > 0 ? hours / weekly : 0)
          : hours / 7;
        return n + (((daily * 60) / r.sessionMinutes) * r.usablePct) / 100;
      }, 0);
    };
    for (const r of workspace.rooms.filter(
      (r) => !r.planningOnly && active(r, start, end),
    )) {
      const available = roomAvailability(r, r.start, r.end);
      roomCapacity += available;
      roomPools.push({
        id: r.id,
        locationId: r.locationId,
        telehealthUsesRoom: r.telehealthUsesRoom,
        capacity: available,
      });
      roomCount++;
    }
    for (const e of effective.filter((e) => e.field === "room.add")) {
      const r = workspace.rooms.find((r) => r.id === e.targetId);
      if (r) {
        const available = e.value * roomAvailability(r, e.date, e.end);
        roomCapacity += available;
        roomPools.push({
          id: e.id,
          locationId: r.locationId,
          telehealthUsesRoom: r.telehealthUsesRoom,
          capacity: available,
        });
        roomCount += e.value;
      } else warnings.push(`${e.name}: room template not found.`);
    }
    const anyRooms =
      roomPools.length > 0 ||
      workspace.rooms.some((r) => !r.archived && !r.planningOnly);
    if (inPerson > 0 && !anyRooms)
      warnings.push("No rooms configured; in-person capacity is unverified.");
    const allocate = (requested: number) => {
      const remaining = roomPools.map((r) => r.capacity),
        assigned = new Map<string, number>();
      const ordered = [...people].sort(
        (a, b) =>
          Number(!!b.op?.roomId) - Number(!!a.op?.roomId) ||
          Number(!!b.op?.locationId) - Number(!!a.op?.locationId),
      );
      const eligibleFor = (c: (typeof people)[number]) =>
        roomPools
          .map((r, i) => ({ r, i }))
          .filter(({ r }) =>
            c.op?.roomId
              ? r.id === c.op.roomId
              : c.op?.locationId
                ? r.locationId === c.op.locationId
                : true,
          );
      const availableFor = (c: (typeof people)[number]) => {
        const clinical = c.capacity - (assigned.get(c.instance) ?? 0),
          eligible = eligibleFor(c);
        if (
          !anyRooms ||
          (c.inPerson === 0 && !eligible.some(({ r }) => r.telehealthUsesRoom))
        )
          return clinical;
        return Math.min(
          clinical,
          eligible.reduce(
            (sum, { r, i }) =>
              sum + remaining[i] / (r.telehealthUsesRoom ? 1 : c.inPerson),
            0,
          ),
        );
      };
      let total = 0;
      for (
        let pass = 0;
        pass < people.length + 1 && requested - total > 1e-8;
        pass++
      ) {
        let progress = 0;
        const limits = new Map(
          people.map((c) => [c.instance, availableFor(c)]),
        );
        const free = [...limits.values()].reduce((n, v) => n + v, 0);
        const need = requested - total;
        for (const c of ordered) {
          const available = limits.get(c.instance) ?? 0;
          let wanted = Math.min(
              available,
              free > 0 ? (need * available) / free : 0,
            ),
            provided = 0;
          const eligible = eligibleFor(c);
          if (
            !anyRooms ||
            (c.inPerson === 0 &&
              !eligible.some(({ r }) => r.telehealthUsesRoom))
          )
            provided = wanted;
          else
            for (const { r, i } of eligible.sort(
              (a, b) =>
                Number(a.r.telehealthUsesRoom) - Number(b.r.telehealthUsesRoom),
            )) {
              const fraction = r.telehealthUsesRoom ? 1 : c.inPerson;
              const count =
                fraction > 0
                  ? Math.min(wanted, remaining[i] / fraction)
                  : wanted;
              remaining[i] -= count * fraction;
              provided += count;
              wanted -= count;
            }
          assigned.set(c.instance, (assigned.get(c.instance) ?? 0) + provided);
          total += provided;
          progress += provided;
        }
        if (progress < 1e-8) break;
      }
      return {
        assigned,
        total,
        roomUse: roomCapacity - remaining.reduce((n, v) => n + v, 0),
      };
    };
    const roomLimit = anyRooms ? allocate(capacity).total : Infinity;
    const allocation = allocate(Math.min(demand, capacity));
    const sessions = allocation.total;
    const utilization = ratio(sessions, capacity);
    let revenue = 0,
      clinicianPay = 0,
      employerBurden = 0,
      ownerClinicalPay = 0;
    const clinicianValues: Record<string, Values> = {};
    for (const c of people) {
      const count = allocation.assigned.get(c.instance) ?? 0;
      let pay = 0,
        earned = 0;
      for (const day of c.daily) {
        const dayCount =
          c.capacity > 0 ? (count * day.capacity) / c.capacity : 0;
        const remaining = Math.max(0, c.capAmount - (capEarned[c.capKey] ?? 0));
        const afterCap = c.capEnabled && c.capAmount > 0 && remaining === 0;
        const calculated = calculateClinicianMetrics({
          ...c,
          sessionRate: day.rate,
          sessionsPerWeek: dayCount,
          weeksWorkedPerYear: 1,
          capEnabled: c.capEnabled && !afterCap,
          capAmount: remaining,
          preCapClinicianSplit: afterCap ? c.postCapClinicianSplit : day.split,
          preCapPracticeSplit: afterCap
            ? c.postCapPracticeSplit
            : 100 - day.split,
          nonClinicalHoursPerWeek:
            ((c.nonClinicalHoursPerWeek ?? 0) / 7) *
            (c.weeksWorkedPerYear / 52.1786),
        });
        if (day.mode === "existing_split")
          capEarned[c.capKey] =
            (capEarned[c.capKey] ?? 0) +
            (calculated.preCapSessions * day.rate * (100 - day.split)) / 100;
        pay +=
          day.mode === "salary"
            ? day.amount / 12 / days
            : day.mode === "hourly"
              ? ((day.amount * (c.op?.paidHoursPerWeek ?? 0)) / 7) *
                (c.weeksWorkedPerYear / 52.1786)
              : day.mode === "per_session"
                ? day.amount * dayCount
                : calculated.clinicianCompensation;
        earned += (dayCount * day.rate * setting.collectionPct) / 100;
      }
      const burden =
        String(c.classification).toLowerCase() === "w2"
          ? (pay *
              (c.w2EmployerFicaPct +
                c.futaSutaPct +
                c.workersCompPct +
                c.otherEmployerBurdenPct)) /
            100
          : 0;
      revenue += earned;
      clinicianPay += pay;
      employerBurden += burden;
      if (String(c.classification).toLowerCase() === "owner")
        ownerClinicalPay += pay;
      clinicianValues[c.instance] = calculateCustomKpis(
        workspace,
        {
          sessions: count,
          capacity: c.capacity,
          utilization: (ratio(count, c.capacity) ?? 0) * 100,
          revenue: earned,
          clinicianPay: pay,
          employerBurden: burden,
          profit: earned - pay - burden,
        },
        end,
      );
    }
    const collectionMonth = m - setting.collectionDelayMonths;
    const collections =
      setting.collectionDelayMonths === 0
        ? revenue
        : collectionMonth >= 0
          ? (results[collectionMonth].values.revenue ?? 0)
          : m === 0
            ? setting.openingReceivables
            : 0;
    let overhead = effective.reduce(
        (n, e) =>
          n +
          (e.monthlyCost *
            activeDays({ start: e.date, end: e.end }, start, end)) /
            days,
        0,
      ),
      additionalIncome = 0,
      explicitTax = 0,
      explicitReserves = 0,
      explicitOwner = 0;
    const budgetLines: Record<string, number> = {};
    for (const original of workspace.budgets) {
      const b = { ...original };
      const changes = effective.filter(
        (e) => e.targetId === b.id && e.field === "budget.amount",
      );
      let amount: number;
      if (b.planningOnly) {
        // Daily slices preserve gaps between paused and resumed template events.
        amount = datesIn(start, end).reduce((sum, date) => {
          const launch = [...changes]
            .reverse()
            .find((e) => e.date <= date && (!e.end || e.end >= date));
          if (!launch || !active(b, date, date)) return sum;
          const line = {
            ...b,
            amount: launch.value,
            start: b.start > launch.date ? b.start : launch.date,
          };
          return (
            sum +
            budgetAmount(line, date, date, sessions / days, revenue / days)
          );
        }, 0);
      } else {
        b.amount = datedValue(
          b.amount,
          changes,
          b.start > start ? b.start : start,
          b.end && b.end < end ? b.end : end,
        );
        amount = budgetAmount(b, start, end, sessions, revenue);
      }
      budgetLines[b.id] = amount;
      const kind = workspace.categories.find(
        (c) => c.id === b.categoryId,
      )?.kind;
      if (kind === "income") additionalIncome += amount;
      else if (kind === "tax") explicitTax += amount;
      else if (kind === "reserve") explicitReserves += amount;
      else if (kind === "owner") explicitOwner += amount;
      else if (kind === "marketing") marketing += amount;
      else overhead += amount;
    }
    const oneTime = events
      .filter((e) => e.enabled && e.date >= start && e.date <= end)
      .reduce((n, e) => n + e.oneTimeCost, 0);
    overhead += oneTime;
    const staffCost = staff.reduce(
      (n, s) => n + calculateStaffMemberCost(s).totalAnnualCost / 12,
      0,
    );
    const ownerPayroll = setting.ownerPayrollMonthly + explicitOwner;
    const ownerBurden = (ownerPayroll * setting.ownerPayrollBurdenPct) / 100;
    const fees = (collections * setting.processingPct) / 100;
    const profit =
      revenue +
      additionalIncome -
      clinicianPay -
      employerBurden -
      staffCost -
      overhead -
      marketing -
      fees -
      ownerPayroll -
      ownerBurden;
    const cashProfit =
      collections +
      additionalIncome -
      clinicianPay -
      employerBurden -
      staffCost -
      overhead -
      marketing -
      fees -
      ownerPayroll -
      ownerBurden;
    const basis = Math.max(0, cashProfit);
    const buckets = workspace.allocations.filter((a) => active(a, start, end));
    const configured = buckets.length > 0;
    const bucketPct = buckets.reduce((n, b) => n + b.percent, 0);
    if (bucketPct > 100)
      warnings.push(
        "Active cash allocations exceed 100%; distributions are capped at available cash.",
      );
    let taxReserve = configured
      ? buckets
          .filter((b) => b.kind === "tax")
          .reduce((n, b) => n + (b.percent / 100) * basis, 0)
      : (basis * setting.taxPct) / 100;
    let reserves = configured
      ? buckets
          .filter((b) => b.kind === "reserve")
          .reduce((n, b) => n + (b.percent / 100) * basis, 0)
      : (basis * setting.reservePct) / 100;
    let distributions = configured
      ? buckets
          .filter((b) => b.kind === "distribution")
          .reduce((n, b) => n + (b.percent / 100) * basis, 0)
      : (basis * setting.distributionPct) / 100;
    taxReserve += explicitTax;
    reserves += explicitReserves;
    distributions = Math.min(
      distributions,
      Math.max(0, basis - taxReserve - reserves),
    );
    const retainedCash = cashProfit - taxReserve - reserves - distributions;
    cash += retainedCash;
    const familyDistribution = configured
      ? distributions *
        (ratio(
          buckets
            .filter((b) => b.kind === "distribution" && b.household)
            .reduce((n, b) => n + b.percent, 0),
          buckets
            .filter((b) => b.kind === "distribution")
            .reduce((n, b) => n + b.percent, 0),
        ) ?? 0)
      : distributions;
    const familyTakeHome =
      (ownerPayroll +
        (setting.includeOwnerClinical ? ownerClinicalPay : 0) +
        familyDistribution) *
        (1 - setting.householdWithholdingPct / 100) +
      setting.otherHouseholdIncome -
      setting.householdBenefitsCost;
    const contributionPerSession = ratio(
      revenue - clinicianPay - employerBurden - fees,
      sessions,
    );
    const revenuePerSession = ratio(revenue, sessions) ?? 0;
    const values = calculateCustomKpis(
      workspace,
      {
        sessions,
        capacity,
        utilization: utilization === null ? null : utilization * 100,
        unservedSessions: Math.max(0, demand - sessions),
        roomCapacity: anyRooms ? roomCapacity : null,
        roomUtilization: anyRooms
          ? ratio(allocation.roomUse, roomCapacity) === null
            ? null
            : (allocation.roomUse / roomCapacity) * 100
          : null,
        requiredRooms:
          anyRooms && roomCount > 0 && roomCapacity > 0
            ? Math.ceil((demand * inPerson) / (roomCapacity / roomCount))
            : null,
        leads,
        consultations,
        clients: newClients,
        revenue,
        collections,
        clinicianPay,
        employerBurden,
        ownerClinicalPay,
        staffCost,
        overhead,
        marketing,
        adSpend,
        cpl: leads === null ? null : ratio(adSpend, leads),
        consultationPct:
          leads && consultations !== null
            ? (consultations / leads) * 100
            : null,
        closePct: attended ? (acquiredClients / attended) * 100 : null,
        attendance: setting.attendancePct,
        fees,
        ownerPayroll,
        profit,
        taxReserve,
        reserves,
        distributions,
        retainedCash,
        cash,
        familyTakeHome,
        breakEvenSessions:
          contributionPerSession && contributionPerSession > 0
            ? (staffCost + overhead + marketing + ownerPayroll + ownerBurden) /
              contributionPerSession
            : null,
        cac: ratio(marketing, newClients),
        ltv:
          revenuePerSession *
          setting.sessionsPerClientMonth *
          setting.retentionMonths,
        roas: ratio(revenue, marketing),
        contributionRoas: ratio(
          revenue - clinicianPay - employerBurden - fees,
          marketing,
        ),
        netRoi:
          marketing > 0
            ? ((revenue - clinicianPay - employerBurden - fees - marketing) /
                marketing) *
              100
            : null,
        runway: retainedCash < 0 ? Math.max(0, cash) / -retainedCash : null,
      },
      end,
    );
    const constraint =
      demand > capacity && capacity <= roomLimit
        ? "Clinician capacity"
        : demand > roomLimit
          ? "Room capacity"
          : cash < setting.minimumCash
            ? "Cash reserve"
            : demand < capacity
              ? "Client demand"
              : "Balanced";
    const trace: Record<string, string> = {
      sessions: `Demand ${demand.toFixed(1)} allocated across clinician capacity ${capacity.toFixed(1)}, capped by assigned rooms and locations (usable capacity ${Number.isFinite(roomLimit) ? roomLimit.toFixed(1) : "unverified / telehealth"}). Telehealth consumes a room only where configured. Historical baseline is retained separately from new-client cohorts.`,
      revenue:
        "Sum of clinician sessions x effective session rate x collection assumption. Earned revenue, not necessarily cash received.",
      collections: `Earned revenue received after ${setting.collectionDelayMonths} month(s), plus opening receivables in month one when a delay applies.`,
      clinicianPay:
        "Existing compensation function with annual cap progression, effective terms and non-clinical pay; configured salary/hourly/session overrides apply.",
      overhead:
        "Active non-marketing operating budget lines, prorated for effective dates, plus one-time events and hire support. Marketing and legacy staff payroll are separate.",
      profit:
        "Earned revenue + other income - clinician pay - employer burden - staff cost - overhead - marketing - fees - owner payroll/burden.",
      familyTakeHome:
        "Owner payroll + included owner clinical pay + household distributions, less explicit household withholding and benefits, plus other household income. These are estimates, not tax advice.",
      cash: "Opening available cash + cumulative cash collections/income - cash expenses - tax/reserve allocations - distributions. Reserves are ring-fenced, not available operating cash.",
      utilization:
        "Completed sessions / available clinician sessions. Capacity accounts for working weeks and hire ramp.",
      leads:
        "Each campaign's own estimation method; CAC-inferred leads require compatible funnel rates. Unknown leads remain unknown.",
      netRoi:
        "Whole-practice contribution less marketing costs, divided by marketing costs. Not a causal campaign ROI; use sandbox incremental comparison for a campaign decision.",
    };
    Object.assign(trace, {
      capacity:
        "Sum of each active clinician's dated weekly capacity / 7, adjusted for working weeks, calendar days, credentialing delay and hire ramp.",
      roomCapacity:
        "Usable hours in each active room x 60 / session minutes. Assigned room and location limits are shared across clinicians.",
      roomUtilization:
        "Room slots consumed, including configured telehealth occupancy, divided by usable room slots.",
      requiredRooms:
        "In-person session demand / average configured room capacity, rounded up. Location assignment can impose additional limits.",
      consultations:
        "Campaign leads x each campaign's consultation rate. Unknown lead estimates remain unknown.",
      clients:
        "Client cohorts reaching their conversion date, after channel-overlap adjustments, plus organic clients.",
      unservedSessions:
        "Modeled session demand minus sessions that fit clinician and room limits; never negative.",
      employerBurden:
        "W2 clinician pay x the existing employer FICA, unemployment, workers-compensation and other burden percentages.",
      staffCost:
        "Existing staff annual salary/hourly cost with payroll burden / 12. Only the selected compensation team is included.",
      marketing:
        "Advertising spend plus campaign operating costs and additional marketing-category budget lines, prorated for active dates. Budget lines are additive, not copies of campaign spend.",
      adSpend:
        "Campaign advertising budgets applied day by day, including dated proposed spend changes.",
      fees: "Cash collections x payment-processing percentage.",
      ownerPayroll:
        "Monthly non-clinical owner pay plus explicit owner-category budget lines.",
      ownerClinicalPay:
        "Clinical compensation for clinicians classified as owner; this is separate from non-clinical owner payroll.",
      taxReserve:
        "Positive cash profit x active tax allocation, plus explicit tax budget lines.",
      reserves:
        "Positive cash profit x active reserve allocation, plus explicit reserve budget lines.",
      distributions:
        "Positive cash profit x active distribution allocation. Only household-marked buckets reach family take-home.",
      retainedCash:
        "Cash operating profit less tax allocation, reserves and owner distributions.",
      breakEvenSessions:
        "Fixed overhead, support staff, owner payroll/burden and marketing divided by current contribution per session. This is a local-volume estimate.",
      cac: "All current marketing costs / new clients reaching conversion this month; conversion delays can make month-to-month CAC uneven.",
      cpl: "Advertising spend / modeled leads; zero or missing leads produce an unknown result.",
      attendance:
        "Manual attendance or completed / scheduled sessions in the selected historical window; missing historical data falls back to the stated manual assumption.",
      ltv: "Current collected-fee equivalent per session x sessions per client-month x assumed retention months. Revenue basis, before care-delivery costs.",
      runway:
        "Available cash / current monthly cash burn; unknown when the month is cash-positive.",
    });
    for (const k of workspace.kpis.filter((k) => !k.archived))
      trace[k.key] =
        `${k.left} ${k.operation} ${k.constant ?? k.right}. ${k.operation === "divide" && k.unit === "percent" ? "Ratio expressed as percentage points. " : ""}Missing inputs and division by zero stay unknown.`;
    for (const k of workspace.kpis.filter((k) => !k.archived)) {
      const definition =
        [...(k.versions ?? [])]
          .filter((v) => v.effectiveDate <= end)
          .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ??
        k;
      trace[k.key] =
        `${definition.left} ${definition.operation} ${definition.constant ?? definition.right}. Formula effective at period end ${end}; missing inputs remain unknown.`;
    }
    if (cash < 0) warnings.push("Available operating cash becomes negative.");
    const budgetOverhead = workspace.budgets
      .filter(
        (b) =>
          !b.planningOnly &&
          ["expense", "facility"].includes(
            workspace.categories.find((c) => c.id === b.categoryId)?.kind ??
              "expense",
          ),
      )
      .reduce(
        (sum, b) => sum + budgetAmount(b, start, end, sessions, revenue),
        0,
      );
    results.push({
      date: start,
      values,
      clinicians: clinicianValues,
      channels,
      budgetLines,
      budgetValues: { overhead: budgetOverhead },
      forecastValues: values,
      trace,
      warnings: [...new Set(warnings)],
      constraint,
    });
  }
  if (compareMarketing && workspace.campaigns.some((c) => !c.archived)) {
    const withoutMarketing = forecast(
      { ...workspace, campaigns: [] },
      context,
      proposed,
      demandMultiplier,
      false,
    );
    results.forEach((month, index) => {
      const baseline = withoutMarketing[index].values;
      const spend = month.values.marketing ?? 0;
      const increment = (month.values.profit ?? 0) - (baseline.profit ?? 0);
      month.values.roas = ratio(
        (month.values.collections ?? 0) - (baseline.collections ?? 0),
        month.values.adSpend ?? 0,
      );
      month.values.contributionRoas = ratio(
        increment + spend,
        month.values.adSpend ?? 0,
      );
      month.values.netRoi = spend > 0 ? (increment / spend) * 100 : null;
      month.trace.netRoi =
        "Modeled incremental operating profit versus the same practice without paid campaigns, divided by campaign costs. Shared capacity is applied in both forecasts; this is not observed attribution or causal proof.";
      month.trace.roas =
        "Modeled incremental cash collections versus the same practice without paid campaigns, divided by advertising spend (excluding other campaign costs).";
      workspace.kpis.forEach((k) => delete month.values[k.key]);
      month.values = calculateCustomKpis(
        workspace,
        month.values,
        monthEnd(month.date),
      );
      month.forecastValues = month.values;
    });
  }
  return results;
}

export function observed(
  workspace: Workspace,
  context: Context,
  start: string,
  end: string,
): { values: Values; dataThrough: string | null; warnings: string[] } {
  const periods = workspace.periods.filter(
    (p) =>
      p.status === "finalized" &&
      !p.archived &&
      p.start >= start &&
      p.end <= end,
  );
  const warnings: string[] = [];
  if (
    workspace.periods.some(
      (p) =>
        p.status === "finalized" &&
        p.start <= end &&
        p.end >= start &&
        (p.start < start || p.end > end),
    )
  )
    warnings.push(
      "Crossing reporting periods are excluded from exact actual totals.",
    );
  const sum = (key: keyof (typeof periods)[number]) =>
    periods.length && periods.every((p) => typeof p[key] === "number")
      ? periods.reduce((n, p) => n + (p[key] as number), 0)
      : null;
  const transactions = workspace.transactions.filter((t) =>
    periods.some((p) => p.id === t.periodId),
  );
  const expenseTotal = (kinds: string[]) =>
    periods.length && periods.every((p) => p.expensesComplete)
      ? transactions
          .filter((t) =>
            kinds.includes(
              workspace.categories.find((c) => c.id === t.categoryId)?.kind ??
                "",
            ),
          )
          .reduce((n, t) => n + t.amount, 0)
      : null;
  const overhead = expenseTotal(["expense", "facility"]),
    marketing = expenseTotal(["marketing"]);
  const selected = context.clinicians.filter((c) =>
    workspace.settings.teamId === null
      ? c.goalId == null
      : c.goalId === workspace.settings.teamId,
  );
  const records = context.sessions.filter((s) =>
    selected.some((c) => c.id === s.clinicianId),
  );
  const sessions = summarizeSessions(records, { start, end });
  const funnels = workspace.funnels.filter((f) =>
    periods.some((p) => p.id === f.periodId),
  );
  const fs = (
    key:
      | "leads"
      | "clients"
      | "spend"
      | "scheduled"
      | "attended"
      | "attributedRevenue",
  ) =>
    funnels.length && funnels.every((f) => f[key] !== null)
      ? funnels.reduce((n, f) => n + (f[key] ?? 0), 0)
      : null;
  const revenue = sum("earnedRevenue"),
    pay = sum("clinicianPay"),
    burden = sum("employerBurden"),
    staff = sum("staffPay"),
    owner = sum("ownerPay"),
    distribution = sum("distributions"),
    ownerClinical = sum("ownerClinicalPay");
  const profit = [
    revenue,
    pay,
    burden,
    staff,
    owner,
    overhead,
    marketing,
  ].every((x) => x !== null)
    ? revenue! - pay! - burden! - staff! - owner! - overhead! - marketing!
    : null;
  const values = calculateCustomKpis(
    workspace,
    {
      sessions: sessions.completed,
      capacity: sessions.desired,
      utilization: sessions.utilization,
      revenue,
      collections: sum("revenue"),
      clinicianPay: pay,
      employerBurden: burden,
      staffCost: staff,
      overhead,
      ownerPayroll: owner,
      ownerClinicalPay: ownerClinical,
      profit,
      cash:
        [...periods].sort((a, b) => a.end.localeCompare(b.end)).at(-1)
          ?.closingCash ?? null,
      distributions: distribution,
      taxReserve: sum("taxes"),
      reserves: sum("reserves"),
      marketing,
      leads: fs("leads"),
      clients: fs("clients"),
      consultations: fs("scheduled"),
      adSpend: fs("spend"),
      cpl:
        fs("spend") !== null && fs("leads")
          ? fs("spend")! / fs("leads")!
          : null,
      cac:
        marketing !== null && fs("clients") ? marketing / fs("clients")! : null,
      consultationPct:
        fs("scheduled") !== null && fs("leads")
          ? (fs("scheduled")! / fs("leads")!) * 100
          : null,
      closePct:
        fs("clients") !== null && fs("attended")
          ? (fs("clients")! / fs("attended")!) * 100
          : null,
      attendance: sessions.attendance,
      roas:
        fs("attributedRevenue") !== null && fs("spend")
          ? fs("attributedRevenue")! / fs("spend")!
          : null,
      familyTakeHome:
        owner !== null &&
        distribution !== null &&
        (!workspace.settings.includeOwnerClinical || ownerClinical !== null)
          ? (owner +
              distribution +
              (workspace.settings.includeOwnerClinical ? ownerClinical! : 0)) *
              (1 - workspace.settings.householdWithholdingPct / 100) -
            workspace.settings.householdBenefitsCost * calendarMonths(periods) +
            workspace.settings.otherHouseholdIncome * calendarMonths(periods)
          : null,
    },
    end,
  );
  if (!periods.length)
    warnings.push(
      "No finalized financial periods in this range. Sessions are separately recorded actuals.",
    );
  if (sessions.partial.length)
    warnings.push(
      "Crossing session periods are excluded from exact session totals.",
    );
  return {
    values,
    dataThrough: periods.reduce<string | null>(
      (last, p) => (!last || p.end > last ? p.end : last),
      null,
    ),
    warnings,
  };
}

function calendarMonths(periods: { start: string; end: string }[]) {
  return periods.reduce((sum, p) => {
    for (
      let date = monthDate(p.start);
      date <= p.end;
      date = monthDate(date, 1)
    ) {
      sum +=
        activeDays(p, date, monthEnd(date)) /
        daysInclusive(date, monthEnd(date));
    }
    return sum;
  }, 0);
}

export function observedSeries(
  workspace: Workspace,
  context: Context,
): ForecastMonth[] {
  return workspace.periods
    .filter((p) => !p.archived && p.status === "finalized")
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((p) => {
      const actual = observed(workspace, context, p.start, p.end);
      const clinicians = Object.fromEntries(
        context.clinicians
          .filter((c) =>
            workspace.settings.teamId === null
              ? c.goalId == null
              : c.goalId === workspace.settings.teamId,
          )
          .map((c) => {
            const s = summarizeSessions(
              context.sessions.filter((r) => r.clinicianId === c.id),
              { start: p.start, end: p.end },
            );
            return [
              String(c.id),
              calculateCustomKpis(
                workspace,
                {
                  sessions: s.completed,
                  capacity: s.desired,
                  utilization: s.utilization,
                  attendance: s.attendance,
                },
                p.end,
              ),
            ];
          }),
      );
      return {
        date: p.end,
        periodStart: p.start,
        values: actual.values,
        clinicians,
        channels: {},
        trace: {},
        warnings: actual.warnings,
        constraint: "Recorded period",
      };
    });
}

export function forecastForPeriods(
  months: ForecastMonth[],
  periods: { start: string; end: string }[],
): Values {
  const keys = [
    "sessions",
    "capacity",
    "revenue",
    "collections",
    "clinicianPay",
    "employerBurden",
    "staffCost",
    "overhead",
    "marketing",
    "profit",
    "ownerPayroll",
    "ownerClinicalPay",
    "distributions",
    "taxReserve",
    "reserves",
    "familyTakeHome",
    "leads",
    "clients",
    "consultations",
  ];
  if (!periods.length)
    return Object.fromEntries(keys.map((key) => [key, null]));
  const slices = periods.flatMap((p) =>
    months
      .filter((m) => m.date <= p.end && monthEnd(m.date) >= p.start)
      .map((m) => ({
        m,
        fraction:
          activeDays(p, m.date, monthEnd(m.date)) /
          daysInclusive(m.date, monthEnd(m.date)),
      })),
  );
  const covered = periods.every(
    (p) =>
      months.length &&
      p.start >= months[0].date &&
      p.end <= monthEnd(months[months.length - 1].date),
  );
  const result: Values = Object.fromEntries(
    keys.map((key) => [
      key,
      covered && slices.every((s) => s.m.values[key] != null)
        ? slices.reduce((sum, s) => sum + s.m.values[key]! * s.fraction, 0)
        : null,
    ]),
  );
  result.utilization =
    result.sessions != null && result.capacity
      ? (result.sessions / result.capacity) * 100
      : null;
  result.cac =
    result.marketing != null && result.clients
      ? result.marketing / result.clients
      : null;
  return result;
}

export function evaluateObservedRules(workspace: Workspace, context: Context) {
  const projection = forecast(workspace, context);
  const series = observedSeries(workspace, context).map((m) => {
    const periods = [{ start: m.periodStart!, end: m.date }];
    const projected = forecastForPeriods(projection, periods);
    const budgetOverhead = workspace.budgets
      .filter(
        (b) =>
          !b.planningOnly &&
          ["expense", "facility"].includes(
            workspace.categories.find((c) => c.id === b.categoryId)?.kind ??
              "expense",
          ),
      )
      .reduce(
        (sum, b) =>
          sum +
          budgetForRange(
            b,
            m.periodStart!,
            m.date,
            m.values.sessions ?? 0,
            m.values.revenue ?? 0,
          ),
        0,
      );
    return {
      ...m,
      forecastValues: calculateCustomKpis(workspace, projected, m.date),
      budgetValues: { overhead: budgetOverhead },
    };
  });
  const latest = series.length - 1;
  return workspace.rules
    .filter((r) => r.enabled && !r.archived)
    .map((rule) => {
      const result = conditionResult(rule.condition, series, latest, workspace);
      return {
        rule,
        date: series[latest]?.date ?? null,
        status:
          rule.status !== "open"
            ? rule.status
            : latest < 0
              ? "unknown"
              : result === null
                ? "insufficient data"
                : result
                  ? "triggered"
                  : "not triggered",
      };
    });
}

export function evaluateCondition(
  condition: Condition,
  months: ForecastMonth[],
  index: number,
  workspace: Workspace,
): boolean {
  return conditionResult(condition, months, index, workspace) === true;
}
export function evaluateRules(workspace: Workspace, months: ForecastMonth[]) {
  return workspace.rules
    .filter((r) => r.enabled && !r.archived)
    .map((rule) => {
      const index = months.findIndex((_, i) =>
        evaluateCondition(rule.condition, months, i, workspace),
      );
      return {
        rule,
        date: index < 0 ? null : months[index].date,
        actionDate:
          index < 0 ? null : monthDate(months[index].date, -rule.leadMonths),
        status:
          rule.status !== "open"
            ? rule.status
            : index === 0
              ? "triggered"
              : index > 0
                ? "approaching"
                : "healthy",
      };
    });
}

export function ruleResponseEvents(
  rule: Rule,
  workspace: Workspace,
  actionDate: string,
  makeId: () => string,
): PlanEvent[] {
  const responses = [
    { id: "primary", name: rule.action, offsetMonths: 0, eventId: null },
    ...(rule.responses ?? []),
  ];
  const responseIds = responses.map(() => makeId());
  const idMap = new Map<string, string>();
  responses.forEach((r, i) => {
    if (r.eventId && !idMap.has(r.eventId))
      idMap.set(r.eventId, responseIds[i]);
  });
  return responses.map((response, index) => {
    const template =
      index === 0
        ? rule.event
        : workspace.events.find((e) => e.id === response.eventId);
    const date = monthDate(actionDate, response.offsetMonths);
    const end = template?.end
      ? new Date(
          Date.parse(template.end + "T12:00:00Z") +
            Date.parse(date + "T12:00:00Z") -
            Date.parse(template.date + "T12:00:00Z"),
        )
          .toISOString()
          .slice(0, 10)
      : null;
    return {
      id: responseIds[index],
      name: response.name,
      date,
      end,
      field: template?.field ?? "custom",
      targetId: template?.targetId ?? "",
      value: template?.value ?? 0,
      enabled: true,
      dependsOn: template?.dependsOn.map((id) => idMap.get(id) ?? id) ?? [],
      delayMonths: template?.delayMonths ?? 0,
      rampMonths: template?.rampMonths ?? 1,
      oneTimeCost: template?.oneTimeCost ?? 0,
      monthlyCost: template?.monthlyCost ?? 0,
      notes: `Decision rule: ${rule.name}. ${template?.notes ?? ""}`,
      initiativeId: null,
    };
  });
}

export function solveGoal(
  workspace: Workspace,
  context: Context,
  metric: string,
  target: number,
) {
  const first = forecast(workspace, context)[0];
  const v = first.values;
  const selected = context.clinicians.filter((c) =>
    workspace.settings.teamId === null
      ? c.goalId == null
      : c.goalId === workspace.settings.teamId,
  );
  const rate = selected.length
    ? ((selected.reduce((n, c) => n + c.sessionRate, 0) / selected.length) *
        workspace.settings.collectionPct) /
      100
    : 0;
  const margin =
    (v.sessions ?? 0) > 0
      ? ((v.revenue ?? 0) -
          (v.clinicianPay ?? 0) -
          (v.employerBurden ?? 0) -
          (v.fees ?? 0)) /
        (v.sessions ?? 1)
      : 0;
  const fixed =
    (v.overhead ?? 0) +
    (v.staffCost ?? 0) +
    (v.marketing ?? 0) +
    (v.ownerPayroll ?? 0);
  let required =
    metric === "sessions"
      ? target
      : metric === "revenue"
        ? rate > 0
          ? target / rate
          : null
        : margin > 0
          ? (target + fixed) / margin
          : null;
  if (metric === "familyTakeHome") {
    const keep =
      ((1 - workspace.settings.householdWithholdingPct / 100) *
        workspace.settings.distributionPct) /
      100;
    required =
      keep > 0 && margin > 0
        ? (Math.max(
            0,
            target -
              (v.ownerPayroll ?? 0) *
                (1 - workspace.settings.householdWithholdingPct / 100),
          ) /
            keep +
            fixed) /
          margin
        : null;
  }
  const perClinician = selected.length
    ? (v.capacity ?? 0) / selected.length
    : 0;
  const clients =
    required === null
      ? null
      : required /
        Math.max(
          1,
          workspace.settings.sessionsPerClientMonth *
            workspace.settings.retentionMonths,
        );
  const campaign = workspace.campaigns.find((c) => !c.archived);
  const estimate = campaign ? estimateCampaign(campaign, workspace) : null;
  const clientYield =
    estimate && estimate.spend > 0 ? estimate.clients / estimate.spend : 0;
  return {
    sessions: required,
    clinicians:
      required !== null && perClinician > 0
        ? Math.ceil(required / perClinician)
        : null,
    rooms:
      required !== null && workspace.rooms.length && v.roomCapacity
        ? Math.ceil(
            (required * workspace.settings.defaultInPersonPct) /
              100 /
              (v.roomCapacity / workspace.rooms.length),
          )
        : null,
    clients,
    leads:
      clients !== null &&
      estimate &&
      estimate.clients > 0 &&
      estimate.leads !== null
        ? (clients * estimate.leads) / estimate.clients
        : null,
    spend: clients !== null && clientYield > 0 ? clients / clientYield : null,
    warning:
      "Steady-state estimate using current mix and unit economics; use the dated forecast to test ramp, cap transitions and cash feasibility.",
  };
}

export function transitionInitiative(
  workspace: Workspace,
  id: string,
  status: "active" | "paused" | "completed" | "stopped",
  date: string,
  newId: () => string,
): Workspace {
  const proposal = workspace.proposals.find((p) => p.id === id);
  if (!proposal?.approvedAt) throw new Error("Choose an approved initiative.");
  const previousDay = new Date(Date.parse(date + "T12:00:00Z") - 86400000)
    .toISOString()
    .slice(0, 10);
  let events = workspace.events.map((e) => ({ ...e }));
  if (status !== "active")
    events = events.map((e) =>
      e.initiativeId !== id || !e.enabled || (e.end && e.end < date)
        ? e
        : e.date >= date
          ? { ...e, enabled: false }
          : { ...e, end: previousDay },
    );
  else {
    const resumed: PlanEvent[] = [];
    const mapping = new Map<string, string>();
    for (const original of proposal.changes.filter((c) =>
      proposal.approvedIds.includes(c.id),
    )) {
      if (original.end && original.end < date) continue;
      const last = events
        .filter(
          (e) =>
            e.initiativeId === id &&
            (e.id === original.id || e.sourceChangeId === original.id),
        )
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1);
      if (!last) continue;
      if (last.date >= date) {
        last.enabled = true;
        last.end = original.end;
        mapping.set(original.id, last.id);
      } else {
        const next = {
          ...last,
          id: newId(),
          sourceChangeId: original.id,
          date,
          end: original.end,
          enabled: true,
          oneTimeCost: 0,
          delayMonths: 0,
        };
        resumed.push(next);
        mapping.set(original.id, next.id);
      }
    }
    for (const e of resumed)
      e.dependsOn = e.dependsOn.map(
        (dependency) => mapping.get(dependency) ?? dependency,
      );
    events.push(...resumed);
  }
  return {
    ...workspace,
    events,
    proposals: workspace.proposals.map((p) =>
      p.id === id ? { ...p, status } : p,
    ),
  };
}

export function affordablePay(
  workspace: Workspace,
  context: Context,
  clinicianId: number,
  mode: "salary" | "hourly" | "per_session" | "split",
  month: number,
  targetProfit: number,
) {
  const clinician = context.clinicians.find((c) => c.id === clinicianId);
  if (!clinician)
    return { maximum: null, limited: false, error: "Choose a clinician." };
  const existing = workspace.clinicians.find(
    (c) => c.clinicianId === clinicianId,
  );
  if (mode === "hourly" && !existing?.paidHoursPerWeek)
    return {
      maximum: null,
      limited: false,
      error: "Set paid hours per week in this clinician's operating profile.",
    };
  const data: Workspace = { ...workspace, settings: { ...workspace.settings } };
  data.settings.horizonMonths = Math.min(60, Math.max(1, month + 1));
  data.terms = data.terms.filter((t) => t.clinicianId !== clinicianId);
  data.events = data.events.filter(
    (e) =>
      e.targetId !== String(clinicianId) ||
      !["clinician.split", "clinician.payAmount"].includes(e.field),
  );
  const profile = existing
    ? { ...existing }
    : {
        id: "affordability",
        clinicianId,
        start: workspace.settings.forecastStart,
        end: null,
        status: "active" as const,
        desiredWeeklySessions: clinician.sessionsPerWeek,
        inPersonPct: workspace.settings.defaultInPersonPct,
        locationId: null,
        roomId: null,
        payAmount: 0,
        paidHoursPerWeek: 0,
        payMode: "existing_split" as const,
        openingCapContribution: null,
      };
  data.clinicians = [
    ...data.clinicians.filter((c) => c.clinicianId !== clinicianId),
    profile,
  ];
  profile.payMode = mode === "split" ? "existing_split" : mode;
  const evaluate = (amount: number) => {
    profile.payAmount = amount;
    const people =
      mode === "split"
        ? context.clinicians.map((c) =>
            c.id === clinicianId
              ? {
                  ...c,
                  preCapClinicianSplit: amount,
                  preCapPracticeSplit: 100 - amount,
                  postCapClinicianSplit: amount,
                  postCapPracticeSplit: 100 - amount,
                }
              : c,
          )
        : context.clinicians;
    return forecast(data, { ...context, clinicians: people }, [], 1, false).at(
      -1,
    )!.values.profit!;
  };
  if (evaluate(0) < targetProfit)
    return {
      maximum: null,
      limited: false,
      error:
        "The selected profit target is not met even with zero pay for this clinician.",
    };
  let low = 0,
    high = mode === "split" ? 100 : mode === "salary" ? 1000000 : 10000;
  const limited = evaluate(high) >= targetProfit;
  if (limited) return { maximum: high, limited: true, error: null };
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    if (evaluate(mid) >= targetProfit) low = mid;
    else high = mid;
  }
  return { maximum: Math.floor(low * 100) / 100, limited: false, error: null };
}
