import type { Context, ForecastMonth, Workspace } from "@workspace/practice/hub";

export type OperatingPlanSummary = {
  month: string;
  weeks: number;
  sessions: number | null;
  weeklySessions: number | null;
  sessionCapacity: number | null;
  estimatedRevenue: number | null;
  clinicianCompensation: number;
  operatingExpense: number;
  marketingCost: number;
  estimatedProfit: number | null;
  targetProfit: number;
  profitGap: number | null;
  contributionPerSession: number | null;
  sessionsToCloseGap: number | null;
  activeClients: number | null;
  sessionsPerClientMonth: number;
  leadToClientRate: number | null;
  replacementClients: number | null;
  fillClients: number | null;
  clientsNeeded: number | null;
  leadsNeeded: number | null;
  consultsNeeded: number | null;
  attendedConsultsNeeded: number | null;
  hire: {
    name: string;
    targetWeeklySessions: number;
    rampWeeklySessions: number;
    monthlySessions: number;
    estimatedRevenue: number | null;
    payAndAddedCost: number | null;
    contribution: number | null;
  } | null;
  warnings: string[];
};

const monthDays = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

const rateFromCampaigns = (
  campaigns: Workspace["campaigns"],
  key: "leadToClient" | "leadToConsult" | "consultAttendance",
) => {
  const active = campaigns.filter((campaign) => !campaign.archived);
  if (!active.length) return null;
  const values = active.map((campaign) => {
    if (key === "leadToClient")
      return campaign.consultationPct / 100 * campaign.attendancePct / 100 * campaign.closePct / 100;
    if (key === "leadToConsult") return campaign.consultationPct / 100;
    return campaign.attendancePct / 100;
  });
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const ratio = (numerator: number | null | undefined, denominator: number | null | undefined) =>
  denominator && denominator > 0 && numerator !== null && numerator !== undefined
    ? numerator / denominator
    : null;

export function summarizeOperatingPlan(
  workspace: Workspace,
  context: Context,
  month: ForecastMonth | undefined,
): OperatingPlanSummary | null {
  if (!month) return null;
  const values = month.values;
  const weeks = monthDays(month.date) / 7;
  const sessions = values.sessions ?? null;
  const estimatedRevenue = values.revenue ?? null;
  const clinicianCompensation = (values.clinicianPay ?? 0) + (values.employerBurden ?? 0);
  const operatingExpense =
    clinicianCompensation +
    (values.staffCost ?? 0) +
    (values.overhead ?? 0) +
    (values.marketing ?? 0) +
    (values.fees ?? 0) +
    (values.ownerPayroll ?? 0) * (1 + workspace.settings.ownerPayrollBurdenPct / 100);
  const estimatedProfit = values.profit ?? null;
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
    fillSessions !== null && sessionsPerClientMonth > 0 ? fillSessions / sessionsPerClientMonth : null;
  const clientsNeeded =
    replacementClients === null && fillClients === null
      ? null
      : (replacementClients ?? 0) + (fillClients ?? 0);
  const leadToClientRate =
    ratio(values.clients, values.leads) ??
    rateFromCampaigns(workspace.campaigns, "leadToClient");
  const leadToConsultRate =
    ratio(values.consultations, values.leads) ??
    rateFromCampaigns(workspace.campaigns, "leadToConsult");
  const consultAttendanceRate = rateFromCampaigns(workspace.campaigns, "consultAttendance");
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

  const hireTemplate = workspace.hiring.find((item) => !item.archived);
  const template = hireTemplate
    ? context.clinicians.find((person) => person.id === hireTemplate.templateClinicianId)
    : undefined;
  const rampWeeklySessions = hireTemplate
    ? hireTemplate.desiredWeeklySessions / Math.max(1, hireTemplate.rampMonths)
    : 0;
  const hireMonthlySessions = rampWeeklySessions * weeks;
  const hireRate = template?.sessionRate ?? null;
  const hireRevenue =
    hireRate === null
      ? null
      : hireMonthlySessions * hireRate * workspace.settings.collectionPct / 100;
  const hirePayAndAddedCost =
    template && hireRevenue !== null
      ? hireRevenue * template.preCapClinicianSplit / 100 +
        hireTemplate!.monthlySupport +
        (hireTemplate!.recruiting + hireTemplate!.credentialing + hireTemplate!.training + hireTemplate!.equipment) /
          Math.max(1, hireTemplate!.rampMonths)
      : null;

  const warnings = [];
  if (estimatedRevenue === null) warnings.push("Estimated revenue needs session volume and rates.");
  if (leadToClientRate === null) warnings.push("Lead requirements need campaign assumptions or recorded lead/client results.");
  if (sessionsPerClientMonth <= 0) warnings.push("Active clients need a sessions-per-client-month assumption.");
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
    marketingCost: values.marketing ?? 0,
    estimatedProfit,
    targetProfit,
    profitGap,
    contributionPerSession,
    sessionsToCloseGap,
    activeClients,
    sessionsPerClientMonth,
    leadToClientRate,
    replacementClients,
    fillClients,
    clientsNeeded,
    leadsNeeded,
    consultsNeeded,
    attendedConsultsNeeded,
    hire: hireTemplate && template
      ? {
          name: hireTemplate.name,
          targetWeeklySessions: hireTemplate.desiredWeeklySessions,
          rampWeeklySessions,
          monthlySessions: hireMonthlySessions,
          estimatedRevenue: hireRevenue,
          payAndAddedCost: hirePayAndAddedCost,
          contribution:
            hireRevenue === null || hirePayAndAddedCost === null
              ? null
              : hireRevenue - hirePayAndAddedCost,
        }
      : null,
    warnings,
  };
}
