import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  allocationSchema,
  clinicianSettingSchema,
  emptyWorkspace,
  fundGoalSchema,
  goalSchema,
  termSchema,
  staffTermSchema,
  type Context,
} from "@workspace/practice/hub";
import {
  financialSessionGoal,
  type FinancialSessionGoalInput,
} from "./financial-session-goal.ts";

function setup(): FinancialSessionGoalInput {
  const workspace = emptyWorkspace("2026-01-01");
  Object.assign(workspace.settings, {
    baselineMode: "manual",
    baselineWeeklySessions: 100,
    baselineRetentionPct: 100,
    defaultInPersonPct: 0,
    overheadFloorMonthly: 1000,
    overheadFloorOverride: true,
    weeksPerYear: 52.1786,
  });
  const context: Context = {
    clinicians: [
      {
        id: 1,
        label: "Elia",
        classification: "owner",
        sessionRate: 100,
        sessionsPerWeek: 100,
        weeksWorkedPerYear: 52.1786,
        capEnabled: false,
        capAmount: 0,
        preCapClinicianSplit: 0,
        preCapPracticeSplit: 100,
        postCapClinicianSplit: 0,
        postCapPracticeSplit: 100,
        w2EmployerFicaPct: 0,
        futaSutaPct: 0,
        workersCompPct: 0,
        otherEmployerBurdenPct: 0,
      },
    ],
    staff: [],
    sessions: [],
  };
  workspace.goals.push(
    goalSchema.parse({
      id: randomUUID(),
      name: "Operating profit",
      metric: "profit",
      amount: 1000,
    }),
  );
  return {
    workspace,
    context,
    range: { start: "2026-01-01", end: "2026-01-31" },
  };
}
const close = (actual: number | null, expected: number) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 1e-6,
    `${actual} != ${expected}`,
  );

test("true minimum starts at zero rather than the current pace; no writes or personal fractions", () => {
  const input = setup();
  const before = structuredClone(input);
  const goal = financialSessionGoal(input);
  assert.equal(goal.status, "available");
  close(goal.practiceWeeklyGoal, 20 / (31 / 7));
  assert.deepEqual(input, before);
  assert.equal(goal.individualWeeklyGoals[1], null);
  input.workspace.settings.baselineWeeklySessions = 1;
  close(
    financialSessionGoal(input).practiceWeeklyGoal,
    goal.practiceWeeklyGoal!,
  );
});

test("owner pretax distributions, fixed co-owner salary, retained cash and profit reconcile without adding salary twice", () => {
  const input = setup();
  const { workspace, context } = input;
  context.clinicians.push({
    ...context.clinicians[0],
    id: 2,
    label: "Erin",
    classification: "w2",
  });
  workspace.settings.familyW2ClinicianId = 2;
  workspace.clinicians.push(
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: 2,
      start: "2026-01-01",
      desiredWeeklySessions: 100,
      inPersonPct: 0,
      payMode: "salary",
      payAmount: 12000,
    }),
  );
  workspace.allocations.push(
    allocationSchema.parse({
      id: randomUUID(),
      name: "Elia distribution",
      kind: "distribution",
      percent: 50,
      household: true,
      start: "2026-01-01",
    }),
  );
  workspace.goals.push(
    goalSchema.parse({
      id: randomUUID(),
      name: "Owner Pay",
      metric: "ownerDistributionsPretax",
      amount: 500,
    }),
    goalSchema.parse({
      id: randomUUID(),
      name: "Co-Owner Pay",
      metric: "coOwnerSalaryPretax",
      amount: 1000,
    }),
  );
  input.baselineMix = {
    byClinician: { 1: 1, 2: 0 },
    source: "explicit owner clinical scenario",
  };
  input.additionalTargets = [
    {
      name: "Retained profit",
      metric: "retainedCash",
      amount: 500,
      basis: "monthly",
      source: "explicit retained cash target",
    },
  ];
  const goal = financialSessionGoal(input);
  assert.equal(goal.status, "available");
  close(goal.practiceWeeklyGoal, 30 / (31 / 7));
  close(goal.details.values!.clinicianPay, 1000);
  close(goal.details.values!.profit, 1000);
  close(goal.details.values!.ownerDistributionsPretax, 500);
  close(goal.details.values!.coOwnerSalaryPretax, 1000);
  close(goal.details.values!.retainedCash, 500);
});

