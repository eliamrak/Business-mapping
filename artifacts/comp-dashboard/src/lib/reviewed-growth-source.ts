import {
  resolveImportedProvider,
  completeServicePeriodState,
  type Context,
  type Workspace,
  type ImportEvidenceDeclarations,
} from "@workspace/practice/hub";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { currentPracticeClinicians } from "./practice-scope.ts";
import {
  derivedShowVisits,
  consultAttendanceClassifier,
  attendanceStatusConflicts,
  type LocalSnapshot,
  type SameDayVisitOverrides,
} from "./retention-local.ts";
import {
  reviewedGrowth,
  type GrowthSettings,
  type GrowthVisit,
  type GrowthObservationInput,
} from "./reviewed-growth-observations.ts";
import { providerGrowth, staffingPlanCandidates } from "./provider-growth.ts";
/** One synchronous capture → result. Scenario settings cannot replace actual
 * attendance, leads, current roster or source identity. No cache survives inputs. */
export function reviewedGrowthFromSources(input: {
  workspace: Workspace;
  context: Context;
  snapshots: LocalSnapshot[];
  overrides: SameDayVisitOverrides;
  declarations?: ImportEvidenceDeclarations;
  today: string;
  settings: GrowthSettings;
  scenario: boolean;
  planningWorkspace?: Workspace;
  planningContext?: Context;
}) {
  const { workspace, context, today } = input,
    teamId = workspace.settings.teamId;
  const team = context.clinicians.filter((p) => (p.goalId ?? null) === teamId);
  const roster = currentPracticeClinicians(workspace, context, today);
  const report = completeReportCoverage(
    input.snapshots,
    team,
    today,
    context.clinicians,
    { declarations: input.declarations, teamId },
  );
  const accepted = buildImportedSessionOverlay(
    context,
    report.eligibleSnapshots,
    teamId,
    input.overrides,
    {
      declarations: input.declarations,
      classificationSnapshots: input.snapshots,
      billingEvidenceSnapshots: input.snapshots,
    },
  );
  const state = completeServicePeriodState(
    accepted.context.sessions,
    team.map((p) => p.id),
    today,
    report.completeAttendanceCoverage,
  );
  const resolve = (row: {
    clientId: string;
    clinician: string;
    serviceDate: string;
  }): GrowthVisit[] => {
    const clinicianId = resolveImportedProvider(
      row.clinician,
      context.clinicians,
      teamId,
      input.declarations,
    );
    if (
      clinicianId === null ||
      !state.eligibleCoverage.some(
        (c) =>
          c.clinicianId === clinicianId &&
          c.start <= row.serviceDate &&
          c.end >= row.serviceDate,
      )
    )
      return [];
    return [{ clientId: row.clientId, clinicianId, date: row.serviceDate }];
  };
  const visits = derivedShowVisits(
    report.eligibleSnapshots,
    input.overrides,
    input.snapshots,
  ).flatMap(resolve);
  const isConsult = consultAttendanceClassifier(input.snapshots);
  const admittedKeys = new Set(
    visits.map((v) => `${v.clientId}|${v.clinicianId}|${v.date}`),
  );
  const excludedTreatmentEvidence = [
    ...derivedShowVisits(input.snapshots, input.overrides, input.snapshots),
    ...attendanceStatusConflicts(input.snapshots, input.snapshots)
      .filter((g) => g.kind === "treatment")
      .flatMap((g) => g.rows),
  ].flatMap((row) => {
    if (row.status !== "show" || isConsult(row)) return [];
    const clinicianId = resolveImportedProvider(
      row.clinician,
      context.clinicians,
      teamId,
      input.declarations,
    );
    if (
      clinicianId === null ||
      !team.some((p) => p.id === clinicianId) ||
      admittedKeys.has(`${row.clientId}|${clinicianId}|${row.serviceDate}`)
    )
      return [];
    return [{ clientId: row.clientId, clinicianId, date: row.serviceDate }];
  });
  const consults = report.eligibleSnapshots.flatMap((s) =>
    s.kind === "attendance"
      ? s.rows
          .filter((r) => r.status === "show" && isConsult(r))
          .flatMap(resolve)
      : [],
  );
  const observationInput: GrowthObservationInput = {
    today,
    visits,
    consults,
    excludedTreatmentEvidence,
    coverage: state.eligibleCoverage,
    clinicianIds: roster.map((p) => p.id),
    workspace,
    weeklyCapacity: roster.length
      ? roster.reduce((s, p) => s + p.sessionsPerWeek, 0)
      : null,
    weeksPerYear: workspace.settings.weeksPerYear,
    settings: input.settings,
    scenario: input.scenario,
  };
  const result = reviewedGrowth(observationInput);
  const providers = providerGrowth(observationInput, result, roster);
  const staffingCandidates = input.scenario
    ? staffingPlanCandidates(
        input.planningWorkspace ?? workspace,
        input.planningContext ?? context,
        input.settings.staffing ?? [],
      )
    : { overlays: [], issues: [], templateCount: 0 };
  // Diagnostic revision only (not a security/content-authentication hash). Every
  // captured dependency participates; no client identifiers leave the adapter.
  const serialized = JSON.stringify({
    today,
    workspace,
    context,
    snapshots: input.snapshots,
    overrides: input.overrides,
    declarations: input.declarations,
    settings: input.settings,
    scenario: input.scenario,
    planningWorkspace: input.planningWorkspace,
    planningContext: input.planningContext,
  });
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return {
    ...result,
    providers,
    staffingCandidates,
    inputRevision: (hash >>> 0).toString(16),
  };
}
