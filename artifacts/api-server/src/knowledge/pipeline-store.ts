import { and, eq } from "drizzle-orm";
import { db, knowledgePipelineStatesTable as states } from "@workspace/db";
import type { KnowledgePipelineStore, PipelineState } from "./import-pipeline";
/** Prepared persistence only; NOT wired to routes, provider adapters, jobs or the live read repository. */
export const postgresKnowledgePipelineStore: KnowledgePipelineStore = {
  async read(scope) {
    const [row] = await db.select().from(states).where(and(eq(states.practiceId, scope.practiceId), eq(states.principalId, scope.principalId)));
    if (!row) return null;
    const state = row.state as PipelineState;
    if (state.generation !== row.generation || state.practiceId !== row.practiceId || state.principalId !== row.principalId)
      throw new Error("Invalid Knowledge state binding");
    return state;
  },
  async compareAndSwap(scope, expectedGeneration, next) {
    if (next.practiceId !== scope.practiceId || next.principalId !== scope.principalId || next.generation !== expectedGeneration + 1)
      throw new Error("Invalid Knowledge state transition");
    if (expectedGeneration === 0) {
      const rows = await db.insert(states).values({ ...scope, generation: next.generation, state: next }).onConflictDoNothing().returning({ generation: states.generation });
      return rows.length === 1;
    }
    const rows = await db.update(states).set({ generation: next.generation, state: next, updatedAt: new Date() }).where(and(
      eq(states.practiceId, scope.practiceId), eq(states.principalId, scope.principalId), eq(states.generation, expectedGeneration),
    )).returning({ generation: states.generation });
    return rows.length === 1;
  },
};
