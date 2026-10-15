import { test } from "node:test";
import assert from "node:assert/strict";
import { practicePeriodRange } from "./practice-period.ts";
test("four completed periods end at the last payroll service end, not today", () => {
  assert.deepEqual(practicePeriodRange("4pay", "2026-10-14", { start: "", end: "" }), { start: "2026-08-13", end: "2026-10-07" });
});
test("four completed weeks use Monday-Sunday boundaries", () => {
  assert.deepEqual(practicePeriodRange("4weeks", "2026-10-14", { start: "", end: "" }), { start: "2026-09-14", end: "2026-10-11" });
});
