import test from "node:test";
import assert from "node:assert/strict";
import { daysInclusive, sessionInputSchema, type SessionRecord } from "@workspace/practice";
import { clinicianSettingSchema, emptyWorkspace, eventSchema, roomSchema, termSchema, type Context } from "@workspace/practice/hub";
import { historicalPerformancePeriods } from "./historical-performance-periods.ts";
import { historicalPerformanceWindow } from "./historical-performance.ts";
import { overviewHistoricalAttrition, overviewHistoricalCapacity, type OverviewHistoricalCapacityInput } from "./overview-historical-capacity.ts";
import { periodClientAttrition } from "./period-client-attrition.ts";
import type { LocalSnapshot } from "./retention-local.ts";

const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const person = (id = 1, sessionsPerWeek = 23): Context["clinicians"][number] => ({
  id, label: `Clinician ${id}`, goalId: 7, sessionsPerWeek, roleType: "associate", classification: "1099",
  sessionRate: 100, weeksWorkedPerYear: 20, preCapClinicianSplit: 60, preCapPracticeSplit: 40,
  capEnabled: false, capAmount: 0, postCapClinicianSplit: 60, postCapPracticeSplit: 40,
  w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0,
  nonClinicalHoursPerWeek: 0, nonClinicalHourlyRate: 0,
});
const record = (start: string, end: string, weekly: number, clinicianId = 1, id = 1): SessionRecord => ({
  ...sessionInputSchema.parse({ clinicianId, start, end,
    completed: Math.round(weekly * daysInclusive(start, end) / 7), desired: 9999, cancelled: null,
    noShow: null, scheduled: null, inPerson: null, telehealth: null, sourceAttachmentId: null }),
  id, revision: 1, updatedAt: "2026-10-19T12:00:00Z",
});
const profile = (start = "2025-10-01", desiredWeeklySessions = 23, extra: Partial<ReturnType<typeof clinicianSettingSchema.parse>> = {}) =>
  clinicianSettingSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, start, desiredWeeklySessions, ...extra });
const fixture = (): OverviewHistoricalCapacityInput => {
  const workspace = emptyWorkspace("2026-10-19");
  workspace.settings.teamId = 7;
  return {
    workspace, context: { clinicians: [person()], staff: [], sessions: [
      record("2025-10-01", "2026-06-30", 10), record("2026-07-01", "2026-09-30", 21),
    ] },
    attendanceCoverage: [], selectedClinicianIds: [1], today: "2026-10-19",
    historicalReports: {
      "3mo": { window: historicalPerformanceWindow("2026-10-19", "3mo") },
      year: { window: historicalPerformanceWindow("2026-10-19", "year") },
    },
  };
};
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test("six months of admitted clinician history compares with three months without claiming full-year tenure", () => {
  const input = fixture();
  input.historyBasis = "available-history";
  input.context.sessions = [record("2026-04-01", "2026-06-30", 7), record("2026-07-01", "2026-09-30", 14, 1, 2)];
  input.attendanceCoverage = [{ clinicianId: 1, start: "2026-04-01", end: "2026-09-30" }];
  input.workspace.clinicians = [profile("2026-04-01", 20)];
  const result = overviewHistoricalCapacity(freeze(input));
  assert.deepEqual(result.year.range, { start: "2026-04-01", end: "2026-09-30" });
  assert.deepEqual(result["3mo"].range, { start: "2026-07-01", end: "2026-09-30" });
  close(result.year.weekly, 275 * 7 / 183);
  close(result["3mo"].weekly, 14);
  close(result.year.utilizationPct, (275 * 7 / 183) / 20 * 100);
  close(result["3mo"].utilizationPct, 70);
});

