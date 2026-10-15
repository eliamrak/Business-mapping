import type { Context, Workspace } from "@workspace/practice/hub";
import type { LocalSnapshot } from "./retention-local.ts";
const normalize = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
export function currentPracticeClinicians(workspace: Workspace, context: Context) {
  return context.clinicians.filter((person) => {
    if ((person.goalId ?? null) !== workspace.settings.teamId) return false;
    const profile = workspace.clinicians.find((entry) => entry.clinicianId === person.id);
    return profile?.onTeam !== false && profile?.status !== "archived" && profile?.status !== "planned";
  });
}
export function snapshotsForClinicians(snapshots: LocalSnapshot[], clinicians: Context["clinicians"]) {
  const names = new Set(clinicians.map((person) => normalize(person.label)));
  return snapshots.map((snapshot) => ({ ...snapshot, rows: snapshot.rows.filter((row) => names.has(normalize(row.clinician))) })) as LocalSnapshot[];
}
