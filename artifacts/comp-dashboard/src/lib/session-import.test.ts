import { test } from "node:test";
import assert from "node:assert/strict";
import type { Clinician } from "@workspace/practice/hub";
import type { SessionRecord } from "@workspace/practice";
import { inspectSessionSheet, planSessionImport } from "./session-import.ts";

const clinician = (id: number, label: string, sessionsPerWeek: number) => ({
  id, label, goalId: null, sessionsPerWeek,
}) as Clinician;
const clinicians = [
  clinician(1, "Erin Smith", 16),
  clinician(2, "Michele Teague", 23),
];
const rows = [
  ["", "Erin", "Michele", "Sara"],
  ["4/9/26 - 4/22/26", "21", "28", "-"],
  ["4/23/26 - 5/6/26", "0", "40", "3"],
  ["2/26/25 - 3/11/26", "20", "35", "-"],
  ["9/24/26 - 10/7/26", "", "", ""],
  ["Average", "20.6", "31.8", ""],
  ["Goal Average", "30", "44", ""],
  ["Current %", "68.7%", "72.3%", ""],
];

test("reads clinician columns, 2026 biweekly rows, goals, and recorded zeroes", () => {
  const sheet = inspectSessionSheet(rows, clinicians);
  assert.equal(sheet.headerRow, 1);
  assert.equal(sheet.periods.length, 3);
  assert.deepEqual(sheet.years, [2026]);
  assert.equal(sheet.columns[0].suggestedId, 1);
  assert.equal(sheet.columns[1].suggestedId, 2);
  assert.equal(sheet.columns[2].suggestedId, null);
  assert.equal(sheet.columns[0].sheetGoal, 30);
  assert.equal(sheet.periods[1].counts[1], 0);
  assert.equal(sheet.periods[0].counts[3], null);
  assert.match(sheet.periods[2].errors.join(" "), /14 days/);
});

test("requires explicit handling of unmatched names and suspicious dates", () => {
  const sheet = inspectSessionSheet(rows, clinicians);
  const plan = planSessionImport(sheet, 2026, { 1: 1, 2: 2 }, {}, "sheet", clinicians, []);
  assert.ok(plan.errors.some((item) => item.includes("Sara")));
  assert.ok(plan.errors.some((item) => item.includes("Row 4")));
});

test("imports only approved values, skips existing identical entries, and never overwrites", () => {
  const sheet = inspectSessionSheet(rows, clinicians);
  const mapping = { 1: 1, 2: 2, 3: "skip" as const };
  const corrections = { 4: { start: "2026-02-26", end: "2026-03-11" } };
  const clean = planSessionImport(sheet, 2026, mapping, corrections, "sheet", clinicians, []);
  assert.deepEqual(clean.errors, []);
  assert.equal(clean.entries.length, 6);
  assert.equal(clean.entries.find((entry) => entry.completed === 0)?.desired, 30);
  assert.equal(clean.skippedCount, 1);

  const first = clean.entries[0];
  const existing = [{ ...first, id: 9, revision: 1, updatedAt: "2026-09-25T00:00:00Z" }] as SessionRecord[];
  const repeat = planSessionImport(sheet, 2026, mapping, corrections, "sheet", clinicians, existing);
  assert.equal(repeat.duplicateCount, 1);
  assert.equal(repeat.entries.length, 5);
  const changed = planSessionImport(sheet, 2026, mapping, corrections, "sheet", clinicians, [
    { ...existing[0], completed: 99 },
  ]);
  assert.deepEqual(changed.errors, []);
  assert.equal(changed.conflictCount, 1);
  assert.equal(changed.entries.length, 5);
});

test("can use current clinician goals instead of spreadsheet goals", () => {
  const sheet = inspectSessionSheet(rows, clinicians);
  const plan = planSessionImport(
    sheet, 2026, { 1: 1, 2: 2, 3: "skip" },
    { 4: { start: "2026-02-26", end: "2026-03-11" } },
    "practice", clinicians, [],
  );
  assert.equal(plan.entries.find((entry) => entry.clinicianId === 1)?.desired, 32);
  assert.equal(plan.entries.find((entry) => entry.clinicianId === 2)?.desired, 46);
});
