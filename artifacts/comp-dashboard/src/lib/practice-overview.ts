import type { ForecastMonth, Workspace } from "@workspace/practice/hub";
import { derivedShowVisits, estimateLocalClientActivity, type ClientActivityOptions, type LocalSnapshot, type SameDayVisitOverrides } from "./retention-local.ts";
import { fundProjectionSummary } from "./practice-money-visuals.ts";
import { moneyBridgeSummary } from "./money-bridge.ts";
import { linkedGoalForMetric } from "./legacy-practice-goals.ts";
import type { CompensationGoal } from "./workspace-defaults.ts";

export function overviewClientFlow(snapshots: LocalSnapshot[], overrides: SameDayVisitOverrides, start: string, end: string, asOf: string, options: ClientActivityOptions = {}) {
  const activity = estimateLocalClientActivity(snapshots, overrides, 56, 56, 28, asOf, 90, start, end, options);
  if (!activity) return { starts: null, departures: null, through: null, leftCensoredStarts: 0 };
  const firstDates = new Map<string, string>();
  for (const row of derivedShowVisits(snapshots, overrides, options.classificationSnapshots)) {
    if (row.serviceDate > asOf) continue;
    const first = firstDates.get(row.clientId);
    if (!first || row.serviceDate < first) firstDates.set(row.clientId, row.serviceDate);
  }
  const firsts = [...firstDates.values()].filter((date) => date >= start && date <= end);
  return {
    starts: firsts.filter((date) => date > activity.coverageStart).length,
    departures: activity.endingEventCoverageComplete ? activity.endingEvents.length : null,
    through: end < activity.endingObservationCutoff ? end : activity.endingObservationCutoff,
    leftCensoredStarts: firsts.filter((date) => date === activity.coverageStart).length,
  };
}

export function overviewFundingSummary(workspace: Workspace, annualMonths: ForecastMonth[], legacyGoal?: CompensationGoal | null) {
  const sum = (metric: string) => annualMonths.length === 12 && annualMonths.every((row) => row.values[metric] != null)
    ? annualMonths.reduce((total, row) => total + row.values[metric]!, 0) : null;
  const diagnostics: string[] = [];
  const monthly = (metric: Parameters<typeof linkedGoalForMetric>[0]) => {
    const binding = linkedGoalForMetric(metric, workspace, legacyGoal);
    if (binding.diagnostic) diagnostics.push(binding.diagnostic);
    const goal = binding.goal;
    return goal ? goal.amount / (goal.basis === "annual" ? 12 : 1) : null;
  };
  const owner = monthly("ownerDistributionsPretax");
  const salary = monthly("coOwnerSalaryPretax");
  const retained = monthly("profit");
  const includedSalaryAnnual = sum("coOwnerSalaryPretax");
  const salaryGap = salary === 0 ? 0 : salary === null || includedSalaryAnnual === null ? null : Math.max(0, salary * 12 - includedSalaryAnnual);
  const fundAmounts = workspace.fundGoals.filter((goal) => !goal.archived && goal.amount > 0).map((goal) => {
    const lower = goal.name.toLowerCase().replace(" fund", "");
    const configured = workspace.allocations.filter((row) => !row.archived);
    const amounts = annualMonths.map((month) => {
      const monthStart = month.date.slice(0, 7) + "-01";
      const end = new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const allocations = configured.filter((row) => row.start <= end && (!row.end || row.end >= monthStart));
      if (configured.some((row) => row.name.toLowerCase().includes(lower)) && !allocations.some((row) => row.name.toLowerCase().includes(lower))) return 0;
      return fundProjectionSummary({ ...goal, currentBalance: 0 }, allocations, month.values, month.date)?.contribution ?? null;
    });
    return amounts.length === 12 && amounts.every((amount) => amount !== null) ? amounts.reduce<number>((total, amount) => total + amount!, 0) : null;
  });
  const parts = [owner === null ? null : owner * 12, salaryGap, retained === null ? null : retained * 12, ...fundAmounts];
  const target = parts.every((part) => part !== null) ? parts.reduce<number>((total, part) => total + part!, 0) : null;
  const bridge = moneyBridgeSummary(Object.fromEntries(["revenue", "clinicianPay", "profit", "employerBurden", "staffCost", "overhead", "marketing", "fees", "ownerPayroll"].map((metric) => [metric, sum(metric)])), workspace.settings.ownerPayrollBurdenPct);
  return {
    income: bridge.revenue, clinicianPay: bridge.clinicianPay, profit: bridge.profit, otherCosts: bridge.otherCosts,
    adjustments: bridge.adjustments, costComponents: bridge.components,
    target, diagnostics, knownSubtotal: parts.reduce<number>((total, part) => total + (part ?? 0), 0),
    missingAmounts: parts.filter((part) => part === null).length,
    includedSalaryAnnual, ownerAnnual: owner === null ? null : owner * 12,
    salaryGap, retainedAnnual: retained === null ? null : retained * 12,
    fundsAnnual: fundAmounts.every((amount) => amount !== null) ? fundAmounts.reduce<number>((total, amount) => total + amount!, 0) : null,
  };
}