test("available clinician history clips only admitted outer bounds and uses identical actual and desired days", () => {
  const input = fixture();
  input.historyBasis = "available-history";
  input.context.sessions = [record("2026-06-01", "2026-06-30", 14), record("2026-07-01", "2026-09-30", 14)];
  input.attendanceCoverage = [{ clinicianId: 1, start: "2026-06-01", end: "2026-09-30" }];
  input.workspace.clinicians = [profile("2026-06-01", 20)];
  const before = structuredClone(input);
  const year = overviewHistoricalCapacity(freeze(input)).year;
  assert.deepEqual(year.requestedRange, { start: "2025-10-01", end: "2026-09-30" });
  assert.deepEqual(year.effectiveRange, { start: "2026-06-01", end: "2026-09-30" });
  assert.deepEqual(year.range, year.effectiveRange);
  close(year.weekly, 14);
  assert.equal(year.desiredWeekly, 20);
  assert.equal(year.unknownDesiredDays, 0);
  close(year.utilizationPct, 70);
  assert.match(year.reasons.join(" "), /do not establish employment tenure/);
  assert.deepEqual(input, before);
  assert.equal(overviewHistoricalCapacity({ ...input, historyBasis: "calendar" }).year.weekly, null);
});

test("available history keeps gaps unknown, quiet proof zero, and sparse visits without proof unknown", () => {
  const input = fixture();
  input.historyBasis = "available-history";
  input.context.sessions = [];
  input.attendanceCoverage = [{ clinicianId: 1, start: "2026-06-01", end: "2026-07-31" },
    { clinicianId: 1, start: "2026-08-02", end: "2026-09-30" }];
  assert.equal(overviewHistoricalCapacity(input).year.weekly, null);
  input.context.sessions = [record("2026-08-01", "2026-08-01", 7)];
  assert.equal(overviewHistoricalCapacity(input).year.weekly, null, "manual rows cannot fill an admitted evidence gap");
  input.context.sessions = [];
  input.attendanceCoverage[1].start = "2026-08-01";
  assert.equal(overviewHistoricalCapacity(input).year.weekly, 0);
  input.attendanceCoverage = [];
  input.context.sessions = [record("2026-08-03", "2026-08-03", 7, 1, -1)];
  const missing = overviewHistoricalCapacity(input).year;
  assert.equal(missing.effectiveRange, null);
  assert.equal(missing.weekly, null);
  assert.equal(missing.desiredWeekly, null);
});

test("available clipping preserves crossing aggregate guards and cannot change multi-clinician practice semantics", () => {
  const input = fixture();
  input.historyBasis = "available-history";
  input.attendanceCoverage = [{ clinicianId: 1, start: "2026-06-15", end: "2026-09-29" }];
  input.context.sessions = [record("2026-06-01", "2026-06-30", 14)];
  const year = overviewHistoricalCapacity(input).year;
  assert.equal(year.weekly, null);
  assert.equal(year.observedCompleted, null);
  assert.deepEqual(year.range, { start: "2026-06-15", end: "2026-09-29" });
  input.selectedClinicianIds = [1, 2];
  input.context.clinicians.push(person(2));
  assert.equal(overviewHistoricalCapacity(input).year.weekly, null);
  assert.match(overviewHistoricalCapacity(input).year.reasons.join(" "), /practice totals use complete calendar/);
});

test("Oct 19: 17 / 23 is 73.913% and both calendar histories normalize their own totals to weeks", () => {
  const input = fixture();
  // A 91-day calendar window permits exactly 17/week using whole session counts.
  input.historicalReports = {
    "3mo": { window: historicalPerformanceWindow(input.today, "3mo", "2026-06-30") },
    year: { window: historicalPerformanceWindow(input.today, "year", "2026-06-30") },
  };
  input.context.sessions = [record("2025-07-01", "2026-03-31", 7), record("2026-04-01", "2026-06-30", 17)];
  const result = overviewHistoricalCapacity(input);
  assert.deepEqual(Object.keys(result), ["3mo", "year"]);
  const recent = result["3mo"];
  close(recent.weekly, 17);
  assert.equal(recent.desiredWeekly, 23);
  close(recent.utilizationPct, 73.91304347826086);
  assert.equal(recent.desiredBasis, "current-card-assumptions");
  assert.equal(recent.historicalDesiredWeekly, null);
  assert.equal(recent.unknownDesiredDays, 91);
  assert.match(recent.reasons.join(" "), /current clinician-card.*historical staffing.*unverified/);
  const total = input.context.sessions.reduce((sum, row) => sum + row.completed, 0);
  close(result.year.observedCompleted, total);
  close(result.year.weekly, total * 7 / 365);
  assert.notEqual(result.year.weekly, recent.weekly);
});

