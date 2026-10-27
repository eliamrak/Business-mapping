import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarResponse,
  forecastCalendar,
  integrateResponse,
  projectGrowth,
} from "./reviewed-growth-engine.ts";
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
// Aggregate-only Page68 receipt. These are test inputs, never production defaults.
const recentCounts = [
  [
    34, 0, 0, 0, 1, 1, 4, 5, 0, 1, 0, 3, 4, 4, 11, 0, 0, 0, 1, 3, 3, 4, 0, 0, 1,
    0, 2, 4, 7, 2,
  ],
  [
    1, 0, 1, 1, 1, 3, 0, 0, 0, 0, 1, 2, 2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 1, 0, 2,
    1, 1, 0, 0, 0,
  ],
  [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
    0, 0, 0, 0, 0,
  ],
];
const longerCounts = [
  [
    140, 0, 0, 1, 3, 3, 9, 15, 4, 3, 4, 6, 5, 6, 35, 6, 5, 5, 7, 5, 8, 20, 4, 2,
    3, 3, 4, 10, 29, 8,
  ],
  [
    3, 3, 3, 1, 4, 16, 3, 1, 2, 3, 2, 4, 19, 3, 1, 4, 2, 0, 2, 8, 4, 2, 4, 3, 4,
    1, 17, 4, 1, 1,
  ],
  [
    2, 1, 3, 11, 3, 2, 3, 2, 0, 1, 12, 2, 3, 1, 0, 0, 2, 6, 2, 0, 2, 2, 2, 4, 9,
    5, 0, 0, 0, 1,
  ],
  [
    1, 7, 2, 3, 3, 0, 1, 1, 5, 3, 1, 3, 0, 1, 3, 8, 4, 1, 1, 0, 0, 2, 7, 2, 1,
    1, 0, 3, 1, 6,
  ],
  [
    3, 2, 2, 0, 0, 1, 6, 1, 1, 0, 0, 1, 2, 3, 3, 0, 0, 0, 0, 3, 4, 2, 1, 1, 0,
    0, 2, 3, 4, 0,
  ],
  [
    1, 0, 2, 2, 1, 4, 0, 1, 0, 0, 1, 3, 3, 0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1,
    2, 3, 2, 0, 0,
  ],
  [
    0, 2, 5, 2, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 1, 6, 2, 1, 1, 0, 0, 1, 3, 0,
    0, 0, 0, 0, 1,
  ],
];
const longer = longerCounts.flatMap((row, i) =>
  row.map((n) => n / [140, 122, 110, 90, 73, 54, 39][i]!),
);
const recent = recentCounts
  .flatMap((row, i) => row.map((n) => n / [34, 16, 4][i]!))
  .concat(longer.slice(90));
