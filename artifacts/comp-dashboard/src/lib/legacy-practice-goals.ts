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
  diagnostic: string | null;
  provenance: string | null;
  initialDraftDefaults: Pick<Goal, "amount" | "basis" | "date">;
};

const legacyMeasures = {
  "owner pay": { field: "secondOwnerPayGoal", metric: "coOwnerSalaryPretax" },
  "co-owner pay": {
    field: "ownerPayGoal",
    metric: "ownerDistributionsPretax",
  },
  "business profit": { field: "businessProfitGoal", metric: "profit" },
  "desired clinicians": {
    field: "desiredCliniciansCount",
    metric: "activeClinicalHeadcount",
  },
} as const;

export function linkedGoalForMetric(
  metric: typeof legacyMeasures[keyof typeof legacyMeasures]["metric"],
  workspace: Pick<Workspace, "goals">,
  legacyGoal: CompensationGoal | null | undefined,
): LinkedGoalBinding {
  const name = {
    coOwnerSalaryPretax: "Owner pay",
    ownerDistributionsPretax: "Co-owner pay",
    profit: "Business Profit",
    activeClinicalHeadcount: "Desired Clinicians",
  }[metric];
  return linkedGoalFor(name, workspace, legacyGoal);
}

// Inherited targets have no persisted identity. Materialize only the edited goal,
// spreading initialDraftDefaults before the user's patch so explicit zero wins.
export function linkedGoalFor(
  name: string,
  workspace: Pick<Workspace, "goals">,
  legacyGoal: CompensationGoal | null | undefined,
): LinkedGoalBinding {
  const key = name.trim().toLowerCase();
  const measure = Object.hasOwn(legacyMeasures, key)
    ? legacyMeasures[key as keyof typeof legacyMeasures]
    : undefined;
  const ownerBinding = key === "owner pay" || key === "co-owner pay";
  const ownerMetrics = ["coOwnerSalaryPretax", "ownerDistributionsPretax"];
  const semanticGoals = ownerBinding ? workspace.goals.filter(goal => goal.metric === measure!.metric) : [];
  const activeMatches = semanticGoals.filter(goal => !goal.archived);
  const unknownNamed = ownerBinding && workspace.goals.some(goal =>
    ["owner pay", "co-owner pay"].includes(goal.name.trim().toLowerCase())
    && !ownerMetrics.includes(goal.metric));
  const diagnostic = activeMatches.length > 1
    ? `${name}: multiple saved ${measure!.metric} goals; review their IDs before editing.`
    : unknownNamed ? `${name}: a saved owner goal has an unrecognized funding metric; review its mapping before editing.` : null;
  const existing = ownerBinding ? diagnostic ? undefined : activeMatches[0] : workspace.goals.find(
    (goal) => !goal.archived && goal.name.trim().toLowerCase() === key,
  );
  const hasStoredName = ownerBinding ? semanticGoals.length > 0 || !!diagnostic : workspace.goals.some(
    (goal) => goal.name.trim().toLowerCase() === key,
  );
  let goal: LinkedPracticeGoal | null = existing ? { ...existing } : null;
  let origin: LinkedGoalBinding["origin"] = hasStoredName
    ? "workspace"
    : "none";
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
    diagnostic,
    provenance: existing
      ? `Saved goal "${existing.name}" (${existing.id}); ${existing.metric}. Name and amount retained.`
      : origin === "legacy" ? `Inherited ${measure!.field}; annual amount retained for ${key === "owner pay" ? "Erin salary" : key === "co-owner pay" ? "Elia distributions" : name}.` : null,
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