test("recurring contribution tests exact fund allocation, never total balance as expense", () => {
  const input = setup();
  input.workspace.fundGoals.push(
    fundGoalSchema.parse({
      id: randomUUID(),
      name: "Building Fund",
      amount: 100000,
      currentBalance: 10000,
      balanceDate: "2026-01-01",
    }),
  );
  const allocation = allocationSchema.parse({
    id: randomUUID(),
    name: "Building",
    kind: "reserve",
    percent: 25,
    start: "2026-01-01",
  });
  input.workspace.allocations.push(allocation);
  input.recurringFundContributions = [
    {
      fundName: "Building Fund",
      allocationId: allocation.id,
      amount: 500,
      basis: "monthly",
      source: "approved monthly contribution",
    },
  ];
  const goal = financialSessionGoal(input);
  assert.equal(goal.status, "available");
  close(goal.practiceWeeklyGoal, 30 / (31 / 7));
  close(goal.details.values!.profit, 2000);
  input.workspace.fundGoals[0].amount = 1000000;
  close(
    financialSessionGoal(input).practiceWeeklyGoal,
    goal.practiceWeeklyGoal!,
  );
  input.recurringFundContributions = [];
  assert.match(
    financialSessionGoal(input).unavailableReasons.join(" "),
    /recurring contribution/,
  );
});

function growthInput(amount = 80): FinancialSessionGoalInput {
  const input = setup();
  input.workspace.goals[0].amount = 400;
  input.workspace.fundGoals.push(
    fundGoalSchema.parse({
      id: randomUUID(),
      name: "Growth Fund",
      amount: 100000,
      currentBalance: 0,
      balanceDate: "2026-01-01",
    }),
  );
  const growth = allocationSchema.parse({
    id: randomUUID(),
    name: "Growth",
    kind: "retained",
    percent: 20,
    start: "2026-01-01",
  });
  input.workspace.allocations.push(growth);
  input.recurringFundContributions = [
    {
      fundName: "Growth Fund",
      allocationId: growth.id,
      amount,
      basis: "monthly",
      source: "approved recurring Growth contribution",
    },
  ];
  return input;
}

test("20% Growth receives $80 from a $400 basis, not all unassigned retained cash", () => {
  const input = growthInput();
  for (const [kind, percent] of [
    ["tax", 10],
    ["reserve", 15],
    ["distribution", 25],
  ] as const) {
    input.workspace.allocations.push(
      allocationSchema.parse({
        id: randomUUID(),
        name: kind,
        kind,
        percent,
        start: "2026-01-01",
      }),
    );
  }
  const goal = financialSessionGoal(input);
  assert.equal(goal.status, "available");
  close(goal.details.values!.profit, 400);
  close(goal.details.values!.retainedCash, 200);
  close(
    goal.details.targets.find(
      (t) => t.name === "Growth Fund recurring contribution",
    )!.modeled,
    80,
  );
  close(goal.practiceWeeklyGoal, 14 / (31 / 7));
});

test("$800 recurring Growth target at 20% requires $4000 basis, not $800 retained cash", () => {
  const goal = financialSessionGoal(growthInput(800));
  assert.equal(goal.status, "available");
  close(goal.details.values!.profit, 4000);
  close(
    goal.details.targets.find(
      (t) => t.name === "Growth Fund recurring contribution",
    )!.modeled,
    800,
  );
  close(goal.practiceWeeklyGoal, 50 / (31 / 7));
});

