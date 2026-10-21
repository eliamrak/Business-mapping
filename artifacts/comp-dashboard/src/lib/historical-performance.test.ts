import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { historicalPerformance, historicalPerformanceWindow } from "./historical-performance.ts";
import { completeReportCoverage } from "./complete-report-coverage.ts";
import { summarizeConsultConversions, type AttendanceRow, type ConsultAttributionOverrideInput, type LocalSnapshot } from "./retention-local.ts";

const visit = (clientId: string, serviceDate: string, phone = false, clinician = "Lane"): AttendanceRow => ({
  clientId, serviceDate, clinician, status: "show", location: null,
  sourceRowHash: `${clientId}:${serviceDate}`, billingCode: phone ? "PHONE" : "90837",
  ...(phone ? { visitKind: "consultation" as const } : {}),
});
const snapshot = (rows: AttendanceRow[], end = "2026-10-14"): LocalSnapshot => ({
  id: "synthetic", kind: "attendance", sourceHash: "synthetic", importedAt: "2026-10-14T00:00:00Z",
  coverageStart: rows.map((row) => row.serviceDate).sort()[0],
  coverageEnd: rows.map((row) => row.serviceDate).sort().at(-1)!, rows,
  reportCoverage: { start: "2025-01-01", end, complete: true }, coverageClinicians: ["Lane", "Moss"],
});

