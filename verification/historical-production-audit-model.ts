import { workspaceSchema, importDeclarationsSchema, restoreHistoricalBillingProviders, billingChargeResolutionSchema,
  bindBillingResolutions, resolveHistoricalBillingProvider, validateHistoricalBillingProviders, normalizeProviderLabel } from "../lib/practice/src/hub/index.ts";
import { historicalBillingLedger } from "../artifacts/comp-dashboard/src/lib/historical-billing-ledger.ts";
import { summarizeReportedBilling } from "../artifacts/comp-dashboard/src/lib/reported-billing.ts";
import { completeReportCoverage } from "../artifacts/comp-dashboard/src/lib/complete-report-coverage.ts";
import { attendanceStatusConflicts } from "../artifacts/comp-dashboard/src/lib/retention-local.ts";
import type { aggregateAudit } from "./practice-readonly-audit-model.ts";

type Input = Parameters<typeof aggregateAudit>[0];
type Window = { start: string; end: string; asOf: string };
const sum = (values: (number | null)[]) => values.every(value => value !== null) ? values.reduce<number>((a, b) => a + b!, 0) : null;
const safeDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value ? value : null;

/** Explicit aggregate projection only: never return source/client/provider keys or notes. */
export function historicalProductionAudit(input: Input, options: Window) {
  if (input.snapshots.some(source => source.kind !== "attendance" && source.kind !== "billing")) throw new Error("Unsupported source kind.");
  const workspace = workspaceSchema.parse(input.workspace), roster = input.context.clinicians;
  const history = input.historicalBillingJournal?.length
    ? restoreHistoricalBillingProviders(input.historicalBillingJournal, input.declarationRevision ?? 0) : undefined;
  const declared = importDeclarationsSchema.parse({ ...(input.declarations ?? { version: 1, mappings: [], sourceSets: [] }),
    ...(history ? { historicalBillingProviders: history } : {}) });
  const approvals = bindBillingResolutions((input.billingResolutions ?? []).map(row => billingChargeResolutionSchema.parse(row)), roster, declared);
  const declarations = { ...declared, billingResolutions: approvals };
  const selected = roster.filter(person => (person.goalId ?? null) === workspace.settings.teamId);
  const proof = completeReportCoverage(input.snapshots, selected, options.asOf, roster, { declarations, teamId: workspace.settings.teamId });
  const attendanceAdmitted = new Set(proof.eligibleAttendanceRows), billingAdmitted = new Set(proof.eligibleBillingRows);
  const ledger = (start: string, end: string) => historicalBillingLedger(input.snapshots, roster, workspace.settings.teamId, declarations, options.asOf, { start, end });
  const total = ledger(options.start, options.end);
  const months = [];
  for (let month = options.start.slice(0, 7); month <= options.end.slice(0, 7);) {
    const first = month + "-01", last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const start = first < options.start ? options.start : first, end = last > options.end ? options.end : last;
    const report = ledger(start, end), known = report.reportedCharges !== null;
    months.push({ month, start, end, fullCalendarMonthSelected: start === first && end === last,
      reportedCharges: report.reportedCharges, reportDateCoverageComplete: report.coverageComplete,
      acceptedChargeRows: known ? report.months.reduce((n, row) => n + row.rowCount, 0) : null,
      collapsedDuplicateRows: known ? report.months.reduce((n, row) => n + row.duplicateRowCount, 0) : null,
      unresolvedConflictGroups: report.evidence.conflictingHashCount, staleApprovals: report.evidence.staleResolutionCount });
    month = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
  }
  const contributions = [...(declarations.historicalBillingProviders ?? [])].sort((a, b) => normalizeProviderLabel(a.sourceLabel).localeCompare(normalizeProviderLabel(b.sourceLabel))).map((provider, index) => {
    const identityValid = resolveHistoricalBillingProvider(provider.sourceLabel, roster, declarations) === provider.id;
    const sourceBindingsValid = validateHistoricalBillingProviders({ ...declared, historicalBillingProviders: [provider] }, roster, input.snapshots).length === 0;
    const report = summarizeReportedBilling(input.snapshots, options.asOf, { start: options.start, end: options.end, clinicianLabel: provider.sourceLabel, billingResolutions: approvals });
    const verified = identityValid && sourceBindingsValid;
    return { providerSlot: index + 1, identityValid, sourceBindingsValid, reportDateCoverageComplete: verified && total.coverageComplete, basis: "reported-service-date-charges-not-cash",
      reportedCharges: verified && !report.evidence.invalidDateRowCount ? report.months.length ? sum(report.months.map(row => row.charges)) : total.coverageComplete ? 0 : null : null,
      months: report.months.map(row => ({ month: row.month, charges: verified ? row.charges : null,
        acceptedChargeRows: verified && row.charges !== null ? row.rowCount : null, collapsedDuplicateRows: verified && row.charges !== null ? row.duplicateRowCount : null })) };
  });
  const windows = [{ label: "October_10", start: "2026-10-10", end: "2026-10-10" },
    { label: "October_11", start: "2026-10-11", end: "2026-10-11" }, { label: "October_12", start: "2026-10-12", end: "2026-10-12" },
    { label: "partial_October_08_12", start: "2026-10-08", end: "2026-10-12" }].map(window => {
      const report = ledger(window.start, window.end);
      const attendanceSources = input.snapshots.filter(source => source.kind === "attendance").map(source => ({ ...source,
        rows: source.rows.filter(row => row.serviceDate >= window.start && row.serviceDate <= window.end) }));
      const attendance = attendanceSources.flatMap(source => source.rows);
      return { ...window, reportedCharges: report.reportedCharges, reportDateCoverageComplete: report.coverageComplete,
        billingRawRows: report.evidence.rawRowCount, billingAcceptedChargeRows: report.reportedCharges !== null ? report.months.reduce((n, row) => n + row.rowCount, 0) : null,
        billingCollapsedDuplicateRows: report.reportedCharges !== null ? report.evidence.duplicateRowCount : null,
        billingUnresolvedConflicts: report.evidence.conflictingHashCount, billingStaleApprovals: report.evidence.staleResolutionCount,
        attendanceRawRows: attendance.length,
        attendanceEncounterCandidates: new Set(attendance.map(row => JSON.stringify([row.clientId, normalizeProviderLabel(row.clinician), row.serviceDate]))).size,
        attendanceStatusConflicts: attendanceStatusConflicts(attendanceSources as Input["snapshots"]).length,
        currentTeamAdmittedAttendanceRows: attendance.filter(row => attendanceAdmitted.has(row as never)).length,
        completeOperatingPeriod: false };
    });
  return { range: { start: options.start, end: options.end, asOf: options.asOf }, basis: "reported-billed-charges-not-cash-payroll-costs-or-profit",
    declarationRevision: input.declarationRevision ?? 0,
    sourceInventory: input.snapshots.map((source, index) => ({ sourceSlot: index + 1, kind: source.kind,
      importedAt: new Date(source.importedAt).toISOString(), storedRows: source.rows.length,
      observedStart: safeDate(source.coverageStart), observedEnd: safeDate(source.coverageEnd),
      individualReportProof: source.reportCoverage ? { start: safeDate(source.reportCoverage.start), end: safeDate(source.reportCoverage.end), complete: source.reportCoverage.complete === true } : null,
      declarationReferenceCount: declarations.sourceSets.filter(set => set.snapshotIds.includes(source.id)).length,
      historicalRegistryReferenceCount: (declarations.historicalBillingProviders ?? []).filter(provider => provider.sourceSets.some(set => set.snapshotIds.includes(source.id))).length,
      currentTeamAdmittedRows: source.rows.filter(row => source.kind === "attendance" ? attendanceAdmitted.has(row as never) : billingAdmitted.has(row as never)).length,
      lateCancellationRows: source.rows.filter(row => "cancellationSubtype" in row && row.cancellationSubtype === "late_cancelled").length })),
    approvals: { storedCount: approvals.length, validIdentityBindings: approvals.filter(row => !row.mappingInvalid).length,
      historicalBindings: approvals.filter(row => row.historicalProviderId !== undefined).length,
      appliedCasesInSelectedRange: total.evidence.resolvedCaseCount, staleCasesInSelectedRange: total.evidence.staleResolutionCount },
    scope: { currentTeamClinicians: selected.length, historicalProviders: contributions.length,
      unknownProviderRows: total.unknownProviderRows, unconfirmedSourceRows: total.unconfirmedSourceRows },
    through: { currentTeamAttendance: proof.attendanceThrough, currentTeamBilling: proof.billingThrough, joint: proof.dataThrough },
    wholePractice: { reportedCharges: total.reportedCharges, reportDateCoverageComplete: total.coverageComplete,
      unresolvedConflicts: total.evidence.conflictingHashCount, invalidDates: total.evidence.invalidDateRowCount },
    months, historicalContributions: contributions, octoberWindows: windows,
    limits: ["same-reader-replay-not-independent-financial-source-verification", "provider-slots-sort-by-exact-normalized-registry-label-no-provider-names-output", "attendance-encounter-candidates-are-not-certified-treatment-sessions", "report-date-coverage-is-not-complete-operating-period-coverage", "no-extrapolation-no-missing-cost-certification"] };
}
