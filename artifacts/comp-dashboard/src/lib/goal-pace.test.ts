import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateGoalPace } from "./goal-pace.ts";

test("goal pace reports past variance, catch-up gain and finish date", () => {
  const result = calculateGoalPace(
    [
      { date: "2026-01-01", value: 100 },
      { date: "2026-02-01", value: 110 },
      { date: "2026-03-01", value: 120 },
      { date: "2026-04-01", value: 130 },
      { date: "2026-05-01", value: 140 },
      { date: "2026-06-01", value: 150 },
    ],
    [
      { date: "2026-01-31", value: 90 },
      { date: "2026-02-28", value: 95 },
      { date: "2026-03-31", value: 100 },
      { date: "2026-04-30", value: 105 },
    ],
  )!;
  assert.equal(result.priorVariance, -10);
  assert.equal(result.variance, -25);
  assert.equal(result.monthlyGainNeeded, 22.5);
  assert.equal(result.recentMonthlyGain, 5);
  assert.equal(result.estimatedFinishDate, "2027-01-01");
});

test("goal pace does not invent a finish date for a flat or declining trend", () => {
  const result = calculateGoalPace(
    [{ date: "2026-06-01", value: 200 }],
    [
      { date: "2026-01-31", value: 100 },
      { date: "2026-02-28", value: 95 },
      { date: "2026-03-31", value: 90 },
    ],
  )!;
  assert.equal(result.estimatedFinishDate, null);
  assert.ok((result.recentMonthlyGain ?? 0) < 0);
});

test("goal pace needs both a target and real data", () => {
  assert.equal(calculateGoalPace([], [{ date: "2026-01-31", value: 1 }]), null);
  assert.equal(calculateGoalPace([{ date: "2026-01-01", value: 1 }], []), null);
});
