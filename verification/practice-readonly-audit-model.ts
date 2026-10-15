import { completeServicePeriodState, workspaceSchema, importDeclarationsSchema, resolveImportedProvider, type ImportDeclarations, type Context } from "../lib/practice/src/hub/index.ts";
import { completeReportCoverage } from "../artifacts/comp-dashboard/src/lib/complete-report-coverage.ts";
import { buildImportedSessionOverlay } from "../artifacts/comp-dashboard/src/lib/import-derived-sessions.ts";
import { completePeriodSessionSummary } from "../artifacts/comp-dashboard/src/lib/complete-session-summary.ts";
import { practiceFinancialRange } from "../artifacts/comp-dashboard/src/lib/practice-financial-range.ts";
import { buildPracticeProjection } from "../artifacts/comp-dashboard/src/lib/practice-projection.ts";
import { currentPracticeClinicians, snapshotsForClinicians } from "../artifacts/comp-dashboard/src/lib/practice-scope.ts";
import { resolveWorkspaceDefaults, type CompensationGoal } from "../artifacts/comp-dashboard/src/lib/workspace-defaults.ts";
import { summarizeReportedBilling } from "../artifacts/comp-dashboard/src/lib/reported-billing.ts";
import { buildLocalRetentionMetrics, summarizeConsultConversions, type LocalSnapshot, type SameDayVisitOverrides } from "../artifacts/comp-dashboard/src/lib/retention-local.ts";

const normalize = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
const sum = (values: (number | null)[]) => values.every((value) => value !== null) ? values.reduce<number>((total, value) => total + value!, 0) : null;
const charges = (report: ReturnType<typeof summarizeReportedBilling>, knownEmpty = false) => report.evidence.invalidDateRowCount === 0 ? report.months.length ? sum(report.months.map((row) => row.charges)) : knownEmpty ? 0 : null : null;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
function consultNumbers(metric: ReturnType<typeof summarizeConsultConversions>["practice"] | undefined) {
  if (!metric) return null;
  return Object.fromEntries(["consultations", "converted", "candidateConversions", "missed", "pending", "needsAttribution", "internalReferralsProtected", "evaluated", "conversionRate"].map((key) => [key, count(metric[key as keyof typeof metric])]));
}
function retentionNumbers(metric: ReturnType<typeof buildLocalRetentionMetrics>["clientActivityByClinician"][number] | undefined) {
  if (!metric) return null;
  return { coverageVerified: metric.coverageVerified, retained: metric.retainedClients, evaluated: metric.initialRetentionDenominator,
    matureNonRetained: metric.matureNonRetainedClients, pending: metric.pendingInitialClients, percent: metric.initialRetentionPct,
    endingEventsInFullMonths: metric.endingFullMonthClientEnds, matureMonths: metric.endingFullMonthDenominator,
    endingsPerMatureMonth: metric.averageClientEndingsPerFullMonth };
}

