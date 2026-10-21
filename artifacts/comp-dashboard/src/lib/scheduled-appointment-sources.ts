import { normalizeProviderLabel, resolveImportedProvider, type ImportEvidenceDeclarations } from "@workspace/practice/hub";
import type { AttendanceStatus, LocalSnapshot } from "./retention-local.ts";

type Clinician = { id: number; label: string; goalId?: number | null };

/** In-memory positive observations for appointmentSnapshots, never completed actuals or absence proof. */
export function scheduledAppointmentSources(
  snapshots: readonly LocalSnapshot[],
  fullRoster: readonly Clinician[],
  declarations?: ImportEvidenceDeclarations | null,
  asOfDate = "9999-12-31",
): {
  snapshots: LocalSnapshot[];
  classificationSnapshots: LocalSnapshot[];
  excludedFollowUpEvidence: { clientId: string; serviceDate: string; observedAt: string; status: AttendanceStatus }[];
} {
  const teams = new Set([
    ...fullRoster.map(person => person.goalId ?? null),
    ...(declarations?.mappings.map(mapping => mapping.teamId) ?? []),
  ]);
  const labels = new Map<string, Clinician | null>();
  const resolve = (label: string) => {
    if (!labels.has(label)) {
      const ids = new Set([...teams].flatMap(teamId => {
        const id = resolveImportedProvider(label, fullRoster, teamId, declarations);
        return id === null ? [] : [id];
      }));
      labels.set(label, ids.size === 1 ? fullRoster.find(person => person.id === [...ids][0])! : null);
    }
    return labels.get(label)!;
  };
  const available = (row: { serviceDate: string; status?: AttendanceStatus }, importedAt: string) => {
    const imported = Date.parse(importedAt);
    return (Number.isFinite(imported) && new Date(imported).toISOString().slice(0, 10) <= asOfDate)
      || (row.status === "show" && /^\d{4}-\d{2}-\d{2}$/.test(row.serviceDate)
        && Number.isFinite(Date.parse(row.serviceDate))
        && new Date(row.serviceDate).toISOString().slice(0, 10) === row.serviceDate && row.serviceDate <= asOfDate);
  };
  // Only IDs observable as of the requested day collide; unused roster copies remain allowed.
  const observed = new Map<string, Set<number>>();
  for (const snapshot of snapshots) for (const row of snapshot.rows) {
    if (!available(row, snapshot.importedAt)) continue;
    const person = resolve(row.clinician);
    if (!person) continue;
    const key = normalizeProviderLabel(person.label);
    const ids = observed.get(key) ?? new Set<number>();
    ids.add(person.id);
    observed.set(key, ids);
  }
  const excludedFollowUpEvidence: { clientId: string; serviceDate: string; observedAt: string; status: AttendanceStatus }[] = [];
  const classificationSnapshots: LocalSnapshot[] = [];
  for (const snapshot of snapshots) {
    const { reportCoverage, coverageClinicians, ...source } = snapshot;
    const mapRows = <T extends { clinician: string; clientId: string; serviceDate: string; status?: AttendanceStatus }>(rows: T[]): T[] => rows.flatMap(row => {
      const person = resolve(row.clinician);
      if (!available(row, snapshot.importedAt) || !person || observed.get(normalizeProviderLabel(person.label))!.size > 1) {
        if (row.status !== undefined) excludedFollowUpEvidence.push({ clientId: row.clientId, serviceDate: row.serviceDate, observedAt: snapshot.importedAt, status: row.status });
        return [];
      }
      return [{ ...row, clinician: person.label }];
    });
    classificationSnapshots.push(snapshot.kind === "attendance"
      ? { ...source, kind: "attendance", rows: mapRows(snapshot.rows) }
      : { ...source, kind: "billing", rows: mapRows(snapshot.rows) });
  }
  return { snapshots: classificationSnapshots.filter(snapshot => snapshot.kind === "attendance"), classificationSnapshots, excludedFollowUpEvidence };
}
