import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, clinicianSettingSchema } from "@workspace/practice/hub";
import { currentPracticeClinicians, snapshotsForClinicians } from "./practice-scope.ts";
test("current consultation scope excludes former staff without deleting historical facts", () => {
  const workspace = emptyWorkspace("2026-10-01");
  const context = { clinicians: [{ id: 1, label: "Current", goalId: null }, { id: 2, label: "Former", goalId: null }], staff: [], sessions: [] } as any;
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 2, start: "2026-01-01", desiredWeeklySessions: 10, onTeam: false }));
  const snapshots = [{ kind: "attendance", id: "synthetic", importedAt: "2026-10-14T12:00:00Z", sourceHash: "synthetic", coverageStart: "2026-01-01", coverageEnd: "2026-10-14", rows: [{ clinician: "Current", serviceDate: "2026-01-01", clientId: "a", status: "show", location: null, sourceRowHash: "a" }, { clinician: "Former", serviceDate: "2026-01-01", clientId: "b", status: "show", location: null, sourceRowHash: "b" }] }] as any;
  const before = structuredClone({ workspace, context, snapshots });
  assert.equal(snapshotsForClinicians(snapshots, currentPracticeClinicians(workspace, context))[0].rows.length, 1);
  assert.equal(snapshotsForClinicians(snapshots, context.clinicians)[0].rows.length, 2);
  assert.deepEqual({ workspace, context, snapshots }, before);
});
