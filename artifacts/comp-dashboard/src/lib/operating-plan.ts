import type { ForecastMonth, Workspace } from "@workspace/practice/hub";

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
    channel.leads === null || channel.consultations === null)) return null;
  const leads = channels.reduce((sum, [, channel]) => sum + (channel.leads ?? 0), 0);
  const scheduled = channels.reduce((sum, [, channel]) => sum + (channel.consultations ?? 0), 0);
  const clients = channels.reduce((sum, [, channel]) => sum + channel.clients, 0);
  const attended = channels.reduce((sum, [id, channel]) => {
    const campaign = workspace.campaigns.find((item) => item.id === id);
    return sum + (channel.consultations ?? 0) * (campaign?.attendancePct ?? 0) / 100;
  }, 0);
  return {
    leadToClient: validRate(ratio(clients, leads)),
    leadToConsult: validRate(ratio(scheduled, leads)),
    consultAttendance: validRate(ratio(attended, scheduled)),
  };
}

export function summarizeOperatingPlan(
  workspace: Workspace,
  month: ForecastMonth | undefined,
  fillHorizonMonths = 6,
  asOf = new Date().toISOString().slice(0, 10),
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
  const contributionPerSession =
    estimatedRevenue === null
      ? null
      : ratio(estimatedRevenue - clinicianCompensation - (values.fees ?? 0), sessions);
  const sessionsToCloseGap =
    profitGap !== null && contributionPerSession && contributionPerSession > 0
      ? Math.ceil(profitGap / contributionPerSession)
      : null;
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

  const warnings = [];
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
