import type { Values } from "@workspace/practice/hub";
import type { PracticeFinancialRange } from "./practice-financial-range.ts";
import type { PracticeFinancialEstimate } from "./practice-financial-estimate.ts";
import { moneyBridgeSummary } from "./money-bridge.ts";

/** Compose disjoint estimate segments, never substituting estimates into actuals. */
export function financialEstimateDisplay(report: PracticeFinancialRange, historical: PracticeFinancialEstimate | null) {
  const parts: Values[] = [];
  const reasons = [...(historical?.unavailableReasons ?? [])];
  if (report.actual.range) {
    if (historical?.range?.start === report.actual.range.start && historical.range.end === report.actual.range.end) parts.push(historical.values);
    else { parts.push({}); reasons.push("Historical estimate does not cover the selected historical dates."); }
  }
  if (report.forward.range) {
    if (report.actual.range && report.forward.range.start <= report.actual.range.end) {
      parts.push({}); reasons.push("Estimate date segments overlap; combined totals withheld.");
    } else parts.push(report.forward.values);
    reasons.push(...report.forecastWarnings.filter(reason => /unavailable|unknown|unverified|missing|insufficient/i.test(reason)));
  }
  if (!report.actual.range && !report.forward.range) reasons.push("Complete source coverage has not established an estimate boundary.");
  const keys = new Set([...Object.keys(report.values), ...parts.flatMap(part => Object.keys(part))]);
  const values: Values = Object.fromEntries([...keys].map(key => [key, parts.length && parts.every(part => part[key] != null && Number.isFinite(part[key])) ? parts.reduce((sum, part) => sum + part[key]!, 0) : null]));
  const historyMatches = !report.actual.range || historical?.range?.start === report.actual.range.start && historical.range.end === report.actual.range.end;
  const disjoint = !report.actual.range || !report.forward.range || report.forward.range.start > report.actual.range.end;
  const subtotalParts = [...(report.actual.range ? [historyMatches ? historical?.values.surplusBeforeUnconfiguredMarketing ?? null : null] : []), ...(report.forward.range ? [report.forward.values.profit ?? null] : [])];
  const surplusBeforeUnconfiguredMarketing = disjoint && subtotalParts.length > 0 && subtotalParts.every(value => value !== null && Number.isFinite(value))
    ? subtotalParts.reduce<number>((sum, value) => sum + value!, 0) : null;
  return { values, historical, surplusBeforeUnconfiguredMarketing, reasons: [...new Set(reasons)], basis: "Billed-charge historical estimate + clinician-card future estimate; not recorded cash or paid payroll." };
}

export function financialEstimateBridge(report: PracticeFinancialRange, display: ReturnType<typeof financialEstimateDisplay>) {
  const future = moneyBridgeSummary(report.forward.values, report.ownerPayrollBurdenPct);
  const costKeys = ["employerBurden", "staffCost", "overhead", "marketing", "fees", "ownerPayroll", "ownerPayrollBurden"];
  const components = [
    ...(report.actual.range ? costKeys.map(key => ({ label: "Historical estimate: " + (display.historical?.components.find(row => row.key === key)?.label ?? key), value: display.historical?.values[key] ?? null })) : []),
    ...(report.forward.range ? future.components.map(row => ({ ...row, label: "Future estimate: " + row.label })) : []),
  ];
  const otherCosts = components.length && components.every(row => row.value !== null) ? components.reduce((sum, row) => sum + row.value!, 0) : null;
  const { revenue = null, clinicianPay = null, profit = null } = display.values;
  const adjustments = revenue !== null && clinicianPay !== null && profit !== null && otherCosts !== null ? profit + clinicianPay + otherCosts - revenue : null;
  return { revenue, clinicianPay, profit, otherCosts, adjustments, components };
}
