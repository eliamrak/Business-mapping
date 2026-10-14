import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateClinicianMetrics,
  calculateStaffMemberCost,
  calculateTotalStaffCost,
  calculateBusinessGoalOutputs,
  calculateCurrentRealityGap,
  type ClinicianMetricsInput,
} from "./calculations.ts";

const input: ClinicianMetricsInput = {
  sessionRate: 100,
  sessionsPerWeek: 20,
  weeksWorkedPerYear: 50,
  capEnabled: false,
  capAmount: 20000,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  postCapClinicianSplit: 75,
  postCapPracticeSplit: 25,
  classification: "w2",
  w2EmployerFicaPct: 7.65,
  futaSutaPct: 1,
  workersCompPct: 0.5,
  otherEmployerBurdenPct: 0.85,
};
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test("baseline W2 production, payroll burden and practice net", () => {
  const result = calculateClinicianMetrics(input);
  assert.equal(result.annualSessions, 1000);
  assert.equal(result.annualProduction, 100000);
  assert.equal(result.clinicianCompensation, 60000);
  assert.equal(result.practiceGrossRevenue, 40000);
  close(result.employerObligations, 6000);
  close(result.practiceNetBeforeOverhead, 34000);
  close(
    result.burdenFica +
      result.burdenFutaSuta +
      result.burdenWorkersComp +
      result.burdenOther,
    result.employerObligations,
  );
});
test("cap transition preserves compensation and practice revenue", () => {
  const result = calculateClinicianMetrics({ ...input, capEnabled: true });
  assert.equal(result.preCapSessions, 500);
  assert.equal(result.postCapSessions, 500);
  assert.equal(result.clinicianCompensation, 67500);
  assert.equal(result.practiceGrossRevenue, 32500);
  assert.equal(
    result.clinicianCompensation + result.practiceGrossRevenue,
    result.annualProduction,
  );
});
test("positive practice cap is unreachable with zero pre-cap practice share", () => {
  const result = calculateClinicianMetrics({ ...input, classification: "1099",
    sessionsPerWeek: 2, weeksWorkedPerYear: 50, capEnabled: true, capAmount: 1000,
    preCapClinicianSplit: 100, preCapPracticeSplit: 0,
    postCapClinicianSplit: 70, postCapPracticeSplit: 30,
  });
  assert.equal(result.preCapSessions, 100);
  assert.equal(result.postCapSessions, 0);
  assert.equal(result.sessionsToCAP, 100);
  assert.equal(result.clinicianCompensation, 10000);
  assert.equal(result.practiceGrossRevenue, 0);
  const zeroCap = calculateClinicianMetrics({ ...input, capEnabled: true, capAmount: 0 });
  assert.equal(zeroCap.preCapSessions, 1000);
  assert.equal(zeroCap.postCapSessions, 0);
  assert.equal(zeroCap.clinicianCompensation, 60000);
});

test("1099 and owner do not add employer burden", () => {
  for (const classification of ["1099", "owner"]) {
    const result = calculateClinicianMetrics({ ...input, classification });
    assert.equal(result.employerObligations, 0);
    close(result.clinicianPayrollTaxEstimate, 60000 * 0.153);
  }
});
test("nonclinical compensation and zero volume preserve current behavior", () => {
  const result = calculateClinicianMetrics({
    ...input,
    nonClinicalHoursPerWeek: 2,
    nonClinicalHourlyRate: 25,
  });
  assert.equal(result.nonClinicalComp, 2500);
  close(result.practiceNetBeforeOverhead, 31250);
  assert.equal(
    calculateClinicianMetrics({ ...input, sessionsPerWeek: 0 })
      .annualProduction,
    0,
  );
});
test("staff salary/hourly precedence and burden", () => {
  const base = {
    ...input,
    weeksPerYear: 50,
    annualSalary: 50000,
    hourlyRate: 20,
    hoursPerWeek: 20,
  };
  close(calculateStaffMemberCost(base).totalAnnualCost, 55000);
  close(
    calculateStaffMemberCost({ ...base, annualSalary: 0 }).totalAnnualCost,
    22000,
  );
  assert.equal(
    calculateStaffMemberCost({ ...base, classification: "1099" })
      .totalAnnualCost,
    50000,
  );
  assert.equal(calculateTotalStaffCost([]), 0);
});
test("goal solving and absence of current reality retain current results", () => {
  const outputs = calculateBusinessGoalOutputs({
    ownerPayGoal: 120000,
    secondOwnerPayGoal: 60000,
    annualOverheadGoal: 120000,
    businessProfitGoal: 60000,
    desiredCliniciansCount: 6,
  });
  assert.equal(outputs.totalAnnualBusinessNeed, 360000);
  assert.equal(outputs.requiredNetPerClinician, 60000);
  assert.equal(outputs.requiredMonthlyNetPerClinician, 5000);
  assert.equal(calculateCurrentRealityGap(undefined, undefined), null);
});