test("practice totals sum matching clinicians and use a ratio of totals, not average percentages", () => {
  const input = fixture();
  input.context.clinicians.push(person(2, 7), { ...person(3, 100), goalId: 99 });
  input.context.sessions.push(record("2025-10-01", "2026-09-30", 7, 2, 2), record("2025-10-01", "2026-09-30", 100, 3, 3));
  const one = overviewHistoricalCapacity(input)["3mo"];
  input.selectedClinicianIds = [2];
  // A year aggregate must not be prorated into the three-month total.
  input.context.sessions = input.context.sessions.filter(row => row.clinicianId !== 2);
  input.context.sessions.push(record("2025-10-01", "2026-06-30", 7, 2, 2), record("2026-07-01", "2026-09-30", 7, 2, 3));
  const two = overviewHistoricalCapacity(input)["3mo"];
  input.selectedClinicianIds = [1, 2, 1];
  const practice = overviewHistoricalCapacity(input)["3mo"];
  close(practice.weekly, one.weekly! + two.weekly!);
  assert.equal(practice.desiredWeekly, 30);
  close(practice.utilizationPct, 28 / 30 * 100);
  assert.notEqual(practice.utilizationPct, (one.utilizationPct! + two.utilizationPct!) / 2);
});

test("dated desired profiles weight every inclusive calendar day, with explicit zero and current roster switch preserved", () => {
  const input = fixture();
  input.workspace.clinicians = [
    profile("2025-10-01", 10, { end: "2026-07-31", onTeam: false }),
    profile("2026-08-01", 0, { end: "2026-08-31", onTeam: false }),
    profile("2026-09-01", 20, { onTeam: false }),
  ];
  const { "3mo": recent, year } = overviewHistoricalCapacity(input);
  close(recent.desiredWeekly, (31 * 10 + 31 * 0 + 30 * 20) / 92);
  close(year.desiredWeekly, (304 * 10 + 30 * 20) / 365);
  close(recent.utilizationPct, 21 / recent.desiredWeekly! * 100);
  assert.equal(recent.desiredBasis, "dated-profile-assumptions");
  assert.equal(recent.currentDesiredWeekly, 23);
  assert.equal(recent.unknownDesiredDays, 0);
  assert.equal(recent.desiredCoverageComplete, true);
  assert.match(recent.reasons.join(" "), /model assumptions.*not verified actual historical capacity/);
});

test("profile starts, ends and interior gaps stay unknown; fallback is a full current-card scenario", () => {
  const input = fixture();
  input.workspace.clinicians = [profile("2026-07-02", 30, { end: "2026-07-31" }), profile("2026-08-02", 50, { end: "2026-09-29" })];
  const recent = overviewHistoricalCapacity(input)["3mo"];
  assert.equal(recent.unknownDesiredDays, 3);
  assert.equal(recent.historicalDesiredWeekly, null);
  assert.equal(recent.desiredWeekly, 23);
  assert.equal(recent.desiredBasis, "current-card-assumptions");
  assert.equal(recent.desiredCoverageComplete, false);
});

