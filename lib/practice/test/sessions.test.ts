import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateSchema,
  dateRangeSchema,
  daysInclusive,
  sessionInputSchema,
  sessionWriteSchema,
  rangesOverlap,
  summarizeSessions,
  type SessionRecord,
} from "../src/index.ts";

const record: SessionRecord = {
  id: 1,
  clinicianId: 1,
  start: "2026-09-07",
  end: "2026-09-20",
  completed: 40,
  desired: 50,
  cancelled: null,
  noShow: 0,
  revision: 1,
  updatedAt: "2026-09-20T12:00:00Z",
};
const { id: _id, revision: _revision, updatedAt: _updated, ...input } = record;

test("session detail counts reconcile and unknown attendance remains unknown", () => {
  assert.equal(
    sessionInputSchema.safeParse({ ...input, scheduled: 39 }).success,
    false,
  );
  assert.equal(
    sessionInputSchema.safeParse({ ...input, inPerson: 25, telehealth: 20 })
      .success,
    false,
  );
  assert.equal(
    sessionInputSchema.safeParse({
      ...input,
      inPerson: 25,
      telehealth: 15,
      scheduled: 50,
    }).success,
    true,
  );
  assert.equal(
    summarizeSessions([record], { start: record.start, end: record.end })
      .attendance,
    null,
  );
  assert.equal(
    summarizeSessions([{ ...record, scheduled: 50 }], {
      start: record.start,
      end: record.end,
    }).attendance,
    80,
  );
});

test("dates are calendar-valid, inclusive, and independent of DST", () => {
  assert.equal(dateSchema.safeParse("2026-02-30").success, false);
  assert.equal(dateSchema.safeParse("0000-01-01").success, false);
  assert.equal(dateSchema.safeParse("2028-02-29").success, true);
  assert.equal(daysInclusive("2026-03-07", "2026-03-09"), 3);
  assert.equal(daysInclusive(record.start, record.end), 14);
  assert.equal(
    dateRangeSchema.safeParse({ start: record.end, end: record.start }).success,
    false,
  );
});
test("counts reject blanks, negative, fractional, non-finite and excessive values", () => {
  for (const value of ["", "12", -1, 1.5, Infinity, NaN, 10001])
    assert.equal(
      sessionInputSchema.safeParse({ ...input, completed: value }).success,
      false,
    );
  assert.equal(
    sessionInputSchema.safeParse({ ...input, completed: 0 }).success,
    true,
  );
  assert.equal(
    sessionInputSchema.safeParse({ ...input, noShow: null }).success,
    true,
  );
  assert.equal(
    sessionInputSchema.safeParse({ ...input, unexpected: 1 }).success,
    false,
  );
});
test("entry length and write preconditions are validated", () => {
  assert.equal(
    sessionInputSchema.safeParse({ ...input, end: "2027-09-20" }).success,
    false,
  );
  assert.equal(sessionWriteSchema.safeParse({ entry: input }).success, false);
  assert.equal(
    sessionWriteSchema.safeParse({
      entry: input,
      requestId: "x",
      expectedRevision: null,
    }).success,
    false,
  );
});
test("whole-period totals preserve unknown values and distinguish a recorded zero", () => {
  const summary = summarizeSessions([record], {
    start: record.start,
    end: record.end,
  });
  assert.equal(summary.completed, 40);
  assert.equal(summary.desired, 50);
  assert.equal(summary.utilization, 80);
  assert.equal(summary.averagePerRecordedWeek, 20);
  assert.equal(summary.cancelled, null);
  assert.equal(summary.noShow, 0);
  assert.equal(summary.coveredDays, 14);
  assert.equal(summary.dataThrough, record.end);
  assert.equal(summarizeSessions([], record).completed, null);
  assert.equal(
    summarizeSessions([{ ...record, completed: 0 }], record).completed,
    0,
  );
  assert.equal(
    summarizeSessions([{ ...record, desired: 0 }], record).utilization,
    null,
  );
});
test("partial periods are flagged and never silently prorated", () => {
  const summary = summarizeSessions([record], {
    start: "2026-09-10",
    end: "2026-09-20",
  });
  assert.equal(summary.partial.length, 1);
  assert.equal(summary.included.length, 0);
  assert.equal(summary.completed, null);
});
test("adjacent periods are allowed, shared dates overlap", () => {
  assert.equal(
    rangesOverlap(record, { start: "2026-09-21", end: "2026-10-04" }),
    false,
  );
  assert.equal(
    rangesOverlap(record, { start: "2026-09-20", end: "2026-10-03" }),
    true,
  );
  const summary = summarizeSessions(
    [record, { ...record, id: 2, start: "2026-09-21", end: "2026-10-04" }],
    { start: "2026-09-01", end: "2026-10-10" },
  );
  assert.equal(summary.completed, 80);
  assert.equal(summary.coveredDays, 28);
  assert.equal(summary.averagePerRecordedWeek, 20);
});
