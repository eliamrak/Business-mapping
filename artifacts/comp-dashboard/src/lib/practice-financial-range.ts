import { completeServicePeriodState, forecast, observed, bindBillingResolutions, type Context, type ForecastMonth, type PaceCoverage, type Workspace, type ImportEvidenceDeclarations } from "@workspace/practice/hub";
import { buildPracticeProjection } from "./practice-projection.ts";
import { summarizeReportedBilling } from "./reported-billing.ts";
import type { LocalSnapshot } from "./retention-local.ts";
import { moneyBridgeSummary } from "./money-bridge.ts";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { completePeriodSessionSummary } from "./complete-session-summary.ts";

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

/** Complete report history and the forecast after its covered period never overlap. */
export function practiceFinancialRange(workspace: Workspace, context: Context, snapshots: LocalSnapshot[], asOf: string, requested: Range, coverage: PaceCoverage[] = [], declarations?: ImportEvidenceDeclarations | null) {
  const roster = context.clinicians.filter((person) => (person.goalId ?? null) === workspace.settings.teamId);
  const reports = completeReportCoverage(snapshots, roster, asOf, context.clinicians, { declarations, teamId: workspace.settings.teamId });
  const sessionProof = completeServicePeriodState(context.sessions, roster.map((person) => person.id), asOf, coverage);
  const earliest = [
    ...workspace.periods.filter((row) => !row.archived && row.status === "finalized").map((row) => row.start),
    ...reports.completeAttendanceCoverage.map((row) => row.start),
    ...reports.completeBillingCoverage.map((row) => row.start),
    ...sessionProof.eligibleCoverage.map((row) => row.start),
  ].sort()[0] ?? asOf;
  const range = { start: requested.start.startsWith("0000-") ? earliest : requested.start, end: requested.end.startsWith("9999-") ? asOf : requested.end };
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + "T12:00:00Z")) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
  if (!valid(range.start) || !valid(range.end) || range.start > range.end) return {
    range, dataThrough: null, forecastStart: null, reports, ownerPayrollBurdenPct: workspace.settings.ownerPayrollBurdenPct, actual: { range: null, values: sum([]), complete: false, reportedCharges: null, report: summarizeReportedBilling([], asOf), billingComplete: false },
    forward: { range: null, values: sum([]), months: [] as ForecastMonth[] }, values: sum([]), warnings: ["Choose valid non-reversed reporting dates."],
  };
  const projection = buildPracticeProjection(workspace, context, "actual", asOf, coverage, reports.billingThrough);
  const cutoff = projection.latestReportThrough;
  const actualEnd = cutoff && cutoff < range.end ? cutoff : range.end;
  const actualRange = cutoff && range.start <= actualEnd ? { start: range.start, end: actualEnd } : null;
  const forecastStart = cutoff ? shift(cutoff, 1) : null;
  const forwardStart = forecastStart && range.start > forecastStart ? range.start : forecastStart;
  const forwardRange = forwardStart && forwardStart <= range.end ? { start: forwardStart, end: range.end } : null;
  const names = new Set(context.clinicians.filter((person) => (person.goalId ?? null) === workspace.settings.teamId).map((person) => person.label.trim().replace(/\s+/g, " ").toLowerCase()));
  const charges = actualRange ? summarizeReportedBilling(snapshots, actualEnd, { start: range.start, end: actualEnd, clinicianLabels: [...names], eligibleRows: new Set(reports.eligibleBillingRows), billingResolutions: bindBillingResolutions(declarations?.billingResolutions ?? [], context.clinicians, declarations) }) : summarizeReportedBilling([], asOf);
  const billingComplete = !!actualRange && roster.length > 0 && roster.every((person) => {
    for (let date = actualRange.start; date <= actualRange.end; date = shift(date, 1))
      if (!reports.completeBillingCoverage.some((proof) => proof.clinicianId === person.id && proof.start <= date && proof.end >= date)) return false;
    return true;
  });
  const reportedCharges = charges.evidence.invalidDateRowCount === 0 && charges.months.every((row) => row.charges !== null)
    ? charges.months.length ? charges.months.reduce((total, row) => total + row.charges!, 0) : billingComplete ? 0 : null : null;
  const ledgerComplete = actualRange ? financialCoverage(workspace, actualRange) : true;
  const complete = !!actualRange && ledgerComplete && billingComplete;
  const actualObserved = actualRange ? observed(workspace, context, actualRange.start, actualRange.end) : null;
  const actualValues: Values = actualObserved ? Object.fromEntries(sumKeys.map((key) => [key, ledgerComplete ? actualObserved.values[key] ?? null : null])) : {};
  const paidConsultationUnclassified = !!actualRange && reports.eligibleBillingRows.some((row) => row.serviceDate >= actualRange.start && row.serviceDate <= actualRange.end && row.totalFeeCharged !== 0 && (row.billingCode?.trim().toUpperCase() === "PHONE" || row.visitKind === "consultation"));
  if (actualRange) {
    const ledger = actualObserved!.values;
    const otherCosts = ledgerComplete && [ledger.revenue, ledger.clinicianPay, ledger.profit].every((value) => value != null)
      ? ledger.revenue! - ledger.clinicianPay! - ledger.profit! : null;
    actualValues.revenue = billingComplete && !paidConsultationUnclassified ? reportedCharges : null;
    actualValues.profit = actualValues.revenue !== null && actualValues.clinicianPay != null && otherCosts !== null
      ? actualValues.revenue! - actualValues.clinicianPay! - otherCosts : null;
    const sessions = completePeriodSessionSummary(context.sessions, roster.map((person) => person.id), actualRange, coverage, asOf);
    actualValues.sessions = sessions.coverageComplete ? sessions.observedCompleted : null;
  }
  const warnings = [...(actualObserved?.warnings ?? []), ...charges.evidence.warnings.filter((warning) => !warning.startsWith("Elapsed months"))];
  warnings.push(...reports.incompletePeriods.map((period) => period.reason));
  if (actualObserved && ledgerComplete && actualValues.revenue !== null && actualObserved.values.revenue != null && Math.abs(actualValues.revenue! - actualObserved.values.revenue!) > 0.005)
    warnings.push("Complete billed session fees differ from the financial ledger's earned-revenue entry. Historical session income uses the billed source; stored ledger entries and independently recorded costs are unchanged.");
  if (paidConsultationUnclassified) warnings.push("Nonzero PHONE/consultation charge violates the confirmed zero-fee policy. Original billed facts remain visible for review; affected treatment-revenue totals are withheld, not silently changed to zero.");
  if (actualRange && !complete) warnings.push("Actual billed-revenue or financial-cost coverage is incomplete for the selected dates; only complete report periods contribute. Missing days are not actual zeros.");
  if (!cutoff) warnings.push("Data covers through: unverified. No common complete activity report or complete billing report establishes the actual/forecast boundary; upload dates and occupied row endpoints are not proof.");
  if (reports.billingThrough !== projection.latestCompleteThrough) warnings.push(`Source dates differ: complete activity through ${projection.latestCompleteThrough ?? "unverified"}; complete billing through ${reports.billingThrough ?? "unverified"}. The latest complete report sets the forecast boundary, but does not certify missing activity, billing or cost coverage.`);
  warnings.push(...projection.clinicianPace.map((person) => `${person.name}: ${person.basis}. Only complete source pay periods enter the three-month average.`));
  warnings.push(...projection.unavailableReasons);
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
  return { range, dataThrough: cutoff, forecastStart, reports, ownerPayrollBurdenPct: workspace.settings.ownerPayrollBurdenPct, actual: { range: actualRange, values: actualValues, complete, reportedCharges, report: charges, billingComplete }, forward: { range: forwardRange, values: forwardValues as Values, months: future }, values, warnings: [...new Set([...warnings, ...future.flatMap((row) => row.warnings)])] };
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
