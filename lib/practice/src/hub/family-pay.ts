export function estimateW2NetPay(gross: number, incomeTaxPct: number) {
  const employeePayrollTax = gross * 0.0765;
  const incomeTax = gross * incomeTaxPct / 100;
  return {
    employeePayrollTax,
    incomeTax,
    net: Math.max(0, gross - employeePayrollTax - incomeTax),
  };
}
