import type { ForecastMonth } from "@workspace/practice/hub";

export function moneyBridgeSummary(values: ForecastMonth["values"], ownerPayrollBurdenPct: number) {
  const value = (key: string) => values[key] != null && Number.isFinite(values[key]) ? values[key]! : null;
  const ownerPayroll = value("ownerPayroll");
  const components = [
    { label: "Employer burden", value: value("employerBurden") },
    { label: "Support staff + burden", value: value("staffCost") },
    { label: "Operating overhead", value: value("overhead") },
    { label: "Marketing", value: value("marketing") },
    { label: "Processing fees", value: value("fees") },
    { label: "Separate owner payroll", value: ownerPayroll },
    { label: "Owner payroll burden", value: ownerPayroll !== null && Number.isFinite(ownerPayrollBurdenPct) ? ownerPayroll * ownerPayrollBurdenPct / 100 : null },
  ];
  const otherCosts = components.every((item) => item.value !== null)
    ? components.reduce((sum, item) => sum + item.value!, 0) : null;
  const revenue = value("revenue"), clinicianPay = value("clinicianPay"), profit = value("profit");
  const adjustments = revenue !== null && clinicianPay !== null && profit !== null && otherCosts !== null
    ? profit + clinicianPay + otherCosts - revenue : null;
  return { components, otherCosts, adjustments, revenue, clinicianPay, profit };
}
