import type { BusinessGoal, Clinician, CurrentReality, ScenarioClinician, StaffMember, ScenarioStaffMember } from "@workspace/api-client-react";

export { calculateClinicianMetrics, calculateStaffMemberCost, calculateTotalStaffCost } from "@workspace/practice/compensation";
export type { ClinicianMetricsInput, StaffCostInput } from "@workspace/practice/compensation";

export function calculateBusinessGoalOutputs(goal: Partial<BusinessGoal>) {
  const totalAnnualBusinessNeed = 
    (goal.ownerPayGoal || 0) + 
    (goal.secondOwnerPayGoal || 0) + 
    (goal.annualOverheadGoal || 0) + 
    (goal.businessProfitGoal || 0) + 
    (goal.buildingFundGoal || 0) + 
    (goal.emergencyReserveGoal || 0) + 
    (goal.growthFundGoal || 0);

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

export function calculateCurrentRealityGap(current: CurrentReality | undefined, goal: BusinessGoal | undefined) {
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

  // "Currently achieved" = sum of all components that map to a business goal line item:
  // owner pay, second owner pay, overhead, profit, building fund, and cash reserve
  // (cash reserve is treated as the emergency reserve equivalent)
  const currentTotalAchieved =
    (current.currentOwnerPay || 0) +
    (current.currentSecondOwnerPay || 0) +
    (current.currentAnnualOverhead || 0) +
    (current.currentBusinessProfit || 0) +
    (current.currentBuildingFund || 0) +
    (current.currentCashReserve || 0);

  let gapToGoal = 0;
  let gapPerClinician = 0;
  let percentAchieved = 0;

  if (goal) {
    const goalOutputs = calculateBusinessGoalOutputs(goal);
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
