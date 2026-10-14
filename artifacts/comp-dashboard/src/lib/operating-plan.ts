import { datedValue, eventSchema, forecast, monthEnd, type Context, type ForecastMonth, type Workspace } from "@workspace/practice/hub";

export type OperatingPlanSummary = {
  month: string;
  weeks: number;
  sessions: number | null;
  weeklySessions: number | null;
  sessionCapacity: number | null;
  estimatedRevenue: number | null;
  clinicianCompensation: number;
  operatingExpense: number;
  otherIncome: number | null;
  marketingCost: number;
  estimatedProfit: number | null;
  targetProfit: number;
  profitGap: number | null;
  contributionPerSession: number | null;
  sessionsToCloseGap: number | null;
  activeClients: number | null;
  sessionsPerClientMonth: number;
  monthlyAttritionPct: number;
  leadToClientRate: number | null;
  replacementClients: number | null;
  fillClients: number | null;
  fillHorizonMonths: number;
  clientsNeeded: number | null;
  leadsNeeded: number | null;
  consultsNeeded: number | null;
  attendedConsultsNeeded: number | null;
  leadRateSource: "recorded" | "campaign" | null;
  warnings: string[];
};

export type OperatingScenarioDelta = {
  revenue: number | null;
  profit: number | null;
  addedCapacitySessions: number | null;
  addedClientsPerMonth: number | null;
  addedLeadsPerMonth: number | null;
};

export function compareOperatingPlans(
  baseline: OperatingPlanSummary | null,
  scenario: OperatingPlanSummary | null,
): OperatingScenarioDelta | null {
  if (!baseline || !scenario || baseline.month !== scenario.month) return null;
  const addedCapacitySessions = baseline.sessionCapacity === null || scenario.sessionCapacity === null
    ? null : Math.max(0, scenario.sessionCapacity - baseline.sessionCapacity);
  const addedClientsPerMonth = addedCapacitySessions === null || scenario.sessionsPerClientMonth <= 0 || scenario.fillHorizonMonths <= 0
    ? null : addedCapacitySessions / scenario.sessionsPerClientMonth / scenario.fillHorizonMonths;
  return {
    revenue: baseline.estimatedRevenue === null || scenario.estimatedRevenue === null
      ? null : scenario.estimatedRevenue - baseline.estimatedRevenue,
    profit: baseline.estimatedProfit === null || scenario.estimatedProfit === null
      ? null : scenario.estimatedProfit - baseline.estimatedProfit,
    addedCapacitySessions,
    addedClientsPerMonth,
    addedLeadsPerMonth: addedClientsPerMonth === null || scenario.leadToClientRate === null || scenario.leadToClientRate <= 0
      ? null : Math.ceil(addedClientsPerMonth / scenario.leadToClientRate),
  };
}

const monthDays = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

const ratio = (numerator: number | null | undefined, denominator: number | null | undefined) =>
  denominator && denominator > 0 && numerator !== null && numerator !== undefined
    ? numerator / denominator
    : null;

const validRate = (value: number | null) =>
  value !== null && value >= 0 && value <= 1 ? value : null;

function recordedRates(workspace: Workspace, before: string, asOf: string) {
  const recent = workspace.periods
    .filter((period) => !period.archived && period.end < before && period.end < asOf)
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, 6)
    .flatMap((period) => {
      const rows = workspace.funnels.filter((row) => row.periodId === period.id);
      if (!rows.length || rows.some((row) => row.leads === null || row.clients === null)) return [];
      return [{
        leads: rows.reduce((sum, row) => sum + (row.leads ?? 0), 0),
        clients: rows.reduce((sum, row) => sum + (row.clients ?? 0), 0),
        scheduled: rows.every((row) => row.scheduled !== null)
          ? rows.reduce((sum, row) => sum + (row.scheduled ?? 0), 0) : null,
        attended: rows.every((row) => row.attended !== null)
          ? rows.reduce((sum, row) => sum + (row.attended ?? 0), 0) : null,
      }];
    });
  if (recent.length < 3) return null;
  const leads = recent.reduce((sum, row) => sum + row.leads, 0);
  const clients = recent.reduce((sum, row) => sum + row.clients, 0);
  const withSchedule = recent.filter((row) => row.scheduled !== null);
  const withAttendance = withSchedule.filter((row) => row.attended !== null);
  return {
    leadToClient: validRate(ratio(clients, leads)),
    leadToConsult: withSchedule.length >= 3
      ? validRate(ratio(
          withSchedule.reduce((sum, row) => sum + (row.scheduled ?? 0), 0),
          withSchedule.reduce((sum, row) => sum + row.leads, 0),
        )) : null,
    consultAttendance: withAttendance.length >= 3
      ? validRate(ratio(
          withAttendance.reduce((sum, row) => sum + (row.attended ?? 0), 0),
          withAttendance.reduce((sum, row) => sum + (row.scheduled ?? 0), 0),
        )) : null,
  };
}