const lagRecent = {
  1: 1,
  2: 2,
  3: 1,
  4: 1,
  6: 1,
  7: 8,
  8: 3,
  10: 1,
  11: 1,
  12: 1,
  13: 1,
  14: 6,
  18: 1,
  23: 1,
  29: 1,
  54: 1,
  68: 1,
};
const lagLonger = {
  1: 4,
  2: 4,
  3: 5,
  4: 4,
  5: 3,
  6: 5,
  7: 24,
  8: 5,
  9: 2,
  10: 4,
  11: 4,
  12: 4,
  13: 3,
  14: 9,
  15: 3,
  17: 3,
  18: 1,
  20: 1,
  21: 4,
  22: 1,
  23: 1,
  24: 1,
  27: 2,
  29: 1,
  34: 2,
  35: 1,
  54: 1,
  55: 2,
  56: 1,
  68: 2,
  85: 1,
};
const months = forecastCalendar("2026-09-30", 6);
function fixture(long: boolean) {
  const starts = long ? 151 : 45,
    leads = long ? 261 : 81;
  const routes = Object.entries(long ? lagLonger : lagRecent).map(([d, n]) => ({
    days: Number(d) + 5,
    weight: n / starts,
  }));
  routes.push({ days: 5, weight: (long ? 43 : 13) / starts });
  const response = calendarResponse({
    months,
    kernel: long ? longer : recent,
    routes,
    startsPerLead: starts / leads,
    historicalLeadsPerDay: leads / (long ? 273 : 92),
  })!;
  const baseline = months.map(
    (m) =>
      (m.endDay - m.startDay) *
      (150 * (long ? 1958 / 45496 : 509 / 13366) +
        20 * (long ? 33 / 854 : 32 / 833)),
  );
  const input = {
    months,
    response,
    baseline,
    capacity: Array(6).fill(376),
    reserve: Array(6).fill(0),
    leads: Array(6).fill(long ? 29 : 27),
    occupancy: 0.8,
    goalMonths: 4,
    workingWeeksPerMonth: 4,
  };
  return { response, input, projection: projectGrowth(input)! };
}
for (const long of [false, true])
  test(`Page68 ${long ? "longer" : "recent hybrid"} daily response, pipeline and projection parity`, () => {
    const { response: r, projection: p } = fixture(long);
    const expectedQ = long
      ? [
          0.44882188322121586, 1.3658587108911693, 2.0705851303225886,
          2.544830088269262, 2.7119317143827115, 3.415008543403279,
        ]
      : [
          0.4789455806217349, 1.511978617611919, 2.145869082897994,
          2.44402095648428, 2.592468188829941, 3.2754602898241774,
        ];
    const expectedP = long
      ? [
          14.477130246802384, 10.857605060825204, 7.923527145072814,
          6.702548947368654, 5.138172538232422, 5.289399731777672,
        ]
      : [
          13.93887867647059, 10.532828484654733, 3.9508072250639388,
          5.098950663375336, 4.147179931010523, 4.4257023347739555,
        ];
    const expectedR = long
      ? [
          [0.44882188322121586, 0, 0, 0, 0, 0],
          [0.9339740183168215, 0.4318846925743478, 0, 0, 0, 0],
          [
            0.6566567615073241, 0.9651064855940488, 0.44882188322121586, 0, 0,
            0,
          ],
          [
            0.4843510587289346, 0.6518173613439299, 0.9598397849751813,
            0.44882188322121586, 0, 0,
          ],
          [
            0.39974250021612606, 0.43876079936110707, 0.5936586107089762,
            0.8828261415740217, 0.39694366252248026, 0,
          ],
          [
            0.3825915001909097, 0.4427514876523702, 0.4927567614859809,
            0.6706722541101358, 0.9774146567426668, 0.44882188322121586,
          ],
        ]
      : [
          [0.4789455806217349, 0, 0, 0, 0, 0],
          [1.051611878323611, 0.46036673928830796, 0, 0, 0, 0],
          [0.580257894675194, 1.086665607601065, 0.4789455806217349, 0, 0, 0],
          [
            0.31484860405067383, 0.569066963205035, 1.0811598086068361,
            0.4789455806217349, 0, 0,
          ],
          [
            0.3702618555355273, 0.27722203730600614, 0.5298568650877317,
            0.9938051983039334, 0.42132223259674245, 0,
          ],
          [
            0.35986631045621487, 0.40886017091693017, 0.3102924257450226,
            0.6172114753906341, 1.1002843266936404, 0.4789455806217349,
          ],
        ];
    r.matrix.forEach((row, t) =>
      row.forEach((value, a) => near(value, expectedR[t]![a]!)),
    );
    r.cumulative.forEach((v, i) => near(v, expectedQ[i]!));
    r.pipeline.forEach((v, i) => near(v, expectedP[i]!));
    near(p.workload[3]!, long ? 304.5813566889818 : 271.9849477338804);
    near(p.workload[5]!, long ? 328.40338267227736 : 293.76056140545626);
    near(p.goalPace!, long ? 27.51410249100224 : 38.79001848968186);
    near(p.physicalLeadCeiling!, long ? 42.93748118717428 : 52.1077501534779);
    assert.equal(p.physicalCrossing, null);
    assert.equal(p.limitingMonth, "2027-03");
    assert.equal(p.occupancyCrossing, long ? "2027-01" : null);
    r.matrix.forEach((row, t) =>
      row.forEach((v, a) => {
        if (a > t) assert.equal(v, 0);
      }),
    );
  });
