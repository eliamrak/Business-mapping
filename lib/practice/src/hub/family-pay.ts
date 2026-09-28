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
  const monthEnd = new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0))
    .toISOString().slice(0, 10);
  return [monthStart.slice(0, 7) + "-15", monthEnd]
    .filter((date) => date >= effectiveStart && date <= through).length;
}
