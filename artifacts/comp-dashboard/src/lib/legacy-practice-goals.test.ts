import { test } from "node:test";
import assert from "node:assert/strict";
import type { BusinessGoal } from "@workspace/api-client-react";
import {
  emptyWorkspace,
  goalSchema,
  fundGoalSchema,
} from "@workspace/practice/hub";
import { resolveWorkspaceDefaults } from "./workspace-defaults.ts";
import { linkedGoalFor, linkedFundGoalFor } from "./legacy-practice-goals.ts";

const legacy: BusinessGoal = {
  id: 7,
  name: "Year 1 Baseline",
  timeHorizon: "1year",
  ownerPayGoal: 90_000,
  secondOwnerPayGoal: 30_000,
  annualOverheadGoal: 120_000,
  businessProfitGoal: 24_000,
  desiredCliniciansCount: 6,
  desiredOwnerClinicalCaseload: 0,
  buildingFundGoal: 0,
  emergencyReserveGoal: 0,
  growthFundGoal: 0,
  notes: null,
  createdAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
};

test("selected original legacy goals show 90000 annual owner pay and 6 clinicians without writes", () => {
  const stored = emptyWorkspace("2026-10-14");
  const before = structuredClone({ stored, legacy });
  const resolved = resolveWorkspaceDefaults(
    stored,
    { clinicians: [], staff: [], sessions: [] },
    [legacy],
  );
  const owner = linkedGoalFor("Owner pay", resolved.workspace, resolved.goal);
  assert.equal(owner.origin, "legacy");
  assert.equal(owner.goal?.amount, 90_000);
  assert.equal(owner.goal?.metric, "ownerDistributionsPretax");
  assert.equal(owner.goal?.basis, "annual");
  assert.equal(owner.goal?.date, null);
  assert.equal(owner.goal?.id, undefined);
  const clinicians = linkedGoalFor(
    "Desired Clinicians",
    resolved.workspace,
    resolved.goal,
  );
  assert.equal(clinicians.goal?.amount, 6);
  assert.equal(clinicians.goal?.metric, "activeClinicalHeadcount");
  assert.equal(resolved.workspace.goals.length, 0);
  assert.deepEqual({ stored, legacy }, before);
});

test("active named workspace zero and edits override legacy values", () => {
  const workspace = emptyWorkspace("2026-10-14");
  const zero = goalSchema.parse({
    id: crypto.randomUUID(),
    name: "OWNER PAY",
    metric: "ownerDistributionsPretax",
    amount: 0,
    basis: "monthly",
    date: "2027-03-01",
  });
  workspace.goals.push(zero);
  const binding = linkedGoalFor("Owner pay", workspace, legacy);
  assert.equal(binding.origin, "workspace");
  assert.deepEqual(binding.goal, zero);
  assert.deepEqual(binding.initialDraftDefaults, {
    amount: 0,
    basis: "monthly",
    date: "2027-03-01",
  });
  zero.amount = 1234;
  assert.equal(
    linkedGoalFor("Owner pay", workspace, legacy).goal?.amount,
    1234,
  );
  assert.equal(binding.goal?.amount, 0);
});

test("basis or date as the first edit preserves the inherited amount in a valid draft", () => {
  const workspace = emptyWorkspace("2026-10-14");
  const binding = linkedGoalFor("Owner pay", workspace, legacy);
  for (const patch of [
    { basis: "monthly" },
    { date: "2027-06-01" },
    { amount: 0 },
  ]) {
    const draft = goalSchema.parse({
      id: crypto.randomUUID(),
      name: "Owner pay",
      metric: binding.goal?.metric,
      ...binding.initialDraftDefaults,
      ...patch,
    });
    assert.equal(draft.amount, "amount" in patch ? 0 : 90_000);
  }
  assert.equal(workspace.goals.length, 0);
});

test("co-owner salary and business profit use the correct annual measures", () => {
  const workspace = emptyWorkspace("2026-10-14");
  assert.deepEqual(linkedGoalFor("Co-owner pay", workspace, legacy).goal, {
    name: "Co-owner pay",
    metric: "coOwnerSalaryPretax",
    amount: 30_000,
    basis: "annual",
    date: null,
  });
  assert.deepEqual(linkedGoalFor("Business Profit", workspace, legacy).goal, {
    name: "Business Profit",
    metric: "profit",
    amount: 24_000,
    basis: "annual",
    date: null,
  });
});

test("only the selected legacy goal supplies fallback, and archived named goals suppress inheritance", () => {
  const workspace = emptyWorkspace("2026-10-14");
  workspace.settings.teamId = 99;
  const resolved = resolveWorkspaceDefaults(
    workspace,
    { clinicians: [], staff: [], sessions: [] },
    [legacy],
  );
  assert.equal(
    linkedGoalFor("Owner pay", resolved.workspace, resolved.goal).origin,
    "none",
  );
  workspace.goals.push(
    goalSchema.parse({
      id: crypto.randomUUID(),
      name: "Owner pay",
      metric: "ownerDistributionsPretax",
      amount: 1,
      archived: true,
    }),
  );
  const archived = linkedGoalFor("Owner pay", workspace, legacy);
  assert.equal(archived.goal, null);
  assert.equal(archived.origin, "workspace");
  assert.equal(archived.initialDraftDefaults.amount, 0);
  assert.equal(linkedGoalFor("Revenue", workspace, legacy).goal, null);
});

