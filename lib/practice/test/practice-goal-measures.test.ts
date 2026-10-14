import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  emptyWorkspace,
  forecast,
  forecastForPeriods,
  observed,
  observedSeries,
  clinicianSettingSchema,
  termSchema,
  allocationSchema,
  periodSchema,
  metricMap,
  workspaceSchema,
  goalSchema,
  type Context,
} from "../src/hub/index.ts";

const person = (
  id: number,
  classification = "owner",
  goalId: number | null = null,
): Context["clinicians"][number] => ({
  id,
  label: `Clinician ${id}`,
  goalId,
  classification,
  sessionRate: 100,
  sessionsPerWeek: 40,
  weeksWorkedPerYear: 52.1786,
  capEnabled: false,
  capAmount: 50000,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  postCapClinicianSplit: 75,
  postCapPracticeSplit: 25,
  w2EmployerFicaPct: 0,
  futaSutaPct: 0,
  workersCompPct: 0,
  otherEmployerBurdenPct: 0,
});
const setup = () => {
  const workspace = emptyWorkspace("2026-01-01");
  Object.assign(workspace.settings, {
    baselineMode: "manual",
    baselineWeeklySessions: 100,
    baselineRetentionPct: 100,
    defaultInPersonPct: 0,
    horizonMonths: 2,
  });
  const context: Context = { clinicians: [person(1)], staff: [], sessions: [] };
  return { workspace, context };
};
const close = (actual: number | null | undefined, expected: number) =>
  assert.ok(
    actual != null && Math.abs(actual - expected) < 1e-6,
    `${actual} != ${expected}`,
  );

test("active clinical headcount counts people including owners, not 100 sessions", () => {
  const { workspace, context } = setup();
  context.sessions.push({
    id: 1,
    revision: 1,
    updatedAt: "2026-01-31T00:00:00Z",
    clinicianId: 1,
    start: "2026-01-01",
    end: "2026-01-31",
    completed: 100,
    desired: 100,
    scheduled: null,
    cancelled: null,
    noShow: null,
    inPerson: null,
    telehealth: null,
    sourceAttachmentId: null,
  });
  assert.equal(
    forecast(workspace, context)[0].values.activeClinicalHeadcount,
    1,
  );
  const actual = observed(workspace, context, "2026-01-01", "2026-01-31");
  assert.equal(actual.values.sessions, 100);
  assert.equal(actual.values.activeClinicalHeadcount, 1);
});

test("headcount uses selected team and active dates at period end, excluding planning records", () => {
  const { workspace, context } = setup();
  workspace.settings.teamId = 7;
  context.clinicians = [
    person(1, "owner", 7),
    person(2, "w2", 7),
    person(3, "1099", 7),
    person(4, "w2", 8),
  ];
  workspace.clinicians.push(
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: 1,
      start: "2026-01-01",
      end: "2026-01-15",
      desiredWeeklySessions: 40,
    }),
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: 2,
      start: "2026-02-01",
      desiredWeeklySessions: 40,
    }),
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: 3,
      start: "2026-01-01",
      status: "planned",
      desiredWeeklySessions: 40,
    }),
  );
  const months = forecast(workspace, context);
  assert.equal(months[0].values.activeClinicalHeadcount, 0);
  assert.equal(months[1].values.activeClinicalHeadcount, 1);
  assert.equal(
    observed(workspace, context, "2026-01-01", "2026-01-10").values
      .activeClinicalHeadcount,
    1,
  );
  assert.equal(
    observed(workspace, context, "2026-01-01", "2026-01-31").values
      .activeClinicalHeadcount,
    0,
  );
  assert.equal(
    forecastForPeriods(months, [{ start: "2026-01-01", end: "2026-02-28" }])
      .activeClinicalHeadcount,
    1,
  );
  assert.equal(
    forecastForPeriods(months, [{ start: "2026-01-01", end: "2026-01-10" }])
      .activeClinicalHeadcount,
    1,
  );
});

function salarySetup() {
  const { workspace, context } = setup();
  context.clinicians.push(person(2, "w2"));
  workspace.settings.familyW2ClinicianId = 2;
  workspace.clinicians.push(
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: 2,
      start: "2026-01-01",
      desiredWeeklySessions: 40,
      payMode: "salary",
      payAmount: 12000,
    }),
  );
  workspace.allocations.push(
    allocationSchema.parse({
      id: randomUUID(),
      name: "Household owner",
      kind: "distribution",
      household: true,
      percent: 25,
      start: "2026-01-01",
    }),
    allocationSchema.parse({
      id: randomUUID(),
      name: "Other owner",
      kind: "distribution",
      household: false,
      percent: 25,
      start: "2026-01-01",
    }),
  );
  return { workspace, context };
}

test("co-owner fixed gross salary and owner-only distributions are independent measures", () => {
  const { workspace, context } = salarySetup();
  const values = forecast(workspace, context)[0].values;
  close(values.coOwnerSalaryPretax, 1000);
  assert.ok(values.ownerClinicalPay! > 0);
  close(values.ownerDistributionsPretax, values.distributions! / 2);
  assert.notEqual(values.ownerDistributionsPretax, values.familyTakeHome);
  assert.notEqual(values.coOwnerSalaryPretax, values.clinicianPay);
});

