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

export function semiMonthlyChecksThrough(monthStart: string, through: string, effectiveStart: string) {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const secondPayday = `${monthStart.slice(0, 7)}-${String(Math.min(30, lastDay)).padStart(2, "0")}`;
  return [monthStart.slice(0, 7) + "-15", secondPayday]
    .filter((date) => date >= effectiveStart && date <= through).length;
}
