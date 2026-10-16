import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, clinicianSettingSchema, roomSchema } from "@workspace/practice/hub";
import { currentPracticeClinicians, configuredRoomsAtDate, snapshotsForClinicians } from "./practice-scope.ts";
test("current consultation scope excludes former staff without deleting historical facts", () => {
  const workspace = emptyWorkspace("2026-10-01");
  const context = { clinicians: [{ id: 1, label: "Current", goalId: null }, { id: 2, label: "Former", goalId: null }], staff: [], sessions: [] } as any;
  workspace.clinicians.push(clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 2, start: "2026-01-01", desiredWeeklySessions: 10, onTeam: false }));
  const snapshots = [{ kind: "attendance", id: "synthetic", importedAt: "2026-10-14T12:00:00Z", sourceHash: "synthetic", coverageStart: "2026-01-01", coverageEnd: "2026-10-14", rows: [{ clinician: "Current", serviceDate: "2026-01-01", clientId: "a", status: "show", location: null, sourceRowHash: "a" }, { clinician: "Former", serviceDate: "2026-01-01", clientId: "b", status: "show", location: null, sourceRowHash: "b" }] }] as any;
  const before = structuredClone({ workspace, context, snapshots });
  assert.equal(snapshotsForClinicians(snapshots, currentPracticeClinicians(workspace, context, "2026-10-14"))[0].rows.length, 1);
  assert.equal(snapshotsForClinicians(snapshots, context.clinicians)[0].rows.length, 2);
  assert.deepEqual({ workspace, context, snapshots }, before);
});

test("current roster honors team, status, onTeam and inclusive start/end dates without rewriting history", () => {
  const workspace = emptyWorkspace("2026-10-01");
  workspace.settings.teamId = 7;
  const context = { clinicians: Array.from({ length: 10 }, (_, index) => ({
    id: index + 1, label: `Synthetic ${index + 1}`, goalId: index === 9 ? 8 : 7,
  })), staff: [], sessions: [{ clinicianId: 2, start: "2026-09-01", end: "2026-09-14", completed: 14 }] } as any;
  const profiles = [
    { clinicianId: 2, end: "2026-09-30" },
    { clinicianId: 3, start: "2026-11-01" },
    { clinicianId: 4, status: "planned" },
    { clinicianId: 5, status: "archived" },
    { clinicianId: 6, onTeam: false },
    { clinicianId: 7, start: "2026-10-14" },
    { clinicianId: 8, end: "2026-10-14" },
    { clinicianId: 9, onTeam: true },
  ];
  workspace.clinicians = profiles.map((profile) => clinicianSettingSchema.parse({
    id: crypto.randomUUID(), start: "2026-01-01", desiredWeeklySessions: 10, ...profile,
  }));
  const before = structuredClone({ workspace, context });
  const ids = (date: string) => currentPracticeClinicians(workspace, context, date).map((person) => person.id);
  assert.deepEqual(ids("2026-10-14"), [1, 7, 8, 9]);
  assert.deepEqual(ids("2026-10-13"), [1, 8, 9], "Future starts are not current before their start date");
  assert.deepEqual(ids("2026-10-15"), [1, 7, 9], "End date is inclusive but the following date is excluded");
  assert.deepEqual(ids("2026-11-01"), [1, 3, 7, 9]);
  assert.deepEqual(ids("2026-09-30"), [1, 2, 8, 9], "onTeam true cannot override dated membership");
  assert.deepEqual({ workspace, context }, before);
});

test("room headline sources share inclusive dated eligibility, excluding future, expired and review-only records", () => {
  const room = (name: string, patch = {}) => roomSchema.parse({ id: crypto.randomUUID(), name, start: "2026-01-01", weeklyHours: 10, ...patch });
  const rooms = [room("Current"), room("Future", { start: "2026-11-01" }), room("Expired", { end: "2026-09-30" }),
    room("Review only", { planningOnly: true }), room("Archived", { archived: true })];
  const before = structuredClone(rooms);
  const names = (date: string) => configuredRoomsAtDate(rooms, date).map((row) => row.name);
  assert.deepEqual(names("2026-10-14"), ["Current"]);
  assert.deepEqual(names("2026-09-30"), ["Current", "Expired"]);
  assert.deepEqual(names("2026-10-01"), ["Current"]);
  assert.deepEqual(names("2026-11-01"), ["Current", "Future"]);
  assert.deepEqual(names("2026-01-01"), ["Current", "Expired"]);
  assert.deepEqual(names("2025-12-31"), []);
  assert.deepEqual(rooms, before);
  assert.strictEqual(configuredRoomsAtDate(rooms, "2026-10-14")[0], rooms[0]);
});

test("configured room scope never invents a usable room or changes source records", () => {
  const review = roomSchema.parse({ id: crypto.randomUUID(), name: "Imported location", start: "2026-01-01", weeklyHours: 0, planningOnly: true });
  assert.deepEqual(configuredRoomsAtDate([], "2026-10-14"), []);
  assert.deepEqual(configuredRoomsAtDate([review], "2026-10-14"), []);
  assert.equal(review.planningOnly, true);
  assert.equal(review.weeklyHours, 0);
});
