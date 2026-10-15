import { daysInclusive } from "../index.ts";
import {
  calculateClinicianMetrics,
  calculateStaffMemberCost,
  staffCompensationKnown,
} from "../compensation.ts";
import {
  forecast,
  cashAllocationsForRange,
  overheadGoalAllowance,
  budgetAmount,
  monthEnd,
  staffMemberAt,
  summarizeImportedBillingActuals,
  type Context,
  type ForecastOptions,
} from "./engine.ts";
import {
  estimateW2NetPay,
  payrollPayDatesThrough,
  payrollPeriodForPayDate,
  payrollScheduleForClassification,
  semiMonthlyChecksThrough,
} from "./family-pay.ts";
import { clinicianModelAt, clinicianTermsAt } from "./clinician-terms.ts";
import type { Workspace } from "./model.ts";
import { observedSessionPace, type PaceCoverage } from "./observed-pace.ts";
import { workingSessionPace } from "./working-session-pace.ts";
import { projectedCashAllocations } from "./projected-cash-allocations.ts";

export type MonthFlow = {
  start: string;
  through: string | null;
  sessionDataThrough: string | null;
  basisLabel: "Month to date" | "Projection";
  paceSource: string;
  paceLookbackStart: string | null;
  sessions: number | null;
  splitPeriods: boolean;
  incompleteClinicians: string[];
  revenue: number | null;
  otherIncome: number;
  clinicianPay: number;
  employerBurden: number;
  familyGrossPay: number;
  familyEmployerBurden: number;
  staffPay: number | null;
  overhead: number;
  marketing: number;
  processing: number | null;
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
  scheduledPayroll: { clinicianPay: number; familyGrossPay: number; employerBurden: number; staffPay: number | null } | null;
  allocationBasis: "cash-surplus" | "positive-profit";
  allocationSurplus: number | null;
  unavailableReasons: string[];
};

export type MonthFlowOptions = {
  fullMonthProjection?: boolean;
  attendanceCoverage?: PaceCoverage[];
  forecastOptions?: ForecastOptions;
};

const dayBefore = (date: string, days: number) =>
  new Date(Date.parse(date + "T12:00:00Z") - days * 86_400_000)
    .toISOString()
    .slice(0, 10);