/** Only this explicit numeric/date projection may leave the process. No source strings, keys or rows. */
export function aggregateAudit(input: { workspace: unknown; context: Context; goals: CompensationGoal[]; snapshots: LocalSnapshot[]; overrides: SameDayVisitOverrides; declarations?: ImportDeclarations | null }, options: { asOf: string; start: string; end: string; targetLabel: string }) {
  const { context, snapshots, overrides } = input;
  if (snapshots.some((snapshot) => snapshot.kind !== "attendance" && snapshot.kind !== "billing")) throw new Error("unsupported_snapshot_kind");
  const resolved = resolveWorkspaceDefaults(workspaceSchema.parse(input.workspace), context, input.goals);
  const workspace = resolved.workspace;
  const declarations = input.declarations ? importDeclarationsSchema.parse(input.declarations) : null;
  const admission = { declarations, teamId: workspace.settings.teamId };
  const ids = context.clinicians.filter((person) => (person.goalId ?? null) === workspace.settings.teamId).map((person) => person.id);
  const selected = context.clinicians.filter((person) => ids.includes(person.id));
  const current = currentPracticeClinicians(workspace, context, options.asOf);
  const allProof = completeReportCoverage(snapshots, selected, options.asOf, context.clinicians, admission);
  const currentProof = completeReportCoverage(snapshots, current, options.asOf, context.clinicians, admission);
  const proof = allProof;
  const rawOverlay = buildImportedSessionOverlay(context, snapshots, workspace.settings.teamId, overrides, { declarations });
  const admittedOverlay = buildImportedSessionOverlay(context, allProof.eligibleSnapshots, workspace.settings.teamId, overrides, { declarations });
  const state = completeServicePeriodState(admittedOverlay.context.sessions, ids, options.asOf, proof.completeAttendanceCoverage);
  const modelContext = { ...admittedOverlay.context, sessions: state.eligibleRecords };
  const range = { start: options.start, end: options.end };
  const sessionSummary = completePeriodSessionSummary(modelContext.sessions, ids, range, state.eligibleCoverage, options.asOf);
  const financial = practiceFinancialRange(resolved.forecastWorkspace, modelContext, snapshots, options.asOf, range, state.eligibleCoverage, declarations);
  const projection = buildPracticeProjection(resolved.forecastWorkspace, modelContext, "actual", options.asOf, state.eligibleCoverage, currentProof.billingThrough);
  const rawCharges = summarizeReportedBilling(snapshots, options.asOf, { ...range, clinicianLabels: selected.map((person) => person.label) });
  const admittedCharges = summarizeReportedBilling(snapshots, options.asOf, { ...range, clinicianLabels: selected.map((person) => person.label), eligibleRows: new Set(proof.eligibleBillingRows) });
  const billingWindowProved = selected.length > 0 && selected.every((person) => {
    for (let stamp = Date.parse(range.start + "T12:00:00Z"); stamp <= Date.parse(range.end + "T12:00:00Z"); stamp += 86400000) {
      const date = new Date(stamp).toISOString().slice(0, 10);
      if (!proof.completeBillingCoverage.some((row) => row.clinicianId === person.id && row.start <= date && row.end >= date)) return false;
    }
    return true;
  });
  const excludedFollowUpEvidence = snapshots.flatMap((snapshot) => snapshot.kind !== "attendance" ? [] : snapshot.rows.filter((row) => {
    if (row.status !== "show" || allProof.eligibleAttendanceRows.includes(row)) return false;
    const matchingIds = context.clinicians.filter((person) => normalize(person.label) === normalize(row.clinician)).map((person) => person.id);
    return !allProof.completeAttendanceCoverage.some((entry) => matchingIds.includes(entry.clinicianId) && entry.start <= row.serviceDate && entry.end >= row.serviceDate);
  }).map((row) => ({ clientId: row.clientId, serviceDate: row.serviceDate })));
  const historical = snapshotsForClinicians(allProof.eligibleSnapshots, selected);
  const rawHistorical = snapshotsForClinicians(snapshots, selected);
  const clinicalOptions = { cohortClinicianNames: current.map((person) => person.label), excludedFollowUpEvidence };
  const consultation = summarizeConsultConversions(allProof.eligibleSnapshots, overrides, options.start, options.end, options.asOf, workspace.consultAttributionOverrides, clinicalOptions);
  const rawConsultation = summarizeConsultConversions(snapshots, overrides, options.start, options.end, options.asOf, workspace.consultAttributionOverrides, { cohortClinicianNames: clinicalOptions.cohortClinicianNames });
  const retention = buildLocalRetentionMetrics(historical, {}, overrides, 28, options.asOf, 90, options.start, options.end, { excludedFollowUpEvidence });
  const rawRetention = buildLocalRetentionMetrics(rawHistorical, {}, overrides, 28, options.asOf, 90, options.start, options.end);
  const targets = context.clinicians.filter((person) => normalize(person.label) === normalize(options.targetLabel));
  const targetId = resolveImportedProvider(options.targetLabel, context.clinicians, workspace.settings.teamId, declarations);
  const target = context.clinicians.find((person) => person.id === targetId) ?? null;
  const targetMetric = (metrics: typeof retention) => target ? metrics.clientActivityByClinician.find((row) => normalize(row.clinician) === normalize(target.label)) : undefined;
  const targetConsult = (summary: typeof consultation) => target ? summary.byClinician.find((row) => normalize(row.clinician ?? "") === normalize(target.label)) : undefined;
  const periodEnds = [...new Set([...proof.completeAttendanceCoverage, ...proof.completeBillingCoverage, ...state.eligibleCoverage].map((row) => `${row.start}/${row.end}`))].sort();
  const numberValues = (values: typeof financial.values) => Object.fromEntries(["sessions", "revenue", "clinicianPay", "profit", "collections"].map((key) => [key, count(values[key])]));
  const gapGroups = new Map<string, { kind: string; start: string | null; end: string | null; occurrences: number }>();
  for (const gap of proof.incompletePeriods) {
    const key = JSON.stringify([gap.kind, gap.start, gap.end]);
    const value = gapGroups.get(key) ?? { kind: gap.kind, start: gap.start, end: gap.end, occurrences: 0 };
    value.occurrences++;
    gapGroups.set(key, value);
  }
  return {
    window: range, asOf: options.asOf, units: { currency: "USD", conversionAndRetention: "percent_0_to_100", weekly: "sessions_per_7_included_calendar_days" },
    scope: { selectedClinicians: ids.length, currentClinicians: current.length, globalClinicians: context.clinicians.length,
      ambiguousNormalizedNames: new Set(context.clinicians.filter((person) => context.clinicians.some((other) => other.id !== person.id && normalize(other.label) === normalize(person.label))).map((person) => normalize(person.label))).size },
    sources: { snapshots: snapshots.length, attendanceRows: snapshots.filter((row) => row.kind === "attendance").reduce((total, row) => total + row.rows.length, 0),
      billingRows: snapshots.filter((row) => row.kind === "billing").reduce((total, row) => total + row.rows.length, 0),
      explicitCompleteDeclarations: snapshots.filter((row) => row.reportCoverage?.complete === true).length,
      missingExplicitCoverageSnapshots: snapshots.filter((row) => row.reportCoverage == null).length,
      rawAttendanceStatusConflicts: rawOverlay.diagnostic.attendanceStatusConflictCount,
      admittedAttendanceStatusConflicts: proof.attendanceStatusConflictCount,
      admittedAttendanceRows: proof.eligibleAttendanceRows.length, admittedBillingRows: proof.eligibleBillingRows.length, excludedRows: proof.excludedRowsCount,
      incompleteOrMissingProviderPeriods: proof.incompletePeriods.length, retainedManualRecords: context.sessions.filter((row) => ids.includes(row.clinicianId)).length,
      excludedManualRecords: context.sessions.filter((row) => ids.includes(row.clinicianId) && !state.eligibleRecords.includes(row)).length },
    coverageBlocker: !declarations?.sourceSets.length && snapshots.length > 0 && snapshots.every((row) => row.reportCoverage == null)
      ? "all_active_imports_lack_explicit_coverage_confirm_source_report_dates_or_owner_confirmed_scope_no_minmax_inference"
      : proof.eligibleAttendanceRows.length === 0 && proof.eligibleBillingRows.length === 0 ? "no_import_rows_pass_complete_period_and_global_identity_gates" : null,
    through: { attendance: proof.attendanceThrough, billing: proof.billingThrough, joint: proof.dataThrough,
      currentAttendance: currentProof.attendanceThrough, currentBilling: currentProof.billingThrough, forecastStarts: financial.forecastStart },
    incompleteOrUnverifiedRanges: [...gapGroups.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    workingBaseline: { weekly: projection.projectedWeekly, activityThrough: projection.latestCompleteThrough,
      forecastStarts: projection.forecastStart, anonymousClinicianWindows: projection.clinicianPace.map((person) => ({
        start: person.windowStart, end: person.windowEnd, includedDays: person.recordedDays, completePeriods: person.includedPeriodCount,
        weekly: person.usedWeekly, excludedRecords: person.excludedRecordCount,
      })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) },
    periods: periodEnds.map((key) => { const [start, end] = key.split("/"); return { start, end,
      attendanceProviders: proof.completeAttendanceCoverage.filter((row) => row.start === start && row.end === end).length,
      billingProviders: proof.completeBillingCoverage.filter((row) => row.start === start && row.end === end).length,
      supportedSessionProviders: state.completePeriods.filter((row) => row.start === start && row.end === end).length,
      admittedSessions: state.completePeriods.filter((row) => row.start === start && row.end === end).reduce((total, row) => total + row.completed, 0) }; }),
    comparison: { basis: "raw_retained_evidence_vs_candidate_complete_period_admission_not_old_deployed_UI",
      rawImportedVisitsInWindow: rawOverlay.derivedSessions.filter((row) => row.start >= range.start && row.end <= range.end).reduce((total, row) => total + row.completed, 0),
      rawReconciledChargedFees: charges(rawCharges), admittedReconciledChargedFees: charges(admittedCharges, billingWindowProved),
      candidateSessions: sessionSummary.observedCompleted, candidateIncludedDays: sessionSummary.observedCoverageDays, candidateWeekly: sessionSummary.completedWeekly },
    financial: { actualCoverageComplete: financial.actual.complete, billingCoverageComplete: financial.actual.billingComplete,
      actual: numberValues(financial.actual.values), forecast: numberValues(financial.forward.values), combined: numberValues(financial.values) },
    evidenceIssues: { admittedBillingConflicts: admittedCharges.evidence.conflictingHashCount, admittedBillingAmbiguities: admittedCharges.evidence.ambiguousEncounterCount,
      rawBillingConflicts: rawCharges.evidence.conflictingHashCount, rawBillingAmbiguities: rawCharges.evidence.ambiguousEncounterCount,
      rawInvalidFeeRows: rawCharges.evidence.invalidFeeRowCount, rawInvalidDateRows: rawCharges.evidence.invalidDateRowCount,
      admittedNonzeroPhoneChargeRows: proof.eligibleBillingRows.filter((row) => row.serviceDate >= range.start && row.serviceDate <= range.end && row.totalFeeCharged !== 0 && (row.billingCode?.trim().toUpperCase() === "PHONE" || row.visitKind === "consultation")).length,
      unresolvedPartialFollowUpRows: excludedFollowUpEvidence.length },
    requestedClinician: { identity: target ? declarations?.mappings.some((row) => row.clinicianId === target.id) ? "explicit_confirmed_selected_identity" : "unique_selected_identity" : targets.length > 1 ? "ambiguous_global_identity" : "not_found_or_not_selected",
      beforeAdmission: { confirmedCloser: consultNumbers(targetConsult(rawConsultation)), retention: retentionNumbers(targetMetric(rawRetention)) },
      candidate: { confirmedCloser: consultNumbers(targetConsult(consultation)), retention: retentionNumbers(targetMetric(retention)) } },
    practiceConsultation: { beforeAdmission: consultNumbers(rawConsultation.practice), candidate: consultNumbers(consultation.practice) },
    definitions: { practiceClose: "one_client_journey_converted_to_treatment_within_one_calendar_month_divided_by_evaluated_journeys_pending_excluded",
      clinicianClose: "manual_confirmed_closer_credit_divided_by_evaluated_credited_journeys_unconfirmed_candidates_pending_internal_referrers_protected",
      initialRetention: "three_treatment_sessions_initial_gaps_at_most_28_days_PHONE_excluded_pending_excluded",
      endings: "three_treatment_sessions_then_90_days_mature_covered_followup_later_returns_and_unresolved_partial_evidence_block_absence" },
    limitations: ["raw_evidence_is_not_certified_actual_coverage", "no_old_deployed_UI_reconstruction", "billed_fees_are_not_cash", "missing_actual_costs_remain_unknown", "no_coverage_inferred_or_written", "percentage_pay_uses_accepted_discounted_charges_PHONE_must_be_zero", "aggregate_single_person_groups_may_still_be_sensitive_keep_report_private"],
  };
}
