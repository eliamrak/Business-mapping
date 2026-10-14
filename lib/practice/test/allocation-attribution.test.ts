import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  emptyWorkspace,
  allocationSchema,
  clinicianSettingSchema,
  workspaceSchema,
  forecast,
  monthFlow,
  observed,
  periodSchema,
  cashAllocationsForRange,
  type Context,
} from "../src/hub/index.ts";

const person: Context["clinicians"][number] = {
  id: 1,
  label: "Synthetic",
  goalId: null,
  classification: "other",
  sessionRate: 100,
  sessionsPerWeek: 20,
  weeksWorkedPerYear: 52.1786,
  capEnabled: false,
  capAmount: 0,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  postCapClinicianSplit: 60,
  postCapPracticeSplit: 40,
  w2EmployerFicaPct: 0,
  futaSutaPct: 0,
  workersCompPct: 0,
  otherEmployerBurdenPct: 0,
};
const context: Context = { clinicians: [person], staff: [], sessions: [] };
const record = (
  end = "2026-01-31",
  count = 10,
): Context["sessions"][number] => ({
  id: 1,
  clinicianId: 1,
  start: "2026-01-01",
  end,
  completed: count,
  desired: count,
  cancelled: null,
  noShow: null,
  scheduled: null,
  inPerson: null,
  telehealth: null,
  sourceAttachmentId: null,
  revision: 1,
  updatedAt: `${end}T12:00:00Z`,
});
const setup = (mapped = false) => {
  const workspace = emptyWorkspace("2026-01-01");
  Object.assign(workspace.settings, {
    baselineMode: "manual",
    baselineWeeklySessions: 70 / 31,
    baselineRetentionPct: 100,
    defaultInPersonPct: 0,
    collectionPct: 100,
    collectionDelayMonths: 0,
    overheadFloorMonthly: 0,
    ownerPayrollMonthly: 0,
    horizonMonths: 1,
  });
  if (mapped) {
    workspace.settings.familyW2ClinicianId = 1;
    workspace.clinicians.push(
      clinicianSettingSchema.parse({
        id: randomUUID(),
        clinicianId: 1,
        start: "2026-01-01",
        payMode: "salary",
        payAmount: 0,
        desiredWeeklySessions: 20,
      }),
    );
  }
  return workspace;
};
const bucket = (
  kind: "distribution" | "reserve" | "tax" | "retained",
  percent: number,
  start = "2026-01-01",
  end: string | null = null,
  household = false,
) =>
  allocationSchema.parse({
    id: randomUUID(),
    name: `${kind}-${start}`,
    kind,
    percent,
    start,
    end,
    household,
  });
const close = (actual: number | null | undefined, expected: number) =>
  assert.ok(
    actual !== null &&
      actual !== undefined &&
      Math.abs(actual - expected) < 1e-8,
    `${actual} != ${expected}`,
  );
const flowFor = (workspace: ReturnType<typeof setup>, end = "2026-01-31") =>
  monthFlow(
    workspace,
    {
      ...context,
      clinicians: [
        {
          ...person,
          classification:
            workspace.settings.familyW2ClinicianId === 1 ? "w2" : "other",
        },
      ],
      sessions: [record(end)],
    },
    "2026-01-01",
    end,
  );

test("valid consecutive 100% buckets partition the $400 surplus in both forecast and Money", () => {
  const workspace = setup();
  workspace.allocations = [
    bucket("distribution", 100, "2026-01-01", "2026-01-15", true),
    bucket("reserve", 100, "2026-01-16"),
  ];
  assert.equal(workspaceSchema.safeParse(workspace).success, true);
  const month = forecast(workspace, context)[0];
  const flow = flowFor(workspace);
  close(month.values.profit, 400);
  close(month.values.distributions, (400 * 15) / 31);
  close(month.values.reserves, (400 * 16) / 31);
  close(month.values.ownerDistributionsPretax, (400 * 15) / 31);
  close(month.values.retainedCash, 0);
  close(flow.profit, 400);
  close(flow.distribution, (400 * 15) / 31);
  close(
    flow.allocations.find((item) => item.kind === "reserve")?.amount,
    (400 * 16) / 31,
  );
  close(
    flow.allocations.reduce((sum, item) => sum + item.amount, 0),
    400,
  );
  close(flow.retained, 0);
  assert.ok(
    month.warnings.every(
      (warning) => !warning.includes("cash allocations exceed"),
    ),
  );
});

