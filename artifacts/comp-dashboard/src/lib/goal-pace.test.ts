import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateGoalPace } from "./goal-pace.ts";

test("independent audit: January 100 to May 200 gains 25 per month", () => {
  const result = calculateGoalPace([{ date: "2026-12-01", value: 400 }], [
    { date: "2026-01-01", value: 100 },
    { date: "2026-05-01", value: 200 },
  ])!;
  assert.equal(result.recentMonthlyGain, 25);
  assert.equal(result.estimatedFinishDate, "2027-01-01");
});

test("same-day duplicate observations do not accelerate or weight the trend", () => {
  const plan = [{ date: "2026-12-01", value: 400 }];
  const points = [{ date: "2026-01-01", value: 100 }, { date: "2026-05-01", value: 200 }];
  const result = calculateGoalPace(plan, [...points, points[1], points[1], points[1]])!;
  assert.equal(result.recentMonthlyGain, 25);
  assert.equal(result.rows.length, 2);
  assert.equal(result.estimatedFinishDate, "2027-01-01");
  assert.equal(calculateGoalPace(plan, [points[1], points[1]])!.recentMonthlyGain, null);
});

test("elapsed calendar months handle year gaps and leap-month endpoints in every timezone", () => {
  const originalTZ = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/New_York", "Pacific/Auckland"]) {
      process.env.TZ = zone;
      const result = calculateGoalPace([{ date: "2025-12-01", value: 500 }], [
        { date: "2024-01-31", value: 100 },
        { date: "2024-02-29", value: 125 },
        { date: "2024-05-31", value: 200 },
        { date: "2025-01-31", value: 400 },
      ])!;
      assert.equal(result.recentMonthlyGain, 25);
      assert.equal(result.estimatedFinishDate, "2025-05-01");
    }
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test("one day across a month boundary has positive fractional elapsed time", () => {
  const result = calculateGoalPace([{ date: "2026-12-01", value: 400 }], [
    { date: "2026-01-31", value: 100 }, { date: "2026-02-01", value: 101 },
  ])!;
  assert.equal(result.recentMonthlyGain, 28);
});

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
