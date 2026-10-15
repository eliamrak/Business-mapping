import {
  calculateClinicianMetrics,
  calculateStaffMemberCost,
  staffCompensationKnown,
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
import { estimateW2NetPay } from "./family-pay.ts";
import { reconcileBillingEvidence } from "./billing-evidence.ts";
export { reconcileBillingEvidence } from "./billing-evidence.ts";

export type Clinician = ClinicianMetricsInput & {
  id: number;
  label: string;
  goalId?: number | null;
};
export type Staff = StaffCostInput & {
  id?: number;
  label?: string;
  goalId?: number | null;
};
export type ImportedBillingActual = {
  clinicianId: number;
  serviceDate: string;
  totalFeeCharged: number;
  sourceRowHash: string;
  clientId?: string;
  billingCode?: string | null;
  visitKind?: "consultation";
  sourceSnapshotId?: string;
  evidenceUnknown?: boolean;
  /** Explicit whole-treatment-day matching proof, never inferred from row count alone. */
  replacementSessionCount?: number;
};
export type Context = {
  clinicians: Clinician[];
  staff: Staff[];
  sessions: SessionRecord[];
  importedBillingActuals?: ImportedBillingActual[];
};

export function overheadGoalAllowance(
  settings: Workspace["settings"],
  revenue: number,
  monthFraction = 1,
): number | null {
  if (settings.overheadGoalBasis === "fixed_percent")
    return settings.overheadGoalPercent === undefined
      ? null
      : (revenue * settings.overheadGoalPercent) / 100;
  if (settings.overheadGoalBasis === "fixed_dollars")
    return settings.overheadFloorMonthly * monthFraction;
  return null;
}
export function staffMemberAt(
  workspace: Workspace,
  member: Staff,
  date: string,
): Staff {
  if (!member.id) return member;
  const terms = [...workspace.staffTerms]
    .filter(
      (entry) =>
        entry.staffMemberId === member.id &&
        entry.effectiveDate <= date &&
        (!entry.end || entry.end >= date),
    )
    .sort(
      (a, b) =>
        a.effectiveDate.localeCompare(b.effectiveDate) ||
        Number(a.end === null) - Number(b.end === null) ||
        (a.end ?? "").localeCompare(b.end ?? ""),
    );
  return terms.reduce<Staff>(
    (current, term) => ({
      ...current,
      annualSalary: term.annualSalary ?? current.annualSalary,
      hourlyRate: term.hourlyRate ?? current.hourlyRate,
      hoursPerWeek: term.hoursPerWeek ?? current.hoursPerWeek,
      weeksPerYear: term.weeksPerYear ?? current.weeksPerYear,
    }),
    member,
  );
}
export function staffCostForRange(
  workspace: Workspace,
  member: Staff,
  start: string,
  end: string,
) {
  const monthDays = daysInclusive(monthDate(start), monthEnd(start));
  return datesIn(start, end).reduce(
    (sum, date) =>
      sum +
      calculateStaffMemberCost(staffMemberAt(workspace, member, date))
        .totalAnnualCost /
        12 /
        monthDays,
    0,
  );
}
export type Values = Record<string, number | null>;
export type ForecastMonth = {
  date: string;
  periodStart?: string;
  periodEnd?: string;
  values: Values;
  clinicians: Record<string, Values>;
  channels: Record<string, FunnelEstimate>;
  budgetLines?: Record<string, number>;
  budgetValues?: Values;
  forecastValues?: Values;
  goalMeasureDaily?: Record<string, Values>;
  trace: Record<string, string>;
  warnings: string[];
  constraint: string;
};
export type ForecastOptions = {
  baselineWeeklyByClinician?: Record<number, number>;
  useImportedBillingActuals?: boolean;
  workingForecast?: boolean;
  workingRange?: { start: string; end: string };
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

export const summarizeImportedBillingActuals = (
  context: Context,
  selectedIds: Set<number>,
) => {
  const billed = new Map<number, Map<string, number>>();
  const groups = new Map<string, ImportedBillingActual[]>();
  const enriched = context.importedBillingActuals?.filter((row) => row.clientId !== undefined) ?? [];
  for (const row of context.importedBillingActuals ?? []) {
    if (row.clientId !== undefined) continue;
    const group = groups.get(row.sourceRowHash) ?? [];
    group.push(row);
    groups.set(row.sourceRowHash, group);
  }
  const unknownDates: Array<{ clinicianId: number; date: string; reason?: string }> = [];
  const resolved: ImportedBillingActual[] = [];
  for (const group of reconcileBillingEvidence(enriched.map((row) => ({ row: { ...row, clientId: row.clientId!, clinician: String(row.clinicianId) }, snapshotId: row.sourceSnapshotId ?? "context" })))) {
    if (!group.known || group.rows.some((row) => row.evidenceUnknown)) {
      unknownDates.push(...group.rows.map((row) => ({ clinicianId: row.clinicianId, date: row.serviceDate, reason: "Billing encounter identity or amount is ambiguous; no duplicate or conflicting payload is authoritative." })));
    } else resolved.push(group.row);
  }
  for (const [hash, rows] of groups) {
    const row = rows[0];
    if (!hash.trim() || !Number.isFinite(row.totalFeeCharged) || rows.some((other) => other.clinicianId !== row.clinicianId || other.serviceDate !== row.serviceDate || other.totalFeeCharged !== row.totalFeeCharged)) {
      unknownDates.push(...rows.map((other) => ({ clinicianId: other.clinicianId, date: other.serviceDate })));
      continue;
    }
    if (row.evidenceUnknown) { unknownDates.push({ clinicianId: row.clinicianId, date: row.serviceDate }); continue; }
    resolved.push(row);
  }
  const replacementSessions = new Map<number, Map<string, number>>();
  const requiresProof = new Set<string>();
  const unverified = new Set<string>();
  for (const row of resolved) {
    if (!selectedIds.has(row.clinicianId)) continue;
    const code = row.billingCode?.trim().toUpperCase();
    const consultation = code === "PHONE" || row.visitKind === "consultation";
    if (consultation) {
      if (row.totalFeeCharged !== 0) unknownDates.push({ clinicianId: row.clinicianId, date: row.serviceDate, reason: "Nonzero PHONE/consultation charge violates the confirmed zero-fee policy; source review is required and charges cannot replace treatment estimates." });
      continue;
    }
    if (row.clientId !== undefined && !/^\d{5}$/.test(code ?? "")) {
      unknownDates.push({ clinicianId: row.clinicianId, date: row.serviceDate, reason: "Unclassified charges cannot establish a complete treatment-day replacement." });
      continue;
    }
    const key = `${row.clinicianId}|${row.serviceDate}`;
    if (row.clientId !== undefined) requiresProof.add(key);
    const counts = replacementSessions.get(row.clinicianId) ?? new Map<string, number>();
    const count = row.replacementSessionCount;
    if (count == null || !Number.isInteger(count) || count < 0) unverified.add(key);
    else if (counts.has(row.serviceDate) && counts.get(row.serviceDate) !== count) unverified.add(key);
    else counts.set(row.serviceDate, count);
    replacementSessions.set(row.clinicianId, counts);
    const clinician = billed.get(row.clinicianId) ?? new Map<string, number>();
    clinician.set(
      row.serviceDate,
      (clinician.get(row.serviceDate) ?? 0) + row.totalFeeCharged,
    );
    billed.set(row.clinicianId, clinician);
  }
  for (const key of unverified) {
    const [id, date] = key.split("|");
    replacementSessions.get(Number(id))?.delete(date);
  }
  return { billed, unknownDates: unknownDates.filter((row) => selectedIds.has(row.clinicianId)), replacementSessions, requiresProof };
};
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
  record: { start: string | null; end: string | null; archived?: boolean },
  start: string,
  end: string,
) =>
  !record.archived &&
  !!record.start &&
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

export function cashAllocationsForRange(
  allocations: Workspace["allocations"],
  positiveSurplus: number,
  start: string,
  end: string,
) {
  const days = daysInclusive(start, end);
  const buckets = allocations
    .filter((bucket) => active(bucket, start, end))
    .map((bucket) => ({
      ...bucket,
      amount: (Math.max(0, positiveSurplus) * bucket.percent / 100) *
        activeDays(bucket, start, end) / days,
    }));
  const maxDailyPercent = datesIn(start, end).reduce(
    (maximum, date) => Math.max(
      maximum,
      buckets.filter((bucket) => active(bucket, date, date))
        .reduce((sum, bucket) => sum + bucket.percent, 0),
    ),
    0,
  );
  return { buckets, configured: buckets.length > 0, maxDailyPercent };
}

function activeClinicalHeadcountAt(
  workspace: Workspace,
  context: Context,
  date: string,
  currentTeamOnly = false,
) {
  return context.clinicians.filter((clinician) => {
    const selected =
      workspace.settings.teamId === null
        ? clinician.goalId == null
        : clinician.goalId === workspace.settings.teamId;
    const setting = workspace.clinicians.find(
      (entry) => entry.clinicianId === clinician.id,
    );
    return (
      selected &&
      (!setting || (setting.status === "active" && (!currentTeamOnly || setting.onTeam !== false) && active(setting, date, date)))
    );
  }).length;
}

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
  clients: number | null;
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
  const campaignName = c.name || "Campaign";
  const campaignSpend = c.monthlySpend ?? 0;
  const otherCost = c.otherMonthlyCost ?? 0;
  const conversion =
    c.consultationPct !== null &&
    c.attendancePct !== null &&
    c.closePct !== null
      ? ((((c.consultationPct / 100) * c.attendancePct) / 100) * c.closePct) /
        100
      : null;
  let leads: number | null = null,
    clients: number | null = null;
  const warnings: string[] = [];
  if (!c.method) warnings.push(`${campaignName}: choose an estimate method.`);
  if (c.method === "cpl") {
    leads = c.cpl === null ? null : ratio(campaignSpend, c.cpl);
    clients = leads !== null && conversion !== null ? leads * conversion : null;
    if (leads === null)
      warnings.push(`${campaignName}: cost per lead must be positive.`);
    if (conversion === null)
      warnings.push(`${campaignName}: conversion rates are incomplete.`);
  }
  if (c.method === "cac") {
    clients = c.cac === null ? null : ratio(campaignSpend, c.cac);
    leads =
      conversion !== null && conversion > 0 && clients !== null
        ? clients / conversion
        : null;
    if (!c.cac) warnings.push(`${campaignName}: CAC must be positive.`);
    if (conversion === null)
      warnings.push(`${campaignName}: conversion rates are incomplete.`);
  }
  if (c.method === "clicks") {
    leads =
      c.cpm > 0
        ? ((((campaignSpend / c.cpm) * 1000 * c.ctrPct) / 100) *
            c.clickToLeadPct) /
          100
        : null;
    clients = leads !== null && conversion !== null ? leads * conversion : null;
    if (!c.cpm) warnings.push(`${campaignName}: CPM must be positive.`);
    if (conversion === null)
      warnings.push(`${campaignName}: conversion rates are incomplete.`);
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
        spend: campaignSpend,
        cpl: c.cpl,
        cac: c.cac,
        closePct: c.closePct,
      },
      date,
    );
    const value = kpi ? values[kpi.key] : null;
    clients = value == null ? null : Math.max(0, value);
    if (value == null)
      warnings.push(`${campaignName}: custom client formula is unavailable.`);
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
        `${campaignName}: historical yield needs finalized spend and client totals.`,
      );
    else {
      clients =
        (campaignSpend * records.reduce((n, r) => n + (r.clients ?? 0), 0)) /
        spend;
      leads = records.some((r) => r.leads === null)
        ? null
        : (campaignSpend * records.reduce((n, r) => n + (r.leads ?? 0), 0)) /
          spend;
    }
  }
  return {
    leads,
    consultations:
      leads === null || c.consultationPct === null
        ? null
        : (leads * c.consultationPct) / 100,
    clients: clients === null ? null : clients * (1 - c.overlapPct / 100),
    spend: campaignSpend + otherCost,
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
  options: ForecastOptions = {},
): ForecastMonth[] {
  const settings = workspace.settings;
  const issues = eventIssues([...workspace.events, ...proposed]);
  const events = issues.length
    ? workspace.events.filter((e) => e.enabled)
    : [...workspace.events, ...proposed].filter((e) => e.enabled);
  const selected = context.clinicians.filter((c) =>
    settings.teamId === null ? c.goalId == null : c.goalId === settings.teamId,
  );
  const importedBillingSource = summarizeImportedBillingActuals(
    context,
    new Set(selected.map((person) => person.id)),
  );
  const importedBilling = importedBillingSource.billed;
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
  const baseWeekly = options.baselineWeeklyByClinician
    ? selected.reduce(
        (total, clinician) =>
          total +
          (options.baselineWeeklyByClinician?.[clinician.id] ??
            clinician.sessionsPerWeek),
        0,
      )
    : settings.baselineMode === "manual"
      ? settings.baselineWeeklySessions
      : historicalWeekly;
  const results: ForecastMonth[] = [];
  const workingRange = options.workingForecast ? options.workingRange : undefined;
  if (workingRange && (!/^\d{4}-\d{2}-\d{2}$/.test(workingRange.start) || !/^\d{4}-\d{2}-\d{2}$/.test(workingRange.end) || workingRange.start > workingRange.end || [workingRange.start, workingRange.end].some((date) => !Number.isFinite(Date.parse(date + "T12:00:00Z")) || new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date)))
    throw new Error("Working forecast range requires valid ordered calendar dates.");
  let cash = settings.openingCash;
  let cashKnown = true;
  let baselineRetained = 1;
  const capEarned: Record<string, number> = {};
  const unknownCapKeys = new Set<string>();
  const cohorts: {
    start: number;
    clients: number;
    sessions: number;
    retention: number;
  }[] = [];
  const futureClients: Record<number, typeof cohorts> = {};
  for (let m = 0; m < settings.horizonMonths; m++) {
    const calendarStart = monthDate(settings.forecastStart, m);
    const calendarEnd = monthEnd(calendarStart);
    const start = workingRange && workingRange.start > calendarStart ? workingRange.start : calendarStart,
      end = workingRange && workingRange.end <calendarEnd ? workingRange.end : calendarEnd;
    if (start > end) continue;
    const days = daysInclusive(start, end),
      calendarDays = daysInclusive(calendarStart, calendarEnd),
      weeks = days / 7;
    const warnings = [...issues];
    let unknownBilling = options.useImportedBillingActuals !== false && importedBillingSource.unknownDates.some((row) => row.date >= start && row.date <= end);
    let unknownCompensation = false;
    if (unknownBilling) warnings.push("Imported billing source identities conflict or have unknown fees; matching revenue is unknown.");
    if (unknownBilling) warnings.push(...importedBillingSource.unknownDates.filter((row) => row.date >= start && row.date <= end).flatMap((row) => row.reason ? [row.reason] : []));
    const unknownStaff = staff.filter((member) => datesIn(start, end).some((date) => !staffCompensationKnown(staffMemberAt(workspace, member, date))));
    if (unknownStaff.length) warnings.push("Selected staff compensation is unknown; financial feasibility and profit cannot be certified.");
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
    if (start.endsWith("-01-01") || results.length === 0) {
      for (const key of Object.keys(capEarned)) delete capEarned[key];
      unknownCapKeys.clear();
    }
    if (results.length === 0 && !start.endsWith("-01-01"))
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
    const needsCampaignStart = (c: Campaign) =>
      !c.archived &&
      !c.planningOnly &&
      c.start === null &&
      ((c.monthlySpend ?? 0) > 0 ||
        (c.otherMonthlyCost ?? 0) > 0 ||
        c.method !== null);
    for (const original of workspace.campaigns.filter(
      (c) =>
        (active(c, start, end) || needsCampaignStart(c)) &&
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
      if (!c.start) {
        f.clients = null;
        f.leads = null;
        f.consultations = null;
        f.warnings.push(`${c.name || "Campaign"}: forecast start is missing.`);
        channels[c.id] = f;
        warnings.push(...f.warnings);
        continue;
      }
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
        if (estimate.clients !== null)
          acquiredClients += (estimate.clients / calendarDays) * demandMultiplier;
        attended =
          attended === null ||
          estimate.consultations === null ||
          daily.attendancePct === null
            ? null
            : attended +
              ((estimate.consultations * daily.attendancePct) / 100 / calendarDays) *
                demandMultiplier;
        adSpend += (daily.monthlySpend ?? 0) / calendarDays;
        f.clients =
          f.clients === null || estimate.clients === null
            ? null
            : f.clients + (estimate.clients / calendarDays) * demandMultiplier;
        f.spend += estimate.spend / calendarDays;
        f.leads =
          f.leads === null || estimate.leads === null
            ? null
            : f.leads + (estimate.leads / calendarDays) * demandMultiplier;
        f.consultations =
          f.consultations === null || estimate.consultations === null
            ? null
            : f.consultations +
              (estimate.consultations / calendarDays) * demandMultiplier;
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
        clients: f.clients ?? 0,
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
    if (m > 0 && !options.workingForecast) baselineRetained *= setting.baselineRetentionPct / 100;
    const baselineMonthSessions = options.baselineWeeklyByClinician
      ? selected.reduce((sum, clinician) => {
          const profile = workspace.clinicians.find((entry) => entry.clinicianId === clinician.id);
          if (profile && (profile.status !== "active" || !active(profile, start, end) || (options.workingForecast && profile.onTeam === false))) return sum;
          const first = profile && profile.start > start ? profile.start : start;
          const last = profile?.end && profile.end < end ? profile.end : end;
          return sum + (options.baselineWeeklyByClinician?.[clinician.id] ?? clinician.sessionsPerWeek) * daysInclusive(first, last) / 7;
        }, 0)
      : (baseWeekly ?? 0) * weeks;
    const baselineDemand = baselineMonthSessions * baselineRetained;
    const acquiredDemand = cohorts.reduce(
      (n, c) =>
        n + c.clients * c.sessions * Math.pow(1 - 1 / c.retention, m - c.start),
      0,
    );
    const demand =
      baselineDemand + (options.workingForecast ? 0 : (acquiredDemand * setting.attendancePct) / 100);
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
          availability: [],
          payMode: "existing_split",
          payAmount: 0,
          paidHoursPerWeek: 0,
          expectedSessionRevenue: null,
          openingCapContribution: 0,
        },
      });
    }
    const people = roster
      .filter(
        (c) => !c.op || (c.op.status === "active" && active(c.op, start, end) && (!options.workingForecast || c.op.onTeam !== false)),
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
        const availableHours =
          c.op?.availability.reduce(
            (sum, block) => sum + block.endHour - block.startHour,
            0,
          ) ?? 0;
        const daily = datesIn(firstDay, lastDay).map((date) => {
          const mode =
            [...terms]
              .reverse()
              .find((t) => t.effectiveDate <= date && t.payMode !== null)
              ?.payMode ??
            c.op?.payMode ??
            "existing_split";
          const listedRate = datedValue(c.sessionRate, rates, date, date);
          const expectedTermRate =
            [...terms]
              .reverse()
              .find(
                (term) =>
                  term.effectiveDate <= date &&
                  term.expectedSessionRevenue !== null,
              )?.expectedSessionRevenue ?? undefined;
          const expectedRate = expectedTermRate ?? c.op?.expectedSessionRevenue;
          const paidHoursPerWeek =
            [...terms]
              .reverse()
              .find(
                (term) =>
                  term.effectiveDate <= date && term.paidHoursPerWeek !== null,
              )?.paidHoursPerWeek ??
            c.op?.paidHoursPerWeek ??
            0;
          return {
            date,
            cardRate: listedRate,
            mode,
            amount: datedValue(c.op?.payAmount ?? 0, payChanges, date, date),
            paidHoursPerWeek,
            rate:
              expectedTermRate !== undefined
                ? expectedTermRate
                : expectedRate == null
                  ? listedRate
                  : c.sessionRate > 0
                    ? (listedRate * expectedRate) / c.sessionRate
                    : expectedRate,
            split: datedValue(c.preCapClinicianSplit, splits, date, date),
            capacity:
              (availableHours > 0
                ? (Math.min(
                    datedValue(
                      c.op?.desiredWeeklySessions ?? c.sessionsPerWeek,
                      capacities,
                      date,
                      date,
                    ),
                    availableHours,
                  ) *
                    (c.op?.availability
                      .filter(
                        (block) =>
                          block.day ===
                          new Date(date + "T12:00:00Z").getUTCDay(),
                      )
                      .reduce(
                        (sum, block) => sum + block.endHour - block.startHour,
                        0,
                      ) ?? 0)) /
                  availableHours
                : datedValue(
                    c.op?.desiredWeeklySessions ?? c.sessionsPerWeek,
                    capacities,
                    date,
                    date,
                  ) / 7) *
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
    if (
      workspace.rooms.some(
        (room) =>
          !room.archived && (room.blocks.length || room.assignments.length),
      ) &&
      people.some((person) => !person.op?.availability.length)
    )
      warnings.push(
        "Some clinician availability is missing; room-time overlap is only partly verified.",
      );
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
      dedicatedClinicianId: number | null;
      limits: Record<string, number> | null;
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
    const assignmentLimits = (
      r: Workspace["rooms"][number],
      from: string,
      to: string | null,
    ) => {
      const useAssignments = r.usage === "shared" && r.assignments.length > 0;
      if (!useAssignments && !r.blocks.length) return null;
      const limits: Record<string, number> = {};
      for (const c of people) {
        if (c.instance !== String(c.id)) continue;
        let slots = 0;
        for (const date of datesIn(
          from > start ? from : start,
          to && to < end ? to : end,
        )) {
          const day = new Date(date + "T12:00:00Z").getUTCDay();
          const skipped =
            useAssignments &&
            r.skippedWeeks.some(
              (week) =>
                week.clinicianId === c.id &&
                date >= week.weekStart &&
                date <
                  new Date(
                    Date.parse(week.weekStart + "T12:00:00Z") + 7 * 86_400_000,
                  )
                    .toISOString()
                    .slice(0, 10),
            );
          const assigned = skipped
            ? []
            : useAssignments
              ? r.assignments.filter(
                  (b) => b.day === day && b.clinicianId === c.id,
                )
              : r.blocks.filter((b) => b.day === day);
          const roomOpen = r.blocks.filter((b) => b.day === day);
          const clinicianOpen =
            c.op?.availability.filter((b) => b.day === day) ?? [];
          for (const block of assigned) {
            const roomWindows = r.blocks.length ? roomOpen : [block];
            const clinicianWindows = c.op?.availability.length
              ? clinicianOpen
              : [block];
            for (const open of roomWindows)
              for (const available of clinicianWindows) {
                const hours = Math.max(
                  0,
                  Math.min(block.endHour, open.endHour, available.endHour) -
                    Math.max(
                      block.startHour,
                      open.startHour,
                      available.startHour,
                    ),
                );
                slots +=
                  (((hours * 60) / r.sessionMinutes) * r.usablePct) / 100;
              }
          }
        }
        limits[c.instance] = slots;
      }
      return limits;
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
        dedicatedClinicianId:
          r.usage === "dedicated" ? r.dedicatedClinicianId : null,
        limits: assignmentLimits(r, r.start, r.end),
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
          dedicatedClinicianId:
            r.usage === "dedicated" ? r.dedicatedClinicianId : null,
          limits: assignmentLimits(r, e.date, e.end),
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
        usedByClinician = roomPools.map(() => new Map<string, number>()),
        assigned = new Map<string, number>();
      const ordered = [...people].sort(
        (a, b) =>
          Number(!!b.op?.roomId) - Number(!!a.op?.roomId) ||
          Number(!!b.op?.locationId) - Number(!!a.op?.locationId),
      );
      const eligibleFor = (c: (typeof people)[number]) =>
        roomPools
          .map((r, i) => ({ r, i }))
          .filter(
            ({ r }) =>
              (r.dedicatedClinicianId === null ||
                (c.instance === String(c.id) &&
                  r.dedicatedClinicianId === c.id)) &&
              (r.limits === null || (r.limits[c.instance] ?? 0) > 0) &&
              (c.op?.roomId
                ? r.id === c.op.roomId
                : c.op?.locationId
                  ? r.locationId === c.op.locationId
                  : true),
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
              sum +
              Math.min(
                remaining[i],
                Math.max(
                  0,
                  (r.limits?.[c.instance] ?? Infinity) -
                    (usedByClinician[i].get(c.instance) ?? 0),
                ),
              ) /
                (r.telehealthUsesRoom ? 1 : c.inPerson),
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
        const preferences =
          pass === 0 && options.baselineWeeklyByClinician
            ? new Map(
                people.map((c) => [
                  c.instance,
                  Math.min(
                    limits.get(c.instance) ?? 0,
                    (c.instance === String(c.id)
                      ? (options.baselineWeeklyByClinician?.[c.id] ??
                        c.sessionsPerWeek)
                      : 0) * (c.daily.length / 7),
                  ),
                ]),
              )
            : limits;
        const free = [...preferences.values()].reduce((n, v) => n + v, 0);
        const need = requested - total;
        for (const c of ordered) {
          const available = limits.get(c.instance) ?? 0;
          const preferred = preferences.get(c.instance) ?? 0;
          let wanted = Math.min(
              available,
              free > 0 ? (Math.min(need, free) * preferred) / free : 0,
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
                  ? Math.min(
                      wanted,
                      remaining[i] / fraction,
                      Math.max(
                        0,
                        (r.limits?.[c.instance] ?? Infinity) -
                          (usedByClinician[i].get(c.instance) ?? 0),
                      ) / fraction,
                    )
                  : wanted;
              remaining[i] -= count * fraction;
              usedByClinician[i].set(
                c.instance,
                (usedByClinician[i].get(c.instance) ?? 0) + count * fraction,
              );
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
    const workingAssignments = new Map(people.map((person) => [person.instance,
      (options.baselineWeeklyByClinician?.[person.id] ?? 0) * person.daily.length / 7,
    ]));
    const allocation = options.workingForecast
      ? { assigned: workingAssignments, total: [...workingAssignments.values()].reduce((sum, count) => sum + count, 0), roomUse: 0 }
      : allocate(Math.min(demand, capacity));
    const sessions = allocation.total;
    if (options.workingForecast && anyRooms) warnings.push("Working room utilization is unavailable: average session pace does not establish dated room-use assignments.");
    const utilization = ratio(sessions, capacity);
    let revenue = 0,
      clinicianPay = 0,
      employerBurden = 0,
      ownerClinicalPay = 0,
      familyGrossPay = 0;
    let coOwnerSalaryPretax: number | null = null;
    const goalMeasureDaily: Record<string, Values> = Object.fromEntries(
      datesIn(start, end).map((date) => [
        date,
        {
          activeClinicalHeadcount: activeClinicalHeadcountAt(
            workspace,
            context,
            date,
            options.workingForecast,
          ),
          coOwnerSalaryPretax: null,
        },
      ]),
    );
    const clinicianValues: Record<string, Values> = {};
    const serviceDaily = new Map<string, { sessions: number; revenue: number }>();
    for (const c of people) {
      const count = allocation.assigned.get(c.instance) ?? 0;
      let pay = 0,
        earned = 0;
      let personPayUnknown = false;
      for (const day of c.daily) {
        const dayCount =
          options.workingForecast ? (options.baselineWeeklyByClinician?.[c.id] ?? 0) / 7 : c.capacity > 0 ? (count * day.capacity) / c.capacity : 0;
        const importedFee = options.useImportedBillingActuals !== false && c.instance === String(c.id)
          ? importedBilling.get(c.id)?.get(day.date) : undefined;
        const replacementCount = importedBillingSource.replacementSessions.get(c.id)?.get(day.date);
        const needsProof = importedFee !== undefined && (options.workingForecast || importedBillingSource.requiresProof.has(`${c.id}|${day.date}`));
        const rejectedReplacement = needsProof && (replacementCount === undefined || Math.abs(replacementCount - dayCount) > 1e-8);
        if (rejectedReplacement) {
          unknownBilling = true;
          importedBillingSource.unknownDates.push({ clinicianId: c.id, date: day.date });
          warnings.push("Partial or unverified treatment-day billing cannot replace the whole modeled day; revenue and percentage compensation are unknown until complete matching evidence is supplied.");
        }
        const unknownDayBilling = options.useImportedBillingActuals !== false && importedBillingSource.unknownDates.some((row) => row.clinicianId === c.id && row.date === day.date);
        const splitSensitive = day.split > 0 || (c.capEnabled && c.postCapClinicianSplit > 0);
        const splitUnknown = day.mode === "existing_split" && splitSensitive && (unknownDayBilling || unknownCapKeys.has(c.capKey));
        if (splitUnknown) {
          personPayUnknown = true;
          unknownCompensation = true;
          if (c.capEnabled && c.capAmount > 0) unknownCapKeys.add(c.capKey);
        }
        // Only accepted matching charges can establish percentage pay and cap progress.
        const compensationRate = importedFee !== undefined && !unknownDayBilling && dayCount > 0 ? importedFee / dayCount
          : options.workingForecast ? day.cardRate : day.rate;
        const remaining = Math.max(0, c.capAmount - (capEarned[c.capKey] ?? 0));
        const afterCap = c.capEnabled && c.capAmount > 0 && remaining === 0;
        const calculated = calculateClinicianMetrics({
          ...c,
          sessionRate: compensationRate,
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
        if (day.mode === "existing_split" && !splitUnknown)
          capEarned[c.capKey] =
            (capEarned[c.capKey] ?? 0) +
            (calculated.preCapSessions * compensationRate * (100 - day.split)) / 100;
        pay +=
          day.mode === "salary"
            ? day.amount / 12 / calendarDays
            : day.mode === "hourly"
              ? ((day.amount * day.paidHoursPerWeek) / 7) *
                (c.weeksWorkedPerYear / 52.1786)
              : day.mode === "per_session"
                ? day.amount * dayCount
                : calculated.clinicianCompensation;
        if (
          c.id === settings.familyW2ClinicianId &&
          c.instance === String(c.id) &&
          day.mode === "salary"
        ) {
          const salary = day.amount / 12 / calendarDays;
          coOwnerSalaryPretax = (coOwnerSalaryPretax ?? 0) + salary;
          goalMeasureDaily[day.date].coOwnerSalaryPretax = salary;
        }
        const dayRevenue = importedFee ?? dayCount * (options.workingForecast ? day.cardRate : day.rate);
        earned += dayRevenue;
        const totals = serviceDaily.get(day.date) ?? { sessions: 0, revenue: 0 };
        serviceDaily.set(day.date, { sessions: totals.sessions + dayCount, revenue: totals.revenue + dayRevenue });
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
      if (c.id === settings.familyW2ClinicianId && c.instance === String(c.id))
        familyGrossPay += pay;
      clinicianValues[c.instance] = calculateCustomKpis(
        workspace,
        {
          sessions: count,
          capacity: c.capacity,
          utilization: (ratio(count, c.capacity) ?? 0) * 100,
          revenue: options.useImportedBillingActuals !== false && importedBillingSource.unknownDates.some((row) => row.clinicianId === c.id && row.date >= start && row.date <= end) ? null : earned,
          clinicianPay: personPayUnknown ? null : pay,
          employerBurden: personPayUnknown ? null : burden,
          profit: personPayUnknown || (options.useImportedBillingActuals !== false && importedBillingSource.unknownDates.some((row) => row.clinicianId === c.id && row.date >= start && row.date <= end)) ? null : earned - pay - burden,
        },
        end,
      );
    }
    const priorMonthDate = monthDate(calendarStart, -setting.collectionDelayMonths);
    const priorMonth = results.find((month) => monthDate(month.date) === priorMonthDate);
    const priorFullMonthKnown = priorMonth !== undefined && priorMonth.date === priorMonthDate &&
      (priorMonth.periodEnd ?? monthEnd(priorMonth.date)) === monthEnd(priorMonthDate) && priorMonth.values.revenue !== null;
    const missingPriorWorkingReceipts = !!workingRange && setting.collectionDelayMonths > 0 && (!priorFullMonthKnown || days !== calendarDays);
    const collectedRevenue = (amount: number) =>
      (amount * setting.collectionPct) / 100;
    const collections =
      setting.collectionDelayMonths === 0
        ? collectedRevenue(revenue)
        : priorMonth
          ? collectedRevenue(priorMonth.values.revenue ?? 0)
          : m === 0
            ? setting.openingReceivables
            : 0;
    let overhead = effective.reduce(
        (n, e) =>
          n +
          (e.monthlyCost *
            activeDays({ start: e.date, end: e.end }, start, end)) /
            calendarDays,
        0,
      ),
      additionalIncome = 0,
      explicitTax = 0,
      explicitReserves = 0,
      explicitOwner = 0,
      detailedOverhead = 0;
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
            budgetAmount(line, date, date, workingRange ? serviceDaily.get(date)?.sessions ?? 0 : sessions / days, workingRange ? serviceDaily.get(date)?.revenue ?? 0 : revenue / days)
          );
        }, 0);
      } else if (workingRange) {
        amount = datesIn(start, end).reduce((sum, date) => {
          const daily = serviceDaily.get(date);
          const line = { ...b, amount: datedValue(b.amount, changes, date, date) };
          return sum + budgetAmount(line, date, date, daily?.sessions ?? 0, daily?.revenue ?? 0);
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
      else {
        overhead += amount;
        detailedOverhead += amount;
      }
    }
    const monthFraction = days / daysInclusive(monthDate(start), monthEnd(start));
    const overheadAllowance = overheadGoalAllowance(setting, revenue, monthFraction) ??
      (setting.overheadFloorMonthly * days) / daysInclusive(monthDate(start), monthEnd(start));
    overhead += Math.max(0, overheadAllowance - detailedOverhead);
    const oneTime = events
      .filter((e) => e.enabled && e.date >= start && e.date <= end)
      .reduce((n, e) => n + e.oneTimeCost, 0);
    overhead += oneTime;
    const staffCost = staff.reduce(
      (n, s) => n + staffCostForRange(workspace, s, start, end),
      0,
    );
    const ownerPayroll = setting.ownerPayrollMonthly * monthFraction + explicitOwner;
    const ownerBurden = (ownerPayroll * setting.ownerPayrollBurdenPct) / 100;
    const chargedSessions =
      setting.collectionDelayMonths === 0
        ? sessions
        : priorMonth
          ? (priorMonth.values.sessions ?? 0)
          : 0;
    const fees =
      (collections * setting.processingPct) / 100 +
      chargedSessions *
        (setting.collectionPct / 100) *
        setting.processingTransactionsPerSession *
        setting.processingFixedPerTransaction +
      (m === 0 && setting.collectionDelayMonths > 0
        ? setting.processingOpeningTransactions *
          setting.processingFixedPerTransaction
        : 0);
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
    const { buckets, configured, maxDailyPercent } = cashAllocationsForRange(
      workspace.allocations, basis, start, end,
    );
    if (maxDailyPercent > 100)
      warnings.push(
        "Active cash allocations exceed 100%; distributions are capped at available cash.",
      );
    let taxReserve = configured
      ? buckets
          .filter((b) => b.kind === "tax")
          .reduce((n, b) => n + b.amount, 0)
      : (basis * setting.taxPct) / 100;
    let reserves = configured
      ? buckets
          .filter((b) => b.kind === "reserve")
          .reduce((n, b) => n + b.amount, 0)
      : (basis * setting.reservePct) / 100;
    let distributions = configured
      ? buckets
          .filter((b) => b.kind === "distribution")
          .reduce((n, b) => n + b.amount, 0)
      : (basis * setting.distributionPct) / 100;
    taxReserve += explicitTax;
    reserves += explicitReserves;
    distributions = Math.min(
      distributions,
      Math.max(0, basis - taxReserve - reserves),
    );
    const retainedCash = cashProfit - taxReserve - reserves - distributions;
    cash += retainedCash;
    const ownerDistributionBuckets = buckets.filter(
      (bucket) => bucket.kind === "distribution" && bucket.household,
    );
    const distributionAmountTotal = buckets
      .filter((bucket) => bucket.kind === "distribution")
      .reduce((sum, bucket) => sum + bucket.amount, 0);
    const ownerDistributionsPretax =
      ownerDistributionBuckets.length > 0
        ? distributions *
          (ratio(
            ownerDistributionBuckets.reduce(
              (sum, bucket) => sum + bucket.amount,
              0,
            ),
            distributionAmountTotal,
          ) ?? 0)
        : null;
    const familyDistribution =
      configured ? ownerDistributionsPretax ?? 0 : distributions;
    const familyTakeHome =
      settings.familyW2ClinicianId !== null
        ? estimateW2NetPay(familyGrossPay, settings.estimatedIncomeTaxPct).net +
          familyDistribution
        : ownerPayroll +
          (setting.includeOwnerClinical ? ownerClinicalPay : 0) +
          familyDistribution;
    const contributionPerSession = ratio(
      revenue - clinicianPay - employerBurden - fees,
      sessions,
    );
    const revenuePerSession = ratio(revenue, sessions) ?? 0;
    let values = calculateCustomKpis(
      workspace,
      {
        sessions,
        activeClinicalHeadcount: activeClinicalHeadcountAt(
          workspace,
          context,
          end,
          options.workingForecast,
        ),
        ownerDistributionsPretax,
        coOwnerSalaryPretax,
        capacity,
        utilization: utilization === null ? null : utilization * 100,
        unservedSessions: Math.max(0, demand - sessions),
        roomCapacity: anyRooms ? roomCapacity : null,
        roomUtilization: options.workingForecast ? null : anyRooms
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
    if (unknownStaff.length) for (const key of ["staffCost", "profit", "taxReserve", "reserves", "distributions", "retainedCash", "cash", "familyTakeHome", "ownerDistributionsPretax", "breakEvenSessions", "runway"]) values[key] = null;
    const unknownCollections = setting.collectionDelayMonths === 0 ? unknownBilling : missingPriorWorkingReceipts || priorMonth?.values.revenue === null;
    if (missingPriorWorkingReceipts) warnings.push("Delayed collections are unknown: this working range lacks prior complete calendar-month revenue or exact within-month receipt timing.");
    if (options.workingForecast) for (const key of ["roas", "contributionRoas", "netRoi"]) values[key] = null;
    if (unknownBilling) for (const key of ["revenue", "profit", "ltv", "roas", "contributionRoas", "netRoi", "breakEvenSessions"]) values[key] = null;
    if (unknownCompensation) {
      warnings.push("Percentage compensation or prior cap progress is unknown because matching billed charges were rejected; fixed salary/hourly/session terms remain independent.");
      for (const key of ["clinicianPay", "employerBurden", "ownerClinicalPay", "profit", "contributionPerSession", "contributionRoas", "netRoi", "breakEvenSessions", "taxReserve", "reserves", "distributions", "retainedCash", "familyTakeHome", "ownerDistributionsPretax"]) values[key] = null;
    }
    if (unknownCollections) {
      values.collections = null;
      if (setting.processingPct > 0 || (missingPriorWorkingReceipts && setting.processingFixedPerTransaction > 0)) for (const key of ["fees", "profit", "netRoi", "contributionRoas", "breakEvenSessions"]) values[key] = null;
    }
    if (unknownCollections || unknownStaff.length) for (const key of ["taxReserve", "reserves", "distributions", "retainedCash", "familyTakeHome", "ownerDistributionsPretax"]) values[key] = null;
    cashKnown = cashKnown && !unknownCollections && !unknownCompensation && unknownStaff.length === 0;
    if (!cashKnown) { values.cash = null; values.runway = null; }
    for (const kpi of workspace.kpis) delete values[kpi.key];
    values = calculateCustomKpis(workspace, values, end);
    const constraint = !cashKnown ? "Cash balance unknown" : options.workingForecast ? "Working history average" :
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
      activeClinicalHeadcount:
        "Selected-team clinical roster count at period end, including owners. Dated active status is required when configured; planning records and simulated hire instances are excluded.",
      ownerDistributionsPretax:
        "Cash distributions attributable to household-marked owner distribution allocations, before personal income tax. Excludes clinical compensation and salary; missing owner allocation attribution remains unknown.",
      coOwnerSalaryPretax:
        "Fixed gross salary for settings.familyW2ClinicianId only, using active dates and effective salary-mode terms. Excludes split/hourly/session compensation and personal tax estimates; absent salary attribution remains unknown.",
      sessions: options.workingForecast ? "Working average: each current clinician's available sessions in the rolling three-month window divided by calendar weeks, including quiet weeks. No vacation, full-caseload, room-capacity or acquisition adjustment." : `Demand ${demand.toFixed(1)} allocated across clinician capacity ${capacity.toFixed(1)}, capped by assigned rooms and locations (usable capacity ${Number.isFinite(roomLimit) ? roomLimit.toFixed(1) : "unverified / telehealth"}). Telehealth consumes a room only where configured. Historical baseline is retained separately from new-client cohorts.`,
      revenue:
        "Billed session income from imported charged fees where available, otherwise clinician sessions x effective session rate. Not collected cash.",
      collections: `Estimated cash collected from billed session income after applying the paid-portion assumption and ${setting.collectionDelayMonths} month(s) delay, plus opening receivables in month one when a delay applies.`,
      clinicianPay:
        "Existing compensation function with annual cap progression, effective terms and non-clinical pay; configured salary/hourly/session overrides apply.",
      overhead:
        setting.overheadGoalBasis === "fixed_percent"
          ? `Operating budget lines count toward the fixed ${setting.overheadGoalPercent}% of matching-period billed clinical revenue allowance; one-time events and hire support are additional. Marketing and staff payroll are separate.`
          : "Operating budget lines plus any remaining compensation-plan overhead allowance, one-time events and hire support. Marketing and staff payroll are separate.",
      profit:
        "Billed session income + other income - clinician pay - employer burden - staff cost - overhead - marketing - fees - owner payroll/burden.",
      familyTakeHome:
        "Selected W2 clinician gross pay less estimated employee Social Security, Medicare and other withholding or deductions, plus family distributions. Employer payroll costs are already in practice profit. This is an estimate, not a paycheck record.",
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
        "Usable hours in each active room x 60 / session minutes. Dedicated ownership, recurring shared blocks, clinician availability and location limits constrain access.",
      roomUtilization: options.workingForecast
        ? "Unknown: average working session pace does not establish dated room-use assignments. Configured room capacity remains a separate diagnostic."
        : "Room slots consumed, including configured telehealth occupancy, divided by usable room slots.",
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
      fees: "Cash collections x processing percentage plus estimated successful payments x fixed fee. Payments default to completed sessions times the configured payments-per-session factor.",
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
      ...(workingRange ? { periodStart: start, periodEnd: end } : {}),
      values,
      goalMeasureDaily,
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
      options,
    );
    results.forEach((month, index) => {
      const baseline = withoutMarketing[index].values;
      const spend = month.values.marketing ?? 0;
      const increment = month.values.profit === null || baseline.profit === null ? null : (month.values.profit ?? 0) - (baseline.profit ?? 0);
      month.values.roas = options.workingForecast || month.values.collections === null || baseline.collections === null ? null : ratio((month.values.collections ?? 0) - (baseline.collections ?? 0), month.values.adSpend ?? 0);
      month.values.contributionRoas = options.workingForecast || increment === null ? null : ratio(increment + spend, month.values.adSpend ?? 0);
      month.values.netRoi = options.workingForecast || increment === null ? null : spend > 0 ? (increment / spend) * 100 : null;
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
  const ownerDistribution = sum("ownerDistributionsPretax");
  const householdAttributionRequired =
    periods.some((period) => period.ownerDistributionsPretax !== null) ||
    workspace.allocations.some((bucket) => active(bucket, start, end));
  const familyDistribution = householdAttributionRequired
    ? ownerDistribution ?? (distribution === 0 ? 0 : null)
    : distribution;
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
      activeClinicalHeadcount: activeClinicalHeadcountAt(
        workspace,
        context,
        end,
      ),
      ownerDistributionsPretax: ownerDistribution,
      coOwnerSalaryPretax: sum("coOwnerSalaryPretax"),
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
        familyDistribution !== null &&
        (!workspace.settings.includeOwnerClinical || ownerClinical !== null)
          ? owner +
            familyDistribution +
            (workspace.settings.includeOwnerClinical ? ownerClinical! : 0)
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
    "activeClinicalHeadcount",
    "ownerDistributionsPretax",
    "coOwnerSalaryPretax",
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
  const end = periods.reduce(
    (latest, period) => (period.end > latest ? period.end : latest),
    periods[0].end,
  );
  const lastMonth = months.find(
    (month) => month.date <= end && monthEnd(month.date) >= end,
  );
  result.activeClinicalHeadcount = covered
    ? (lastMonth?.goalMeasureDaily?.[end]?.activeClinicalHeadcount ??
      lastMonth?.values.activeClinicalHeadcount ??
      null)
    : null;
  if (
    covered &&
    slices.every((slice) => slice.m.goalMeasureDaily !== undefined)
  ) {
    const dailySalary = periods
      .flatMap((period) => datesIn(period.start, period.end))
      .map(
        (date) =>
          months.find(
            (month) => month.date <= date && monthEnd(month.date) >= date,
          )?.goalMeasureDaily?.[date]?.coOwnerSalaryPretax ?? null,
      );
    result.coOwnerSalaryPretax = dailySalary.every((salary) => salary === null)
      ? null
      : dailySalary.reduce<number>((sum, salary) => sum + (salary ?? 0), 0);
  }
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
    ? selected.reduce((n, c) => n + c.sessionRate, 0) / selected.length
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
    const keep = workspace.settings.distributionPct / 100;
    required =
      keep > 0 && margin > 0
        ? (Math.max(0, target - (v.ownerPayroll ?? 0)) / keep + fixed) / margin
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
    estimate && estimate.spend > 0 && estimate.clients !== null
      ? estimate.clients / estimate.spend
      : 0;
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
      estimate.clients !== null &&
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
        availability: [],
        payAmount: 0,
        paidHoursPerWeek: 0,
        payMode: "existing_split" as const,
        expectedSessionRevenue: null,
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