test("fractional delays integrate day-zero spike rather than rounding", () => {
  near(integrateResponse([1], 0, 1, 0, 1, 0.5)!, 0.125);
  assert.equal(integrateResponse([null], 0, 1, 0, 1, 0), null);
  assert.equal(integrateResponse([], 0, 1, 2, 3, 0), 0);
});
test("variable intake uses R once; Q is already cumulative", () => {
  const { input } = fixture(false);
  const leads = [10, 0, 0, 0, 0, 0];
  const p = projectGrowth({ ...input, leads })!;
  p.workload.forEach((v, i) =>
    near(
      v,
      input.baseline[i]! +
        input.response.pipeline[i]! +
        10 * input.response.matrix[i]![0]!,
    ),
  );
});
test("unsupported follow-up remains unavailable, not zero", () => {
  const { input } = fixture(false);
  assert.equal(
    calendarResponse({
      months,
      kernel: recent.slice(0, 90),
      routes: [{ days: 5, weight: 1 }],
      startsPerLead: 0.5,
      historicalLeadsPerDay: 1,
    }),
    null,
  );
  assert.equal(projectGrowth({ ...input, goalMonths: 7 }), null);
});
test("zero response, baseline overload, target zero and capacity changes", () => {
  const { input } = fixture(false),
    zero = {
      matrix: months.map(() => Array(6).fill(0)),
      cumulative: Array(6).fill(0),
      pipeline: Array(6).fill(0),
      pendingStarts: 0,
    };
  const p = projectGrowth({ ...input, response: zero })!;
  assert.equal(p.goalStatus, "unattainable");
  assert.equal(p.physicalLeadCeiling, null);
  assert.equal(projectGrowth({ ...input, occupancy: 0 })!.goalPace, 0);
  const overloaded = projectGrowth({ ...input, capacity: Array(6).fill(100) })!;
  assert.equal(overloaded.baselineOverload, true);
  assert.equal(overloaded.feasibleGoalPace, null);
  assert.equal(overloaded.physicalLeadCeiling, null);
  const reduced = projectGrowth({ ...input, capacity: Array(6).fill(280) })!;
  assert.ok(
    reduced.physicalLeadCeiling! < projectGrowth(input)!.physicalLeadCeiling!,
  );
  assert.deepEqual(input.capacity, Array(6).fill(376));
});
test("calendar rolls across leap years and preserves actual month lengths", () => {
  const result = forecastCalendar("2028-01-31", 2);
  assert.deepEqual(result, [
    { month: "2028-02", startDay: 0, endDay: 29 },
    { month: "2028-03", startDay: 29, endDay: 60 },
  ]);
});
test("nonfinite arithmetic, impossible dates and tiny positive requirements fail safely", () => {
  assert.equal(integrateResponse([1e308, 1e308], 0, 2, 0, 2, 0), null);
  assert.deepEqual(forecastCalendar("2026-02-30", 1), []);
  const { input } = fixture(false);
  assert.equal(projectGrowth({ ...input, leads: Array(6).fill(1e308) }), null);
  const p = projectGrowth({
    months: [months[0]!],
    response: {
      matrix: [[1]],
      cumulative: [1],
      pipeline: [0],
      pendingStarts: 0,
    },
    baseline: [0],
    capacity: [1],
    reserve: [0],
    leads: [0],
    occupancy: 5e-11,
    goalMonths: 1,
    workingWeeksPerMonth: 4,
  })!;
  assert.equal(p.roundedGoalPace, 1);
});