test("overlapping, archived and planned profiles cannot silently establish historical desired rates", () => {
  for (const profiles of [[profile(), profile()], [profile(undefined, 23, { status: "archived" })], [profile(undefined, 23, { status: "planned" })]]) {
    const input = fixture();
    input.workspace.clinicians = profiles;
    const recent = overviewHistoricalCapacity(input)["3mo"];
    assert.equal(recent.historicalDesiredWeekly, null);
    assert.equal(recent.unknownDesiredDays, 92);
  }
});

test("practice gaps never mix one clinician's dated desired with another's current-card assumption", () => {
  const input = fixture();
  input.workspace.clinicians = [profile("2025-10-01", 30)];
  input.context.clinicians.push(person(2, 7));
  input.attendanceCoverage = [{ clinicianId: 2, start: "2025-10-01", end: "2026-09-30" }];
  input.selectedClinicianIds = [1, 2];
  const recent = overviewHistoricalCapacity(input)["3mo"];
  assert.equal(recent.weekly, 21);
  assert.equal(recent.historicalDesiredWeekly, null);
  assert.equal(recent.desiredWeekly, 30);
  assert.equal(recent.unknownDesiredDays, 92);
  assert.equal(recent.desiredBasis, "current-card-assumptions");
  input.selectedClinicianIds = [1];
  assert.equal(overviewHistoricalCapacity(input)["3mo"].historicalDesiredWeekly, 30);
});

test("dated zero desired takes precedence over a positive current card and keeps percent full undefined", () => {
  const input = fixture();
  input.workspace.clinicians = [profile("2025-10-01", 0)];
  const recent = overviewHistoricalCapacity(input)["3mo"];
  assert.equal(recent.currentDesiredWeekly, 23);
  assert.equal(recent.historicalDesiredWeekly, 0);
  assert.equal(recent.desiredWeekly, 0);
  assert.equal(recent.desiredBasis, "dated-profile-assumptions");
  assert.equal(recent.utilizationPct, null);
});

test("missing manual days never use the legacy observed-days rate, even when attendanceCoverage is empty", () => {
  const input = fixture();
  input.context.sessions = [record("2026-07-01", "2026-07-07", 170)];
  const recent = overviewHistoricalCapacity(input)["3mo"];
  assert.equal(recent.weekly, null);
  assert.equal(recent.utilizationPct, null);
  assert.equal(recent.observedCompleted, 170);
  assert.equal(recent.coverageComplete, false);
});

test("sparse imports require proof, while certified quiet dates and entirely quiet windows are known zero", () => {
  const input = fixture();
  input.context.sessions = [record("2026-07-03", "2026-07-03", 7, 1, -1)];
  assert.equal(overviewHistoricalCapacity(input)["3mo"].weekly, null);
  input.attendanceCoverage = [{ clinicianId: 1, start: "2026-07-01", end: "2026-09-30" }];
  close(overviewHistoricalCapacity(input)["3mo"].weekly, 7 / 92);
  input.context.sessions = [];
  const quiet = overviewHistoricalCapacity(input)["3mo"];
  assert.equal(quiet.weekly, 0);
  assert.equal(quiet.observedCompleted, 0);
  assert.equal(quiet.utilizationPct, 0);
  input.attendanceCoverage[0].end = "2026-09-29";
  assert.equal(overviewHistoricalCapacity(input)["3mo"].weekly, null);
});

test("one missing clinician's coverage withholds practice totals but not the covered individual", () => {
  const input = fixture();
  input.context.clinicians.push(person(2, 7));
  input.selectedClinicianIds = [1, 2];
  assert.equal(overviewHistoricalCapacity(input)["3mo"].weekly, null);
  input.selectedClinicianIds = [1];
  close(overviewHistoricalCapacity(input)["3mo"].weekly, 21);
});