test("named Growth contribution is weighted by its effective days within the selected month", () => {
  const input = growthInput();
  input.workspace.allocations[0].start = "2026-01-16";
  const goal = financialSessionGoal(input);
  assert.equal(goal.status, "available");
  close(goal.details.values!.profit, 80 / ((0.2 * 16) / 31));
  close(
    goal.details.targets.find(
      (t) => t.name === "Growth Fund recurring contribution",
    )!.modeled,
    80,
  );
});

test("recurring fund contribution uses selected financial-period units and preserves explicit zero", () => {
  const input = growthInput(960);
  input.recurringFundContributions![0].basis = "annual";
  input.range = { start: "2026-02-01", end: "2026-02-14" };
  const goal = financialSessionGoal(input);
  assert.equal(goal.status, "available");
  close(
    goal.details.targets.find(
      (t) => t.name === "Growth Fund recurring contribution",
    )!.target,
    40,
  );
  close(
    goal.details.targets.find(
      (t) => t.name === "Growth Fund recurring contribution",
    )!.modeled,
    40,
  );
  close(goal.practiceWeeklyGoal, 3.5);
  input.recurringFundContributions![0].amount = 0;
  input.workspace.allocations[0].percent = 0;
  const zero = financialSessionGoal(input);
  assert.equal(zero.status, "available");
  close(
    zero.details.targets.find(
      (t) => t.name === "Growth Fund recurring contribution",
    )!.modeled,
    0,
  );
});

test("selected calendar month uses dated fees and capacity instead of a different forecast month", () => {
  const input = setup();
  input.workspace.settings.forecastStart = "2030-06-01";
  input.workspace.terms.push(
    termSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      effectiveDate: "2026-02-01",
      sessionRate: 200,
      capacity: 10,
    }),
  );
  const january = financialSessionGoal(input);
  input.range = { start: "2026-02-01", end: "2026-02-28" };
  const february = financialSessionGoal(input);
  close(january.practiceWeeklyGoal, 20 / (31 / 7));
  close(february.practiceWeeklyGoal, 2.5);
  close(february.capacity.weekly, 10);
  assert.equal(february.details.targets[0].target, 1000);
});

test("financial period units use selected days, not days outside the selected period", () => {
  const input = setup();
  input.range = { start: "2026-01-01", end: "2026-02-28" };
  input.periods = [
    { start: "2026-01-01", end: "2026-01-14" },
    { start: "2026-02-01", end: "2026-02-14" },
  ];
  input.workspace.goals[0].basis = "annual";
  input.workspace.goals[0].amount = 12000;
  const goal = financialSessionGoal(input);
  close(goal.details.weeks, 4);
  close(goal.details.targets[0].target, 1000 * (14 / 31 + 14 / 28));
  close(goal.practiceWeeklyGoal, (20 * (14 / 31 + 14 / 28)) / 4);
});

test("capacity is distinct and never replaces an unattainable financial Goal", () => {
  const input = setup();
  input.context.clinicians[0].sessionsPerWeek = 2;
  const goal = financialSessionGoal(input);
  assert.equal(goal.status, "unavailable");
  assert.equal(goal.practiceWeeklyGoal, null);
  close(goal.capacity.weekly, 2);
  assert.equal(goal.capacity.sufficient, false);
  assert.match(goal.unavailableReasons.join(" "), /uncapped financial engine/);
});

test("unset target is unavailable, explicit zero is meaningful, missing attribution stays unavailable", () => {
  const input = setup();
  input.workspace.goals = [];
  assert.equal(financialSessionGoal(input).status, "unavailable");
  input.workspace.goals.push(
    goalSchema.parse({
      id: randomUUID(),
      name: "Zero profit",
      metric: "profit",
      amount: 0,
    }),
  );
  close(financialSessionGoal(input).practiceWeeklyGoal, 10 / (31 / 7));
  input.workspace.goals[0].metric = "sessions";
  close(financialSessionGoal(input).practiceWeeklyGoal, 0);
  input.workspace.goals[0].metric = "ownerDistributionsPretax";
  input.workspace.settings.distributionPct = 0;
  assert.equal(financialSessionGoal(input).status, "available");
  input.workspace.goals[0].amount = 1;
  input.workspace.settings.distributionPct = 25;
  assert.equal(financialSessionGoal(input).status, "unavailable");
});

