import { eq, isNull } from "drizzle-orm";
import {
  db,
  cliniciansTable,
  sessionGoalYearsTable,
} from "@workspace/db";

export class SessionGoalConflict extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export type SessionGoalInput = {
  clinicianId: number;
  year: number;
  sessionsPerWeek: number;
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

export async function saveSessionGoal(input: SessionGoalInput) {
  return db.transaction(async (tx) => {
    const [clinician] = await tx
      .select({ id: cliniciansTable.id })
      .from(cliniciansTable)
      .where(eq(cliniciansTable.id, input.clinicianId));
    if (!clinician)
      throw new SessionGoalConflict(
        "This clinician no longer exists. Refresh the team list.",
        404,
      );
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