test("overlapping session rows and crossing aggregates remain unknown even with full-day proof", () => {
  const input = fixture();
  input.attendanceCoverage = [{ clinicianId: 1, start: "2025-01-01", end: "2026-10-19" }];
  input.context.sessions.push({ ...input.context.sessions[1], id: 3 });
  assert.equal(overviewHistoricalCapacity(input)["3mo"].weekly, null);
  input.context.sessions = [record("2026-06-30", "2026-07-07", 100)];
  const recent = overviewHistoricalCapacity(input)["3mo"];
  assert.equal(recent.weekly, null);
  assert.equal(recent.observedCompleted, null);
  assert.match(recent.reasons.join(" "), /crosses.*cannot be prorated/);
});

test("historical report windows, including stale anchors and leap year, are reused without replacing them with today", () => {
  const input = fixture();
  input.historicalReports = {
    "3mo": { window: historicalPerformanceWindow("2026-10-19", "3mo", "2024-02-29") },
    year: { window: historicalPerformanceWindow("2026-10-19", "year", "2024-02-29") },
  };
  input.context.sessions = [record("2023-03-01", "2023-11-30", 10), record("2023-12-01", "2024-02-29", 20)];
  const result = overviewHistoricalCapacity(input);
  assert.deepEqual(result["3mo"].range, { start: "2023-12-01", end: "2024-02-29" });
  close(result["3mo"].weekly, 20);
  close(result.year.weekly, input.context.sessions.reduce((sum, row) => sum + row.completed, 0) * 7 / 366);
});

test("room/max capacity, dated capacity terms, weeks worked, stored session desired and staffing events cannot change desired fill", () => {
  const input = fixture();
  input.workspace.clinicians = [profile()];
  const before = overviewHistoricalCapacity(input);
  input.workspace.settings.defaultInPersonPct = 100;
  input.workspace.rooms.push(roomSchema.parse({ id: crypto.randomUUID(), name: "Tiny room", start: "2025-10-01", weeklyHours: 1 }));
  input.workspace.terms.push(termSchema.parse({ id: crypto.randomUUID(), clinicianId: 1, effectiveDate: "2025-10-01", capacity: 100 }));
  input.workspace.events.push(eventSchema.parse({ id: crypto.randomUUID(), name: "Planning capacity", date: "2026-07-01", field: "clinician.capacity", targetId: "1", value: 99 }));
  input.context.clinicians[0].weeksWorkedPerYear = 1;
  input.context.sessions.forEach(row => row.desired = 0);
  assert.deepEqual(overviewHistoricalCapacity(input), before);
});

test("zero desired has no percentage; above-desired attendance is not clamped; invalid desired stays unknown", () => {
  const input = fixture();
  input.context.clinicians[0].sessionsPerWeek = 0;
  let recent = overviewHistoricalCapacity(input)["3mo"];
  assert.equal(recent.desiredWeekly, 0);
  assert.equal(recent.utilizationPct, null);
  input.context.clinicians[0].sessionsPerWeek = 10;
  close(overviewHistoricalCapacity(input)["3mo"].utilizationPct, 210);
  for (const value of [NaN, Infinity, -1]) {
    input.context.clinicians[0].sessionsPerWeek = value;
    recent = overviewHistoricalCapacity(input)["3mo"];
    assert.equal(recent.desiredWeekly, null);
    assert.equal(recent.desiredBasis, "unknown");
    assert.equal(recent.utilizationPct, null);
  }
});

test("empty, cross-team, missing and ambiguous clinician selections cannot become partial practice metrics", () => {
  for (const ids of [[], [99], [1, 99], [2]]) {
    const input = fixture();
    input.context.clinicians.push({ ...person(2), goalId: 99 });
    input.selectedClinicianIds = ids;
    const recent = overviewHistoricalCapacity(input)["3mo"];
    assert.equal(recent.weekly, null);
    assert.equal(recent.desiredWeekly, null);
  }
  const input = fixture();
  input.context.clinicians.push(person());
  assert.equal(overviewHistoricalCapacity(input)["3mo"].weekly, null);
});