test("legacy zero wins, archived linked targets do not reappear, no guessed multi-clinician mix", () => {
  const input = setup();
  input.workspace.goals = [
    goalSchema.parse({
      id: randomUUID(),
      name: "Owner Pay",
      metric: "ownerDistributionsPretax",
      amount: 0,
      archived: true,
    }),
  ];
  input.legacyGoal = {
    id: 1,
    name: "Practice",
    ownerPayGoal: 9999,
    secondOwnerPayGoal: 0,
    annualOverheadGoal: 0,
    businessProfitGoal: 0,
  };
  const goal = financialSessionGoal(input);
  assert.ok(!goal.details.targets.some((t) => t.metric === "ownerDistributionsPretax"));
  assert.equal(goal.details.targets.find((t) => t.metric === "coOwnerSalaryPretax")?.target, 0);
  assert.equal(
    goal.details.targets.find((t) => t.name === "Business Profit")?.target,
    0,
  );
  input.context.clinicians.push({ ...input.context.clinicians[0], id: 2 });
  assert.match(
    financialSessionGoal(input).unavailableReasons.join(" "),
    /mix is unavailable/,
  );
});

test("archived salary and distribution targets suppress only their own legacy metric", () => {
  for (const metric of ["coOwnerSalaryPretax", "ownerDistributionsPretax"] as const) {
    const input = setup();
    input.workspace.goals = [goalSchema.parse({ id: randomUUID(), name: "Historic unrelated label", metric, amount: 123, archived: true })];
    input.legacyGoal = { id: 1, name: "Practice", ownerPayGoal: 12000, secondOwnerPayGoal: 24000, annualOverheadGoal: 0, businessProfitGoal: 0 };
    const before = structuredClone(input.workspace);
    const result = financialSessionGoal(input);
    assert.ok(!result.details.targets.some(target => target.metric === metric));
    const other = metric === "coOwnerSalaryPretax" ? "ownerDistributionsPretax" : "coOwnerSalaryPretax";
    assert.ok(result.details.targets.some(target => target.metric === other && target.target > 0));
    assert.deepEqual(input.workspace, before);
  }
});

test("ambiguous owner bindings make financial goal solving unavailable with a diagnostic", () => {
  const input = setup();
  input.workspace.goals = ["Salary A", "Salary B"].map(name => goalSchema.parse({ id: randomUUID(), name, metric: "coOwnerSalaryPretax", amount: 1000 }));
  const result = financialSessionGoal(input);
  assert.equal(result.status, "unavailable");
  assert.match(result.unavailableReasons.join(" "), /multiple saved/);
});

test("invalid or overlapping selected periods cannot double-count financial goals", () => {
  const input = setup();
  input.periods = [
    { start: "2026-01-01", end: "2026-01-15" },
    { start: "2026-01-15", end: "2026-01-31" },
  ];
  assert.equal(financialSessionGoal(input).status, "unavailable");
  input.periods = undefined;
  input.range.start = "2026-02-30";
  assert.equal(financialSessionGoal(input).status, "unavailable");
});

test("salary-only financial Goal covers salary and overhead once instead of financing salary with a loss", () => {
  const input = setup();
  input.workspace.settings.familyW2ClinicianId = 1;
  input.context.clinicians[0].classification = "w2";
  input.workspace.clinicians.push(
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      start: "2026-01-01",
      desiredWeeklySessions: 100,
      inPersonPct: 0,
      payMode: "salary",
      payAmount: 12000,
    }),
  );
  input.workspace.goals = [
    goalSchema.parse({
      id: randomUUID(),
      name: "Erin salary",
      metric: "coOwnerSalaryPretax",
      amount: 1000,
    }),
  ];
  const goal = financialSessionGoal(input);
  assert.equal(goal.status, "available");
  close(goal.practiceWeeklyGoal, 20 / (31 / 7));
  close(goal.details.values!.profit, 0);
});