test("income-tax estimates change take-home but never gross salary or pretax distributions", () => {
  const { workspace, context } = salarySetup();
  workspace.settings.estimatedIncomeTaxPct = 0;
  const before = forecast(workspace, context)[0].values;
  workspace.settings.estimatedIncomeTaxPct = 50;
  const after = forecast(workspace, context)[0].values;
  close(after.coOwnerSalaryPretax, before.coOwnerSalaryPretax!);
  close(after.ownerDistributionsPretax, before.ownerDistributionsPretax!);
  assert.notEqual(after.familyTakeHome, before.familyTakeHome);
});

test("gross salary respects dated salary terms and period dates", () => {
  const { workspace, context } = salarySetup();
  workspace.terms.push(
    termSchema.parse({
      id: randomUUID(),
      clinicianId: 2,
      effectiveDate: "2026-01-16",
      payMode: "salary",
      payAmount: 24000,
    }),
  );
  const months = forecast(workspace, context);
  close(months[0].values.coOwnerSalaryPretax, (15 * 1000 + 16 * 2000) / 31);
  close(
    forecastForPeriods(months, [{ start: "2026-01-16", end: "2026-01-31" }])
      .coOwnerSalaryPretax,
    (16 * 2000) / 31,
  );
});

test("non-salary pay and unattributed distribution assumptions never substitute for goal measures", () => {
  const { workspace, context } = salarySetup();
  workspace.clinicians[0].payMode = "existing_split";
  workspace.allocations = [];
  workspace.settings.distributionPct = 50;
  const values = forecast(workspace, context)[0].values;
  assert.ok(values.clinicianPay! > 0);
  assert.ok(values.distributions! > 0);
  assert.equal(values.coOwnerSalaryPretax, null);
  assert.equal(values.ownerDistributionsPretax, null);
});

test("legacy financial periods default new attributed actual measures to null", () => {
  const { workspace, context } = setup();
  const period = periodSchema.parse({
    id: randomUUID(),
    name: "January",
    start: "2026-01-01",
    end: "2026-01-31",
    status: "finalized",
    distributions: 800,
    ownerPay: 1000,
    ownerClinicalPay: 500,
    clinicianPay: 4000,
  });
  workspace.periods.push(period);
  assert.equal(period.ownerDistributionsPretax, null);
  assert.equal(period.coOwnerSalaryPretax, null);
  const actual = observed(workspace, context, period.start, period.end).values;
  assert.equal(actual.familyTakeHome, 2300);
  assert.equal(actual.ownerDistributionsPretax, null);
  assert.equal(actual.coOwnerSalaryPretax, null);
});

test("explicit actual owner distributions and co-owner gross salary sum only matching finalized observations", () => {
  const { workspace, context } = setup();
  for (const [start, end, salary, distribution] of [
    ["2026-01-01", "2026-01-15", 500, 100],
    ["2026-01-16", "2026-01-31", 700, 200],
  ] as const) {
    workspace.periods.push(
      periodSchema.parse({
        id: randomUUID(),
        name: start,
        start,
        end,
        status: "finalized",
        coOwnerSalaryPretax: salary,
        ownerDistributionsPretax: distribution,
      }),
    );
  }
  workspace.periods.push(
    periodSchema.parse({
      id: randomUUID(),
      name: "Draft",
      start: "2026-01-01",
      end: "2026-01-31",
      coOwnerSalaryPretax: 9999,
      ownerDistributionsPretax: 9999,
    }),
  );
  const actual = observed(
    workspace,
    context,
    "2026-01-01",
    "2026-01-31",
  ).values;
  assert.equal(actual.coOwnerSalaryPretax, 1200);
  assert.equal(actual.ownerDistributionsPretax, 300);
  assert.equal(
    observedSeries(workspace, context)[0].values.coOwnerSalaryPretax,
    500,
  );
  workspace.periods[1].coOwnerSalaryPretax = null;
  assert.equal(
    observed(workspace, context, "2026-01-01", "2026-01-31").values
      .coOwnerSalaryPretax,
    null,
  );
});

test("new measures register as valid goal metric keys", () => {
  const { workspace } = setup();
  assert.equal(metricMap.activeClinicalHeadcount?.unit, "number");
  assert.equal(metricMap.ownerDistributionsPretax?.unit, "currency");
  assert.equal(metricMap.coOwnerSalaryPretax?.unit, "currency");
  for (const metric of [
    "activeClinicalHeadcount",
    "ownerDistributionsPretax",
    "coOwnerSalaryPretax",
  ]) {
    workspace.goals.push(
      goalSchema.parse({ id: randomUUID(), name: metric, metric, amount: 1 }),
    );
  }
  assert.ok(workspaceSchema.safeParse(workspace).success);
});
