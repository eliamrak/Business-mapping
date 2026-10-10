import { eq, isNull } from "drizzle-orm";
import {
  db,
  cliniciansTable,
  hubWorkspacesTable,
  sessionGoalYearsTable,
} from "@workspace/db";
import { workspaceSchema } from "@workspace/practice/hub";

export class SessionGoalConflict extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

export type SessionGoalInput = {
  clinicianId: number;
  year: number;
  sessionsPerWeek: number;
};

export type SessionGoalAccess = {
  requireActiveTeam?: boolean;
};

export const toSessionGoal = (
  row: typeof sessionGoalYearsTable.$inferSelect,
) => ({
  id: row.id,
  clinicianId: row.clinicianId,
  year: row.year,
  sessionsPerWeek: Number(row.sessionsPerWeek),
  updatedAt: row.updatedAt.toISOString(),
});

export async function listSessionGoalsForGoal(goal: string | number | null) {
  const rows = await db
    .select({ goal: sessionGoalYearsTable })
    .from(sessionGoalYearsTable)
    .innerJoin(
      cliniciansTable,
      eq(sessionGoalYearsTable.clinicianId, cliniciansTable.id),
    )
    .where(
      goal === "unassigned" || goal === null
        ? isNull(cliniciansTable.goalId)
        : eq(cliniciansTable.goalId, Number(goal)),
    )
    .orderBy(sessionGoalYearsTable.year, sessionGoalYearsTable.clinicianId);
  return rows.map((row) => toSessionGoal(row.goal));
}

export async function saveSessionGoal(
  input: SessionGoalInput,
  access: SessionGoalAccess = {},
) {
  return db.transaction(async (tx) => {
    const [clinician] = await tx
      .select({ id: cliniciansTable.id, goalId: cliniciansTable.goalId })
      .from(cliniciansTable)
      .where(eq(cliniciansTable.id, input.clinicianId));
    if (!clinician)
      throw new SessionGoalConflict(
        "This clinician no longer exists. Refresh the team list.",
        404,
      );
    if (access.requireActiveTeam) {
      const [hub] = await tx
        .select()
        .from(hubWorkspacesTable)
        .where(eq(hubWorkspacesTable.id, 1));
      if (
        !hub ||
        clinician.goalId !== workspaceSchema.parse(hub.data).settings.teamId
      )
        throw new SessionGoalConflict(
          "Data-entry access is limited to the active team.",
          403,
        );
    }
    const [saved] = await tx
      .insert(sessionGoalYearsTable)
      .values({
        clinicianId: input.clinicianId,
        year: input.year,
        sessionsPerWeek: String(input.sessionsPerWeek),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [sessionGoalYearsTable.clinicianId, sessionGoalYearsTable.year],
        set: {
          sessionsPerWeek: String(input.sessionsPerWeek),
          updatedAt: new Date(),
        },
      })
      .returning();
    return toSessionGoal(saved);
  });
}
