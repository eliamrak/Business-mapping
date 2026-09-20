import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import {
  calculateClinicianMetrics,
  calculateStaffMemberCost,
  calculateTotalStaffCost,
} from "@workspace/practice/compensation";
import {
  calculateBusinessGoalOutputs,
  calculateCurrentRealityGap,
} from "./calculations.ts";

const original = execFileSync(
  "git",
  [
    "show",
    "de42326a1f378104ce764d619694bbdaf27fbdc2:artifacts/comp-dashboard/src/lib/calculations.ts",
  ],
  { encoding: "utf8" },
);
const code = stripTypeScriptTypes(original.slice(original.indexOf("\n") + 1));
const baseline = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
test("original compensation implementation remains identical across 864 input combinations", () => {
  for (const classification of ["w2", "1099", 1099, "owner", "other", ""])
    for (const sessionRate of [0, 100, 175])
      for (const sessionsPerWeek of [0, 10, 35, 60])
        for (const capEnabled of [false, true])
          for (const capAmount of [0, 1, 20000, 50000, 100000, 999999]) {
            const input = {
              classification,
              sessionRate,
              sessionsPerWeek,
              capEnabled,
              capAmount,
              weeksWorkedPerYear: 48,
              preCapClinicianSplit: 60,
              preCapPracticeSplit: 40,
              postCapClinicianSplit: 75,
              postCapPracticeSplit: 25,
              w2EmployerFicaPct: 7.65,
              futaSutaPct: 1,
              workersCompPct: 0.5,
              otherEmployerBurdenPct: 0,
              nonClinicalHoursPerWeek: 2,
              nonClinicalHourlyRate: 25,
            };
            assert.deepEqual(
              calculateClinicianMetrics(input),
              baseline.calculateClinicianMetrics(input),
            );
          }
});
test("original staff salary/hourly calculations and aggregate costs are unchanged", () => {
  for (const classification of ["w2", "1099", "owner"])
    for (const annualSalary of [null, 0, 50000])
      for (const hourlyRate of [null, 0, 25]) {
        const input = {
          classification,
          annualSalary,
          hourlyRate,
          hoursPerWeek: 30,
          weeksPerYear: 48,
          w2EmployerFicaPct: 7.65,
          futaSutaPct: 1,
          workersCompPct: 0.5,
          otherEmployerBurdenPct: 0,
        };
        assert.deepEqual(
          calculateStaffMemberCost(input),
          baseline.calculateStaffMemberCost(input),
        );
        assert.equal(
          calculateTotalStaffCost([input, input]),
          baseline.calculateTotalStaffCost([input, input]),
        );
      }
});
test("original business goal and reality outputs are preserved", () => {
  const goal = {
    ownerPayGoal: 100000,
    secondOwnerPayGoal: 70000,
    annualOverheadGoal: 120000,
    businessProfitGoal: 50000,
    buildingFundGoal: 5000,
    emergencyReserveGoal: 10000,
    growthFundGoal: 3000,
    desiredCliniciansCount: 5,
  };
  assert.deepEqual(
    calculateBusinessGoalOutputs(goal),
    baseline.calculateBusinessGoalOutputs(goal),
  );
  const reality = {
    currentCliniciansCount: 4,
    currentAvgSessionRate: 150,
    currentAvgSessionsPerWeek: 25,
    currentAvgWeeksWorkedPerYear: 48,
    currentOwnerPay: 50000,
    currentSecondOwnerPay: 40000,
    currentAnnualOverhead: 80000,
    currentBusinessProfit: 20000,
    currentBuildingFund: 2000,
    currentCashReserve: 4000,
  };
  assert.deepEqual(
    calculateCurrentRealityGap(reality as never, goal as never),
    baseline.calculateCurrentRealityGap(reality, goal),
  );
});
