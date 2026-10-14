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
test("compensation preserves legacy parity except unreachable positive caps with zero-fee sessions", () => {
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
            const expected = baseline.calculateClinicianMetrics(input);
            // Known corrected edge: a positive cap cannot be reached by zero-fee sessions.
            // Only the pre/post session allocation differs; all monetary fields retain parity.
            if (capEnabled && capAmount > 0 && sessionRate === 0) {
              expected.preCapSessions = expected.annualSessions;
              expected.postCapSessions = 0;
            }
            assert.deepEqual(calculateClinicianMetrics(input), expected);
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
test("business goal and reality retain parity except capital balances incorrectly counted as annual flows", () => {
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
  const recurringGoal = { ...goal, buildingFundGoal: 0, emergencyReserveGoal: 0, growthFundGoal: 0 };
  // Known corrected bug: accumulated fund targets are capital balances, not
  // recurring annual contributions. All recurring goal outputs retain parity.
  assert.equal(baseline.calculateBusinessGoalOutputs(goal).totalAnnualBusinessNeed, 358000);
  assert.equal(calculateBusinessGoalOutputs(goal).totalAnnualBusinessNeed, 340000,
    "Exclude 18000 of capital targets from recurring annual need without rewriting stored goals");
  assert.deepEqual(calculateBusinessGoalOutputs(goal), baseline.calculateBusinessGoalOutputs(recurringGoal));
  assert.equal(goal.buildingFundGoal + goal.emergencyReserveGoal + goal.growthFundGoal, 18000);
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
  // Apply the same correction to achieved flows: 6000 of accumulated savings
  // cannot satisfy annual income goals. Production and all other logic match.
  const recurringReality = { ...reality, currentBuildingFund: 0, currentCashReserve: 0 };
  const correctedGap = calculateCurrentRealityGap(reality as never, goal as never)!;
  assert.equal(baseline.calculateCurrentRealityGap(reality, goal).gapToGoal, 162000);
  assert.equal(correctedGap.gapToGoal, 150000,
    "Recurring goal 340000 minus recurring achieved 190000 excludes capital on both sides");
  assert.deepEqual(correctedGap, baseline.calculateCurrentRealityGap(recurringReality, recurringGoal));
  assert.equal(reality.currentBuildingFund + reality.currentCashReserve, 6000);
});
