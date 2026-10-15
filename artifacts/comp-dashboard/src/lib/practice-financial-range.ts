import { forecast, observed, type Context, type ForecastMonth, type PaceCoverage, type Workspace } from "@workspace/practice/hub";
import { buildPracticeProjection } from "./practice-projection.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";
import type { LocalSnapshot } from "./retention-local.ts";
import { moneyBridgeSummary } from "./money-bridge.ts";

type Range = { start: string; end: string };
type Values = ForecastMonth["values"];
const shift = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const sumKeys = ["sessions", "revenue", "collections", "clinicianPay", "employerBurden", "staffCost", "overhead", "marketing", "fees", "profit", "ownerPayroll", "ownerClinicalPay", "ownerDistributionsPretax", "coOwnerSalaryPretax", "taxReserve", "reserves", "distributions", "retainedCash", "familyTakeHome"];
const sum = (rows: Values[]): Values => Object.fromEntries(sumKeys.map((key) => [key, rows.length && rows.every((row) => row[key] != null) ? rows.reduce((total, row) => total + row[key]!, 0) : null]));

function financialCoverage(workspace: Workspace, range: Range) {
  const periods = workspace.periods.filter((row) => !row.archived && row.status === "finalized" && row.start >= range.start && row.end <= range.end).sort((a, b) => a.start.localeCompare(b.start));
  let cursor = range.start;
  for (const period of periods) {
    if (period.start !== cursor) return false;
    cursor = shift(period.end, 1);
  }
  return cursor === shift(range.end, 1);
}

/** Actual dates and future dates never overlap; missing past coverage is never forecast-filled. */
export function practiceFinancialRange(workspace: Workspace, context: Context, snapshots: LocalSnapshot[], asOf: string, requested: Range, coverage: PaceCoverage[] = []) {
  const earliest = [...workspace.periods.filter((row) => !row.archived).map((row) => row.start), ...snapshots.flatMap((snapshot) => snapshot.rows.map((row) => row.serviceDate))].sort()[0] ?? asOf;
  const range = { start: requested.start.startsWith("0000-") ? earliest : requested.start, end: requested.end.startsWith("9999-") ? asOf : requested.end };
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + "T12:00:00Z")) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
  if (!valid(range.start) || !valid(range.end) || range.start > range.end) return {
    range, ownerPayrollBurdenPct: workspace.settings.ownerPayrollBurdenPct, actual: { range: null, values: sum([]), complete: false, reportedCharges: null, report: summarizeReportedBilling([], asOf) },
    forward: { range: null, values: sum([]), months: [] as ForecastMonth[] }, values: sum([]), warnings: ["Choose valid non-reversed reporting dates."],
  };
  const actualEnd = range.end < asOf ? range.end : asOf;
  const actualRange = range.start <= actualEnd ? { start: range.start, end: actualEnd } : null;
  const forwardStart = range.start > asOf ? range.start : shift(asOf, 1);
  const forwardRange = forwardStart <= range.end ? { start: forwardStart, end: range.end } : null;
  const names = new Set(context.clinicians.filter((person) => (person.goalId ?? null) === workspace.settings.teamId).map((person) => person.label.trim().replace(/\s+/g, " ").toLowerCase()));
  const charges = actualRange ? summarizeReportedBilling(snapshots, actualEnd, { start: range.start, end: actualEnd, clinicianLabels: [...names] }) : summarizeReportedBilling([], asOf);
  const reportedCharges = charges.evidence.invalidDateRowCount === 0 && charges.months.length && charges.months.every((row) => row.charges !== null) ? charges.months.reduce((total, row) => total + row.charges!, 0) : null;
  const complete = actualRange ? financialCoverage(workspace, actualRange) : true;
  const actualObserved = actualRange ? observed(workspace, context, actualRange.start, actualRange.end) : null;
  const actualValues = actualObserved ? Object.fromEntries(sumKeys.map((key) => [key, complete ? actualObserved.values[key] ?? null : null])) : {};
  const warnings = [...(actualObserved?.warnings ?? []), ...charges.evidence.warnings.filter((warning) => !warning.startsWith("Elapsed months"))];
  if (actualRange && !complete) warnings.push("Actual financial coverage is incomplete for the selected dates; reported charges remain facts, but missing actual costs or days are not filled with a forecast.");
  const projection = forwardRange ? buildPracticeProjection(workspace, context, "actual", asOf, coverage) : null;
  if (projection) warnings.push(...projection.clinicianPace.map((person) => `${person.name}: ${person.basis}. Latest-report anchoring is an estimate, not proof of later quiet days.`));
  const count = forwardRange ? (Number(forwardRange.end.slice(0, 4)) - Number(forwardRange.start.slice(0, 4))) * 12 + Number(forwardRange.end.slice(5, 7)) - Number(forwardRange.start.slice(5, 7)) + 1 : 0;
  const future = forwardRange && count <= 60 && projection?.projectedWeekly != null ? forecast({ ...projection.projectionWorkspace, settings: { ...projection.projectionWorkspace.settings, forecastStart: forwardRange.start.slice(0, 7) + "-01", horizonMonths: count } }, context, [], 1, true, {
    workingForecast: true,
    workingRange: forwardRange,
    useImportedBillingActuals: false,
    baselineWeeklyByClinician: Object.fromEntries(projection.clinicianPace.map((person) => [person.id, person.usedWeekly!])),
  }) : [];
  if (count > 60) warnings.push("The future selection exceeds the supported 60-month forecast horizon.");
  if (forwardRange && !future.length) warnings.push("Future working forecast is unavailable: session history is incomplete.");
  const forwardValues = forwardRange ? sum(future.map((row) => row.values)) : {};
  const values = sum([...(actualRange ? [actualValues] : []), ...(forwardRange ? [forwardValues] : [])]);
  return { range, ownerPayrollBurdenPct: workspace.settings.ownerPayrollBurdenPct, actual: { range: actualRange, values: actualValues as Values, complete, reportedCharges, report: charges }, forward: { range: forwardRange, values: forwardValues as Values, months: future }, values, warnings: [...new Set([...warnings, ...future.flatMap((row) => row.warnings)])] };
}

export type PracticeFinancialRange = ReturnType<typeof practiceFinancialRange>;

export function financialRangeBridge(report: PracticeFinancialRange) {
  const bridge = moneyBridgeSummary(report.values, report.ownerPayrollBurdenPct);
  const actual = report.actual.values;
  const actualCosts = !report.actual.range ? 0 : [actual.revenue, actual.clinicianPay, actual.profit].every((value) => value != null)
    ? actual.revenue! - actual.clinicianPay! - actual.profit! : null;
  const future = moneyBridgeSummary(report.forward.values, report.ownerPayrollBurdenPct);
  const futureCosts = report.forward.range ? future.otherCosts : 0;
  const otherCosts = actualCosts !== null && futureCosts !== null ? actualCosts + futureCosts : null;
  const adjustments = [bridge.revenue, bridge.clinicianPay, bridge.profit, otherCosts].every((value) => value !== null)
    ? bridge.profit! + bridge.clinicianPay! + otherCosts! - bridge.revenue! : null;
  return { ...bridge, otherCosts, adjustments, components: [
    ...(report.actual.range ? [{ label: "Actual aggregate operating costs from finalized ledger (processing not separately classified)", value: actualCosts }] : []),
    ...(report.forward.range ? future.components.map((row) => ({ ...row, label: "Future estimate: " + row.label })) : []),
  ] };
}
