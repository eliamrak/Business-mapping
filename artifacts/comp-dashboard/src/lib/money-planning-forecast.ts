import { forecast, monthEnd, type Context, type PaceCoverage, type Workspace } from "@workspace/practice/hub";
import { buildPracticeProjection } from "./practice-projection.ts";
import { currentPracticeClinicians } from "./practice-scope.ts";

/** Full selected-month baseline using only observations available by that month end. */
export function moneyPlanningForecast(workspace: Workspace, context: Context, today: string, coverage: PaceCoverage[] = [], selectedMonth = today.slice(0, 7)) {
  const month = selectedMonth.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Select a valid planning month (YYYY-MM).");
  const start = month + "-01";
  const end = monthEnd(start);
  const observedAsOf = today < end ? today : end;
  const currentIds = new Set(currentPracticeClinicians(workspace, context, today).map(person => person.id));
  const clinicians = currentPracticeClinicians(workspace, context, observedAsOf).filter(person => currentIds.has(person.id));
  const baselineContext = { ...context, clinicians, sessions: context.sessions.filter(record => record.end <= observedAsOf) };
  // Exclude hiring mechanisms while retaining other configured dated changes and costs.
  const baselineWorkspace = { ...workspace, hiring: [], events: workspace.events.filter(event => event.field !== "clinician.hire") };
  const projection = buildPracticeProjection(baselineWorkspace, baselineContext, "actual", observedAsOf, coverage);
  const historical = month < today.slice(0, 7);
  const assumptionWarnings = historical
    ? ["Historical planning uses available dated terms and currently configured undated assumptions; a saved historical assumption snapshot is unavailable."] : [];
  const basis = `${start} to ${end} · ${month === today.slice(0, 7) ? "current-month" : "selected-month"} planning scenario; complete-period observed sessions through ${projection.latestCompleteThrough ?? "unverified"}; observations capped at ${observedAsOf}; existing active clinicians only; clinician-card fees and configured dated costs, not historical billed actuals or bank cash`;
  const months = projection.projectedWeekly === null ? [] : forecast({
    ...projection.projectionWorkspace,
    settings: { ...projection.projectionWorkspace.settings, forecastStart: start, horizonMonths: 1 },
  }, baselineContext, [], 1, true, {
    workingForecast: true,
    workingRange: { start, end },
    useImportedBillingActuals: false,
    baselineWeeklyByClinician: Object.fromEntries(projection.clinicianPace.map(person => [person.id, person.usedWeekly!])),
  });
  return { months, basis, selectedMonth: month, start, end, observedAsOf,
    historicalAssumptionsAvailable: !historical,
    clinicianPace: projection.clinicianPace, unavailableReasons: projection.unavailableReasons,
    warnings: [...new Set([...assumptionWarnings, ...projection.unavailableReasons, ...months.flatMap(month => month.warnings)])] };
}