test("dated changes in a partial month remain unavailable rather than borrowing a whole-month financial mix", () => {
  const input = setup();
  input.range = { start: "2026-01-16", end: "2026-01-31" };
  input.workspace.terms.push(
    termSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      effectiveDate: "2026-01-16",
      sessionRate: 200,
      capacity: 5,
    }),
  );
  const goal = financialSessionGoal(input);
  assert.equal(goal.practiceWeeklyGoal, null);
  assert.match(
    goal.unavailableReasons.join(" "),
    /Daily financial aggregation/,
  );
});

test("unknown opening compensation cap cannot silently become zero", () => {
  const input = setup();
  input.range = { start: "2026-03-01", end: "2026-03-31" };
  input.context.clinicians[0].capEnabled = true;
  input.context.clinicians[0].capAmount = 10000;
  const goal = financialSessionGoal(input);
  assert.equal(goal.practiceWeeklyGoal, null);
  assert.match(
    goal.unavailableReasons.join(" "),
    /missing financial assumptions/,
  );
});

test("unverified in-person capacity cannot certify a financial session Goal", () => {
  const input = setup();
  input.workspace.settings.defaultInPersonPct = 100;
  const result = financialSessionGoal(input);
  assert.equal(result.status, "unavailable");
  assert.equal(result.practiceWeeklyGoal, null);
  assert.equal(result.capacity.sufficient, null);
  assert.match(result.knownSourceAssumptions.join(" "), /capacity is unverified/);
  assert.match(result.unavailableReasons.join(" "), /unverified capacity/);
  input.workspace.settings.defaultInPersonPct = 0;
  assert.equal(financialSessionGoal(input).status, "available", "explicit telehealth capacity retains the existing valid financial solution");
});

test("historical billed charges cannot finance a hypothetical zero-session minimum", () => {
  const input = setup();
  const clean = financialSessionGoal(input);
  input.context.importedBillingActuals = [{ clinicianId: 1, serviceDate: "2026-01-10", totalFeeCharged: 3000, sourceRowHash: "synthetic-charge" }];
  const before = structuredClone(input);
  const charged = financialSessionGoal(input);
  assert.equal(charged.status, "available");
  close(charged.practiceWeeklyGoal, clean.practiceWeeklyGoal!);
  close(charged.details.values!.revenue, 2000);
  assert.deepEqual(input, before);
});

test("unknown selected staff pay or burden withholds feasibility while explicit zero remains known", () => {
  const input = setup();
  input.context.staff.push({ id: 1, goalId: null, label: "Synthetic staff", annualSalary: null, hourlyRate: null, hoursPerWeek: null, weeksPerYear: 48, classification: "w2", w2EmployerFicaPct: 7.65, futaSutaPct: 1, workersCompPct: 0.5, otherEmployerBurdenPct: 0 });
  const before = structuredClone(input);
  const unknown = financialSessionGoal(input);
  assert.equal(unknown.status, "unavailable");
  assert.match(unknown.unavailableReasons.join(" "), /Synthetic staff.*pay.*unavailable/i);
  assert.deepEqual(input, before);
  input.context.staff[0].annualSalary = 0;
  assert.equal(financialSessionGoal(input).status, "available");
  input.context.staff[0].annualSalary = 48000;
  close(financialSessionGoal(input).details.values!.staffCost, 4366);
  input.context.staff[0].w2EmployerFicaPct = undefined as never;
  assert.equal(financialSessionGoal(input).status, "unavailable");
  input.context.staff[0].goalId = 99;
  assert.equal(financialSessionGoal(input).status, "available", "unselected staff cannot block this practice");
});

