import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  workspaceSchema,
  growthPlanningSchema,
} from "../src/hub/index.ts";
const plan = {
  occupancy: 0.8,
  goalMonths: 4,
  checkMonths: 6,
  leadConsultDays: 5,
  otherRouteDays: 5,
  reserve: 0,
  recruitmentMonths: null,
  onboardingMonths: null,
  rampMonths: null,
  monthlyLeads: { "2026-10": 15 },
  staffing: [
    {
      id: "hypothesis",
      startMonth: "2026-11",
      weeklyCapacity: 20,
      rampMonths: 2,
    },
  ],
};
test("optional growth planning persists without rewriting legacy workspace or source records", () => {
  const actual = emptyWorkspace("2026-10-27");
  assert.equal(actual.settings.growthPlanning, undefined);
  const before = JSON.stringify(actual);
  const scenario = structuredClone(actual);
  scenario.settings.growthPlanning = plan;
  const saved = workspaceSchema.parse(JSON.parse(JSON.stringify(scenario)));
  assert.deepEqual(saved.settings.growthPlanning, plan);
  assert.equal(JSON.stringify(actual), before);
  assert.deepEqual(saved.funnels, actual.funnels);
  assert.deepEqual(saved.clinicians, actual.clinicians);
});
test("invalid horizon, nonfinite inputs and unsafe capacity values are rejected", () => {
  for (const patch of [
    { goalMonths: 7 },
    { occupancy: 1.2 },
    { reserve: -1 },
    { leadConsultDays: Infinity },
    {
      staffing: [
        { id: "bad", startMonth: "bad", weeklyCapacity: -1, rampMonths: 0 },
      ],
    },
  ])
    assert.equal(
      growthPlanningSchema.safeParse({ ...plan, ...patch }).success,
      false,
    );
});
