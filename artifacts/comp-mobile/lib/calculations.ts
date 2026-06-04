export interface FullClinicianInput {
  sessionRate: number;
  sessionsPerWeek: number;
  weeksWorkedPerYear: number;
  capEnabled: boolean;
  capAmount: number;
  preCapClinicianSplit: number;
  preCapPracticeSplit: number;
  postCapClinicianSplit: number;
  postCapPracticeSplit: number;
  classification: string;
  w2EmployerFicaPct: number;
  futaSutaPct: number;
  workersCompPct: number;
  otherEmployerBurdenPct: number;
}

export interface ClinicianMetrics {
  annualSessions: number;
  annualProduction: number;
  clinicianCompensation: number;
  practiceGrossRevenue: number;
  employerObligations: number;
  practiceNetBeforeOverhead: number;
}

export function calculateClinicianMetrics(input: FullClinicianInput): ClinicianMetrics {
  const annualSessions = (input.sessionsPerWeek || 0) * (input.weeksWorkedPerYear || 0);
  const annualProduction = annualSessions * (input.sessionRate || 0);

  let preCapSessions = 0;
  let postCapSessions = 0;

  if (input.capEnabled && input.capAmount > 0) {
    const practiceRevPerSession =
      (input.sessionRate || 0) * ((input.preCapPracticeSplit || 0) / 100);
    const sessionsToCapPrecalc =
      practiceRevPerSession > 0 ? input.capAmount / practiceRevPerSession : 0;
    preCapSessions = Math.min(annualSessions, sessionsToCapPrecalc);
    postCapSessions = Math.max(0, annualSessions - preCapSessions);
  } else {
    preCapSessions = annualSessions;
    postCapSessions = 0;
  }

  const clinicianCompensation =
    preCapSessions * (input.sessionRate || 0) * ((input.preCapClinicianSplit || 0) / 100) +
    postCapSessions * (input.sessionRate || 0) * ((input.postCapClinicianSplit || 0) / 100);

  const practiceGrossRevenue =
    preCapSessions * (input.sessionRate || 0) * ((input.preCapPracticeSplit || 0) / 100) +
    postCapSessions * (input.sessionRate || 0) * ((input.postCapPracticeSplit || 0) / 100);

  const totalEmployerBurdenPct =
    ((input.w2EmployerFicaPct || 0) +
      (input.futaSutaPct || 0) +
      (input.workersCompPct || 0) +
      (input.otherEmployerBurdenPct || 0)) /
    100;

  const isW2 = String(input.classification).toLowerCase() === "w2";
  const employerObligations = isW2 ? clinicianCompensation * totalEmployerBurdenPct : 0;
  const practiceNetBeforeOverhead = practiceGrossRevenue - employerObligations;

  return {
    annualSessions,
    annualProduction,
    clinicianCompensation,
    practiceGrossRevenue,
    employerObligations,
    practiceNetBeforeOverhead,
  };
}

export interface SandboxClinicianInput {
  sessionRate: number;
  sessionsPerWeek: number;
  weeksWorkedPerYear: number;
  clinicianSplitPct: number;
  classification: string;
}

export interface SandboxClinicianResult {
  annualProduction: number;
  clinicianComp: number;
  practiceGross: number;
  practiceNet: number;
}

export interface SandboxStaffInput {
  annualSalary: number;
  classification: string;
  employerBurdenPct: number;
}

export interface SandboxStaffResult {
  baseSalary: number;
  employerBurden: number;
  totalCost: number;
}

export interface SandboxTotals {
  clinicianResults: SandboxClinicianResult[];
  staffResults: SandboxStaffResult[];
  totalPracticeNet: number;
  totalClinicianComp: number;
  totalStaffCost: number;
  totalNeed: number;
  gap: number;
}

export function calculateSandboxResults(
  clinicians: SandboxClinicianInput[],
  settings: { annualOverheadGoal: number; ownerPayGoal: number },
  staff: SandboxStaffInput[] = []
): SandboxTotals {
  let totalPracticeNet = 0;
  let totalClinicianComp = 0;

  const clinicianResults = clinicians.map((c) => {
    const annualSessions = (c.sessionsPerWeek || 0) * (c.weeksWorkedPerYear || 0);
    const annualProduction = annualSessions * (c.sessionRate || 0);
    const practiceSplitPct = 100 - (c.clinicianSplitPct || 0);
    const practiceGross = annualProduction * (practiceSplitPct / 100);
    const clinicianComp = annualProduction * ((c.clinicianSplitPct || 0) / 100);
    const isW2 = String(c.classification).toLowerCase() === "w2";
    const employerBurden = isW2 ? clinicianComp * 0.11 : 0;
    const practiceNet = practiceGross - employerBurden;
    totalPracticeNet += practiceNet;
    totalClinicianComp += clinicianComp;
    return { annualProduction, clinicianComp, practiceGross, practiceNet };
  });

  let totalStaffCost = 0;
  const staffResults = staff.map((s) => {
    const isW2 = String(s.classification).toLowerCase() === "w2";
    const employerBurden = isW2 ? (s.annualSalary || 0) * ((s.employerBurdenPct || 0) / 100) : 0;
    const totalCost = (s.annualSalary || 0) + employerBurden;
    totalStaffCost += totalCost;
    return { baseSalary: s.annualSalary || 0, employerBurden, totalCost };
  });

  const totalNeed = (settings.annualOverheadGoal || 0) + (settings.ownerPayGoal || 0) + totalStaffCost;
  const gap = totalPracticeNet - totalNeed;

  return { clinicianResults, staffResults, totalPracticeNet, totalClinicianComp, totalStaffCost, totalNeed, gap };
}

export function formatCurrency(n: number, compact = false): string {
  if (compact && Math.abs(n) >= 1000) {
    const val = n / 1000;
    return `$${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}k`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
