import { cashAllocationsForRange, type ForecastMonth } from "./engine.ts";
import type { Workspace } from "./model.ts";

export function projectedCashAllocations(
  workspace: Workspace,
  month: ForecastMonth,
  start: string,
  end: string,
) {
  const values = month.values;
  const components = [values.retainedCash, values.taxReserve, values.reserves, values.distributions];
  if (components.some((value) => value == null || !Number.isFinite(value))) return null;
  const surplus = Math.max(0, components.reduce<number>((sum, value) => sum + value!, 0));
  const { buckets, configured } = cashAllocationsForRange(workspace.allocations, surplus, start, end);
  const distribution = values.distributions!;
  const requestedDistribution = buckets.filter((bucket) => bucket.kind === "distribution")
    .reduce((sum, bucket) => sum + bucket.amount, 0);
  const allocations = configured ? buckets.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    kind: bucket.kind,
    amount: bucket.kind === "distribution"
      ? requestedDistribution > 0 ? bucket.amount * distribution / requestedDistribution : 0
      : bucket.amount,
  })) : [
    { id: "tax", name: "Tax fund", kind: "tax", amount: values.taxReserve! },
    { id: "reserve", name: "Business reserves", kind: "reserve", amount: values.reserves! },
    { id: "distribution", name: "Your distribution", kind: "distribution", amount: distribution },
  ];
  if (configured) {
    // Dated tax/reserve budgets add to percentage buckets in the engine.
    for (const [kind, total] of [["tax", values.taxReserve!], ["reserve", values.reserves!]] as const) {
      const assigned = allocations.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.amount, 0);
      if (total - assigned > 1e-8)
        allocations.push({ id: `modeled-${kind}-budget`, name: `Additional ${kind} budget`, kind, amount: total - assigned });
    }
  }
  return {
    surplus,
    allocations,
    distribution,
    retained: values.retainedCash!,
    familyDistribution: configured ? values.ownerDistributionsPretax ?? 0 : distribution,
  };
}
