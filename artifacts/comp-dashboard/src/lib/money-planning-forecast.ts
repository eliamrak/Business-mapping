import { forecast, monthEnd, type Context, type PaceCoverage, type Workspace } from "@workspace/practice/hub";
import { buildPracticeProjection } from "./practice-projection.ts";

/** A full current-month scenario, not imported billed actuals or a partial pay window. */
export function moneyPlanningForecast(workspace: Workspace, context: Context, today: string, coverage: PaceCoverage[] = []) {
  const projection = buildPracticeProjection(workspace, context, "actual", today, coverage);
  const start = today.slice(0, 7) + "-01";
  const end = monthEnd(start);
  const basis = `${start} to ${end} · current-month planning scenario; complete-period observed sessions through ${projection.latestCompleteThrough ?? "unverified"}; clinician-card fees and configured dated costs, not historical billed actuals or bank cash`;
  const months = projection.projectedWeekly === null ? [] : forecast({
    ...projection.projectionWorkspace,
    settings: { ...projection.projectionWorkspace.settings, forecastStart: start, horizonMonths: 1 },
  }, context, [], 1, true, {
    workingForecast: true,
    workingRange: { start, end },
    useImportedBillingActuals: false,
    baselineWeeklyByClinician: Object.fromEntries(projection.clinicianPace.map(person => [person.id, person.usedWeekly!])),
  });
  return { months, basis, clinicianPace: projection.clinicianPace, unavailableReasons: projection.unavailableReasons,
    warnings: [...new Set([...projection.unavailableReasons, ...months.flatMap(month => month.warnings)])] };
}