test("inclusive allocation start/end boundaries use only the selected Money days", () => {
  const workspace = setup();
  workspace.allocations = [
    bucket("distribution", 100, "2026-01-01", "2026-01-15", true),
    bucket("reserve", 100, "2026-01-16"),
  ];
  const fifteenth = flowFor(workspace, "2026-01-15");
  close(fifteenth.distribution, 400);
  assert.equal(
    fifteenth.allocations.some((item) => item.kind === "reserve"),
    false,
  );
  const sixteenth = flowFor(workspace, "2026-01-16");
  close(sixteenth.distribution, (400 * 15) / 16);
  close(
    sixteenth.allocations.find((item) => item.kind === "reserve")?.amount,
    400 / 16,
  );
  close(sixteenth.retained, 0);
});

test("single-day, outside-range and archived allocations honor exact boundaries", () => {
  const allocations = [
    bucket("distribution", 100, "2026-01-15", "2026-01-15", true),
    bucket("reserve", 100, "2026-02-01"),
    { ...bucket("tax", 100), archived: true },
    bucket("retained", 100, "2025-12-01", "2025-12-31"),
  ];
  const all = cashAllocationsForRange(
    allocations,
    310,
    "2026-01-01",
    "2026-01-31",
  );
  assert.equal(all.buckets.length, 1);
  close(all.buckets[0].amount, 10);
  close(
    cashAllocationsForRange(allocations, 310, "2026-01-15", "2026-01-15")
      .buckets[0].amount,
    310,
  );
  assert.equal(
    cashAllocationsForRange(allocations, 310, "2026-01-16", "2026-01-31")
      .configured,
    false,
  );
});

test("full-month buckets preserve full percentages and gaps leave cash unassigned", () => {
  const workspace = setup();
  workspace.allocations = [
    bucket("distribution", 10, "2025-12-01", null, true),
    bucket("reserve", 20),
  ];
  close(forecast(workspace, context)[0].values.distributions, 40);
  close(forecast(workspace, context)[0].values.reserves, 80);
  close(flowFor(workspace).distribution, 40);
  close(flowFor(workspace).retained, 280);
  workspace.allocations = [
    bucket("distribution", 100, "2026-01-01", "2026-01-10", true),
  ];
  close(forecast(workspace, context)[0].values.distributions, (400 * 10) / 31);
  close(flowFor(workspace).retained, (400 * 21) / 31);
});

test("non-overlap is evaluated per day, not by summing percentages across the month", () => {
  const workspace = setup();
  workspace.allocations = [
    bucket("distribution", 100, "2026-01-01", "2026-01-15"),
    bucket("reserve", 100, "2026-01-16"),
  ];
  assert.equal(
    cashAllocationsForRange(
      workspace.allocations,
      400,
      "2026-01-01",
      "2026-01-31",
    ).maxDailyPercent,
    100,
  );
  workspace.allocations[1].start = "2026-01-15";
  assert.equal(workspaceSchema.safeParse(workspace).success, false);
  assert.equal(
    cashAllocationsForRange(
      workspace.allocations,
      400,
      "2026-01-01",
      "2026-01-31",
    ).maxDailyPercent,
    200,
  );
});

test("mapped zero-salary family receives only its $100 household distribution, not the other owner's $100", () => {
  const workspace = setup(true);
  workspace.allocations = [
    bucket("distribution", 10, "2026-01-01", null, true),
    bucket("distribution", 10),
  ];
  const month = forecast(workspace, {
    ...context,
    clinicians: [{ ...person, classification: "w2" }],
  })[0];
  const flow = flowFor(workspace);
  close(month.values.profit, 1000);
  close(month.values.distributions, 200);
  close(month.values.ownerDistributionsPretax, 100);
  close(month.values.familyTakeHome, 100);
  close(flow.familyGrossPay, 0);
  close(flow.distribution, 200);
  close(flow.familyTakeHome, 100);
});

