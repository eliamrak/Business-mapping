import { test } from "node:test";
import assert from "node:assert/strict";
import { activityPeriodCaption, practicePeriodRange } from "./practice-period.ts";

test("activity captions hide the Overall sentinel without changing date filters", () => {
  const overall = practicePeriodRange("overall", "2026-10-20", { start: "", end: "" });
  assert.equal(overall.start, "0000-01-01");
  assert.equal(activityPeriodCaption("overall", overall), "Overall recorded activity through 2026-10-20");
  const custom = { start: "2026-09-02", end: "2026-09-21" };
  assert.equal(activityPeriodCaption("custom", custom), "Selected activity dates: 2026-09-02 to 2026-09-21");
});
test("four completed periods end at the last payroll service end, not today", () => {
  assert.deepEqual(practicePeriodRange("4pay", "2026-10-14", { start: "", end: "" }), { start: "2026-08-13", end: "2026-10-07" });
});
test("four completed weeks use Monday-Sunday boundaries", () => {
  assert.deepEqual(practicePeriodRange("4weeks", "2026-10-14", { start: "", end: "" }), { start: "2026-09-14", end: "2026-10-11" });
});
test("activity caption follows the selected relative period without redundant dates", () => {
  const range = { start: "2026-09-22", end: "2026-10-21" };
  assert.equal(activityPeriodCaption("30d", range), "Last 30 days");
  assert.equal(activityPeriodCaption("60d", range), "Last 60 days");
  assert.equal(activityPeriodCaption("year", range), "Year to date");
});
