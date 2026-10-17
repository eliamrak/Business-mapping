import {
  bindBillingResolutions, budgetAmount, cashAllocationsForRange,
  clinicianModelAt, clinicianTermsAt, isConsultationService,
  isDocumentationService, isRecognizedTreatmentCode, monthEnd,
  overheadGoalAllowance, reconcileBillingEvidence, resolveHistoricalBillingProvider, resolveImportedProvider,
  staffCostForRange, staffMemberAt,
  type Context, type ImportEvidenceDeclarations, type Values, type Workspace,
} from "@workspace/practice/hub";
import { calculateClinicianMetrics, staffCompensationKnown } from "@workspace/practice/compensation";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { derivedShowVisits, type LocalSnapshot, type SameDayVisitOverrides } from "./retention-local.ts";

type Range = { start: string; end: string };
type Component = { key: string; label: string; value: number | null; basis: string };
export type PracticeFinancialEstimate = {
  source: "historical-estimate";
  range: Range | null;
  status: "available" | "partial" | "unavailable";
  billingCoverageComplete: boolean;
  modelComplete: boolean;
  values: Values;
  components: Component[];
  assumptions: string[];
  unavailableReasons: string[];
};
const shift = (date: string, n: number) => new Date(Date.parse(date + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + "T12:00:00Z")) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
const days = (start: string, end: string) => (Date.parse(end + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 86400000 + 1;
const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const percent = (n: unknown): n is number => nonnegative(n) && n <= 100;
const plus = (a: number | null, b: number | null) => a === null || b === null ? null : a + b;
const total = (numbers: (number | null)[]) => numbers.reduce<number | null>(plus, 0);
const active = (row: { start: string | null; end: string | null; archived?: boolean }, date: string) => !row.archived && !!row.start && row.start <= date && (!row.end || row.end >= date);
const keys = ["sessions", "revenue", "clinicianPay", "employerBurden", "ownerClinicalPay", "coOwnerSalaryPretax", "staffCost", "overhead", "marketing", "fees", "ownerPayroll", "ownerPayrollBurden", "otherIncome", "profit", "taxReserve", "reserves", "distributions", "retainedSurplus", "ownerDistributionsPretax"];
const cashKeys = ["collections", "cash", "retainedCash", "familyTakeHome", "paidPayroll", "actualPaid", "bankTransfers"];

/** Billed accrual estimate only. Never finalizes periods or establishes payments. */
export function practiceFinancialEstimateRange(
  workspace: Workspace, context: Context, snapshots: readonly LocalSnapshot[],
  asOf: string, requested: Range, declarations?: ImportEvidenceDeclarations | null,
  sameDayVisitOverrides: SameDayVisitOverrides = {},
): PracticeFinancialEstimate {
  const reasons = new Set<string>();
  const assumptions = [
    "Estimate scope is the selected team's clinician roster; explicitly declared historical billing-only providers are excluded from current-team revenue and compensation.",
    "Raw workspace settings are expense assumptions, not goal-injected defaults or accounting actuals; explicit zero is supported.",
    "Revenue and percentage compensation use accepted discounted billed charges, never clinician-card fees or collected cash.",
    "Salary accrues on active calendar dates; owner clinical pay and co-owner salary are subsets of clinician compensation.",
    "Processing is modeled billed revenue times collectionPct times processingPct, plus attended visits times collectionPct times transaction factor times fixed fee; no payment timing or successful payment is established.",
    "Allocations use each selected month's positive estimated billed surplus, weighted by effective dates; distributions are estimates, not bank transfers.",
    "Budget accruals and configured processing/separate owner payroll are distinct expense assumptions; overlapping payroll or processing budget lines require review.",
    "Overhead compares the selected calendar month's accrued detail with its allowance once; explicit raw floors apply in detailed mode, and dated event costs are additional.",
  ];
  const values: Values = Object.fromEntries([...keys.map(key => [key, 0]), ...cashKeys.map(key => [key, null])]);
  const finish = (range: Range | null, billingCoverageComplete: boolean): PracticeFinancialEstimate => {
    const modelComplete = range !== null && billingCoverageComplete && reasons.size === 0 && keys.every(key => values[key] !== null);
    return {
      source: "historical-estimate", range,
      status: modelComplete ? "available" : keys.some(key => values[key] !== null) && range ? "partial" : "unavailable",
      billingCoverageComplete, modelComplete, values,
      components: keys.map(key => ({ key, label: ({ revenue: "Actual billed gross", clinicianPay: "Estimated earned clinician compensation", coOwnerSalaryPretax: "Co-owner salary (included in clinician compensation)", ownerClinicalPay: "Owner clinical pay (included in clinician compensation)", ownerDistributionsPretax: "Estimated household distribution (not a transfer)", profit: "Estimated operating profit", fees: "Estimated processing fees" } as Record<string, string>)[key] ?? key,
        value: values[key] ?? null, basis: key === "revenue" ? "Accepted billed charges by service date" : "Dated model assumption; not paid/accounting actual" })),
      assumptions, unavailableReasons: [...reasons],
    };
  };
  if (!valid(asOf) || !valid(requested.start) || !valid(requested.end) || requested.start > requested.end || requested.start > asOf || days(requested.start, requested.end) > 1830) {
    keys.forEach(key => values[key] = null);
    reasons.add("Choose valid historical dates within the supported five-year estimate window.");
    return finish(null, false);
  }
  const range = { start: requested.start, end: requested.end < asOf ? requested.end : asOf };
  const people = context.clinicians.filter(person => (person.goalId ?? null) === workspace.settings.teamId);
  const ids = new Set(people.map(person => person.id));
  const proof = completeReportCoverage(snapshots, people, asOf, context.clinicians, { declarations, teamId: workspace.settings.teamId });
  const eligible = new Set(proof.eligibleBillingRows);
  const resolve = (label: string) => resolveImportedProvider(label, context.clinicians, workspace.settings.teamId, declarations);
  const covered = (kind: "billing" | "attendance", id: number, date: string) => (kind === "billing" ? proof.completeBillingCoverage : proof.completeAttendanceCoverage).some(row => row.clinicianId === id && row.start <= date && row.end >= date);
  const charges = new Map<string, number>();
  const badDays = new Set<string>();
  const keyFor = (id: number, date: string) => `${id}|${date}`;
  // Reconcile globally before source admission, date, or team filtering: an excluded
  // conflicting source must not make its eligible counterpart authoritative.
  const entries = snapshots.flatMap(snapshot => snapshot.kind === "billing" ? snapshot.rows.map(row => ({ row, snapshotId: snapshot.sourceSnapshotId ?? snapshot.id })) : []);
  const groups = reconcileBillingEvidence(entries, bindBillingResolutions(declarations?.billingResolutions ?? [], context.clinicians, declarations));
  let identityUnknown = false;
  for (const { row } of entries) {
    const id = resolve(row.clinician);
    const historicalOnly = resolveHistoricalBillingProvider(row.clinician, context.clinicians, declarations) !== null;
    const label = row.clinician.trim().replace(/\s+/g, " ").toLowerCase();
    const matching = context.clinicians.filter(person => person.label.trim().replace(/\s+/g, " ").toLowerCase() === label);
    const otherTeam = matching.length === 1 && !ids.has(matching[0].id) && !declarations?.mappings.some(mapping => mapping.sourceLabel.trim().toLowerCase() === label);
    if (!valid(row.serviceDate) && id !== null) {
      identityUnknown = true;
      reasons.add("A selected provider's billed service date is invalid; charges cannot be assigned to the selected historical window.");
    } else if (row.serviceDate >= range.start && row.serviceDate <= range.end && id === null && !otherTeam && !historicalOnly) {
      identityUnknown = true;
      reasons.add("A billed provider identity is unresolved; selected-practice billed coverage cannot be certified.");
    }
  }
  for (const group of groups) {
    const admitted = group.rows.filter(row => eligible.has(row));
    for (const row of admitted) {
      const id = resolve(row.clinician);
      if (id === null || !ids.has(id)) continue;
      if (!group.known || group.acceptedRows?.some(accepted => !eligible.has(accepted))) badDays.add(keyFor(id, row.serviceDate));
    }
    if (!admitted.length || !group.known || group.acceptedRows?.some(row => !eligible.has(row))) continue;
    for (const row of group.acceptedRows ?? [admitted[0]]) {
      const id = resolve(row.clinician);
      if (id === null || !ids.has(id)) continue;
      const key = keyFor(id, row.serviceDate);
      if (isDocumentationService(row) || isConsultationService(row)) {
        if (row.totalFeeCharged !== 0) badDays.add(key);
        continue;
      }
      if (!isRecognizedTreatmentCode(row.billingCode)) { badDays.add(key); continue; }
      charges.set(key, (charges.get(key) ?? 0) + row.totalFeeCharged);
    }
  }
  const visits = new Map<string, number>();
  for (const row of derivedShowVisits(proof.eligibleSnapshots, sameDayVisitOverrides, snapshots)) {
    const id = resolve(row.clinician);
    if (id !== null && ids.has(id)) visits.set(keyFor(id, row.serviceDate), (visits.get(keyFor(id, row.serviceDate)) ?? 0) + 1);
  }
  const feeAt = (id: number, date: string) => covered("billing", id, date) && !badDays.has(keyFor(id, date)) ? charges.get(keyFor(id, date)) ?? 0 : null;
  const countAt = (id: number, date: string) => covered("attendance", id, date) ? visits.get(keyFor(id, date)) ?? 0 : null;
  if (!people.length) { reasons.add("No mapped clinicians establish the historical practice scope."); keys.forEach(key => values[key] = null); return finish(range, false); }
  let billingCoverageComplete = !identityUnknown;
  const settings = workspace.settings;
  const staff = context.staff.filter(member => (member.goalId ?? null) === settings.teamId);
  const capStates = new Map<number, { year: string; earned: number | null }>();
  const monthValues = new Map<string, Values>();
  const monthDetailedOverhead = new Map<string, number | null>();
  const replayStart = range.start.slice(0, 4) + "-01-01";
  for (let date = replayStart; date <= range.end; date = shift(date, 1)) {
    const selected = date >= range.start;
    const calendarDays = Number(monthEnd(date).slice(8));
    const daily: Values = Object.fromEntries(keys.map(key => [key, 0]));
    for (const person of people) {
      const profiles = workspace.clinicians.filter(row => row.clinicianId === person.id);
      const model = clinicianModelAt(workspace, person.id, date);
      const term = clinicianTermsAt(workspace, person.id, date);
      const fee = feeAt(person.id, date);
      const count = countAt(person.id, date);
      const inactive = profiles.length > 0 && (!model || model.status !== "active");
      const knownInactive = inactive && fee === 0;
      const mode = model?.payMode ?? term.payMode ?? "existing_split";
      let state = capStates.get(person.id);
      if (!state || state.year !== date.slice(0, 4)) { state = { year: date.slice(0, 4), earned: 0 }; capStates.set(person.id, state); }
      // The existing model dates its opening contribution at profile.start only.
      if (model?.start === date && nonnegative(model.openingCapContribution)) state.earned = model.openingCapContribution;
      let pay: number | null = 0;
      let salary = 0;
      if (inactive && !knownInactive) pay = null;
      else if (!inactive) {
        const amount = model?.payAmount ?? term.payAmount;
        if (mode === "salary") {
          pay = nonnegative(amount) ? amount / 12 / calendarDays : null;
          salary = pay ?? 0;
        } else if (mode === "hourly") {
          const hours = model?.paidHoursPerWeek ?? term.paidHoursPerWeek;
          pay = nonnegative(amount) && nonnegative(hours) && nonnegative(person.weeksWorkedPerYear) ? amount * hours / 7 * person.weeksWorkedPerYear / 52.1786 : null;
        } else if (mode === "per_session") pay = nonnegative(amount) && count !== null ? amount * count : null;
        else {
          const split = term.clinicianSplit ?? person.preCapClinicianSplit;
          const capKnown = typeof person.capEnabled === "boolean" && (!person.capEnabled || nonnegative(person.capAmount) && percent(person.postCapClinicianSplit) && percent(person.postCapPracticeSplit) && Math.abs(person.postCapClinicianSplit + person.postCapPracticeSplit - 100) < 1e-8);
          const capped = person.capEnabled && person.capAmount > 0;
          if (!percent(split) || !capKnown || fee === null || capped && (state.earned === null || fee < 0)) pay = null;
          else {
            const remaining = Math.max(0, person.capAmount - (state.earned ?? 0));
            const after = capped && remaining === 0;
            // One monetary unit, not one attended visit; percentage pay and caps
            // require billed dollars, while per-session pay uses proved visits.
            const calculated = calculateClinicianMetrics({ ...person, sessionRate: fee, sessionsPerWeek: 1, weeksWorkedPerYear: 1,
              capEnabled: capped && !after, capAmount: remaining,
              preCapClinicianSplit: after ? person.postCapClinicianSplit : split,
              preCapPracticeSplit: after ? person.postCapPracticeSplit : 100 - split,
              nonClinicalHoursPerWeek: 0, nonClinicalHourlyRate: 0 });
            pay = calculated.clinicianCompensation;
            if (capped) state.earned = (state.earned ?? 0) + calculated.preCapSessions * fee * (100 - split) / 100;
          }
          if (capped && pay === null) state.earned = null;
          if (person.nonClinicalHoursPerWeek) {
            pay = nonnegative(person.nonClinicalHoursPerWeek) && nonnegative(person.nonClinicalHourlyRate) && nonnegative(person.weeksWorkedPerYear)
              ? plus(pay, person.nonClinicalHoursPerWeek * person.nonClinicalHourlyRate / 7 * person.weeksWorkedPerYear / 52.1786) : null;
          }
        }
      }
      const unsupportedPayEvent = workspace.events.some(event => event.enabled && event.field.startsWith("clinician.") && event.date <= date
        && (!event.targetId || event.targetId === String(person.id) || event.targetId === model?.id)
        && ((!event.end || event.end >= date) || person.capEnabled && event.date.slice(0, 4) === date.slice(0, 4)));
      if (unsupportedPayEvent) { pay = null; state.earned = null; }
      if (!selected) continue;
      if (unsupportedPayEvent) reasons.add(`${person.label}: clinician events cannot establish dated compensation or cap progress; use explicit dated terms.`);
      if (fee === null || identityUnknown) { billingCoverageComplete = false; reasons.add(`${person.label}: complete, classified and reconciled billed charges are unavailable for selected dates.`); }
      if (count === null) reasons.add(`${person.label}: exact attended visits require complete attendance coverage; no period-average or card-rate fill is used.`);
      if (pay === null) reasons.add(`${person.label}: dated ${mode} compensation inputs or prior annual cap progress are unknown.`);
      const burdenInputs = [person.w2EmployerFicaPct, person.futaSutaPct, person.workersCompPct, person.otherEmployerBurdenPct];
      const classificationKnown = ["w2", "1099", "owner", "other"].includes(String(person.classification).toLowerCase());
      const burden = !classificationKnown ? null : String(person.classification).toLowerCase() === "w2" ? pay !== null && burdenInputs.every(percent) ? pay * burdenInputs.reduce((a, b) => a + b, 0) / 100 : null : 0;
      if (burden === null) reasons.add(`${person.label}: classification or employer burden is unknown.`);
      daily.sessions = plus(daily.sessions!, count);
      daily.revenue = plus(daily.revenue!, identityUnknown ? null : fee);
      daily.clinicianPay = plus(daily.clinicianPay!, pay);
      daily.employerBurden = plus(daily.employerBurden!, burden);
      if (String(person.classification).toLowerCase() === "owner") daily.ownerClinicalPay = plus(daily.ownerClinicalPay!, pay);
      if (person.id === settings.familyW2ClinicianId && mode === "salary" && !inactive) daily.coOwnerSalaryPretax = plus(daily.coOwnerSalaryPretax!, pay === null ? null : salary);
    }
    if (!selected) continue;
    for (const member of staff) {
      const cost = staffCompensationKnown(staffMemberAt(workspace, member, date)) ? staffCostForRange(workspace, member, date, date) : null;
      if (cost === null) reasons.add(`${member.label ?? "Support staff"}: dated compensation or employer burden is unknown.`);
      daily.staffCost = plus(daily.staffCost!, cost);
    }
    let detailed: number | null = 0;
    let explicitTax: number | null = 0, explicitReserve: number | null = 0;
    const events = workspace.events.filter(event => event.enabled && event.date <= date && (!event.end || event.end >= date));
    for (const budget of workspace.budgets) {
      if (!active(budget, date)) continue;
      if (budget.planningOnly) {
        if (events.some(event => event.field === "budget.amount" && event.targetId === budget.id)) {
          detailed = null;
          reasons.add(`${budget.name}: launched planning-only budgets require explicit dated expense assumptions.`);
        }
        continue;
      }
      const category = workspace.categories.find(row => row.id === budget.categoryId && !row.archived);
      const changes = events.filter(event => event.field === "budget.amount" && event.targetId === budget.id).sort((a, b) => a.date.localeCompare(b.date));
      const amount = changes.at(-1)?.value ?? budget.amount;
      const ambiguous = changes.length > 1 && changes.at(-1)?.date === changes.at(-2)?.date;
      const unknownUnits = budget.cadence === "per_session" && daily.sessions === null || budget.cadence === "percent_revenue" && daily.revenue === null;
      const overlap = category?.kind === "payroll" || /processing|credit.?card|merchant|payroll/i.test(category?.name ?? "") || /processing|credit.?card|merchant|payroll/i.test(budget.name);
      const cost = !category || ambiguous || unknownUnits || overlap || !nonnegative(amount) ? null : budgetAmount({ ...budget, amount }, date, date, daily.sessions ?? 0, daily.revenue ?? 0);
      if (cost === null) reasons.add(`${budget.name}: unknown units/category, ambiguous dated amount, or overlapping payroll/processing expense needs an explicit assumption.`);
      if (category?.kind === "income") daily.otherIncome = plus(daily.otherIncome!, cost);
      else if (category?.kind === "tax") explicitTax = plus(explicitTax, cost);
      else if (category?.kind === "reserve") explicitReserve = plus(explicitReserve, cost);
      else if (category?.kind === "owner") {
        daily.ownerPayroll = null;
        reasons.add(`${budget.name}: owner budget may overlap owner compensation; separate payroll attribution is required.`);
      } else if (category?.kind === "marketing") daily.marketing = plus(daily.marketing!, cost);
      else detailed = plus(detailed, cost);
    }
    // Daily overhead contains only additional event costs. Budget detail and the
    // allowance are compared after summing the selected calendar-month slice.
    for (const event of events) {
      if (event.field === "budget.amount" && !workspace.budgets.some(budget => budget.id === event.targetId)) {
        daily.overhead = null;
        reasons.add(`${event.name}: budget event target is missing.`);
      }
      if (event.field !== "custom" && event.field !== "budget.amount") {
        daily.overhead = null;
        reasons.add(`${event.name}: event ${event.field} is unsupported by this bounded historical estimate; use dated model terms.`);
      }
      if (event.dependsOn.length || event.delayMonths || event.rampMonths !== 1 || !nonnegative(event.monthlyCost) || !nonnegative(event.oneTimeCost)) {
        daily.overhead = null;
        reasons.add(`${event.name}: dependent, delayed, ramped or invalid event costs require explicit dated assumptions.`);
      } else daily.overhead = plus(daily.overhead!, event.monthlyCost / calendarDays + (event.date === date ? event.oneTimeCost : 0));
    }
    if (workspace.campaigns.some(row => !row.archived && (!row.start || active(row, date))) || workspace.hiring.some(row => !row.archived && row.start <= date)) {
      daily.marketing = null;
      reasons.add("Campaign/hiring financial effects require explicit dated budgets in this bounded historical estimate.");
    }
    daily.ownerPayroll = daily.ownerPayroll === null || !nonnegative(settings.ownerPayrollMonthly) ? null : settings.ownerPayrollMonthly / calendarDays;
    daily.ownerPayrollBurden = daily.ownerPayroll !== null && percent(settings.ownerPayrollBurdenPct) ? daily.ownerPayroll * settings.ownerPayrollBurdenPct / 100 : null;
    if (daily.ownerPayroll === null || daily.ownerPayrollBurden === null) reasons.add("Separate owner payroll or its employer burden is unknown.");
    const percentageFee = settings.processingPct === 0 ? 0 : percent(settings.processingPct) && percent(settings.collectionPct) && daily.revenue !== null ? daily.revenue * settings.collectionPct / 100 * settings.processingPct / 100 : null;
    const fixedFee = settings.processingFixedPerTransaction === 0 ? 0 : nonnegative(settings.processingFixedPerTransaction) && nonnegative(settings.processingTransactionsPerSession) && percent(settings.collectionPct) && daily.sessions !== null ? daily.sessions * settings.collectionPct / 100 * settings.processingTransactionsPerSession * settings.processingFixedPerTransaction : null;
    daily.fees = plus(percentageFee, fixedFee);
    if (daily.fees === null) reasons.add("Processing assumptions or exact attended visits needed for estimated transaction counts are unknown.");
    daily.taxReserve = explicitTax;
    daily.reserves = explicitReserve;
    const month = date.slice(0, 7);
    monthDetailedOverhead.set(month, plus(monthDetailedOverhead.has(month) ? monthDetailedOverhead.get(month)! : 0, detailed));
    const bucket = monthValues.get(month) ?? Object.fromEntries(keys.map(key => [key, 0]));
    keys.forEach(key => bucket[key] = plus(bucket[key]!, daily[key]!));
    monthValues.set(month, bucket);
  }
  for (const [month, row] of monthValues) {
    const start = range.start > month + "-01" ? range.start : month + "-01";
    const end = range.end < monthEnd(start) ? range.end : monthEnd(start);
    const fraction = days(start, end) / Number(monthEnd(start).slice(8));
    const allowance = settings.overheadGoalBasis === "fixed_percent" && (row.revenue === null || !percent(settings.overheadGoalPercent)) ? null
      : overheadGoalAllowance(settings, row.revenue ?? 0, fraction)
        ?? (settings.overheadGoalBasis ? null : nonnegative(settings.overheadFloorMonthly) ? settings.overheadFloorMonthly * fraction : null);
    const detailed = monthDetailedOverhead.get(month)!;
    row.overhead = allowance === null || detailed === null ? null : plus(row.overhead!, Math.max(allowance, detailed));
    if (row.overhead === null) reasons.add("Operating overhead assumptions, detailed expenses or revenue-based allowance are unknown.");
    const costs = total([row.clinicianPay!, row.employerBurden!, row.staffCost!, row.overhead!, row.marketing!, row.fees!, row.ownerPayroll!, row.ownerPayrollBurden!]);
    row.profit = costs === null || row.revenue === null || row.otherIncome === null ? null : row.revenue - costs + row.otherIncome;
    const allocation = cashAllocationsForRange(workspace.allocations, Math.max(0, row.profit ?? 0), start, end);
    const known = row.profit !== null && allocation.maxDailyPercent <= 100;
    if (allocation.maxDailyPercent > 100) reasons.add("Active allocation percentages exceed 100%; estimated distributions are unknown.");
    const fallbackKnown = [settings.taxPct, settings.reservePct, settings.distributionPct].every(percent) && settings.taxPct + settings.reservePct + settings.distributionPct <= 100;
    if (!allocation.configured && !fallbackKnown) reasons.add("Fallback surplus allocation percentages are unknown or exceed 100%.");
    const usable = known && (allocation.configured || fallbackKnown);
    const amount = (kind: string, fallback: number) => !usable ? null : allocation.configured ? allocation.buckets.filter(bucket => bucket.kind === kind).reduce((sum, bucket) => sum + bucket.amount, 0) : Math.max(0, row.profit!) * fallback / 100;
    row.taxReserve = plus(row.taxReserve!, amount("tax", settings.taxPct));
    row.reserves = plus(row.reserves!, amount("reserve", settings.reservePct));
    row.distributions = amount("distribution", settings.distributionPct);
    row.ownerDistributionsPretax = !usable ? null : allocation.configured ? allocation.buckets.filter(bucket => bucket.kind === "distribution" && bucket.household).reduce((sum, bucket) => sum + bucket.amount, 0) : row.distributions === 0 ? 0 : null;
    if (row.ownerDistributionsPretax === null && usable) reasons.add("Fallback distributions lack explicit household attribution.");
    const allocated = total([row.taxReserve!, row.reserves!, row.distributions!]);
    row.retainedSurplus = allocated !== null && row.profit !== null ? row.profit - allocated : null;
    keys.forEach(key => values[key] = plus(values[key]!, row[key]!));
  }
  return finish(range, billingCoverageComplete);
}