test("an active goal wins even when an archived goal with the same name comes first", () => {
  const workspace = emptyWorkspace("2026-10-14");
  workspace.goals.push(
    goalSchema.parse({
      id: crypto.randomUUID(),
      name: "Owner pay",
      metric: "ownerDistributionsPretax",
      amount: 90_000,
      archived: true,
    }),
    goalSchema.parse({
      id: crypto.randomUUID(),
      name: "Owner pay",
      metric: "ownerDistributionsPretax",
      amount: 0,
    }),
  );
  assert.equal(linkedGoalFor("Owner pay", workspace, legacy).goal?.amount, 0);
});

test("fund fallback uses real legacy target fields and keeps balances unknown without writes", () => {
  const workspace = emptyWorkspace("2026-10-14");
  const source = {
    ...legacy,
    buildingFundGoal: 100_000,
    emergencyReserveGoal: 20_000,
    growthFundGoal: 30_000,
  };
  const before = structuredClone({ workspace, source });
  for (const [name, amount] of [
    ["Building Fund", 100_000],
    ["Emergency Reserve", 20_000],
    ["Growth Fund", 30_000],
  ] as const) {
    const binding = linkedFundGoalFor(name, workspace, source);
    assert.equal(binding.origin, "legacy");
    assert.deepEqual(binding.goal, {
      name,
      amount,
      date: null,
      currentBalance: null,
      balanceDate: null,
    });
    const draft = fundGoalSchema.parse({
      id: crypto.randomUUID(),
      name,
      ...binding.initialDraftDefaults,
      date: "2027-06-01",
    });
    assert.equal(draft.amount, amount);
    assert.equal(draft.currentBalance, null);
  }
  assert.deepEqual({ workspace, source }, before);
});

test("explicit fund zero, balance and archive override legacy targets", () => {
  const workspace = emptyWorkspace("2026-10-14");
  const source = { ...legacy, buildingFundGoal: 100_000 };
  const fund = fundGoalSchema.parse({
    id: crypto.randomUUID(),
    name: "BUILDING FUND",
    amount: 0,
    currentBalance: 500,
    balanceDate: "2026-10-14",
  });
  workspace.fundGoals.push(fund);
  const binding = linkedFundGoalFor("Building Fund", workspace, source);
  assert.equal(binding.origin, "workspace");
  assert.deepEqual(binding.goal, fund);
  assert.equal(binding.initialDraftDefaults.currentBalance, 500);
  fund.archived = true;
  const archived = linkedFundGoalFor("Building Fund", workspace, source);
  assert.equal(archived.origin, "workspace");
  assert.equal(archived.goal, null);
  assert.equal(archived.initialDraftDefaults.currentBalance, null);
  workspace.fundGoals.push(
    fundGoalSchema.parse({
      id: crypto.randomUUID(),
      name: "Building Fund",
      amount: 1,
    }),
  );
  assert.equal(
    linkedFundGoalFor("Building Fund", workspace, source).goal?.amount,
    1,
  );
});

test("fund fallback leaves absent and invalid fields absent, preserves zero and rejects unknown names", () => {
  const workspace = emptyWorkspace("2026-10-14");
  for (const value of [NaN, Infinity, -1, undefined]) {
    assert.equal(
      linkedFundGoalFor("Growth Fund", workspace, {
        ...legacy,
        growthFundGoal: value,
      }).goal,
      null,
    );
  }
  assert.equal(
    linkedFundGoalFor("Growth Fund", workspace, legacy).goal?.amount,
    0,
  );
  assert.equal(
    linkedFundGoalFor("Something else", workspace, legacy).goal,
    null,
  );
  assert.equal(
    linkedFundGoalFor("Growth Fund", workspace, null).origin,
    "none",
  );
});

test("missing or invalid legacy fields remain absent while legacy zero is valid", () => {
  const workspace = emptyWorkspace("2026-10-14");
  for (const amount of [NaN, Infinity, -1]) {
    assert.equal(
      linkedGoalFor("Owner pay", workspace, { ...legacy, ownerPayGoal: amount })
        .origin,
      "none",
    );
  }
  const { desiredCliniciansCount: _count, ...olderGoal } = legacy;
  assert.equal(
    linkedGoalFor("Desired Clinicians", workspace, olderGoal).goal,
    null,
  );
  assert.equal(
    linkedGoalFor("Owner pay", workspace, { ...legacy, ownerPayGoal: 0 }).goal
      ?.amount,
    0,
  );
  assert.deepEqual(
    linkedGoalFor("Owner pay", workspace, null).initialDraftDefaults,
    { amount: 0, basis: "annual", date: null },
  );
});
