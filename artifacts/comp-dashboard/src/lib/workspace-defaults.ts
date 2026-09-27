import type { Context, Workspace } from "@workspace/practice/hub";

export type CompensationGoal = {
  id: number;
  name: string;
  ownerPayGoal: number;
  secondOwnerPayGoal: number;
  annualOverheadGoal: number;
  businessProfitGoal: number;
};

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
    stored.settings.familyW2ClinicianId === null &&
    !stored.settings.ownerPayrollOverride &&
    stored.settings.ownerPayrollMonthly === 0 && ownerPayMonthly > 0;
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

  const inheritOverhead =
    workspace.settings.overheadMode === "baseline" &&
    !workspace.settings.overheadFloorOverride &&
    (goal?.annualOverheadGoal ?? 0) > 0;
  const forecastWorkspace: Workspace = {
    ...workspace,
    settings: {
      ...workspace.settings,
      overheadFloorMonthly: workspace.settings.overheadMode === "detailed"
        ? 0
        : inheritOverhead
          ? Math.max(workspace.settings.overheadFloorMonthly, (goal?.annualOverheadGoal ?? 0) / 12)
          : workspace.settings.overheadFloorMonthly,
    },
  };

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
