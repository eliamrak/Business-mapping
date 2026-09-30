export function estimateW2NetPay(gross: number, additionalWithholdingPct: number) {
  const employeePayrollTax = gross * 0.0765;
  const additionalWithholding = gross * additionalWithholdingPct / 100;
  return {
    employeePayrollTax,
    additionalWithholding,
    net: Math.max(0, gross - employeePayrollTax - additionalWithholding),
  };
}

export function additionalWithholdingPctFromNet(grossPerCheck: number, netPerCheck: number) {
  if (grossPerCheck <= 0 || netPerCheck < 0 || netPerCheck > grossPerCheck * (1 - 0.0765))
    return null;
  return (grossPerCheck * (1 - 0.0765) - netPerCheck) / grossPerCheck * 100;
}

export type PayrollSchedule = "semi_monthly" | "biweekly_thursday";

export const biweekly1099Anchor = "2026-09-24";

const addDays = (date: string, days: number) =>
  new Date(Date.parse(date + "T12:00:00Z") + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const monthStart = (date: string) => date.slice(0, 7) + "-01";

const nextMonth = (date: string) => {
  const value = new Date(date.slice(0, 7) + "-01T12:00:00Z");
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
};

const semiMonthlyDatesForMonth = (month: string) => {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return [
    month.slice(0, 7) + "-15",
    `${month.slice(0, 7)}-${String(Math.min(30, lastDay)).padStart(2, "0")}`,
  ];
};

export function semiMonthlyPayDatesThrough(
  rangeStart: string,
  through: string,
  effectiveStart: string,
) {
  const dates: string[] = [];
  for (let month = monthStart(rangeStart); month <= through; month = nextMonth(month))
    dates.push(...semiMonthlyDatesForMonth(month));
  return dates.filter((date) => date >= rangeStart && date >= effectiveStart && date <= through);
}

export function semiMonthlyChecksThrough(monthStart: string, through: string, effectiveStart: string) {
  // EMC's configured W2 payroll schedule is the 15th and 30th; February uses its last day.
  return semiMonthlyPayDatesThrough(monthStart, through, effectiveStart).length;
}

export function biweeklyThursdayPayDatesThrough(
  rangeStart: string,
  through: string,
  effectiveStart: string,
  anchor = biweekly1099Anchor,
) {
  let date = anchor;
  while (addDays(date, -14) >= rangeStart) date = addDays(date, -14);
  while (date < rangeStart) date = addDays(date, 14);
  const dates: string[] = [];
  for (; date <= through; date = addDays(date, 14))
    if (date >= effectiveStart) dates.push(date);
  return dates;
}

export function payrollScheduleForClassification(classification: unknown): PayrollSchedule | null {
  const value = String(classification).toLowerCase();
  if (value === "w2") return "semi_monthly";
  if (value === "1099") return "biweekly_thursday";
  return null;
}

export function payrollPayDatesThrough(
  schedule: PayrollSchedule,
  rangeStart: string,
  through: string,
  effectiveStart: string,
) {
  return schedule === "semi_monthly"
    ? semiMonthlyPayDatesThrough(rangeStart, through, effectiveStart)
    : biweeklyThursdayPayDatesThrough(rangeStart, through, effectiveStart);
}

export function payrollPeriodForPayDate(schedule: PayrollSchedule, payDate: string) {
  if (schedule === "biweekly_thursday")
    return { start: addDays(payDate, -14), end: addDays(payDate, -1) };
  const first = payDate.slice(8, 10) === "15";
  return {
    start: first ? payDate.slice(0, 7) + "-01" : payDate.slice(0, 7) + "-16",
    end: payDate,
  };
}
