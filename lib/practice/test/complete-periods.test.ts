import test from "node:test";
import assert from "node:assert/strict";
import { canonicalServicePeriod, completeServicePeriodState } from "../src/hub/complete-periods.ts";
const visit = (date: string, completed = 1, clinicianId = 1) => ({ id: -1, clinicianId, start: date, end: date, completed });
const manual = (start = "2026-09-24", end = "2026-10-07", completed = 14, clinicianId = 1) => ({ id: 1, clinicianId, start, end, completed });
test("canonical service periods retain January 1 anchor across years, DST and leap dates", () => {
  assert.deepEqual(canonicalServicePeriod("2026-10-14"), { start: "2026-10-08", end: "2026-10-21" });
  assert.deepEqual(canonicalServicePeriod("2026-10-07"), { start: "2026-09-24", end: "2026-10-07" });
  for (const date of ["2025-12-31", "2026-03-08", "2028-02-29"]) {
    const period = canonicalServicePeriod(date);
    assert.ok(period.start <= date && date <= period.end);
    assert.equal((Date.parse(period.end) - Date.parse(period.start)) / 86400000, 13);
  }
  assert.throws(() => canonicalServicePeriod("2026-02-30"));
});
test("partial high counts and occupied negative visit bounds cannot establish complete report proof", () => {
  const rows = [manual(), visit("2026-10-08", 1000), visit("2026-10-14", 1000)];
  const before = structuredClone(rows);
  const state = completeServicePeriodState(rows, [1], "2026-10-14", [{ clinicianId: 1, start: "2026-10-08", end: "2026-10-14" }]);
  assert.equal(state.latestCompleteThrough, "2026-10-07");
  assert.deepEqual(state.eligibleRecords, [rows[0]]);
  assert.deepEqual(state.excludedRecords, rows.slice(1));
  assert.equal(state.byClinician[0].completed, 14);
  const sparse = completeServicePeriodState([visit("2026-09-24"), visit("2026-10-07")], [1], "2026-10-14");
  assert.equal(sparse.latestCompleteThrough, null);
  assert.deepEqual(sparse.completePeriods, []);
  assert.deepEqual(rows, before);
});
test("one complete report proves quiet periods without extending to a partial period", () => {
  const coverage = [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-14" }];
  const quiet = completeServicePeriodState([], [1], "2026-10-14", coverage);
  assert.deepEqual(quiet.completePeriods, [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-07", completed: 0 }]);
  assert.equal(quiet.latestCompleteThrough, "2026-10-07");
  assert.deepEqual(quiet.eligibleCoverage, [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-07" }]);
  assert.equal(completeServicePeriodState([], [1], "2026-10-14", [{ clinicianId: 1, start: "2026-10-01", end: "2026-10-14" }]).latestCompleteThrough, null);
});
test("two partial report halves do not certify a full zero period or admit visit counts until a whole report replaces them", () => {
  const coverage = [{ clinicianId: 1, start: "2026-09-24", end: "2026-09-30" }, { clinicianId: 1, start: "2026-10-01", end: "2026-10-07" }];
  const rows = [visit("2026-09-24", 4), visit("2026-10-07", 8)];
  const before = structuredClone({ rows, coverage });
  for (const records of [[], rows]) {
    const partial = completeServicePeriodState(records, [1], "2026-10-14", coverage);
    assert.equal(partial.latestCompleteThrough, null);
    assert.deepEqual(partial.completePeriods, []);
    assert.deepEqual(partial.eligibleCoverage, []);
    assert.deepEqual(partial.eligibleRecords, []);
  }
  const replaced = completeServicePeriodState(rows, [1], "2026-10-14", [...coverage, { clinicianId: 1, start: "2026-09-24", end: "2026-10-07" }]);
  assert.equal(replaced.latestCompleteThrough, "2026-10-07");
  assert.equal(replaced.byClinician[0].completed, 12);
  assert.deepEqual({ rows, coverage }, before);
});
test("a completed replacement report extends the cutoff, not its upload or assessment date", () => {
  const coverage = [{ clinicianId: 1, start: "2026-09-24", end: "2026-10-21" }];
  const rows = [visit("2026-09-24", 14), visit("2026-10-08", 28)];
  assert.equal(completeServicePeriodState(rows, [1], "2026-10-14", coverage).latestCompleteThrough, "2026-10-07");
  const complete = completeServicePeriodState(rows, [1], "2026-10-22", coverage);
  assert.equal(complete.latestCompleteThrough, "2026-10-21");
  assert.equal(complete.byClinician[0].completed, 42);
});
test("conflicts and invalid counts within admitted complete evidence withhold only affected periods", () => {
  const good = manual("2026-09-10", "2026-09-23");
  const coverage = [{ clinicianId: 1, start: "2026-09-10", end: "2026-10-21" }];
  for (const bad of [[manual(), visit("2026-10-01")], [manual(), { ...manual(), id: 2 }], [manual("2026-09-24", "2026-10-07", Number.NaN)]]) {
    const state = completeServicePeriodState([good, ...bad], [1], "2026-10-14", coverage);
    assert.equal(state.latestCompleteThrough, "2026-09-23");
    assert.deepEqual(state.eligibleRecords, [good]);
    assert.ok(state.excludedPeriods.some((period) => /overlap|boundary|invalid/.test(period.reason)));
  }
});
test("retained partial manual and unverified imported rows cannot poison or double-count a later complete manual report", () => {
  const full = manual("2026-01-01", "2026-01-14", 40);
  const partial = { ...manual("2026-01-01", "2026-01-07", 20), id: 2 };
  const crossing = { ...manual("2025-12-31", "2026-01-07", 1000), id: 3 };
  const imported = visit("2026-01-07", 1);
  const rows = [partial, crossing, imported, full];
  const before = structuredClone(rows);
  assert.equal(completeServicePeriodState(rows.slice(0, 3), [1], "2026-01-15").latestCompleteThrough, null);
  for (const records of [rows, [...rows].reverse()]) {
    const state = completeServicePeriodState(records, [1], "2026-01-15");
    assert.equal(state.latestCompleteThrough, "2026-01-14");
    assert.deepEqual(state.eligibleRecords, [full]);
    assert.equal(state.completePeriods[0].completed, 40);
    assert.equal(state.excludedRecords.length, 3);
  }
  assert.deepEqual(rows, before);
});
test("the latest shared complete period, not equality of individual latest cutoffs, certifies the practice boundary", () => {
  assert.equal(completeServicePeriodState([manual()], [1, 2], "2026-10-14").latestCompleteThrough, null);
  const state = completeServicePeriodState([manual(), manual("2026-09-10", "2026-09-23", 7, 2)], [1, 2], "2026-10-14");
  assert.equal(state.latestCompleteThrough, null);
  assert.deepEqual(state.byClinician.map((row) => row.through), ["2026-10-07", "2026-09-23"]);
  const common = completeServicePeriodState([manual(), manual("2026-09-10", "2026-09-23"), manual("2026-09-10", "2026-09-23", 7, 2)], [1, 2], "2026-10-14");
  assert.equal(common.latestCompleteThrough, "2026-09-23");
  assert.deepEqual(common.byClinician.map((row) => row.through), ["2026-10-07", "2026-09-23"]);
  assert.equal(completeServicePeriodState([manual(), { ...manual(), clinicianId: 2 }], [1, 2], "2026-10-14").latestCompleteThrough, "2026-10-07");
});