test("staff cost coverage respects dated pay terms across the selected window", () => {
  const input = setup();
  input.context.staff.push({ id: 1, goalId: null, label: "Dated staff", annualSalary: null, hourlyRate: null, hoursPerWeek: null, weeksPerYear: 48, classification: "1099", w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 });
  input.workspace.staffTerms.push(staffTermSchema.parse({ id: randomUUID(), staffMemberId: 1, effectiveDate: "2026-01-16", annualSalary: 12000 }));
  assert.equal(financialSessionGoal(input).status, "unavailable", "later known terms do not prove earlier missing pay");
  input.workspace.staffTerms[0].effectiveDate = "2026-01-01";
  assert.equal(financialSessionGoal(input).status, "available");
});

test("a fixed-salary shortfall identifies pay terms rather than insufficient capacity", () => {
  const input = setup();
  input.workspace.settings.familyW2ClinicianId = 2;
  input.context.clinicians.push({ ...input.context.clinicians[0], id: 2, label: "Synthetic Erin", classification: "w2" });
  input.workspace.clinicians.push(clinicianSettingSchema.parse({ id: randomUUID(), clinicianId: 2, start: "2026-01-01", desiredWeeklySessions: 100, inPersonPct: 0, payMode: "salary", payAmount: 12000 }));
  input.workspace.goals = [goalSchema.parse({ id: randomUUID(), name: "Co-owner salary", metric: "coOwnerSalaryPretax", amount: 2000 })];
  input.baselineMix = { byClinician: { 1: 1, 2: 0 }, source: "Explicit synthetic owner-session mix" };
  const before = structuredClone(input);
  const result = financialSessionGoal(input);
  assert.equal(result.status, "unavailable");
  assert.equal(result.capacity.sufficient, null);
  assert.match(result.unavailableReasons.join(" "), /fixed.*salary.*1000.*2000.*sessions cannot/i);
  assert.doesNotMatch(result.unavailableReasons.join(" "), /uncapped|above capacity/);
  assert.deepEqual(input, before);
});

test("former clinicians and other-team staff cannot receive or distort a current financial session Goal", () => {
  const input = setup();
  const baseline = financialSessionGoal(input);
  input.context.clinicians.push({ ...input.context.clinicians[0], id: 2, label: "Former clinician", sessionRate: 1000, sessionsPerWeek: 100 });
  input.workspace.clinicians.push(clinicianSettingSchema.parse({ id: randomUUID(), clinicianId: 2, start: "2025-01-01", onTeam: false, desiredWeeklySessions: 100, payMode: "salary", payAmount: 120000 }));
  input.context.staff.push({ id: 99, goalId: 99, label: "Other configuration staff", annualSalary: null, hourlyRate: null, hoursPerWeek: null, weeksPerYear: 48, classification: "w2", w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 });
  const before = structuredClone(input);
  const current = financialSessionGoal(input);
  assert.equal(current.status, "available");
  close(current.practiceWeeklyGoal, baseline.practiceWeeklyGoal!);
  close(current.details.values!.clinicianPay, baseline.details.values!.clinicianPay!);
  assert.equal(current.individualWeeklyGoals[2], null);
  input.baselineMix = { byClinician: { 1: 1, 2: 1000 }, source: "Explicit mix includes a former clinician" };
  close(financialSessionGoal(input).practiceWeeklyGoal, baseline.practiceWeeklyGoal!);
  delete input.baselineMix;
  assert.deepEqual(input, before, "former profiles and source facts are preserved");
  const partial = setup();
  partial.range = { start: "2026-01-01", end: "2026-01-14" };
  const cleanPartial = financialSessionGoal(partial);
  partial.context.clinicians.push(input.context.clinicians[1]);
  partial.workspace.clinicians.push({ ...input.workspace.clinicians[0], end: "2026-01-07" });
  partial.context.staff.push(input.context.staff[0]);
  partial.workspace.staffTerms.push(staffTermSchema.parse({ id: randomUUID(), staffMemberId: 99, effectiveDate: "2026-01-07", annualSalary: 999999 }));
  const scopedPartial = financialSessionGoal(partial);
  assert.equal(scopedPartial.status, "available", "unselected dated staff/former-clinician changes do not invalidate the current window");
  close(scopedPartial.practiceWeeklyGoal, cleanPartial.practiceWeeklyGoal!);
});
