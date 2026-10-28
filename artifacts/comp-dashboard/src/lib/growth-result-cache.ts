import { reviewedGrowthFromSources } from "./reviewed-growth-source.ts";
export type GrowthSourceInput = Parameters<typeof reviewedGrowthFromSources>[0];
/** Per-workspace mounted cache. Exact serialized dependencies, never a lossy hash.
 * Bounded to two coherent results; no persistence or external data transmission. */
export function createGrowthResultCache(compute = reviewedGrowthFromSources) {
  const entries = new Map<
    string,
    ReturnType<typeof reviewedGrowthFromSources>
  >();
  return {
    get(key: string) {
      return entries.get(key);
    },
    calculate(input: GrowthSourceInput, key = JSON.stringify(input)) {
      const hit = entries.get(key);
      if (hit) return hit;
      const result = compute(input);
      entries.set(key, result);
      while (entries.size > 2) entries.delete(entries.keys().next().value!);
      return result;
    },
  };
}

/** Current UI policy; does not rewrite saved source records or archived plans. */
export function growthViewSettings(
  saved: import("./reviewed-growth-observations.ts").GrowthSettings,
) {
  return {
    ...saved,
    leadConsultDays: 5,
    reserve: 0,
    checkMonths: Math.max(6, saved.checkMonths, saved.goalMonths),
    providerPlans: Object.fromEntries(
      Object.entries(saved.providerPlans ?? {}).map(([id, plan]) => [
        id,
        { ...plan, reserve: 0 },
      ]),
    ),
  };
}
