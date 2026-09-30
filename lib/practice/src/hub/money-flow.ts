import { daysInclusive } from "../index.ts";
import { calculateClinicianMetrics, calculateStaffMemberCost } from "../compensation.ts";
import { forecast, budgetAmount, monthEnd, type Context } from "./engine.ts";
import { estimateW2NetPay, semiMonthlyChecksThrough } from "./family-pay.ts";
import { clinicianModelAt, clinicianTermsAt } from "./clinician-terms.ts";
import type { Workspace } from "./model.ts";

export type MonthFlow = {
  start: string;
  through: string | null;
  sessionDataThrough: string | null;
  sessions: number | null;
  splitPeriods: boolean;
  incompleteClinicians: string[];
  revenue: number | null;
  otherIncome: number;
  clinicianPay: number;
  employerBurden: number;
  familyGrossPay: number;
  familyEmployerBurden: number;
  staffPay: number;
  overhead: number;
  marketing: number;
  processing: number;
  legacyOwnerPayroll: number;
  legacyOwnerBurden: number;
  profit: number | null;
  allocations: { id: string; name: string; kind: string; amount: number }[];
  retained: number | null;
  distribution: number | null;
  estimatedEmployeePayrollTax: number;
  estimatedAdditionalWithholding: number;
  estimatedNetPay: number | null;
  familyTakeHome: number | null;
};

