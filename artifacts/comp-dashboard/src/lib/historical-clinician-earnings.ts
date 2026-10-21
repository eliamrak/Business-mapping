import {
  bindBillingResolutions, clinicianModelAt, clinicianTermsAt, isConsultationService,
  isDocumentationService, isFreePhoneService, isRecognizedTreatmentCode,
  reconcileBillingEvidence, resolveHistoricalBillingProvider, resolveImportedProvider,
  type Context, type ImportEvidenceDeclarations, type Workspace,
} from "@workspace/practice/hub";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { practiceFinancialEstimateRange } from "./practice-financial-estimate.ts";
import { derivedShowVisits, type LocalSnapshot, type SameDayVisitOverrides } from "./retention-local.ts";

type Range = { start: string; end: string };
export type HistoricalClinicianEarningsInput = {
  workspace: Workspace;
  context: Context;
  snapshots: readonly LocalSnapshot[];
  declarations?: ImportEvidenceDeclarations | null;
  sameDayVisitOverrides?: SameDayVisitOverrides;
  asOf: string;
  range: Range;
  clinicianId: number;
};
export type HistoricalClinicianEarnings = {
  source: "historical-compensation-estimate";
  clinicianId: number;
  range: Range | null;
  status: "available" | "unavailable";
  averageCompensatedPerCompletedSession: number | null;
  compensatedAmount: number | null;
  completedTreatmentSessions: number | null;
  assumptions: string[];
  unavailableReasons: string[];
};
const nextDay = (date: string) => new Date(Date.parse(date + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);

/** Keep Team-only estimates lazy, with a cache scoped to these immutable report inputs. */
export function createHistoricalClinicianEarningsReader(input: Omit<HistoricalClinicianEarningsInput, "clinicianId">) {
  const selectedIds = new Set(input.context.clinicians.filter(person => (person.goalId ?? null) === input.workspace.settings.teamId).map(person => person.id));
  const cache = new Map<number, HistoricalClinicianEarnings>();
  return {
    get(clinicianId: number) {
      if (!selectedIds.has(clinicianId)) return undefined;
      if (!cache.has(clinicianId)) cache.set(clinicianId, historicalClinicianEarningsPerSession({ ...input, clinicianId }));
      return cache.get(clinicianId);
    },
  };
}

/** Read-only accrual estimate, never observed payroll or a planning-rate override. */
export function historicalClinicianEarningsPerSession(input: HistoricalClinicianEarningsInput): HistoricalClinicianEarnings {
  const { workspace, context, snapshots, declarations, asOf, range, clinicianId, sameDayVisitOverrides = {} } = input;
  const assumptions = [
    "Estimated accrued clinician compensation divided by completed treatment sessions in the same service-date window; not paid payroll, collected revenue or verified accounting earnings.",
    "Uses the historical compensation engine's accepted discounted treatment charges, dated pay terms and annual cap replay. Consultation and documentation revenue do not become percentage treatment pay.",
    "Salary and hourly pay accrue on calendar dates, including quiet dates; configured nonclinical pay is included under the existing engine rules. Employer burden, owner distributions and separate owner payroll are excluded.",
    "Dated terms are required; current card splits and future planning revenue overrides cannot establish historical pay. Cap configuration and any opening cap contribution remain model assumptions, not proof of historical contract terms.",
  ];
  const reasons = new Set<string>();
  const result: HistoricalClinicianEarnings = {
    source: "historical-compensation-estimate", clinicianId, range: null, status: "unavailable",
    averageCompensatedPerCompletedSession: null, compensatedAmount: null, completedTreatmentSessions: null,
    assumptions, unavailableReasons: [],
  };
  const finish = () => ({ ...result, unavailableReasons: [...reasons] });
  const matches = context.clinicians.filter(person => person.id === clinicianId);
  if (matches.length !== 1 || (matches[0].goalId ?? null) !== workspace.settings.teamId) {
    reasons.add("Choose one uniquely identified clinician in the selected team.");
    return finish();
  }
  // Scope reporting, never the identity context or original reconciliation evidence.
  const estimate = practiceFinancialEstimateRange(workspace, context, snapshots, asOf, range,
    declarations, sameDayVisitOverrides, { payBasis: "dated", clinicianId });
  result.range = estimate.range;
  if (!estimate.range) {
    estimate.unavailableReasons.forEach(reason => reasons.add(reason));
    return finish();
  }
  const selected = estimate.range;
  result.completedTreatmentSessions = estimate.values.sessions ?? null;
  if (!estimate.billingCoverageComplete || result.completedTreatmentSessions === null) {
    reasons.add("Complete, reconciled billing and attendance coverage with resolved provider identities is required throughout the selected dates.");
  }
  if (estimate.values.clinicianPay == null || !Number.isFinite(estimate.values.clinicianPay)) {
    reasons.add("Historical compensation inputs or prior annual cap progress are unknown or unsupported.");
  }
  const profiles = workspace.clinicians.filter(profile => profile.clinicianId === clinicianId);
  const terms = workspace.terms.filter(term => term.clinicianId === clinicianId);
  const compensationAmbiguousAt = (date: string) => {
    const effectiveProfiles = profiles.filter(profile => profile.status !== "archived"
      && profile.start <= date && (!profile.end || profile.end >= date));
    if (effectiveProfiles.length > 1) return true;
    // Terms are carry-forward patches. Different dates and disjoint fields are
    // valid; competing definitions of the latest same-day field are ambiguous.
    return (["payMode", "payAmount", "paidHoursPerWeek", "clinicianSplit"] as const).some(field => {
      const applicable = terms.filter(term => term.effectiveDate <= date && term[field] !== null);
      const latest = applicable.map(term => term.effectiveDate).sort().at(-1);
      return latest !== undefined && applicable.filter(term => term.effectiveDate === latest).length > 1;
    });
  };
  // Only an unambiguous dated opening can replace earlier annual cap replay.
  const opening = profiles.filter(profile => profile.start <= selected.start && profile.start.slice(0, 4) === selected.start.slice(0, 4)
    && typeof profile.openingCapContribution === "number" && Number.isFinite(profile.openingCapContribution)
    && profile.openingCapContribution >= 0 && !compensationAmbiguousAt(profile.start)
    && clinicianModelAt(workspace, clinicianId, profile.start)?.id === profile.id)
    .map(profile => profile.start).sort().at(-1);
  const capReplayStart = opening ?? selected.start.slice(0, 4) + "-01-01";
  const capped = matches[0].capEnabled && matches[0].capAmount > 0;
  for (let date = capped ? capReplayStart : selected.start; date <= selected.end; date = nextDay(date)) {
    if (compensationAmbiguousAt(date)) {
      reasons.add(date < selected.start
        ? "Overlapping compensation profiles or competing dated terms make prior annual cap replay ambiguous."
        : "Overlapping compensation profiles or competing dated terms make selected-window compensation ambiguous.");
      return finish();
    }
  }
  const datedPayKnown = (date: string) => {
    const model = clinicianModelAt(workspace, clinicianId, date);
    const term = clinicianTermsAt(workspace, clinicianId, date);
    const beforeConfiguration = profiles.every(profile => profile.start > date);
    const mode = model?.payMode ?? term.payMode;
    return (model?.status === "active" || beforeConfiguration && term.payMode !== null)
      && mode !== null && mode !== undefined && (mode !== "existing_split" || term.clinicianSplit !== null);
  };
  for (let date = selected.start; date <= selected.end; date = nextDay(date)) {
    if (!datedPayKnown(date)) {
      reasons.add("Dated active compensation terms do not establish pay for every selected date; current clinician-card splits are not historical proof.");
      break;
    }
  }
  const proof = completeReportCoverage(snapshots, matches, asOf, context.clinicians,
    { declarations, teamId: workspace.settings.teamId });
  const resolve = (label: string) => resolveImportedProvider(label, context.clinicians, workspace.settings.teamId, declarations);
  const inScope = (row: { clinician: string; serviceDate: string }) => resolve(row.clinician) === clinicianId
    && row.serviceDate >= selected.start && row.serviceDate <= selected.end;
  const encounterKey = (row: { clientId: string; serviceDate: string }) => JSON.stringify([row.clientId.trim(), row.serviceDate]);
  const visitKeys = new Set(derivedShowVisits(proof.eligibleSnapshots, sameDayVisitOverrides, snapshots).filter(inScope).map(encounterKey));
  const eligible = new Set(proof.eligibleBillingRows);
  const entries = snapshots.flatMap(snapshot => snapshot.kind === "billing"
    ? snapshot.rows.map(row => ({ row, snapshotId: snapshot.sourceSnapshotId ?? snapshot.id })) : []);
  if (capped) {
    const normalize = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
    for (const { row } of entries) {
      if (row.serviceDate < capReplayStart || row.serviceDate >= selected.start || resolve(row.clinician) !== null
        || resolveHistoricalBillingProvider(row.clinician, context.clinicians, declarations) !== null) continue;
      const known = context.clinicians.filter(person => normalize(person.label) === normalize(row.clinician));
      const knownOtherTeam = known.length === 1 && (known[0].goalId ?? null) !== workspace.settings.teamId
        && !declarations?.mappings.some(mapping => normalize(mapping.sourceLabel) === normalize(row.clinician));
      if (!knownOtherTeam) reasons.add("Unresolved billed provider identities in prior annual cap history prevent certification of cap progress.");
    }
  }
  const billedKeys = new Set<string>();
  for (const group of reconcileBillingEvidence(entries, bindBillingResolutions(declarations?.billingResolutions ?? [], context.clinicians, declarations))) {
    if (!group.known || group.acceptedRows?.some(row => !eligible.has(row))) continue;
    const admitted = group.rows.filter(row => eligible.has(row));
    if (!admitted.length) continue;
    for (const row of group.acceptedRows ?? [admitted[0]]) {
      const treatment = isRecognizedTreatmentCode(row.billingCode)
        && !isConsultationService(row) && !isDocumentationService(row) && !isFreePhoneService(row);
      if (inScope(row) && treatment) billedKeys.add(encounterKey(row));
      if (capped && treatment && row.totalFeeCharged !== 0
        && resolve(row.clinician) === clinicianId && row.serviceDate >= capReplayStart && row.serviceDate < selected.start
        && !datedPayKnown(row.serviceDate)) reasons.add("Prior annual cap contributions lack dated compensation terms; current card splits cannot establish historical cap progress.");
    }
  }
  if ([...visitKeys].some(key => !billedKeys.has(key)) || [...billedKeys].some(key => !visitKeys.has(key))) {
    reasons.add("Accepted treatment billing and completed attendance must match by clinician, client and service date; unmatched evidence cannot establish earnings per completed session.");
  }
  if (reasons.size) return finish();
  result.compensatedAmount = estimate.values.clinicianPay!;
  if (result.completedTreatmentSessions === null || result.completedTreatmentSessions <= 0) {
    reasons.add("No completed treatment sessions establish an average for the selected dates.");
    return finish();
  }
  const average = result.compensatedAmount / result.completedTreatmentSessions;
  if (!Number.isFinite(average)) {
    result.compensatedAmount = null;
    reasons.add("The compensation average is not finite.");
    return finish();
  }
  result.averageCompensatedPerCompletedSession = average;
  result.status = "available";
  return finish();
}
