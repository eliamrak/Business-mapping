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
