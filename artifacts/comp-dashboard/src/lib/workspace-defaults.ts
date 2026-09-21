import type { Context, Workspace } from "@workspace/practice/hub";

export type CompensationGoal = {
  id: number;
  name: string;
  ownerPayGoal: number;
  secondOwnerPayGoal: number;
  annualOverheadGoal: number;
  businessProfitGoal: number;
};

const inheritedCategoryId = "00000000-0000-4000-8000-000000000101";
const inheritedBudgetId = "00000000-0000-4000-8000-000000000102";

export type WorkspaceDefaults = {
  workspace: Workspace;
  forecastWorkspace: Workspace;
  goal: CompensationGoal | null;
  inherited: {
    team: boolean;
    sessionPace: boolean;
    overhead: boolean;
    ownerPay: boolean;
    profitGoal: boolean;
  };
};

export function resolveWorkspaceDefaults(
  stored: Workspace,
  context: Context,
  goals: CompensationGoal[] = [],
): WorkspaceDefaults {
  const inheritedTeam = stored.settings.teamId === null && goals.length > 0;
  const teamId = stored.settings.teamId ?? goals[0]?.id ?? null;
  const goal = goals.find((item) => item.id === teamId) ?? null;
  const people = context.clinicians.filter(
    (person) => (person.goalId ?? null) === teamId,
  );
  const personIds = new Set(people.map((person) => person.id));
  const hasSessionHistory = context.sessions.some((record) =>
    personIds.has(record.clinicianId),
  );
  const desiredWeeklySessions = people.reduce(
    (total, person) => total + person.sessionsPerWeek,
    0,
  );
  const inheritSessionPace =
    stored.settings.baselineMode === "historical" &&
    !hasSessionHistory &&
    desiredWeeklySessions > 0;
  const ownerPayMonthly = goal
    ? (goal.ownerPayGoal + goal.secondOwnerPayGoal) / 12
    : 0;
  const inheritOwnerPay =
    stored.settings.ownerPayrollMonthly === 0 &&
    ownerPayMonthly > 0;
  const inheritProfitGoal =
    stored.settings.targetProfitMonthly === 0 &&
    (goal?.businessProfitGoal ?? 0) > 0;

  const workspace: Workspace = {
    ...stored,
    settings: {
      ...stored.settings,
      teamId,
      ...(inheritSessionPace
        ? {
            baselineMode: "manual" as const,
            baselineWeeklySessions: desiredWeeklySessions,
          }
        : {}),
      ...(inheritOwnerPay ? { ownerPayrollMonthly: ownerPayMonthly } : {}),
      ...(inheritProfitGoal
        ? { targetProfitMonthly: (goal?.businessProfitGoal ?? 0) / 12 }
        : {}),
    },
  };

  const hasActiveBudget = workspace.budgets.some(
    (budget) => !budget.archived && !budget.planningOnly,
  );
  const inheritOverhead =
    !hasActiveBudget && (goal?.annualOverheadGoal ?? 0) > 0;
  const forecastWorkspace: Workspace = inheritOverhead
    ? {
        ...workspace,
        categories: [
          ...workspace.categories,
          {
            id: inheritedCategoryId,
            name: "Operating overhead",
            archived: false,
            notes: "Inherited from the current compensation plan.",
            sourceAttachmentId: null,
            parentId: null,
            kind: "expense",
            order: -1,
            tags: ["compensation plan"],
          },
        ],
        budgets: [
          ...workspace.budgets,
          {
            id: inheritedBudgetId,
            name: "Current annual overhead",
            archived: false,
            notes: "Inherited from the current compensation plan.",
            sourceAttachmentId: null,
            planningOnly: false,
            start: workspace.settings.forecastStart,
            end: null,
            categoryId: inheritedCategoryId,
            amount: goal?.annualOverheadGoal ?? 0,
            cadence: "annual",
            status: "committed",
            locationId: null,
            roomId: null,
            campaignId: null,
            clinicianId: null,
          },
        ],
      }
    : workspace;

  return {
    workspace,
    forecastWorkspace,
    goal,
    inherited: {
      team: inheritedTeam,
      sessionPace: inheritSessionPace,
      overhead: inheritOverhead,
      ownerPay: inheritOwnerPay,
      profitGoal: inheritProfitGoal,
    },
  };
}
