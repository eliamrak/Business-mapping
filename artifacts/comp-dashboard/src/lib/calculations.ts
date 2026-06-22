import { BusinessGoal, Clinician, CurrentReality, ScenarioClinician, StaffMember, ScenarioStaffMember } from "@workspace/api-client-react";

export interface ClinicianMetricsInput {
  sessionRate: number;
  sessionsPerWeek: number;
  weeksWorkedPerYear: number;
  capEnabled: boolean;
  capAmount: number;
  preCapClinicianSplit: number;
  preCapPracticeSplit: number;
  postCapClinicianSplit: number;
  postCapPracticeSplit: number;
  classification: string | number;
  w2EmployerFicaPct: number;
  futaSutaPct: number;
  workersCompPct: number;
  otherEmployerBurdenPct: number;
  nonClinicalHoursPerWeek?: number;
  nonClinicalHourlyRate?: number;
}

export function calculateClinicianMetrics(input: ClinicianMetricsInput) {
  const annualSessions = (input.sessionsPerWeek || 0) * (input.weeksWorkedPerYear || 0);
  const annualProduction = annualSessions * (input.sessionRate || 0);

  let preCapSessions = 0;
  let postCapSessions = 0;

  if (input.capEnabled && input.capAmount > 0) {
    const practiceRevPerSession = (input.sessionRate || 0) * ((input.preCapPracticeSplit || 0) / 100);
    const sessionsToCapPrecalc = practiceRevPerSession > 0 ? input.capAmount / practiceRevPerSession : 0;
    const sessionsToCAP = Math.min(annualSessions, sessionsToCapPrecalc);
    preCapSessions = Math.min(annualSessions, sessionsToCAP);
    postCapSessions = Math.max(0, annualSessions - sessionsToCAP);
  } else {
    preCapSessions = annualSessions;
    postCapSessions = 0;
  }

  const sessionSplitCompensation =
    (preCapSessions * (input.sessionRate || 0) * ((input.preCapClinicianSplit || 0) / 100)) +
    (postCapSessions * (input.sessionRate || 0) * ((input.postCapClinicianSplit || 0) / 100));

  const nonClinicalComp =
    (input.nonClinicalHoursPerWeek || 0) *
    (input.nonClinicalHourlyRate || 0) *
    (input.weeksWorkedPerYear || 0);

  const clinicianCompensation = sessionSplitCompensation + nonClinicalComp;

  const practiceGrossRevenue =
    (preCapSessions * (input.sessionRate || 0) * ((input.preCapPracticeSplit || 0) / 100)) +
    (postCapSessions * (input.sessionRate || 0) * ((input.postCapPracticeSplit || 0) / 100));

  const totalEmployerBurdenPct = ((input.w2EmployerFicaPct || 0) + (input.futaSutaPct || 0) + (input.workersCompPct || 0) + (input.otherEmployerBurdenPct || 0)) / 100;

  const classification = String(input.classification).toLowerCase();
  const isW2 = classification === 'w2';
  const is1099 = classification === '1099';
  const isOwner = classification === 'owner';

  const employerObligations = isW2 ? clinicianCompensation * totalEmployerBurdenPct : 0;

  const burdenFica = isW2 ? clinicianCompensation * ((input.w2EmployerFicaPct || 0) / 100) : 0;
  const burdenFutaSuta = isW2 ? clinicianCompensation * ((input.futaSutaPct || 0) / 100) : 0;
  const burdenWorkersComp = isW2 ? clinicianCompensation * ((input.workersCompPct || 0) / 100) : 0;
  const burdenOther = isW2 ? clinicianCompensation * ((input.otherEmployerBurdenPct || 0) / 100) : 0;

  const practiceNetBeforeOverhead = practiceGrossRevenue - employerObligations;

  let clinicianPayrollTaxEstimate = 0;
  if (isW2) {
    clinicianPayrollTaxEstimate = clinicianCompensation * 0.0765;
  } else if (is1099 || isOwner || classification === 'other') {
    clinicianPayrollTaxEstimate = clinicianCompensation * 0.153;
  }

  const estimatedCompAfterPayrollTaxes = clinicianCompensation - clinicianPayrollTaxEstimate;

  const practiceRevPerSession = (input.sessionRate || 0) * ((input.preCapPracticeSplit || 0) / 100);
  const sessionsToCAP = input.capEnabled && input.capAmount > 0 && practiceRevPerSession > 0
    ? Math.min(annualSessions, input.capAmount / practiceRevPerSession)
    : annualSessions;

  return {
    annualSessions,
    annualProduction,
    sessionsToCAP,
    preCapSessions,
    postCapSessions,
    sessionSplitCompensation,
    nonClinicalComp,
    clinicianCompensation,
    practiceGrossRevenue,
    employerObligations,
    practiceNetBeforeOverhead,
    clinicianPayrollTaxEstimate,
    estimatedCompAfterPayrollTaxes,
    burdenFica,
    burdenFutaSuta,
    burdenWorkersComp,
    burdenOther,
  };
}

export interface StaffCostInput {
  annualSalary?: number | null;
  hourlyRate?: number | null;
  hoursPerWeek?: number | null;
  weeksPerYear: number;
  classification: string;
  w2EmployerFicaPct: number;
  futaSutaPct: number;
  workersCompPct: number;
  otherEmployerBurdenPct: number;
}

export function calculateStaffMemberCost(input: StaffCostInput) {
  let baseAnnualCost = 0;
  if (input.annualSalary != null && input.annualSalary > 0) {
    baseAnnualCost = input.annualSalary;
  } else if (input.hourlyRate != null && input.hoursPerWeek != null) {
    baseAnnualCost = (input.hourlyRate || 0) * (input.hoursPerWeek || 0) * (input.weeksPerYear || 52);
  }

  const isW2 = String(input.classification).toLowerCase() === "w2";
  const totalBurdenPct = isW2
    ? ((input.w2EmployerFicaPct || 0) + (input.futaSutaPct || 0) + (input.workersCompPct || 0) + (input.otherEmployerBurdenPct || 0)) / 100
    : 0;

  const employerBurden = baseAnnualCost * totalBurdenPct;
  const totalAnnualCost = baseAnnualCost + employerBurden;

  return { baseAnnualCost, employerBurden, totalAnnualCost };
}

export function calculateTotalStaffCost(staffMembers: (StaffMember | ScenarioStaffMember)[]) {
  return staffMembers.reduce((sum, s) => {
    const { totalAnnualCost } = calculateStaffMemberCost({
      annualSalary: s.annualSalary,
      hourlyRate: s.hourlyRate,
      hoursPerWeek: s.hoursPerWeek,
      weeksPerYear: s.weeksPerYear,
      classification: String(s.classification),
      w2EmployerFicaPct: s.w2EmployerFicaPct,
      futaSutaPct: s.futaSutaPct,
      workersCompPct: s.workersCompPct,
      otherEmployerBurdenPct: s.otherEmployerBurdenPct,
    });
    return sum + totalAnnualCost;
  }, 0);
}

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
