import type { BusinessGoal, Clinician, CurrentReality, ScenarioClinician, StaffMember, ScenarioStaffMember } from "@workspace/api-client-react";

export { calculateClinicianMetrics, calculateStaffMemberCost, calculateTotalStaffCost } from "@workspace/practice/compensation";
export type { ClinicianMetricsInput, StaffCostInput } from "@workspace/practice/compensation";

export type RecurringFundContribution = {
  fund: "buildingFundGoal" | "emergencyReserveGoal" | "growthFundGoal";
  amount: number;
  basis: "monthly" | "annual";
  source: string;
};

function annualFundContributions(contributions: readonly RecurringFundContribution[]) {
  return contributions.reduce((total, contribution) => {
    if (!contribution.source.trim() || !Number.isFinite(contribution.amount) || contribution.amount < 0)
      throw new Error("Recurring fund contributions require a nonnegative amount and an explicit source.");
    if (contribution.basis !== "monthly" && contribution.basis !== "annual")
      throw new Error("Recurring fund contributions require a monthly or annual basis.");
    return total + contribution.amount * (contribution.basis === "monthly" ? 12 : 1);
  }, 0);
}

export function calculateBusinessGoalOutputs(goal: Partial<BusinessGoal>, recurringContributions: readonly RecurringFundContribution[] = []) {
  const totalAnnualBusinessNeed = 
    (goal.ownerPayGoal || 0) + 
    (goal.secondOwnerPayGoal || 0) + 
    (goal.annualOverheadGoal || 0) + 
    (goal.businessProfitGoal || 0) +
    annualFundContributions(recurringContributions);

  const desiredCliniciansCount = goal.desiredCliniciansCount || 1;
  const requiredNetPerClinician = desiredCliniciansCount > 0 ? totalAnnualBusinessNeed / desiredCliniciansCount : 0;
  
  const requiredMonthlyBusinessNeed = totalAnnualBusinessNeed / 12;
  const requiredMonthlyNetPerClinician = requiredNetPerClinician / 12;

  return {
    totalAnnualBusinessNeed,
    requiredNetPerClinician,
    requiredMonthlyBusinessNeed,
    requiredMonthlyNetPerClinician
  };
}

export function calculateCurrentRealityGap(current: CurrentReality | undefined, goal: BusinessGoal | undefined, recurring: {
  goalContributions?: readonly RecurringFundContribution[];
  currentContributions?: readonly RecurringFundContribution[];
} = {}) {
  if (!current) return null;

  // Estimated gross production across the whole team
  const currentAnnualProductionEstimate =
    (current.currentCliniciansCount || 0) *
    (current.currentAvgSessionRate || 0) *
    (current.currentAvgSessionsPerWeek || 0) *
    (current.currentAvgWeeksWorkedPerYear || 0);

  // Current net revenue per clinician (using reported business profit as a proxy)
  const currentNetPerClinicianEstimate =
    current.currentCliniciansCount > 0
      ? (current.currentBusinessProfit || 0) / current.currentCliniciansCount
      : 0;

  // Compare annual recurring flows on both sides; accumulated capital is not income.
  const currentTotalAchieved =
    (current.currentOwnerPay || 0) +
    (current.currentSecondOwnerPay || 0) +
    (current.currentAnnualOverhead || 0) +
    (current.currentBusinessProfit || 0) +
    annualFundContributions(recurring.currentContributions ?? []);

  let gapToGoal = 0;
  let gapPerClinician = 0;
  let percentAchieved = 0;

  if (goal) {
    const goalOutputs = calculateBusinessGoalOutputs(goal, recurring.goalContributions);
    gapToGoal = goalOutputs.totalAnnualBusinessNeed - currentTotalAchieved;
    gapPerClinician =
      (goal.desiredCliniciansCount || 1) > 0
        ? gapToGoal / (goal.desiredCliniciansCount || 1)
        : 0;
    percentAchieved =
      goalOutputs.totalAnnualBusinessNeed > 0
        ? (currentTotalAchieved / goalOutputs.totalAnnualBusinessNeed) * 100
        : 100;
  }

  return {
    currentAnnualProductionEstimate,
    currentNetPerClinicianEstimate,
    gapToGoal,
    gapPerClinician,
    percentAchieved,
  };
}
