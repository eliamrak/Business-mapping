import { calculateStaffMemberCost, type StaffCostInput } from "@workspace/practice/compensation";

const known = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function staffPaySummary(input: Partial<StaffCostInput>) {
  if (input.annualSalary != null && !known(input.annualSalary)) return { payType: "Pay unavailable", baseAnnualCost: null, employerBurden: null, totalAnnualCost: null };
  const salary = known(input.annualSalary) && (input.annualSalary > 0 || (input.annualSalary === 0 && input.hourlyRate == null && input.hoursPerWeek == null));
  const hourly = !salary && known(input.hourlyRate) && known(input.hoursPerWeek) && known(input.weeksPerYear);
  const payType = salary ? "Salary" : hourly ? "Hourly" : "Pay unavailable";
  const classification = String(input.classification ?? "").toLowerCase();
  const burdenKnown = classification === "w2"
    ? [input.w2EmployerFicaPct, input.futaSutaPct, input.workersCompPct, input.otherEmployerBurdenPct].every(known)
    : classification === "1099" || classification === "owner";
  if ((!salary && !hourly) || !burdenKnown) return { payType, baseAnnualCost: null, employerBurden: null, totalAnnualCost: null };
  return { payType, ...calculateStaffMemberCost(input as StaffCostInput) };
}

export function staffRosterCost(rows: Partial<StaffCostInput>[]) {
  const totals = rows.map((row) => staffPaySummary(row).totalAnnualCost);
  return totals.some((total) => total === null) ? null : totals.reduce<number>((sum, total) => sum + total!, 0);
}
