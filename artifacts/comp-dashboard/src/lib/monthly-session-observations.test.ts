import test from "node:test";
import assert from "node:assert/strict";
import { monthlySessionObservations } from "./monthly-session-observations.ts";

const record = (id: number, start: string, end: string, completed: number, clinicianId = 1) => ({ id, clinicianId, start, end, completed, desired: completed, cancelled: 0, noShow: 0, scheduled: completed, inPerson: null, telehealth: null, sourceAttachmentId: null, revision: 1 });

test("one Jan15 visit in a verified January report is one monthly fact, not 31 extrapolated points", () => {
  const rows = monthlySessionObservations([record(-1, "2026-01-15", "2026-01-15", 1)], [1], [{ clinicianId: 1, start: "2026-01-01", end: "2026-01-31" }], "2026-01-31");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 1);
  assert.equal(rows[0].weekly, 7 / 31);
  assert.equal(rows[0].averageMonthEquivalent, 30.4375 / 31);
});
test("unverified imported visits remain observed without a false monthly total", () => {
  const [row] = monthlySessionObservations([record(-1, "2026-01-15", "2026-01-15", 1)], [1], [], "2026-01-31");
  assert.equal(row.value, null);
  assert.equal(row.observedTotal, 1);
  assert.equal(row.weekly, null);
});
test("manual adjacent whole periods sum exactly, cross-month totals are not prorated", () => {
  const [complete] = monthlySessionObservations([record(1, "2026-01-01", "2026-01-14", 40), record(2, "2026-01-15", "2026-01-31", 20)], [1], [], "2026-01-31");
  assert.equal(complete.value, 60);
  const rows = monthlySessionObservations([record(1, "2026-01-20", "2026-02-02", 40)], [1], [], "2026-02-28");
  assert.ok(rows.every((row) => row.value === null));
});
test("a future report endpoint or missing clinician cannot certify a monthly actual", () => {
  const coverage = [{ clinicianId: 1, start: "2026-01-01", end: "2026-01-31" }];
  const records = [record(-1, "2026-01-15", "2026-01-15", 1)];
  assert.equal(monthlySessionObservations(records, [1], coverage, "2026-01-20")[0].value, null);
  assert.equal(monthlySessionObservations(records, [1, 2], coverage, "2026-01-31")[0].value, null);
});