export function monthFlow(
  workspace: Workspace,
  context: Context,
  month: string,
  today: string,
): MonthFlow {
  const start = month.slice(0, 7) + "-01";
  const end = monthEnd(start);
  const cutoff = end < today ? end : today;
  const people = context.clinicians.filter(
    (person) => (person.goalId ?? null) === workspace.settings.teamId,
  );
  const selectedIds = new Set(people.map((person) => person.id));
  const records = context.sessions.filter(
    (record) =>
      selectedIds.has(record.clinicianId) &&
      record.start <= cutoff &&
      record.end >= start &&
      record.end <= today,
  );
  const dataThrough = records.reduce<string | null>((latest, record) => {
    const date = record.end < end ? record.end : end;
    return !latest || date > latest ? date : latest;
  }, null);
  const through = dataThrough;
  const familyId = workspace.settings.familyW2ClinicianId;
  const empty = {
    start,
    through,
    sessionDataThrough: dataThrough,
    sessions: null,
    splitPeriods: false,
    incompleteClinicians: [],
    revenue: null,
    otherIncome: 0,
    clinicianPay: 0,
    employerBurden: 0,
    familyGrossPay: 0,
    familyEmployerBurden: 0,
    staffPay: 0,
    overhead: 0,
    marketing: 0,
    processing: 0,
    legacyOwnerPayroll: 0,
    legacyOwnerBurden: 0,
    profit: null,
    allocations: [],
    retained: null,
    distribution: null,
    estimatedEmployeePayrollTax: 0,
    estimatedAdditionalWithholding: 0,
    estimatedNetPay: familyId === null ? null : 0,
    familyTakeHome: null,
  } satisfies MonthFlow;
  if (!through) return empty;

  const elapsed = daysInclusive(start, through);
  const fraction = elapsed / daysInclusive(start, end);
  let splitPeriods = false;
  const datesIn = (from: string, to: string) =>
    Array.from({ length: daysInclusive(from, to) }, (_, index) =>
      new Date(Date.parse(from + "T12:00:00Z") + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
  const dailySessionsByClinician = new Map<number, Map<string, number>>();
  for (const record of records) {
    const overlapStart = record.start > start ? record.start : start;
    const overlapEnd = record.end < through ? record.end : through;
    if (overlapStart > overlapEnd) continue;
    const daily = record.completed / daysInclusive(record.start, record.end);
    if (overlapStart !== record.start || overlapEnd !== record.end)
      splitPeriods = true;
    const clinicianDays = dailySessionsByClinician.get(record.clinicianId) ?? new Map<string, number>();
    for (const date of datesIn(overlapStart, overlapEnd))
      clinicianDays.set(date, (clinicianDays.get(date) ?? 0) + daily);
    dailySessionsByClinician.set(record.clinicianId, clinicianDays);
  }
  const incompleteClinicians = people
    .filter((person) =>
      !records.some(
        (record) =>
          record.clinicianId === person.id && record.end >= through,
      ),
    )
    .map((person) => person.label);
  let sessions = 0;
  let revenue = 0;
  let clinicianPay = 0;
  let employerBurden = 0;
  let familyGrossPay = 0;
  let familyEmployerBurden = 0;
  for (const person of people) {
    const baseProfile = workspace.clinicians.find(
      (entry) => entry.clinicianId === person.id && entry.status !== "archived",
    );
    if (baseProfile?.status === "planned") continue;
    let pay = 0;
    let personSessions = 0;
    let personRevenue = 0;
    let capEarned = baseProfile?.openingCapContribution ?? 0;
    for (const date of datesIn(start, through)) {
      const activeProfile = clinicianModelAt(workspace, person.id, date);
      if (baseProfile && !activeProfile) continue;
      if (activeProfile?.status === "planned") continue;
      const term = clinicianTermsAt(workspace, person.id, date);
      const count = dailySessionsByClinician.get(person.id)?.get(date) ?? 0;
      const rate = activeProfile?.expectedSessionRevenue ?? term.sessionRate ?? person.sessionRate;
      const earned = count * rate * workspace.settings.collectionPct / 100;
      const mode = activeProfile?.payMode ?? "existing_split";
      const amount = activeProfile?.payAmount ?? 0;
      const split = term.clinicianSplit ?? person.preCapClinicianSplit;
      const remaining = Math.max(0, person.capAmount - capEarned);
      const afterCap = person.capEnabled && person.capAmount > 0 && remaining === 0;
      const calculated = calculateClinicianMetrics({
        ...person,
        sessionRate: rate,
        sessionsPerWeek: count,
        weeksWorkedPerYear: 1,
        capEnabled: person.capEnabled && !afterCap,
        capAmount: remaining,
        preCapClinicianSplit: afterCap ? person.postCapClinicianSplit : split,
        preCapPracticeSplit: afterCap ? person.postCapPracticeSplit : 100 - split,
        nonClinicalHoursPerWeek:
          ((person.nonClinicalHoursPerWeek ?? 0) / 7) *
          (person.weeksWorkedPerYear / 52.1786),
      });
      if (mode === "existing_split") {
        capEarned +=
          calculated.preCapSessions * rate * (100 - split) / 100;
        pay += calculated.clinicianCompensation;
      } else if (mode === "salary") {
        pay += person.id === familyId
          ? amount / 24 * semiMonthlyChecksThrough(start, date, date)
          : amount / 12 / daysInclusive(start, end);
      } else if (mode === "hourly") {
        pay += amount * (activeProfile?.paidHoursPerWeek ?? 0) / 7 *
          person.weeksWorkedPerYear / 52.1786;
      } else {
        pay += amount * count;
      }
      personSessions += count;
      personRevenue += earned;
    }
    sessions += personSessions;
    revenue += personRevenue;
    clinicianPay += pay;
    const burden = String(person.classification).toLowerCase() === "w2"
      ? pay * (
        person.w2EmployerFicaPct + person.futaSutaPct +
        person.workersCompPct + person.otherEmployerBurdenPct
      ) / 100
      : 0;
    employerBurden += burden;
    if (person.id === workspace.settings.familyW2ClinicianId) {
      familyGrossPay += pay;
      familyEmployerBurden += burden;
    }
  }
  const staffPay = context.staff
    .filter((member) => (member.goalId ?? null) === workspace.settings.teamId)
    .reduce((sum, member) =>
      sum + calculateStaffMemberCost(member).totalAnnualCost / 12 * fraction,
    0);
  const forecastMonth = forecast(
    {
      ...workspace,
      settings: { ...workspace.settings, forecastStart: start, horizonMonths: 1 },
    },
    context,
  )[0];
  const overhead = (forecastMonth?.values.overhead ?? 0) * fraction;
  const marketing = (forecastMonth?.values.marketing ?? 0) * fraction;
  const otherIncome = workspace.budgets
    .filter((budget) => workspace.categories.some(
      (category) => category.id === budget.categoryId && category.kind === "income",
    ))
    .reduce((sum, budget) =>
      sum + budgetAmount(budget, start, through, sessions, revenue), 0);
  const processing = revenue * workspace.settings.processingPct / 100 +
    sessions * workspace.settings.collectionPct / 100 *
      workspace.settings.processingTransactionsPerSession *
      workspace.settings.processingFixedPerTransaction;
  const legacyOwnerPayroll =
    (forecastMonth?.values.ownerPayroll ?? 0) * fraction;
  const legacyOwnerBurden = legacyOwnerPayroll *
    workspace.settings.ownerPayrollBurdenPct / 100;
  const profit = revenue + otherIncome - clinicianPay - employerBurden -
    staffPay - overhead - marketing - processing - legacyOwnerPayroll -
    legacyOwnerBurden;
  const positive = Math.max(0, profit);
  const buckets = workspace.allocations.filter(
    (bucket) => !bucket.archived && bucket.start <= through &&
      (!bucket.end || bucket.end >= start),
  );
  const allocations = buckets.length
    ? buckets.map((bucket) => ({
        id: bucket.id,
        name: bucket.name,
        kind: bucket.kind,
        amount: positive * bucket.percent / 100,
      }))
    : [
        { id: "tax", name: "Tax fund", kind: "tax", amount: positive * workspace.settings.taxPct / 100 },
        { id: "reserve", name: "Business reserves", kind: "reserve", amount: positive * workspace.settings.reservePct / 100 },
        { id: "distribution", name: "Your distribution", kind: "distribution", amount: positive * workspace.settings.distributionPct / 100 },
      ];
  const distribution = allocations
    .filter((bucket) => bucket.kind === "distribution")
    .reduce((sum, bucket) => sum + bucket.amount, 0);
  const retained = profit - allocations.reduce((sum, bucket) => sum + bucket.amount, 0);
  const netPay = estimateW2NetPay(familyGrossPay, workspace.settings.estimatedIncomeTaxPct);
  return {
    ...empty,
    sessions,
    splitPeriods,
    incompleteClinicians,
    revenue,
    otherIncome,
    clinicianPay,
    employerBurden,
    familyGrossPay,
    familyEmployerBurden,
    staffPay,
    overhead,
    marketing,
    processing,
    legacyOwnerPayroll,
    legacyOwnerBurden,
    profit,
    allocations,
    retained,
    distribution,
    estimatedEmployeePayrollTax: netPay.employeePayrollTax,
    estimatedAdditionalWithholding: netPay.additionalWithholding,
    estimatedNetPay: familyId === null ? null : netPay.net,
    familyTakeHome: familyId === null ? null : netPay.net + distribution,
  };
}