test("household attribution uses date-weighted amounts rather than raw percent shares", () => {
  const workspace = setup(true);
  workspace.allocations = [
    bucket("distribution", 10, "2026-01-01", "2026-01-15", true),
    bucket("distribution", 10),
  ];
  const month = forecast(workspace, context)[0];
  close(month.values.distributions, 100 + (100 * 15) / 31);
  close(month.values.ownerDistributionsPretax, (100 * 15) / 31);
  close(month.values.familyTakeHome, (100 * 15) / 31);
  close(flowFor(workspace).familyTakeHome, (100 * 15) / 31);
});

test("zero household percentage is a recorded zero, not a share of unrelated distributions", () => {
  const workspace = setup(true);
  workspace.allocations = [
    bucket("distribution", 0, "2026-01-01", null, true),
    bucket("distribution", 10),
  ];
  const month = forecast(workspace, context)[0];
  close(month.values.ownerDistributionsPretax, 0);
  close(month.values.familyTakeHome, 0);
  close(flowFor(workspace).familyTakeHome, 0);
});

test("no current household allocation contributes zero family distribution and preserves unknown owner attribution", () => {
  const workspace = setup(true);
  workspace.allocations = [
    bucket("distribution", 10),
    bucket("distribution", 10, "2026-02-01", null, true),
  ];
  const month = forecast(workspace, context)[0];
  assert.equal(month.values.ownerDistributionsPretax, null);
  close(month.values.distributions, 100);
  close(month.values.familyTakeHome, 0);
  close(flowFor(workspace).familyTakeHome, 0);
});

test("undated legacy setting percentages preserve their distribution and family behavior", () => {
  const workspace = setup(true);
  Object.assign(workspace.settings, {
    taxPct: 10,
    reservePct: 20,
    distributionPct: 30,
  });
  const month = forecast(workspace, context)[0];
  const flow = flowFor(workspace);
  close(month.values.taxReserve, 100);
  close(month.values.reserves, 200);
  close(month.values.distributions, 300);
  close(month.values.familyTakeHome, 300);
  assert.equal(month.values.ownerDistributionsPretax, null);
  close(flow.distribution, 300);
  close(flow.familyTakeHome, 300);
  close(flow.retained, 400);
});

test("zero or negative surplus cannot generate distributions or household income", () => {
  const workspace = setup(true);
  workspace.allocations = [
    bucket("distribution", 100, "2026-01-01", null, true),
  ];
  workspace.settings.overheadFloorMonthly = 2000;
  const month = forecast(workspace, context)[0];
  close(month.values.distributions, 0);
  close(month.values.ownerDistributionsPretax, 0);
  close(month.values.familyTakeHome, 0);
  const flow = flowFor(workspace);
  close(flow.distribution, 0);
  close(flow.familyTakeHome, 0);
  close(flow.retained, -1000);
  close(
    cashAllocationsForRange(
      workspace.allocations,
      0,
      "2026-01-01",
      "2026-01-31",
    ).buckets[0].amount,
    0,
  );
});

test("actual family totals use recorded household distributions, preserving explicit zero and unknown attribution", () => {
  const workspace = setup(true);
  workspace.allocations = [
    bucket("distribution", 10, "2026-01-01", null, true),
    bucket("distribution", 10),
  ];
  for (const ownerDistributionsPretax of [100, 0, null]) {
    workspace.periods = [
      periodSchema.parse({
        id: randomUUID(),
        name: "January",
        start: "2026-01-01",
        end: "2026-01-31",
        status: "finalized",
        ownerPay: 0,
        ownerClinicalPay: 0,
        distributions: 200,
        ownerDistributionsPretax,
      }),
    ];
    const actual = observed(
      workspace,
      context,
      "2026-01-01",
      "2026-01-31",
    ).values;
    assert.equal(actual.familyTakeHome, ownerDistributionsPretax);
    assert.equal(actual.distributions, 200);
  }
  workspace.allocations = [];
  assert.equal(
    observed(workspace, context, "2026-01-01", "2026-01-31").values
      .familyTakeHome,
    200,
  );
  workspace.allocations = [bucket("distribution", 10)];
  workspace.periods[0].distributions = 0;
  assert.equal(observed(workspace, context, "2026-01-01", "2026-01-31").values.familyTakeHome, 0);
});