function campaignRates(workspace: Workspace, month: ForecastMonth) {
  const channels = Object.entries(month.channels);
  if (!channels.length || channels.some(([, channel]) =>
    channel.leads === null || channel.consultations === null || channel.clients === null)) return null;
  if (channels.some(([id]) => {
    const campaign = workspace.campaigns.find((item) => item.id === id);
    return !campaign || campaign.attendancePct === null;
  })) return null;
  const leads = channels.reduce((sum, [, channel]) => sum + (channel.leads ?? 0), 0);
  const scheduled = channels.reduce((sum, [, channel]) => sum + (channel.consultations ?? 0), 0);
  const clients = channels.reduce((sum, [, channel]) => sum + (channel.clients ?? 0), 0);
  const attended = channels.reduce((sum, [id, channel]) => {
    const campaign = workspace.campaigns.find((item) => item.id === id);
    return sum + (channel.consultations ?? 0) * campaign!.attendancePct! / 100;
  }, 0);
  return {
    leadToClient: validRate(ratio(clients, leads)),
    leadToConsult: validRate(ratio(scheduled, leads)),
    consultAttendance: validRate(ratio(attended, scheduled)),
  };
}

function incrementalSessionNeed(workspace: Workspace, month: ForecastMonth, context: Context | undefined, gap: number | null) {
  const unknown = (warning: string) => ({ contribution: null, sessions: null, warnings: [warning] });
  if (gap === 0) return { contribution: null, sessions: 0, warnings: [] };
  if (gap === null) return unknown("Incremental session need is unknown because current profit is unavailable.");
  if (!context) return unknown("Incremental session need requires clinician context to model fixed pay, variable costs and cap transitions.");
  const index = (Number(month.date.slice(0, 4)) - Number(workspace.settings.forecastStart.slice(0, 4))) * 12
    + Number(month.date.slice(5, 7)) - Number(workspace.settings.forecastStart.slice(5, 7));
  if (index < 0 || index >= 60 || !month.date.endsWith("-01"))
    return unknown("Incremental session need requires a complete month within the configured forecast.");
  const copy = structuredClone({ workspace, context });
  copy.workspace.settings.horizonMonths = index + 1;
  const evaluateBase = () => forecast(copy.workspace, copy.context, [], 1, false)[index];
  const base = evaluateBase();
  const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  if (!base || !numeric(base.values.sessions) || !numeric(base.values.profit) || !numeric(base.values.capacity)
    || !numeric(month.values.sessions) || !numeric(month.values.profit)
    || Math.abs(base.values.sessions - month.values.sessions) > 1e-6
    || Math.abs(base.values.profit - month.values.profit) > 1e-6)
    return unknown("Selected-month totals do not reconcile with the supplied forecast context; incremental economics are unknown.");
  if (base.warnings.some((warning) => /missing|unknown|incomplete|unavailable|unverified|not found|choose|must be/i.test(warning)))
    return unknown("Forecast inputs are incomplete; fallback assumptions cannot establish incremental session need.");
  const unit = workspace.settings.sessionsPerClientMonth * workspace.settings.attendancePct / 100;
  if (!numeric(unit) || unit <= 0)
    return unknown("A positive configured sessions-per-client and attendance assumption is needed to test incremental demand.");
  const end = monthEnd(month.date);
  const days = monthDays(month.date);
  const organicAtEnd = datedValue(workspace.settings.organicClientsPerMonth,
    workspace.events.filter((event) => event.enabled && event.field === "assumption.organic")
      .map((event) => ({ date: event.date, end: event.end, value: event.value })), end, end);
  let eventId = "00000000-0000-4000-8000-000000000000";
  for (let suffix = 1; workspace.events.some((event) => event.id === eventId); suffix++)
    eventId = `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
  const evaluate = (addedDemand: number) => {
    // A transient end-of-month acquisition adjustment changes this month's demand
    // while retaining all preceding months, including earned cap contributions.
    // The engine averages organic assumptions across days, hence the days factor.
    const event = eventSchema.safeParse({
      id: eventId, name: "Incremental session calculation", date: end, end,
      field: "assumption.organic", value: organicAtEnd + addedDemand * days / unit,
    });
    if (!event.success) return undefined;
    return forecast(copy.workspace, copy.context, [event.data], 1, false)[index];
  };
  const first = evaluate(1);
  if (!numeric(first?.values.sessions) || !numeric(first?.values.profit))
    return unknown("Incremental forecast values are unavailable.");
  const firstSessions = first.values.sessions - base.values.sessions;
  const contribution = firstSessions > 1e-8 ? (first.values.profit - base.values.profit) / firstSessions : null;
  if (base.values.capacity <= base.values.sessions + 1e-8)
    return { contribution, sessions: null, warnings: ["The profit goal cannot be tested above current clinician capacity."] };
  const target = base.values.profit + gap;
  let low = 0, high = Math.max(1, base.values.capacity - base.values.sessions);
  let upper = evaluate(high);
  if (!upper) return unknown("Incremental demand exceeds the supported forecast input range.");
  // Extra demand is bounded by engine capacity. A plateau cannot establish an
  // uncapped requirement, so report unknown rather than extrapolating average cost.
  for (let step = 0; step < 12 && numeric(upper.values.profit) && upper.values.profit < target - 1e-8; step++) {
    const next = evaluate(high * 2);
    if (!next || !numeric(next.values.profit) || next.values.profit < upper.values.profit - 1e-8)
      return unknown("Incremental profit decreases or becomes unavailable; a session minimum cannot be established.");
    if (numeric(next.values.sessions) && numeric(upper.values.sessions)
      && Math.abs(next.values.sessions - upper.values.sessions) < 1e-8
      && Math.abs(next.values.profit - upper.values.profit) < 1e-8) break;
    high *= 2;
    upper = next;
  }
  if (!numeric(upper.values.profit) || !numeric(upper.values.sessions)) return unknown("Incremental forecast values are unavailable.");
  if (upper.values.profit < target - 1e-8)
    return { contribution, sessions: null, warnings: ["The profit goal cannot be reached within configured clinician and room capacity."] };
  for (let step = 0; step < 32; step++) {
    const middle = (low + high) / 2;
    const candidate = evaluate(middle);
    if (!candidate || !numeric(candidate.values.profit) || !numeric(candidate.values.sessions)) return unknown("Incremental forecast values are unavailable.");
    if (candidate.values.profit + 1e-8 >= target) { high = middle; upper = candidate; }
    else low = middle;
  }
  const delivered = upper.values.sessions;
  if (!numeric(delivered)) return unknown("Incremental forecast session volume is unavailable.");
  return { contribution, sessions: Math.ceil(Math.max(0, delivered - base.values.sessions) - 1e-7), warnings: [] };
}

export function summarizeOperatingPlan(
  workspace: Workspace,
  month: ForecastMonth | undefined,
  fillHorizonMonths = 6,
  asOf = new Date().toISOString().slice(0, 10),
  context?: Context,
): OperatingPlanSummary | null {
  if (!month) return null;
  const values = month.values;
  const weeks = monthDays(month.date) / 7;
  const sessions = values.sessions ?? null;
  const estimatedRevenue = values.revenue ?? null;
  const clinicianCompensation = (values.clinicianPay ?? 0) + (values.employerBurden ?? 0);
  const operatingExpense =
    (values.staffCost ?? 0) +
    (values.overhead ?? 0) +
    (values.marketing ?? 0) +
    (values.fees ?? 0) +
    (values.ownerPayroll ?? 0) * (1 + workspace.settings.ownerPayrollBurdenPct / 100);
  const estimatedProfit = values.profit ?? null;
  const otherIncome = estimatedProfit === null || estimatedRevenue === null
    ? null : estimatedProfit - estimatedRevenue + clinicianCompensation + operatingExpense;
  const targetProfit = workspace.settings.targetProfitMonthly;
  const profitGap = estimatedProfit === null ? null : Math.max(0, targetProfit - estimatedProfit);
  const incremental = incrementalSessionNeed(workspace, month, context, profitGap);
  const contributionPerSession = incremental.contribution;
  const sessionsToCloseGap = incremental.sessions;
  const sessionsPerClientMonth = workspace.settings.sessionsPerClientMonth;
  const activeClients =
    sessions !== null && sessionsPerClientMonth > 0 ? sessions / sessionsPerClientMonth : null;
  const attritionRate = 1 - workspace.settings.baselineRetentionPct / 100;
  const replacementClients = activeClients === null ? null : activeClients * attritionRate;
  const sessionCapacity = values.capacity ?? null;
  const fillSessions =
    sessionCapacity !== null && sessions !== null ? Math.max(0, sessionCapacity - sessions) : null;
  const fillClients =
    fillSessions !== null && sessionsPerClientMonth > 0 && fillHorizonMonths > 0
      ? fillSessions / sessionsPerClientMonth / fillHorizonMonths : null;
  const clientsNeeded =
    replacementClients === null && fillClients === null
      ? null
      : (replacementClients ?? 0) + (fillClients ?? 0);
  const observed = recordedRates(workspace, month.date, asOf);
  const campaign = campaignRates(workspace, month);
  const leadToClientRate = observed?.leadToClient ?? campaign?.leadToClient ?? null;
  const leadToConsultRate = observed?.leadToConsult ?? campaign?.leadToConsult ?? null;
  const consultAttendanceRate = observed?.consultAttendance ?? campaign?.consultAttendance ?? null;
  const leadRateSource = observed?.leadToClient !== null && observed?.leadToClient !== undefined
    ? "recorded" : campaign?.leadToClient !== null && campaign?.leadToClient !== undefined
      ? "campaign" : null;
  const leadsNeeded =
    clientsNeeded !== null && leadToClientRate && leadToClientRate > 0
      ? Math.ceil(clientsNeeded / leadToClientRate)
      : null;
  const consultsNeeded =
    leadsNeeded !== null && leadToConsultRate !== null
      ? Math.ceil(leadsNeeded * leadToConsultRate)
      : null;
  const attendedConsultsNeeded =
    consultsNeeded !== null && consultAttendanceRate !== null
      ? Math.ceil(consultsNeeded * consultAttendanceRate)
      : null;

  const warnings = [...incremental.warnings];
  if (estimatedRevenue === null) warnings.push("Estimated revenue needs session volume and rates.");
  if (leadToClientRate === null) warnings.push("Lead requirements need campaign assumptions or recorded lead/client results.");
  if (leadToClientRate === 0) warnings.push("Recorded results show no booked clients from leads; leads needed cannot be estimated from a zero conversion rate.");
  if (sessionsPerClientMonth <= 0) warnings.push("Active clients need a sessions-per-client-month assumption.");
  if (sessionsToCloseGap !== null && fillSessions !== null && sessionsToCloseGap > fillSessions)
    warnings.push("Closing the profit gap would require more sessions than current clinician capacity allows.");
  if (!workspace.campaigns.some((campaign) => !campaign.archived))
    warnings.push("No active lead source is configured; Other/manual sources can still be entered in Lead flow.");

  return {
    month: month.date,
    weeks,
    sessions,
    weeklySessions: sessions === null ? null : sessions / weeks,
    sessionCapacity,
    estimatedRevenue,
    clinicianCompensation,
    operatingExpense,
    otherIncome,
    marketingCost: values.marketing ?? 0,
    estimatedProfit,
    targetProfit,
    profitGap,
    contributionPerSession,
    sessionsToCloseGap,
    activeClients,
    sessionsPerClientMonth,
    monthlyAttritionPct: attritionRate * 100,
    leadToClientRate,
    replacementClients,
    fillClients,
    fillHorizonMonths,
    clientsNeeded,
    leadsNeeded,
    consultsNeeded,
    attendedConsultsNeeded,
    leadRateSource,
    warnings,
  };
}
