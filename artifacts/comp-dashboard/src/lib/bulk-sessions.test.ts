import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import {
  buildBulkPeriods,
  bulkCellKey,
  parsePastedTotals,
  planBulkSessions,
  writeBulkSessions,
} from "./bulk-sessions.ts";

const clinicians = [
  { id: 1, label: "Erin", sessionsPerWeek: 15 },
  { id: 2, label: "Michele", sessionsPerWeek: 22 },
];
const record = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 7,
  revision: 2,
  updatedAt: "2026-09-25T12:00:00Z",
  clinicianId: 1,
  start: "2026-04-09",
  end: "2026-04-22",
  completed: 21,
  desired: 30,
  cancelled: null,
  noShow: null,
  scheduled: null,
  inPerson: null,
  telehealth: null,
  sourceAttachmentId: null,
  ...overrides,
});

test("one 14-day range establishes dates for every following period", () => {
  assert.deepEqual(buildBulkPeriods("2026-12-18", "2026-12-31", 3), [
    { start: "2026-12-18", end: "2026-12-31" },
    { start: "2027-01-01", end: "2027-01-14" },
    { start: "2027-01-15", end: "2027-01-28" },
  ]);
  assert.deepEqual(buildBulkPeriods("2028-02-16", "2028-02-29", 2)[1],
    { start: "2028-03-01", end: "2028-03-14" });
  assert.throws(() => buildBulkPeriods("2026-04-09", "2026-04-21", 3), /14 days/);
  assert.throws(() => buildBulkPeriods("2026-02-30", "2026-03-14", 3), /valid dates/);
});

test("spreadsheet paste keeps row and column positions, treating dashes as missing", () => {
  assert.deepEqual(parsePastedTotals("21\t28\r\n0\t-\r\n\t35\r\n"), [
    ["21", "28"],
    ["0", ""],
    ["", "35"],
  ]);
  assert.deepEqual(parsePastedTotals("20.00\n9\n"), [["20"], ["9"]]);
});

test("bulk plan creates new totals, edits only changed existing totals, and keeps zero", () => {
  const periods = buildBulkPeriods("2026-04-09", "2026-04-22", 2);
  const overrides = {
    [bulkCellKey(periods[0].start, 1)]: "22",
    [bulkCellKey(periods[0].start, 2)]: "0",
    [bulkCellKey(periods[1].start, 1)]: "20",
  };
  const plan = planBulkSessions(periods, clinicians, overrides, [record()]);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.entries.length, 3);
  assert.equal(plan.entries[0].expectedRevision, 2);
  assert.equal(plan.entries[0].entry.desired, 30);
  assert.equal(plan.entries[1].entry.completed, 0);
  assert.equal(plan.entries[1].entry.desired, 44);
  assert.equal(plan.entries[2].entry.start, "2026-04-23");
});

test("unchanged cells and blanks do not submit records", () => {
  const periods = buildBulkPeriods("2026-04-09", "2026-04-22", 1);
  const plan = planBulkSessions(periods, clinicians, {
    [bulkCellKey(periods[0].start, 1)]: "21",
    [bulkCellKey(periods[0].start, 2)]: "",
  }, [record()]);
  assert.equal(plan.entries.length, 0);
  assert.deepEqual(plan.issues, []);
});

test("invalid totals, overlapping periods, and inconsistent details block writes", () => {
  const periods = buildBulkPeriods("2026-04-09", "2026-04-22", 1);
  const key = bulkCellKey(periods[0].start, 1);
  assert.match(planBulkSessions(periods, clinicians, { [key]: "21.5" }, []).issues[0].message, /whole number/);
  assert.match(planBulkSessions(periods, clinicians, { [key]: "21" }, [
    record({ start: "2026-04-01", end: "2026-04-14" }),
  ]).issues[0].message, /overlaps/);
  assert.match(planBulkSessions(periods, clinicians, { [key]: "24" }, [
    record({ scheduled: 21 }),
  ]).issues[0].message, /Scheduled sessions/);
});

test("bulk writes finish the current batch, stop on failure, and retry with the same request ID", async () => {
  const periods = buildBulkPeriods("2026-04-09", "2026-04-22", 3);
  const overrides = Object.fromEntries(periods.flatMap((period) =>
    clinicians.map((person) => [bulkCellKey(period.start, person.id), "10"]),
  ));
  const { entries } = planBulkSessions(periods, clinicians, overrides, []);
  const pending = new Map();
  const calls: Array<{ key: string; requestId: string }> = [];
  const progress: number[] = [];
  let fail = true;
  const saveRecord = async (command: { requestId: string; entry: { start: string; clinicianId: number } }) => {
    const key = bulkCellKey(command.entry.start, command.entry.clinicianId);
    calls.push({ key, requestId: command.requestId });
    if (key === entries[1].key && fail) throw new Error("temporary failure");
  };
  const first = await writeBulkSessions(entries, pending, saveRecord, (count) => progress.push(count));
  assert.equal(first.savedKeys.length, 3);
  assert.match(String(first.error), /temporary failure/);
  assert.equal(calls.length, 4);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(pending.size, 1);

  fail = false;
  const remaining = entries.filter((entry) => !first.savedKeys.includes(entry.key));
  const second = await writeBulkSessions(remaining, pending, saveRecord, () => {});
  assert.equal(second.error, null);
  assert.equal(second.savedKeys.length, 3);
  assert.equal(pending.size, 0);
  assert.equal(calls.find((call) => call.key === entries[1].key)?.requestId,
    calls.findLast((call) => call.key === entries[1].key)?.requestId);
});