test("malformed, partial, incorrect-duration and future windows are rejected", () => {
  for (const range of [
    { start: "2026-07-01", end: "2026-09-29" }, { start: "2026-08-01", end: "2026-09-30" },
    { start: "2026-07-02", end: "2026-09-30" }, { start: "2026-08-01", end: "2026-10-31" },
    { start: "2026-02-30", end: "2026-09-30" }, { start: "bad", end: "2026-09-30" },
  ]) {
    const input = fixture();
    input.historicalReports["3mo"].window.cohort = range;
    const recent = overviewHistoricalCapacity(input)["3mo"];
    assert.equal(recent.weekly, null);
    assert.equal(recent.desiredWeekly, null);
    assert.ok(recent.reasons.length);
  }
});

test("deeply frozen inputs, including source reports, are unchanged and output ranges are independent", () => {
  const input = fixture();
  input.workspace.clinicians = [profile()];
  const before = structuredClone(input);
  const result = overviewHistoricalCapacity(freeze(input));
  assert.deepEqual(input, before);
  result["3mo"].range.start = "2000-01-01";
  assert.deepEqual(input, before);
});

test("monthly ending controls cannot certify an unverified whole-window count or percent", () => {
  const reports = historicalPerformancePeriods({ snapshots: [], today: "2026-10-19" });
  // Controls intentionally make the latest-month rate disagree with period totals.
  reports["3mo"].activity = { ...reports["3mo"].activity!, endingFullMonthClientEnds: 9, endingFullMonthDenominator: 2, endingAttritionPct: 99 };
  reports.year.activity = { ...reports["3mo"].activity, endingFullMonthClientEnds: 13, endingFullMonthDenominator: 7 };
  const result = overviewHistoricalAttrition(freeze(reports));
  assert.equal(result["3mo"].total, null);
  assert.equal(result["3mo"].coveredMatureMonths, 2);
  assert.equal(result.year.total, null);
  assert.equal(result.year.coveredMatureMonths, 7);
  assert.equal(result["3mo"].eligibleClients, null);
  assert.equal(result["3mo"].attritionPct, null);
  assert.equal(result["3mo"].coverageComplete, false);
  assert.ok(result["3mo"].reasons.includes("immature-follow-up"), "October cannot certify September endings through their 90-day follow-up");
  assert.equal(overviewHistoricalAttrition(reports, "Missing")["3mo"].total, null);
});

test("monthly covered zero alone cannot certify a whole-window zero", () => {
  const reports = historicalPerformancePeriods({ snapshots: [], today: "2026-10-19" });
  reports["3mo"].activity = { ...reports["3mo"].activity!, endingFullMonthClientEnds: 0, endingFullMonthDenominator: 0 };
  assert.equal(overviewHistoricalAttrition(reports)["3mo"].total, null);
  reports["3mo"].activity.endingFullMonthDenominator = 1;
  assert.equal(overviewHistoricalAttrition(reports)["3mo"].total, null);
  assert.equal(overviewHistoricalAttrition(reports)["3mo"].attritionPct, null);
});

const julyAttritionReports = (returned = false, asOf = "2026-11-30") => {
  const requestedWindow = { start: "2026-07-01", end: "2026-07-31" };
  const dates = ["2026-07-02", "2026-07-09", "2026-07-16", ...(returned ? ["2026-11-01"] : [])];
  const snapshots: LocalSnapshot[] = [{
    id: "july", kind: "attendance", sourceHash: "july", importedAt: "2026-11-30T12:00:00Z",
    coverageStart: dates[0], coverageEnd: dates.at(-1)!, coverageClinicians: ["Lane"],
    reportCoverage: { start: "2026-06-01", end: "2026-11-30", complete: true },
    rows: dates.map(serviceDate => ({ clientId: "client", clinician: "Lane", serviceDate, status: "show", billingCode: "90837", location: null, sourceRowHash: serviceDate })),
  }];
  const reports = historicalPerformancePeriods({ snapshots, today: asOf });
  // Exercise an explicit July event window without changing trailing-calendar anchor rules.
  reports["3mo"].window.attrition = requestedWindow;
  reports["3mo"].periodAttrition = periodClientAttrition({ snapshots, requestedWindow, asOf });
  return reports;
};