test("retention keeps recent calendar cohorts while attrition uses latest full mature months", () => {
  const window = historicalPerformanceWindow("2026-10-14");
  assert.deepEqual(window.cohort, { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(window.attrition, { start: "2026-04-01", end: "2026-06-30" });
  assert.equal(window.endingObservationCutoff, "2026-07-16");
  assert.deepEqual(historicalPerformanceWindow("2026-10-14", "year").cohort, { start: "2025-10-01", end: "2026-09-30" });
  assert.deepEqual(historicalPerformanceWindow("2024-02-29").cohort, { start: "2023-12-01", end: "2024-02-29" });
  assert.deepEqual(historicalPerformanceWindow("2024-03-01", "year").cohort, { start: "2023-03-01", end: "2024-02-29" });
  assert.deepEqual(historicalPerformanceWindow("2026-10-21", "3mo", "2026-10-07").attrition,
    { start: "2026-04-01", end: "2026-06-30" });
  assert.deepEqual(historicalPerformanceWindow("2026-10-21", "year", "2026-10-07").attrition,
    { start: "2025-07-01", end: "2026-06-30" });
  assert.deepEqual(historicalPerformanceWindow("2026-10-21", "3mo", "2027-01-31").attrition, window.attrition);
  assert.deepEqual(historicalPerformanceWindow("2026-10-21", "3mo", "2026-08-31").attrition,
    { start: "2026-03-01", end: "2026-05-31" });
  assert.deepEqual(historicalPerformanceWindow("2024-05-29").attrition,
    { start: "2023-12-01", end: "2024-02-29" }, "exact E+90 includes a leap month end");
  assert.deepEqual(historicalPerformanceWindow("2024-05-28").attrition,
    { start: "2023-11-01", end: "2024-01-31" }, "one day before E+90 excludes the partial mature month");
});

test("retention uses weighted eligible starts; zero mature full attrition months stays unknown", () => {
  const rows = [visit("retained", "2026-07-03"), visit("retained", "2026-07-10"), visit("retained", "2026-07-17")];
  for (let index = 0; index < 9; index++) rows.push(visit(`miss-${index}`, "2026-08-02"));
  rows.push(visit("pending", "2026-09-29"));
  const snapshots = [snapshot(rows)];
  const before = structuredClone(snapshots);
  const result = historicalPerformance({ snapshots, today: "2026-10-14" });
  assert.equal(result.activity?.retainedClientPairs, 1);
  assert.equal(result.activity?.initialRetentionDenominator, 10);
  assert.equal(result.activity?.initialRetentionRate, 0.1);
  assert.equal(result.activity?.immatureClientPairsExcluded, 1);
  assert.equal(result.activity?.endingFullMonthDenominator, 0);
  assert.equal(result.activity?.averageClientEndingsPerFullMonth, null);
  assert.equal(result.clinicians.find((row) => row.clinician === "Lane")?.initialRetentionPct, 10);
  assert.deepEqual(snapshots, before);
});

test("lagged attrition has separate monthly statistics and preserves the unique-client equation", () => {
  const rows = [
    ...["2026-03-03", "2026-03-10", "2026-04-01"].map(date => visit("ended", date)),
    ...["2026-04-03", "2026-04-10", "2026-04-17", "2026-07-01"].map(date => visit("returned", date)),
    ...["2026-07-03", "2026-07-10", "2026-07-17"].map(date => visit("retained", date)),
  ];
  const snapshots = [snapshot(rows, "2026-10-07")];
  const before = structuredClone(snapshots);
  const report = historicalPerformance({ snapshots, today: "2026-10-21" });
  assert.equal(report.activity?.retainedClientPairs, 1);
  assert.equal(report.activity?.initialRetentionDenominator, 1);
  assert.equal(report.activity?.endingFullMonthClientEnds, 0);
  assert.equal(report.activity?.endingFullMonthDenominator, 0);
  assert.equal(report.activity?.averageClientEndingsPerFullMonth, null);
  assert.equal(report.attritionActivity?.endingFullMonthClientEnds, 1);
  assert.equal(report.attritionActivity?.endingFullMonthDenominator, 3);
  assert.equal(report.attritionActivity?.averageClientEndingsPerFullMonth, 1 / 3);
  assert.deepEqual(report.attritionActivity?.monthlyEndedClients.map(row => row.month), ["2026-04", "2026-05", "2026-06"]);
  assert.equal(report.attritionClinicians.find(row => row.clinician === "Lane")?.averageClientEndingsPerFullMonth, 1 / 3);
  assert.equal(report.clinicians.find(row => row.clinician === "Lane")?.averageClientEndingsPerFullMonth, null);
  assert.equal(report.periodAttrition.practice.totalEligible, 2);
  assert.equal(report.periodAttrition.practice.totalEnded, 1);
  assert.equal(report.periodAttrition.practice.percentage, 50);
  assert.equal(report.periodAttrition.practice.allHistoricalClientsCertified, false);
  const year = historicalPerformance({ snapshots, today: "2026-10-21", period: "year" });
  assert.equal(year.attritionActivity?.endingFullMonthDenominator, 12);
  assert.equal(year.attritionActivity?.averageClientEndingsPerFullMonth, 1 / 12);
  assert.deepEqual(snapshots, before);
});

test("mature dates alone cannot certify missing coverage or left-censored establishment", () => {
  const source = snapshot(["2026-04-01", "2026-04-08", "2026-04-15"].map(date => visit("boundary", date)), "2026-10-07");
  source.reportCoverage!.start = "2026-04-01";
  const report = historicalPerformance({ snapshots: [source], today: "2026-10-21" });
  assert.equal(report.periodAttrition.practice.percentage, null);
  assert.ok(report.periodAttrition.practice.reasons.includes("left-censored-establishment"));
  assert.equal(report.periodAttrition.practice.allHistoricalClientsCertified, false);
  const missing = historicalPerformance({ snapshots: [], calendarSnapshots: [source], today: "2026-10-21" });
  assert.deepEqual(missing.window.attrition, report.window.attrition);
  assert.equal(missing.attritionActivity, null);
  assert.deepEqual(missing.attritionClinicians, []);
  assert.equal(missing.periodAttrition.practice.totalEnded, null);
  assert.equal(missing.periodAttrition.practice.percentage, null);
});

test("historical booking rates stay unknown without booking evidence despite attendance and legacy attribution", () => {
  const rows = [visit("july-close", "2026-07-02", true), visit("july-close", "2026-07-09")];
  const attributions: ConsultAttributionOverrideInput[] = [{ clientId: "july-close", outcome: "confirmed_closer", clinicianName: "Lane" }];
  for (let index = 0; index < 9; index++) {
    rows.push(visit(`august-miss-${index}`, "2026-08-02", true));
    attributions.push({ clientId: `august-miss-${index}`, outcome: "missed_owner", clinicianName: "Lane" });
  }
  rows.push(visit("pending", "2026-09-29", true, "Moss"));
  const snapshots = [snapshot(rows)];
  const input = { snapshots, attributions, today: "2026-10-14", cohortClinicianNames: ["Lane", "Moss"] };
  const result = historicalPerformance(input);
  assert.equal(result.consults.measurement, "scheduled_treatment");
  assert.equal(result.consults.bookingEvidenceAvailable, false);
  assert.ok(result.consults.bookingLimitation);
  assert.equal(result.consults.practice.conversionRate, null);
  assert.equal(result.consults.practice.evaluated, 0);
  assert.equal(result.consults.practice.consultations, 11);
  assert.equal(result.consults.practice.pending, 11);
  assert.equal(result.consults.practice.observedTreatmentStarts, 1);
  const lane = result.consults.byClinician.find((row) => row.clinician === "Lane");
  assert.ok(lane);
  assert.equal(lane.conversionRate, null);
  assert.equal(lane.evaluated, 0);
  assert.equal(lane.pending, 10);
  for (const range of [{ start: "2026-07-01", end: "2026-07-31" }, { start: "2026-08-01", end: "2026-08-31" }]) {
    summarizeConsultConversions(snapshots, {}, range.start, range.end, input.today, attributions);
    assert.deepEqual(historicalPerformance(input), result);
  }
  const year = historicalPerformance({ ...input, period: "year" });
  assert.equal(year.consults.periodStart, "2025-10-01");
  assert.equal(year.consults.periodEnd, "2026-09-30");
});

test("available report end anchors historical labels and never uses later pay dates", () => {
  const result = historicalPerformance({ snapshots: [snapshot([visit("older", "2026-07-03")], "2026-08-31")], today: "2026-10-14" });
  assert.equal(result.window.asOf, "2026-10-14");
  assert.equal(result.window.calendarThrough, "2026-08-31");
  assert.deepEqual(result.window.cohort, { start: "2026-06-01", end: "2026-08-31" });
});

test("year attrition divides endings by covered mature months and later returns remove prior endings", () => {
  const rows = [visit("established", "2026-05-01"), visit("established", "2026-05-08"), visit("established", "2026-06-01")];
  const result = historicalPerformance({ snapshots: [snapshot(rows)], today: "2026-10-14", period: "year" });
  assert.equal(result.activity?.endingFullMonthClientEnds, 1);
  assert.equal(result.activity?.endingFullMonthDenominator, 9);
  assert.equal(result.activity?.averageClientEndingsPerFullMonth, 1 / 9);
  assert.equal(result.clinicians.find((row) => row.clinician === "Lane")?.averageClientEndingsPerFullMonth, 1 / 9);
  const returned = historicalPerformance({ snapshots: [snapshot([...rows, visit("established", "2026-09-01")])], today: "2026-10-14", period: "year" });
  assert.equal(returned.activity?.endingFullMonthClientEnds, 0);
  assert.equal(returned.activity?.averageClientEndingsPerFullMonth, 0);
});

test("consultations route to Sessions, Rooms remains in Growth, and clinical identity guards survive", () => {
  const source = readFileSync(new URL("../pages/practice-workspace.tsx", import.meta.url), "utf8");
  const sessions = source.slice(source.indexOf('{section === "sessions" && ('), source.indexOf('{section === "retention" && ('));
  const growth = source.slice(source.indexOf('{section === "marketing" && ('), source.indexOf('{section === "rooms" && ('));
  assert.match(sessions, /pw-consult-resolution/);
  assert.match(sessions, /Confirm closer/);
  assert.match(sessions, /Total sessions/);
  assert.match(sessions, /Verified booking closes/);
  assert.doesNotMatch(growth, /pw-consult-resolution/);
  assert.match(growth, /setSection\("rooms"\)/);
  assert.match(source, /const contributorActivity =[\s\S]*?hasUniqueClinicianIdentity/);
  assert.match(source, /const unique = practice \|\| hasUniqueClinicianIdentity/);
  assert.match(source, /if \(!unique\) return \{ range, value: null/);
  const historicalHook = source.slice(source.indexOf("  const historicalReports ="), source.indexOf("  const clinicianActivityByName ="));
  assert.doesNotMatch(historicalHook, /periodRange|sharedPeriod|customPeriod/);
  assert.match(historicalHook, /calendarScope: \{ clinicians: context\?\.clinicians \?\? \[\], teamId: workspace\?\.settings.teamId \?\? null, declarations: importEvidenceDeclarations \}/);
});

test("canonical admission cannot move a September 30 report calendar back to June-August", () => {
  const source = snapshot([visit("retained", "2026-07-10"), visit("retained", "2026-07-17"), visit("retained", "2026-07-24"), visit("late", "2026-09-29")], "2026-09-30");
  const admitted = completeReportCoverage([source], [{ id: 1, label: "Lane" }], "2026-10-19");
  assert.equal(admitted.attendanceThrough, "2026-09-23");
  const result = historicalPerformance({ snapshots: admitted.eligibleSnapshots, consultSnapshots: admitted.eligibleSnapshots, calendarSnapshots: [source], classificationSnapshots: [source], today: "2026-10-19" });
  assert.deepEqual(result.window.cohort, { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(result.window.attrition, { start: "2026-04-01", end: "2026-06-30" });
  assert.equal(result.window.calendarThrough, "2026-09-30");
  assert.equal(result.window.asOf, "2026-10-19");
  assert.equal(result.activity?.retainedClientPairs, 1);
  assert.equal(result.activity?.endingFullMonthDenominator, 0);
  const year = historicalPerformance({ snapshots: admitted.eligibleSnapshots, calendarSnapshots: [source], today: "2026-10-19", period: "year" });
  assert.deepEqual(year.window.cohort, { start: "2025-10-01", end: "2026-09-30" });
});

test("known October 10 return blocks a false ending even when admitted coverage stops October 7", () => {
  const source = snapshot([visit("returning", "2026-06-01"), visit("returning", "2026-06-08"), visit("returning", "2026-06-15"), visit("returning", "2026-10-10")]);
  const admitted = completeReportCoverage([source], [{ id: 1, label: "Lane" }], "2026-10-19");
  assert.equal(admitted.attendanceThrough, "2026-10-07");
  const input = { snapshots: admitted.eligibleSnapshots, calendarSnapshots: [source], classificationSnapshots: [source], today: "2026-10-19", period: "year" as const };
  const withoutReturn = historicalPerformance(input);
  assert.equal(withoutReturn.activity?.endingFullMonthClientEnds, 1);
  const knownReturn = historicalPerformance({ ...input, excludedFollowUpEvidence: [{ clientId: "returning", serviceDate: "2026-10-10" }] });
  assert.equal(knownReturn.activity?.endingFullMonthClientEnds, 0);
  assert.equal(knownReturn.clinicians.find((row) => row.clinician === "Lane")?.endingFullMonthClientEnds, 0);
  assert.equal(knownReturn.activity?.endingFullMonthDenominator, withoutReturn.activity!.endingFullMonthDenominator - 1);
  assert.equal(knownReturn.activity?.endingObservationCutoff, "2026-07-09", "coverage still controls maturity; raw return cannot extend it");
  assert.equal(knownReturn.window.endingObservationCutoff, "2026-07-09", "shared cutoff label respects admitted coverage too");
  assert.equal(knownReturn.activity?.initialRetentionDenominator, withoutReturn.activity?.initialRetentionDenominator, "excluded return never becomes a positive admitted visit");
  const futureReturn = historicalPerformance({ ...input, excludedFollowUpEvidence: [{ clientId: "returning", serviceDate: "2026-10-20" }] });
  assert.equal(futureReturn.activity?.endingFullMonthClientEnds, 1, "future observations remain excluded by true today");
});

test("a newer unrelated-team report cannot move the selected team's August calendar anchor", () => {
  const selected = { ...snapshot([visit("selected", "2026-06-01")], "2026-08-31"), id: "selected", coverageClinicians: ["Lane"] };
  const unrelated = { ...snapshot([visit("unrelated", "2026-10-01", false, "Moss")]), id: "unrelated", coverageClinicians: ["Moss"] };
  const roster = [{ id: 1, label: "Lane", goalId: 1 }, { id: 2, label: "Moss", goalId: 2 }];
  const admitted = completeReportCoverage([selected, unrelated], [roster[0]], "2026-10-19", roster, { teamId: 1 });
  const input = { snapshots: admitted.eligibleSnapshots, calendarScope: { clinicians: roster, teamId: 1 }, today: "2026-10-19" };
  const expected = historicalPerformance({ ...input, calendarSnapshots: [selected] });
  const combined = historicalPerformance({ ...input, calendarSnapshots: [selected, unrelated] });
  assert.deepEqual(combined, expected, "calendar evidence cannot add other-team dates or counts");
  assert.deepEqual(combined.window.cohort, { start: "2026-06-01", end: "2026-08-31" });
  assert.equal(combined.window.calendarThrough, "2026-08-31");
});

test("quiet team report proof can anchor dates without supplying observations or confidence", () => {
  const quiet = { ...snapshot([], "2026-08-31"), coverageStart: "2026-06-01", coverageEnd: "2026-08-31", coverageClinicians: ["Lane"] };
  const input = { snapshots: [], calendarScope: { clinicians: [{ id: 1, label: "Lane", goalId: 1 }], teamId: 1 }, today: "2026-10-19" };
  const result = historicalPerformance({ ...input, calendarSnapshots: [quiet] });
  const unrelated = { ...snapshot([visit("other", "2026-10-01", false, "Other")]), coverageClinicians: ["Other"] };
  assert.deepEqual(historicalPerformance({ ...input, calendarSnapshots: [quiet, unrelated] }), result);
  assert.deepEqual(result.window.cohort, { start: "2026-06-01", end: "2026-08-31" });
  assert.equal(result.activity, null);
  assert.deepEqual(result.clinicians, []);
  assert.equal(result.consults.practice.consultations, 0);
  assert.equal(result.consults.practice.conversionRate, null);
  assert.equal(result.consults.coverageVerified, false);
});

test("calendar ownership honors scoped aliases and rejects ambiguous copied identities", () => {
  const selected = { ...snapshot([visit("selected", "2026-06-01", false, "Legacy Lane")], "2026-08-31"), coverageClinicians: [] };
  const ambiguous = { ...snapshot([visit("unresolved", "2026-10-01", false, "Shared")]), coverageClinicians: ["Shared"] };
  const roster = [{ id: 1, label: "Lane", goalId: 1 }, { id: 2, label: "Shared", goalId: 1 }, { id: 3, label: "Shared", goalId: 2 }];
  const declarations = { version: 1 as const, mappings: [{ sourceLabel: "Legacy Lane", clinicianLabel: "Lane", clinicianId: 1, teamId: 1 }], sourceSets: [] };
  const result = historicalPerformance({ snapshots: [], calendarSnapshots: [selected, ambiguous], calendarScope: { clinicians: roster, teamId: 1, declarations }, today: "2026-10-19" });
  assert.equal(result.window.calendarThrough, "2026-08-31");
  assert.equal(result.activity, null);
});
