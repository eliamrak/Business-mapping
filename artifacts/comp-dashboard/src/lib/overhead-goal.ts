import type { Workspace } from "@workspace/practice/hub";

export type OverheadGoalSettings = Pick<
  Workspace["settings"],
  | "overheadGoalBasis"
  | "overheadGoalPercent"
  | "overheadFloorMonthly"
  | "overheadFloorOverride"
  | "overheadMode"
>;
export type OverheadGoalBasis = NonNullable<
  OverheadGoalSettings["overheadGoalBasis"]
>;
export type OverheadGoalPatch = Partial<OverheadGoalSettings>;

export function overheadGoalPatch(
  basis: OverheadGoalBasis,
  value: number,
): OverheadGoalPatch {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > (basis === "fixed_percent" ? 100 : 1e10)
  )
    throw new Error(
      basis === "fixed_percent"
        ? "Enter a percentage between 0 and 100."
        : "Enter a valid dollar amount.",
    );
  return {
    overheadGoalBasis: basis,
    overheadFloorOverride: true,
    ...(basis === "fixed_percent"
      ? { overheadGoalPercent: value }
      : { overheadFloorMonthly: value }),
  };
}

export function overheadGoalSummary(
  settings: OverheadGoalSettings,
  matchingPeriodRevenue: number | null,
  monthFraction = 1,
) {
  if (!Number.isFinite(monthFraction) || monthFraction < 0 || monthFraction > 1)
    throw new Error("Use the selected period's fraction of a month.");
  const revenue =
    matchingPeriodRevenue !== null &&
    Number.isFinite(matchingPeriodRevenue) &&
    matchingPeriodRevenue >= 0
      ? matchingPeriodRevenue
      : null;
  const basis = settings.overheadGoalBasis;
  const explicit = basis !== undefined;
  const percent =
    basis === "fixed_percent" ? (settings.overheadGoalPercent ?? null) : null;
  const dollars =
    basis === "fixed_percent"
      ? percent !== null && revenue !== null
        ? (revenue * percent) / 100
        : null
      : basis === "fixed_dollars" || settings.overheadMode === "baseline"
        ? settings.overheadFloorMonthly * monthFraction
        : null;
  return {
    basis,
    explicit,
    dollars,
    percent:
      basis === "fixed_percent"
        ? percent
        : revenue !== null && revenue > 0 && dollars !== null
          ? (dollars / revenue) * 100
          : null,
  };
}
