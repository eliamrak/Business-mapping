import type { Workspace } from "@workspace/practice/hub";
import type { CompensationGoal } from "./workspace-defaults.ts";

type Goal = Workspace["goals"][number];
export type LinkedPracticeGoal = Pick<
  Goal,
  "name" | "metric" | "amount" | "basis" | "date"
> &
  Partial<Goal>;
export type LinkedGoalBinding = {
  goal: LinkedPracticeGoal | null;
  origin: "workspace" | "legacy" | "none";
  initialDraftDefaults: Pick<Goal, "amount" | "basis" | "date">;
};

const legacyMeasures = {
  "owner pay": { field: "ownerPayGoal", metric: "ownerDistributionsPretax" },
  "co-owner pay": {
    field: "secondOwnerPayGoal",
    metric: "coOwnerSalaryPretax",
  },
  "business profit": { field: "businessProfitGoal", metric: "profit" },
  "desired clinicians": {
    field: "desiredCliniciansCount",
    metric: "activeClinicalHeadcount",
  },
} as const;

// Inherited targets have no persisted identity. Materialize only the edited goal,
// spreading initialDraftDefaults before the user's patch so explicit zero wins.
export function linkedGoalFor(
  name: string,
  workspace: Pick<Workspace, "goals">,
  legacyGoal: CompensationGoal | null | undefined,
): LinkedGoalBinding {
  const key = name.trim().toLowerCase();
  const existing = workspace.goals.find(
    (goal) => !goal.archived && goal.name.trim().toLowerCase() === key,
  );
  const hasStoredName = workspace.goals.some(
    (goal) => goal.name.trim().toLowerCase() === key,
  );
  let goal: LinkedPracticeGoal | null = existing ? { ...existing } : null;
  let origin: LinkedGoalBinding["origin"] = hasStoredName
    ? "workspace"
    : "none";
  const measure = Object.hasOwn(legacyMeasures, key)
    ? legacyMeasures[key as keyof typeof legacyMeasures]
    : undefined;
  if (!hasStoredName && legacyGoal && measure) {
    const amount = legacyGoal[measure.field];
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) {
      goal = {
        name,
        metric: measure.metric,
        amount,
        basis: "annual",
        date: null,
      };
      origin = "legacy";
    }
  }
  return {
    goal,
    origin,
    initialDraftDefaults: {
      amount: goal?.amount ?? 0,
      basis: goal?.basis ?? "annual",
      date: goal?.date ?? null,
    },
  };
}

type FundGoal = Workspace["fundGoals"][number];
export type LinkedFundGoal = Pick<
  FundGoal,
  "name" | "amount" | "date" | "currentBalance" | "balanceDate"
> &
  Partial<FundGoal>;
export type LinkedFundGoalBinding = {
  goal: LinkedFundGoal | null;
  origin: LinkedGoalBinding["origin"];
  initialDraftDefaults: Pick<
    FundGoal,
    "amount" | "date" | "currentBalance" | "balanceDate"
  >;
};

const legacyFunds = {
  "building fund": "buildingFundGoal",
  "emergency reserve": "emergencyReserveGoal",
  "growth fund": "growthFundGoal",
} as const;

export function linkedFundGoalFor(
  name: string,
  workspace: Pick<Workspace, "fundGoals">,
  legacyGoal: CompensationGoal | null | undefined,
): LinkedFundGoalBinding {
  const key = name.trim().toLowerCase();
  const funds = workspace.fundGoals ?? [];
  const existing = funds.find(
    (goal) => !goal.archived && goal.name.trim().toLowerCase() === key,
  );
  const hasStoredName = funds.some(
    (goal) => goal.name.trim().toLowerCase() === key,
  );
  let goal: LinkedFundGoal | null = existing ? { ...existing } : null;
  let origin: LinkedFundGoalBinding["origin"] = hasStoredName
    ? "workspace"
    : "none";
  const field = Object.hasOwn(legacyFunds, key)
    ? legacyFunds[key as keyof typeof legacyFunds]
    : undefined;
  if (!hasStoredName && legacyGoal && field) {
    const amount = legacyGoal[field];
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) {
      // Legacy fund goals are targets, not evidence of a current balance.
      goal = {
        name,
        amount,
        date: null,
        currentBalance: null,
        balanceDate: null,
      };
      origin = "legacy";
    }
  }
  return {
    goal,
    origin,
    initialDraftDefaults: {
      amount: goal?.amount ?? 0,
      date: goal?.date ?? null,
      currentBalance: goal?.currentBalance ?? null,
      balanceDate: goal?.balanceDate ?? null,
    },
  };
}