test("fund balance goals never become recurring annual or monthly business need", () => {
  const goal = {
    ownerPayGoal: 120000, annualOverheadGoal: 60000, businessProfitGoal: 24000,
    buildingFundGoal: 120000, emergencyReserveGoal: 30000, growthFundGoal: 50000,
    desiredCliniciansCount: 4,
  };
  const before = structuredClone(goal);
  const output = calculateBusinessGoalOutputs(goal);
  assert.equal(output.totalAnnualBusinessNeed, 204000);
  assert.equal(output.requiredMonthlyBusinessNeed, 17000);
  assert.equal(output.requiredNetPerClinician, 51000);
  assert.equal(calculateBusinessGoalOutputs({ buildingFundGoal: 120000 }).totalAnnualBusinessNeed, 0);
  assert.deepEqual(goal, before);
});

test("recurring fund contributions require distinct sourced amounts and a known period basis", () => {
  const goal = { buildingFundGoal: 120000, businessProfitGoal: 12000 };
  const contributions = [
    { fund: "buildingFundGoal" as const, amount: 1000, basis: "monthly" as const, source: "Approved annual savings budget" },
    { fund: "emergencyReserveGoal" as const, amount: 3000, basis: "annual" as const, source: "Annual recurring reserve allocation" },
  ];
  const before = structuredClone({ goal, contributions });
  assert.equal(calculateBusinessGoalOutputs(goal, contributions).totalAnnualBusinessNeed, 27000);
  assert.deepEqual({ goal, contributions }, before);
  for (const amount of [-1, NaN, Infinity])
    assert.throws(() => calculateBusinessGoalOutputs(goal, [{ ...contributions[0], amount }]), /explicit source/);
  assert.throws(() => calculateBusinessGoalOutputs(goal, [{ ...contributions[0], source: " " }]), /explicit source/);
  assert.equal(calculateBusinessGoalOutputs(goal, [{ ...contributions[0], amount: 0 }]).totalAnnualBusinessNeed, 12000);
});

test("current savings balances do not masquerade as recurring goal achievement", () => {
  const current = {
    currentCliniciansCount: 2, currentAvgSessionRate: 100,
    currentAvgSessionsPerWeek: 20, currentAvgWeeksWorkedPerYear: 48,
    currentOwnerPay: 60000, currentSecondOwnerPay: 0,
    currentAnnualOverhead: 24000, currentBusinessProfit: 12000,
    currentBuildingFund: 120000, currentCashReserve: 30000,
  };
  const goal = {
    ownerPayGoal: 72000, secondOwnerPayGoal: 0, annualOverheadGoal: 24000,
    businessProfitGoal: 24000, buildingFundGoal: 120000,
    emergencyReserveGoal: 30000, growthFundGoal: 0, desiredCliniciansCount: 2,
  };
  const before = structuredClone({ current, goal });
  const gap = calculateCurrentRealityGap(current as never, goal as never)!;
  assert.equal(gap.gapToGoal, 24000);
  assert.equal(gap.gapPerClinician, 12000);
  assert.equal(gap.percentAchieved, 80);
  assert.deepEqual({ current, goal }, before);
  const contribution = { fund: "buildingFundGoal" as const, amount: 1000, basis: "monthly" as const, source: "Recurring contribution budget" };
  assert.equal(calculateCurrentRealityGap(current as never, goal as never, {
    goalContributions: [contribution], currentContributions: [{ ...contribution, amount: 500 }],
  })!.gapToGoal, 30000);
});