test("mature July engine evidence reaches Overview as 1 ended / 1 observed eligible / 100%", () => {
  const reports = julyAttritionReports();
  const before = structuredClone(reports);
  const result = overviewHistoricalAttrition(freeze(reports))["3mo"];
  assert.deepEqual(result.range, { start: "2026-07-01", end: "2026-07-31" });
  assert.equal(result.total, 1);
  assert.equal(result.eligibleClients, 1);
  assert.equal(result.attritionPct, 100);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.cohortQualifier, "observed-established-clients");
  assert.equal(result.observedMaturePortion, null);
  assert.deepEqual(overviewHistoricalAttrition(reports, " lAnE ")["3mo"], result);
  assert.deepEqual(reports, before);
});

test("covered positive eligible cohort with a later return preserves whole-window zero and 0%", () => {
  const result = overviewHistoricalAttrition(julyAttritionReports(true))["3mo"];
  assert.equal(result.total, 0);
  assert.equal(result.eligibleClients, 1);
  assert.equal(result.attritionPct, 0);
  assert.equal(result.coverageComplete, true);
});

test("immature July totals stay unknown while a separate mature portion keeps exact dates and counts", () => {
  const reports = julyAttritionReports(false, "2026-10-20");
  assert.ok(reports["3mo"].activity);
  Object.assign(reports["3mo"].activity, { endingFullMonthClientEnds: 9, endingFullMonthDenominator: 2, endingAttritionPct: 99 });
  const result = overviewHistoricalAttrition(reports)["3mo"];
  assert.equal(result.total, null);
  assert.equal(result.eligibleClients, null);
  assert.equal(result.attritionPct, null);
  assert.equal(result.coverageComplete, false);
  assert.ok(result.reasons.includes("immature-follow-up"));
  assert.deepEqual(result.observedMaturePortion?.requestedWindow, { start: "2026-07-01", end: "2026-07-22" });
  assert.equal(result.observedMaturePortion?.totalEnded, 1);
  assert.equal(result.observedMaturePortion?.totalEligible, 1);
  assert.equal(result.observedMaturePortion?.percentage, 100);
});

test("explicit practice and normalized clinician period cohorts take precedence over monthly subtotals", () => {
  const reports = julyAttritionReports();
  const evidence = reports["3mo"].periodAttrition;
  evidence.practice = { ...evidence.practice, totalEligible: 4, eligibleClientIds: ["client", "two", "three", "four"], percentage: 25 };
  assert.equal(overviewHistoricalAttrition(reports)["3mo"].attritionPct, 25);
  assert.equal(overviewHistoricalAttrition(reports)["3mo"].eligibleClients, 4);
  assert.equal(overviewHistoricalAttrition(reports, " LANE ")["3mo"].attritionPct, 100);
  evidence.byClinician.push({ ...evidence.byClinician[0], clinician: " lane " });
  assert.equal(overviewHistoricalAttrition(reports, "Lane")["3mo"].total, null, "ambiguous clinician outputs cannot fall back to practice counts");
});

test("legacy reports missing periodAttrition safely preserve unknown rather than use monthly counts", () => {
  const reports = julyAttritionReports();
  // Simulate an older runtime producer, bypassing the new required TypeScript field only here.
  Reflect.deleteProperty(reports["3mo"], "periodAttrition");
  const result = overviewHistoricalAttrition(reports)["3mo"];
  assert.equal(result.total, null);
  assert.equal(result.eligibleClients, null);
  assert.equal(result.attritionPct, null);
  assert.equal(result.coverageComplete, false);
  assert.deepEqual(result.reasons, ["Whole-window client evidence is unavailable."]);
});