export function monthFlow(
  workspace: Workspace,
  context: Context,
  month: string,
  today: string,
  options: MonthFlowOptions = {},
): MonthFlow {
  const start = month.slice(0, 7) + "-01";
  const end = monthEnd(start);
  const cutoff = end < today ? end : today;
  const projection = options.fullMonthProjection ?? false;
  const horizon = projection ? end : cutoff;
  const people = context.clinicians.filter(
    (person) => (person.goalId ?? null) === workspace.settings.teamId,
  );
  const selectedIds = new Set(people.map((person) => person.id));
  const importedBillingSource = summarizeImportedBillingActuals(context, selectedIds);
  const importedBilling = importedBillingSource.billed;
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
  const through = projection ? horizon : dataThrough;
  const completedBiweekly = [
    ...new Map(
      context.sessions
        .filter(
          (record) =>
            selectedIds.has(record.clinicianId) &&
            record.end <= cutoff &&
            daysInclusive(record.start, record.end) === 14,
        )
        .map((record) => [
          `${record.start}|${record.end}`,
          { start: record.start, end: record.end },
        ]),
    ).values(),
  ]
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, 4);
  const exactFour =
    completedBiweekly.length === 4 &&
    daysInclusive(completedBiweekly[0].end, cutoff) <= 28 &&
    completedBiweekly.every(
      (period, index) =>
        (index === 0 ||
          dayBefore(completedBiweekly[index - 1].start, 1) === period.end) &&
        people.every((person) =>
          context.sessions.some(
            (record) =>
              record.clinicianId === person.id &&
              record.start === period.start &&
              record.end === period.end,
          ),
        ),
    );
  const recentStart = exactFour
    ? completedBiweekly[3].start
    : dayBefore(cutoff, 55);
  let anyRecordedPace = false;
  const missingPace: string[] = [];
  const fallbackSources: string[] = [];
  const paceWindows: { name: string; start: string; end: string; basis: string }[] = [];
  const weeklyPaceByClinician = new Map<number, number>();
  for (const person of people) {
    const profile = workspace.clinicians.find((entry) => entry.clinicianId === person.id);
    if (profile?.status === "planned" || profile?.status === "archived" || profile?.onTeam === false || (profile && (profile.start > cutoff || (profile.end !== null && profile.end < start)))) {
      weeklyPaceByClinician.set(person.id, 0);
      continue;
    }
    const pace = projection
      ? workingSessionPace(context.sessions, person.id, cutoff, options.attendanceCoverage)
      : observedSessionPace(context.sessions, person.id, cutoff, recentStart, options.attendanceCoverage);
    const historicalFallback = projection ? pace.windowEnd < start : "historicalFallback" in pace && pace.historicalFallback;
    if (historicalFallback) fallbackSources.push(`${person.label}: historical fallback ${pace.windowStart} to ${pace.windowEnd}, ${pace.basis}`);
    if (pace.weekly !== null) paceWindows.push({ name: person.label, start: pace.windowStart, end: pace.windowEnd, basis: pace.basis });
    anyRecordedPace ||= pace.weekly !== null;
    if (pace.weekly === null) missingPace.push(person.label);
    else weeklyPaceByClinician.set(person.id, pace.weekly);
  }
  const paceSource = projection && anyRecordedPace
    ? `complete-service-period averages in rolling three calendar months; partial periods and unproved gaps excluded; no desired-session fill. ${paceWindows.map((window) => `${window.name}: ${window.start} to ${window.end}, ${window.basis}`).join("; ")}${fallbackSources.length ? `. ${fallbackSources.join("; ")}` : ""}`
    : exactFour
    ? "last four complete biweekly session periods"
    : anyRecordedPace
      ? `observed session averages; unverified coverage remains an estimate; no desired-session fill${fallbackSources.length ? `. ${fallbackSources.join("; ")}` : ""}`
      : "observed session average unavailable; no desired-session substitution";
  const familyId = workspace.settings.familyW2ClinicianId;
  const datesIn = (from: string, to: string) =>
    Array.from({ length: daysInclusive(from, to) }, (_, index) =>
      new Date(Date.parse(from + "T12:00:00Z") + index * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
  let scheduledStaffKnown = true;
  const staffCostAt = (member: Context["staff"][number], date: string) => {
    const terms = staffMemberAt(workspace, member, date);
    if (!staffCompensationKnown(terms)) scheduledStaffKnown = false;
    return calculateStaffMemberCost(terms).totalAnnualCost;
  };
  const scheduledStaffPay = (throughDate: string) =>
    context.staff
      .filter((member) => (member.goalId ?? null) === workspace.settings.teamId)
      .reduce((sum, member) => {
        const schedule = payrollScheduleForClassification(
          member.classification,
        );
        const payrollHistoryStart = "2026-01-01";
        if (!schedule) {
          const annualCost = staffCostAt(member, throughDate);
          return (
            sum +
            ((annualCost / 12) * daysInclusive(start, throughDate)) /
              daysInclusive(start, end)
          );
        }
        return (
          sum +
          payrollPayDatesThrough(schedule, start, throughDate, start).reduce(
            (paySum, payDate) => {
              const period = payrollPeriodForPayDate(schedule, payDate);
              const payStart =
                period.start > payrollHistoryStart
                  ? period.start
                  : payrollHistoryStart;
              if (payStart > period.end) return paySum;
              const periodDays = daysInclusive(period.start, period.end);
              const payPeriods = schedule === "semi_monthly" ? 24 : 26;
              const amount = datesIn(payStart, period.end).reduce(
                (daily, date) =>
                  daily +
                  staffCostAt(member, date) /
                    payPeriods /
                    periodDays,
                0,
              );
              return paySum + amount;
            },
            0,
          )
        );
      }, 0);
  let staffPay = scheduledStaffPay(horizon);
  if (context.staff.some((member) => (member.goalId ?? null) === workspace.settings.teamId &&
    datesIn(start, horizon).some((date) => !staffCompensationKnown(staffMemberAt(workspace, member, date)))))
    scheduledStaffKnown = false;
  const payrollHistoryStart = "2026-01-01";
  const empty = {
    start,
    through,
    sessionDataThrough: dataThrough,
    basisLabel: projection ? "Projection" : "Month to date",
    paceSource,
    paceLookbackStart: projection && !fallbackSources.length && new Set(paceWindows.map((window) => window.start)).size === 1 ? paceWindows[0].start : null,
    sessions: null,
    splitPeriods: false,
    incompleteClinicians: [],
    revenue: null,
    otherIncome: 0,
    clinicianPay: 0,
    employerBurden: 0,
    familyGrossPay: 0,
    familyEmployerBurden: 0,
    staffPay: !scheduledStaffKnown ? null : staffPay,
    overhead: 0,
    marketing: 0,
    processing: projection ? null : 0,
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
    scheduledPayroll: null,
    allocationBasis: projection ? "cash-surplus" : "positive-profit",
    allocationSurplus: null,
    unavailableReasons: !scheduledStaffKnown ? ["Selected staff compensation is unknown; staff costs, profit and allocations cannot be certified."] : [],
  } satisfies MonthFlow;
  if (!through) return empty;
  if (projection && missingPace.length) return { ...empty, incompleteClinicians: missingPace };

  const elapsed = daysInclusive(start, through);
  const fraction = elapsed / daysInclusive(start, end);
  let splitPeriods = false;
  const actualSessionsForDate = (clinicianId: number, date: string) =>
    records.reduce(
      (sum, record) =>
        record.clinicianId === clinicianId &&
        record.start <= date &&
        record.end >= date
          ? sum + record.completed / daysInclusive(record.start, record.end)
          : sum,
      0,
    );
  const sessionsForDate = (clinicianId: number, date: string) => {
    if (!projection) return actualSessionsForDate(clinicianId, date);
    // Checks paid this month can cover service dates in the previous month.
    return (weeklyPaceByClinician.get(clinicianId) ?? 0) / 7;
  };
  const dailySessionsByClinician = new Map<number, Map<string, number>>();
  for (const record of records) {
    const overlapStart = record.start > start ? record.start : start;
    const overlapEnd = record.end < through ? record.end : through;
    if (overlapStart > overlapEnd) continue;
    const daily = record.completed / daysInclusive(record.start, record.end);
    if (!projection && (overlapStart !== record.start || overlapEnd !== record.end))
      splitPeriods = true;
    const clinicianDays =
      dailySessionsByClinician.get(record.clinicianId) ??
      new Map<string, number>();
    for (const date of datesIn(overlapStart, overlapEnd))
      clinicianDays.set(date, (clinicianDays.get(date) ?? 0) + daily);
    dailySessionsByClinician.set(record.clinicianId, clinicianDays);
  }
  if (projection) {
    for (const person of people) {
      const clinicianDays =
        dailySessionsByClinician.get(person.id) ?? new Map<string, number>();
      for (const date of datesIn(start, through)) {
        clinicianDays.set(
          date,
          (weeklyPaceByClinician.get(person.id) ?? 0) / 7,
        );
      }
      dailySessionsByClinician.set(person.id, clinicianDays);
    }
  }
  const incompleteClinicians = projection
    ? []
    : people
        .filter(
          (person) =>
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
    if (baseProfile?.status === "planned" || (projection && baseProfile?.onTeam === false)) continue;
    let pay = 0;
    let personSessions = 0;
    let personRevenue = 0;
    let capEarned = baseProfile?.openingCapContribution ?? 0;
    const schedule = payrollScheduleForClassification(person.classification);
    const activeStart = baseProfile?.start ?? payrollHistoryStart;
    const dayPay = (date: string, count: number) => {
      const activeProfile = clinicianModelAt(workspace, person.id, date);
      if (baseProfile && !activeProfile) return 0;
      if (activeProfile?.status === "planned") return 0;
      const term = clinicianTermsAt(workspace, person.id, date);
      const rate =
        activeProfile?.expectedSessionRevenue ??
        term.sessionRate ??
        person.sessionRate;
      const mode = activeProfile?.payMode ?? "existing_split";
      const amount = activeProfile?.payAmount ?? 0;
      const split = term.clinicianSplit ?? person.preCapClinicianSplit;
      const remaining = Math.max(0, person.capAmount - capEarned);
      const afterCap =
        person.capEnabled && person.capAmount > 0 && remaining === 0;
      const calculated = calculateClinicianMetrics({
        ...person,
        sessionRate: rate,
        sessionsPerWeek: count,
        weeksWorkedPerYear: 1,
        capEnabled: person.capEnabled && !afterCap,
        capAmount: remaining,
        preCapClinicianSplit: afterCap ? person.postCapClinicianSplit : split,
        preCapPracticeSplit: afterCap
          ? person.postCapPracticeSplit
          : 100 - split,
        nonClinicalHoursPerWeek:
          ((person.nonClinicalHoursPerWeek ?? 0) / 7) *
          (person.weeksWorkedPerYear / 52.1786),
      });
      if (mode === "existing_split") {
        capEarned += (calculated.preCapSessions * rate * (100 - split)) / 100;
        return calculated.clinicianCompensation;
      }
      if (mode === "hourly")
        return (
          (((amount * (activeProfile?.paidHoursPerWeek ?? 0)) / 7) *
            person.weeksWorkedPerYear) /
          52.1786
        );
      if (mode === "per_session") return amount * count;
      return amount / 12 / daysInclusive(start, end);
    };
    for (const date of datesIn(start, through)) {
      const activeProfile = clinicianModelAt(workspace, person.id, date);
      if (baseProfile && !activeProfile) continue;
      if (activeProfile?.status === "planned") continue;
      const term = clinicianTermsAt(workspace, person.id, date);
      const count = dailySessionsByClinician.get(person.id)?.get(date) ?? 0;
      const rate =
        activeProfile?.expectedSessionRevenue ??
        term.sessionRate ??
        person.sessionRate;
      const earned = (!projection ? importedBilling.get(person.id)?.get(date) : undefined) ?? count * rate;
      const mode = activeProfile?.payMode ?? "existing_split";
      const amount = activeProfile?.payAmount ?? 0;
      const split = term.clinicianSplit ?? person.preCapClinicianSplit;
      if (!schedule && mode === "salary") {
        pay +=
          person.id === familyId
            ? (amount / 24) * semiMonthlyChecksThrough(start, date, date)
            : amount / 12 / daysInclusive(start, end);
      } else if (!schedule) pay += dayPay(date, count);
      personSessions += count;
      personRevenue += earned;
    }
    if (schedule) {
      const dates = payrollPayDatesThrough(
        schedule,
        start,
        horizon,
        activeStart,
      );
      for (const payDate of dates) {
        const period = payrollPeriodForPayDate(schedule, payDate);
        const salaryProfile = clinicianModelAt(workspace, person.id, payDate);
        const modeAtPayDate = salaryProfile?.payMode ?? "existing_split";
        const profileDate =
          schedule === "biweekly_thursday" && modeAtPayDate !== "salary"
            ? period.end
            : payDate;
        const activeProfile = clinicianModelAt(
          workspace,
          person.id,
          profileDate,
        );
        if (baseProfile && !activeProfile) continue;
        if (activeProfile?.status === "planned") continue;
        const payStart =
          period.start > activeStart ? period.start : activeStart;
        if (payStart > period.end) continue;
        const mode = activeProfile?.payMode ?? "existing_split";
        const amount = activeProfile?.payAmount ?? 0;
        if (mode === "salary") {
          pay += schedule === "semi_monthly" ? amount / 24 : amount / 26;
          continue;
        }
        for (const date of datesIn(payStart, period.end))
          pay += dayPay(date, sessionsForDate(person.id, date));
      }
    }
    sessions += personSessions;
    revenue += personRevenue;
    clinicianPay += pay;
    const burden =
      String(person.classification).toLowerCase() === "w2"
        ? (pay *
            (person.w2EmployerFicaPct +
              person.futaSutaPct +
              person.workersCompPct +
              person.otherEmployerBurdenPct)) /
          100
        : 0;
    employerBurden += burden;
    if (person.id === workspace.settings.familyW2ClinicianId) {
      familyGrossPay += pay;
      familyEmployerBurden += burden;
    }
  }
  const forecastMonth = forecast(
    {
      ...workspace,
      settings: {
        ...workspace.settings,
        forecastStart: start,
        horizonMonths: 1,
      },
    },
    context,
    [], 1, true,
    projection ? { ...options.forecastOptions, baselineWeeklyByClinician: Object.fromEntries(weeklyPaceByClinician), useImportedBillingActuals: false, workingForecast: true } : {},
  )[0];
  const scheduledPayroll = projection ? { clinicianPay, familyGrossPay, employerBurden, staffPay: scheduledStaffKnown ? staffPay : null } : null;
  if (projection && (!forecastMonth || ["revenue", "profit", "clinicianPay", "employerBurden", "staffCost", "overhead", "marketing", "fees", "ownerPayroll"].some((metric) => forecastMonth.values[metric] == null))) {
    const earnedFamilyPay = familyId === null ? 0 : forecastMonth?.clinicians[String(familyId)]?.clinicianPay ?? familyGrossPay;
    const net = estimateW2NetPay(earnedFamilyPay, workspace.settings.estimatedIncomeTaxPct);
    return {
      ...empty,
      sessions: forecastMonth?.values.sessions ?? null,
      revenue: forecastMonth?.values.revenue ?? null,
      clinicianPay: forecastMonth?.values.clinicianPay ?? clinicianPay,
      employerBurden: forecastMonth?.values.employerBurden ?? employerBurden,
      familyGrossPay: earnedFamilyPay,
      familyEmployerBurden: familyId === null ? 0 : forecastMonth?.clinicians[String(familyId)]?.employerBurden ?? familyEmployerBurden,
      staffPay: forecastMonth?.values.staffCost ?? null,
      overhead: forecastMonth?.values.overhead ?? 0,
      marketing: forecastMonth?.values.marketing ?? 0,
      processing: forecastMonth?.values.fees ?? null,
      legacyOwnerPayroll: forecastMonth?.values.ownerPayroll ?? 0,
      legacyOwnerBurden: (forecastMonth?.values.ownerPayroll ?? 0) * workspace.settings.ownerPayrollBurdenPct / 100,
      scheduledPayroll,
      estimatedEmployeePayrollTax: net.employeePayrollTax,
      estimatedAdditionalWithholding: net.additionalWithholding,
      estimatedNetPay: familyId === null ? null : net.net,
      unavailableReasons: forecastMonth?.warnings.length ? forecastMonth.warnings : ["Projected financial inputs are unavailable; profit and allocations are withheld."],
    };
  }
  if (projection && forecastMonth) {
    // Operating profit uses earned costs, not checks paid for another service period.
    // Reuse the bridge's forecast so volume, dated pay terms and cost bounds agree.
    sessions = forecastMonth.values.sessions ?? 0;
    revenue = forecastMonth.values.revenue ?? 0;
    clinicianPay = forecastMonth.values.clinicianPay ?? 0;
    employerBurden = forecastMonth.values.employerBurden ?? 0;
    staffPay = forecastMonth.values.staffCost ?? 0;
    const family = familyId === null ? undefined : forecastMonth.clinicians[String(familyId)];
    familyGrossPay = family?.clinicianPay ?? 0;
    familyEmployerBurden = family?.employerBurden ?? 0;
  }
  let overhead = (forecastMonth?.values.overhead ?? 0) * fraction;
  const goalAllowance = overheadGoalAllowance(workspace.settings, revenue, fraction);
  if (!projection && goalAllowance !== null && forecastMonth) {
    const forecastRevenue = forecastMonth.values.revenue ?? 0;
    const forecastSessions = forecastMonth.values.sessions ?? 0;
    let detailedFullMonth = 0;
    let detailedMatchingPeriod = 0;
    for (const budget of workspace.budgets) {
      const kind = workspace.categories.find((category) => category.id === budget.categoryId)?.kind;
      if (kind && ["income", "tax", "reserve", "owner", "marketing"].includes(kind))
        continue;
      const amount = forecastMonth.budgetLines?.[budget.id] ?? 0;
      detailedFullMonth += amount;
      const unitBudget = { ...budget, amount: 1 };
      const fullMonthUnits = budgetAmount(unitBudget, start, end, forecastSessions, forecastRevenue);
      const matchingUnits = budgetAmount(unitBudget, start, through, sessions, revenue);
      detailedMatchingPeriod += fullMonthUnits > 0
        ? amount * matchingUnits / fullMonthUnits
        : budget.planningOnly ? 0 : budgetAmount(budget, start, through, sessions, revenue);
    }
    const fullMonthAllowance = overheadGoalAllowance(workspace.settings, forecastRevenue) ?? 0;
    const additionalCosts = Math.max(
      0,
      (forecastMonth.values.overhead ?? 0) - Math.max(detailedFullMonth, fullMonthAllowance),
    );
    overhead = Math.max(detailedMatchingPeriod, goalAllowance) + additionalCosts * fraction;
  }
  const marketing = (forecastMonth?.values.marketing ?? 0) * fraction;
  const otherIncome = workspace.budgets
    .filter((budget) =>
      workspace.categories.some(
        (category) =>
          category.id === budget.categoryId && category.kind === "income",
      ),
    )
    .reduce(
      (sum, budget) =>
        sum + (projection ? forecastMonth?.budgetLines?.[budget.id] ?? 0 : budgetAmount(budget, start, through, sessions, revenue)),
      0,
    );
  const estimatedCollections =
    (revenue * workspace.settings.collectionPct) / 100;
  const processing = projection ? forecastMonth!.values.fees! :
    (estimatedCollections * workspace.settings.processingPct) / 100 +
    ((sessions * workspace.settings.collectionPct) / 100) *
      workspace.settings.processingTransactionsPerSession *
      workspace.settings.processingFixedPerTransaction;
  const legacyOwnerPayroll =
    (forecastMonth?.values.ownerPayroll ?? 0) * fraction;
  const legacyOwnerBurden =
    (legacyOwnerPayroll * workspace.settings.ownerPayrollBurdenPct) / 100;
  const unknownActualBilling = !projection && importedBillingSource.unknownDates.some((row) => row.date >= start && row.date <= through);
  if (!projection && (!scheduledStaffKnown || unknownActualBilling)) {
    const netPay = estimateW2NetPay(familyGrossPay, workspace.settings.estimatedIncomeTaxPct);
    return {
      ...empty,
      sessions,
      splitPeriods,
      incompleteClinicians,
      revenue: unknownActualBilling ? null : revenue,
      otherIncome,
      clinicianPay,
      employerBurden,
      familyGrossPay,
      familyEmployerBurden,
      staffPay: scheduledStaffKnown ? staffPay : null,
      overhead,
      marketing,
      processing: unknownActualBilling && workspace.settings.processingPct > 0 && workspace.settings.collectionPct > 0 ? null : processing,
      legacyOwnerPayroll,
      legacyOwnerBurden,
      estimatedEmployeePayrollTax: netPay.employeePayrollTax,
      estimatedAdditionalWithholding: netPay.additionalWithholding,
      estimatedNetPay: familyId === null ? null : netPay.net,
      unavailableReasons: [
        ...(!scheduledStaffKnown ? ["Selected staff compensation is unknown; staff costs, profit and allocations cannot be certified."] : []),
        ...(unknownActualBilling ? ["Imported billing source identities conflict or have unknown fees in this actual window; revenue, profit and allocations cannot be certified."] : []),
      ],
    };
  }
  const profit =
    revenue +
    otherIncome -
    clinicianPay -
    employerBurden -
    staffPay -
    overhead -
    marketing -
    processing -
    legacyOwnerPayroll -
    legacyOwnerBurden;
  const positive = Math.max(0, profit);
  const { buckets, configured } = cashAllocationsForRange(
    workspace.allocations, positive, start, through,
  );
  const allocations = configured
    ? buckets.map((bucket) => ({
        id: bucket.id,
        name: bucket.name,
        kind: bucket.kind,
        amount: bucket.amount,
      }))
    : [
        {
          id: "tax",
          name: "Tax fund",
          kind: "tax",
          amount: (positive * workspace.settings.taxPct) / 100,
        },
        {
          id: "reserve",
          name: "Business reserves",
          kind: "reserve",
          amount: (positive * workspace.settings.reservePct) / 100,
        },
        {
          id: "distribution",
          name: "Your distribution",
          kind: "distribution",
          amount: (positive * workspace.settings.distributionPct) / 100,
        },
      ];
  let distribution = allocations
    .filter((bucket) => bucket.kind === "distribution")
    .reduce((sum, bucket) => sum + bucket.amount, 0);
  let familyDistribution = configured
    ? buckets
        .filter((bucket) => bucket.kind === "distribution" && bucket.household)
        .reduce((sum, bucket) => sum + bucket.amount, 0)
    : distribution;
  let retained =
    profit - allocations.reduce((sum, bucket) => sum + bucket.amount, 0);
  let allocationSurplus = positive;
  if (projection && forecastMonth) {
    const cash = projectedCashAllocations(workspace, forecastMonth, start, through);
    if (!cash) return { ...empty, sessions, revenue, profit, scheduledPayroll, unavailableReasons: ["Projected cash allocation inputs are unavailable; distributions and retained cash are withheld."] };
    allocations.splice(0, allocations.length, ...cash.allocations);
    distribution = cash.distribution;
    familyDistribution = cash.familyDistribution;
    retained = cash.retained;
    allocationSurplus = cash.surplus;
  }
  const netPay = estimateW2NetPay(
    familyGrossPay,
    workspace.settings.estimatedIncomeTaxPct,
  );
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
    familyTakeHome: familyId === null ? null : netPay.net + familyDistribution,
    scheduledPayroll,
    allocationSurplus,
  };
}
