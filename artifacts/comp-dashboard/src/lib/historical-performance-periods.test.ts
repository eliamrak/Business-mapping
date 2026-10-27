import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { historicalPerformance } from "./historical-performance.ts";
import { clinicianAvailableHistoryRange, clinicianHistoricalPerformancePeriods, historicalPerformancePeriods, historicalPeriodDifference, type HistoricalPerformanceInput } from "./historical-performance-periods.ts";
import { sameDayVisitKey, summarizeConsultConversions, type AttendanceRow, type LocalSnapshot } from "./retention-local.ts";

const visit = (clientId: string, serviceDate: string, consult = false): AttendanceRow => ({
  clientId, serviceDate, clinician: "Lane", status: "show", location: null,
  sourceRowHash: `${clientId}:${serviceDate}`, billingCode: consult ? "PHONE" : "90837",
  ...(consult ? { visitKind: "consultation" as const } : {}),
});
const snapshot = (rows: AttendanceRow[], end = "2026-10-14", clinician = "Lane"): LocalSnapshot => ({
  id: clinician, kind: "attendance", sourceHash: clinician, importedAt: "2026-10-14T00:00:00Z",
  coverageStart: "2025-01-01", coverageEnd: end, rows,
  reportCoverage: { start: "2025-01-01", end, complete: true }, coverageClinicians: [clinician],
});
const fixture = (): HistoricalPerformanceInput => ({
  snapshots: [snapshot([
    visit("old-close", "2026-02-01", true), visit("old-close", "2026-02-08"),
    visit("retained", "2026-07-03"), visit("retained", "2026-07-10"), visit("retained", "2026-07-17"),
    visit("recent-miss", "2026-08-02", true), visit("pending", "2026-09-29", true),
  ])],
  attributions: [
    { clientId: "old-close", outcome: "confirmed_closer", clinicianName: "Lane" },
    { clientId: "recent-miss", outcome: "missed_owner", clinicianName: "Lane" },
  ],
  today: "2026-10-14",
});

test("available history uses admitted quiet bounds, preserves gaps and never infers first visits", () => {
  const requested = { start: "2025-10-01", end: "2026-09-30" };
  const proof = [{ clinicianId: 1, start: "2026-06-01", end: "2026-08-31" },
    { clinicianId: 1, start: "2026-09-01", end: "2026-10-07" }];
  const before = structuredClone(proof);
  assert.deepEqual(clinicianAvailableHistoryRange(requested, 1, proof), {
    requestedRange: requested, effectiveRange: { start: "2026-06-01", end: "2026-09-30" }, coverageComplete: true, clipped: true,
  });
  proof[1].start = "2026-09-02";
  const gap = clinicianAvailableHistoryRange(requested, 1, proof);
  assert.equal(gap.coverageComplete, false);
  assert.deepEqual(gap.effectiveRange, { start: "2026-06-01", end: "2026-09-30" });
  assert.equal(clinicianAvailableHistoryRange(requested, 2, proof).effectiveRange, null);
  assert.deepEqual(clinicianAvailableHistoryRange(requested, 1, before).requestedRange, requested);
  for (const invalid of ["bad", "2026-02-30"]) {
    assert.equal(clinicianAvailableHistoryRange({ ...requested, start: invalid }, 1, before).effectiveRange, null);
  }
});

test("paired reports keep practice dates and all classification and follow-up evidence", () => {
  const input = fixture();
  const practiceReports = historicalPerformancePeriods(input);
  const attendanceCoverage = [{ clinicianId: 1, start: "2026-06-01", end: "2026-10-14" }];
  const before = structuredClone(input);
  deepFreeze(input);
  const result = clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1, attendanceCoverage, practiceReports });
  assert.equal(result.practice, practiceReports);
  assert.deepEqual(result.practice.year.window.cohort, { start: "2025-10-01", end: "2026-09-30" });
  assert.deepEqual(result.clinician.year?.window.cohort, { start: "2026-06-01", end: "2026-09-30" });
  assert.equal(result.clinician.year?.consults.practice.pending, 1);
  assert.equal(result.clinician.year?.consults.practice.evaluated, 1);
  assert.equal(result.clinician.year?.consults.practice.conversionRate, 0);
  assert.equal(result.clinician["3mo"]?.activity?.averageClientEndingsPerFullMonth, null);
  assert.equal(result.clinician["3mo"]?.activity, practiceReports["3mo"].activity,
    "independent attrition clipping preserves the original retention statistics");
  assert.equal(result.clinician["3mo"]?.consults, practiceReports["3mo"].consults);
  assert.deepEqual(result.clinician["3mo"]?.window.attrition, { start: "2026-06-01", end: "2026-06-30" });
  assert.deepEqual(result.attritionRanges["3mo"].requestedRange, { start: "2026-04-01", end: "2026-06-30" });
  assert.deepEqual(input, before);
  const gap = clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1, practiceReports,
    attendanceCoverage: [{ clinicianId: 1, start: "2026-06-01", end: "2026-07-31" },
      { clinicianId: 1, start: "2026-08-02", end: "2026-10-14" }] });
  assert.equal(gap.clinician.year, null);
  assert.equal(gap.ranges.year.coverageComplete, false);
  assert.equal(clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1, attendanceCoverage: [] }).clinician.year, null);
});

test("clipped clinician histories forward positive appointment and unresolved sequence inputs", () => {
  const consults = snapshot([visit("positive", "2026-07-01", true)]);
  const appointments = snapshot([visit("positive", "2026-07-08")]);
  appointments.reportCoverage!.complete = false;
  const input = {
    snapshots: [], consultSnapshots: [consults], calendarSnapshots: [consults],
    appointmentSnapshots: [appointments], appointmentClassificationSnapshots: [consults, appointments],
    consultExcludedFollowUpEvidence: [], today: "2026-10-14", clinicianId: 1,
    attendanceCoverage: [{ clinicianId: 1, start: "2026-06-01", end: "2026-10-14" }],
  };
  const before = structuredClone(input);
  deepFreeze(input);
  const result = clinicianHistoricalPerformancePeriods(input);
  assert.equal(result.ranges.year.clipped, true);
  for (const period of ["3mo", "year"] as const) {
    const report = result.clinician[period];
    assert.ok(report);
    assert.equal(report.consults.practice.converted, 1);
    assert.equal(report.consults.practice.conversionRate, 100);
    assert.equal(report.activity, null);
    assert.deepEqual(report.clinicians, []);
  }
  const unresolved = clinicianHistoricalPerformancePeriods({ ...input,
    unresolvedAppointmentEvidence: [{ clientId: "positive", serviceDate: "2026-07-07" }] });
  assert.equal(unresolved.clinician.year?.consults.practice.converted, 0);
  assert.equal(unresolved.clinician.year?.consults.practice.missed, 0);
  assert.equal(unresolved.clinician.year?.consults.practice.conversionRate, null);
  assert.deepEqual(input, before);
});

test("complete unclipped reports reuse frozen base objects without reading metric evidence", () => {
  const practiceReports = deepFreeze(historicalPerformancePeriods(fixture()));
  const input: HistoricalPerformanceInput = {
    today: "2026-10-14",
    get snapshots() { throw new Error("unclipped history must not recalculate metrics"); },
  };
  const result = clinicianHistoricalPerformancePeriods({
    today: input.today,
    get snapshots() { return input.snapshots; },
    clinicianId: 1, practiceReports,
    attendanceCoverage: [{ clinicianId: 1, start: "2025-01-01", end: "2026-10-14" }],
  });
  assert.equal(result.practice, practiceReports);
  assert.equal(result.clinician["3mo"], practiceReports["3mo"]);
  assert.equal(result.clinician.year, practiceReports.year);
  assert.equal(result.ranges.year.clipped, false);
  assert.equal(result.ranges.year.coverageComplete, true);
});

test("clinician attrition clips its mature window independently from retention and consult cohorts", () => {
  const rows = ["2026-05-03", "2026-05-10", "2026-06-01"].map(date => visit("ended", date));
  rows.push(...["2026-07-03", "2026-07-10", "2026-07-17"].map(date => visit("retained", date)));
  const input = { snapshots: [snapshot(rows, "2026-10-07")], today: "2026-10-21" };
  const practiceReports = historicalPerformancePeriods(input);
  const result = clinicianHistoricalPerformancePeriods({ ...input, practiceReports, clinicianId: 1,
    attendanceCoverage: [{ clinicianId: 1, start: "2026-05-01", end: "2026-10-07" }] });
  assert.deepEqual(result.ranges["3mo"].effectiveRange, { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(result.attritionRanges["3mo"].effectiveRange, { start: "2026-05-01", end: "2026-06-30" });
  const report = result.clinician["3mo"]!;
  assert.equal(report.activity, practiceReports["3mo"].activity);
  assert.equal(report.consults, practiceReports["3mo"].consults);
  assert.deepEqual(report.window.cohort, practiceReports["3mo"].window.cohort);
  assert.deepEqual(report.window.attrition, result.attritionRanges["3mo"].effectiveRange);
  assert.equal(report.attritionActivity?.endingFullMonthClientEnds, 1);
  assert.equal(report.attritionActivity?.endingFullMonthDenominator, 2);
  assert.equal(report.attritionActivity?.averageClientEndingsPerFullMonth, 0.5);
  assert.equal(report.periodAttrition.practice.percentage, 100);
  assert.deepEqual(result.attrition["3mo"]?.periodAttrition, report.periodAttrition);
  assert.deepEqual(practiceReports["3mo"].window.attrition, { start: "2026-04-01", end: "2026-06-30" });
});

test("retention gaps cannot hide independent attrition and attrition gaps cannot erase retention", () => {
  const input = fixture();
  const practiceReports = historicalPerformancePeriods(input);
  const retentionGap = clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1, practiceReports,
    attendanceCoverage: [{ clinicianId: 1, start: "2025-01-01", end: "2026-07-31" },
      { clinicianId: 1, start: "2026-08-02", end: "2026-10-14" }] });
  assert.equal(retentionGap.clinician["3mo"], null);
  assert.equal(retentionGap.attrition["3mo"], practiceReports["3mo"]);
  assert.equal(retentionGap.attritionRanges["3mo"].coverageComplete, true);
  const attritionGap = clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1, practiceReports,
    attendanceCoverage: [{ clinicianId: 1, start: "2025-01-01", end: "2026-04-30" },
      { clinicianId: 1, start: "2026-05-02", end: "2026-10-14" }] });
  assert.equal(attritionGap.attrition["3mo"], null);
  assert.equal(attritionGap.attritionRanges["3mo"].coverageComplete, false);
  assert.equal(attritionGap.clinician["3mo"]?.activity, practiceReports["3mo"].activity);
  assert.equal(attritionGap.clinician["3mo"]?.attritionActivity, null);
  assert.deepEqual(attritionGap.clinician["3mo"]?.attritionClinicians, []);
  assert.equal(attritionGap.clinician["3mo"]?.periodAttrition.practice.percentage, null);
  const noAttrition = clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1, practiceReports,
    attendanceCoverage: [{ clinicianId: 1, start: "2026-07-01", end: "2026-10-14" }] });
  assert.equal(noAttrition.attritionRanges["3mo"].effectiveRange, null);
  assert.equal(noAttrition.attrition["3mo"], null);
  assert.equal(noAttrition.clinician["3mo"]?.activity, practiceReports["3mo"].activity);
});

test("available event dates never substitute for follow-up or earlier establishment proof", () => {
  const rows = ["2026-06-01", "2026-06-08", "2026-06-15"].map(date => visit("ending", date));
  const source = snapshot(rows, "2026-08-31");
  source.coverageStart = "2026-06-01";
  source.reportCoverage!.start = "2026-06-01";
  const input = { snapshots: [source], calendarSnapshots: [snapshot([], "2026-10-07")], today: "2026-10-21" };
  const result = clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1,
    attendanceCoverage: [{ clinicianId: 1, start: "2026-06-01", end: "2026-08-31" }] });
  assert.deepEqual(result.attritionRanges["3mo"].effectiveRange, { start: "2026-06-01", end: "2026-06-30" });
  const attrition = result.attrition["3mo"]!;
  assert.equal(attrition.attritionActivity?.endingFullMonthDenominator, 0);
  assert.equal(attrition.attritionActivity?.averageClientEndingsPerFullMonth, null);
  assert.equal(attrition.periodAttrition.practice.totalEnded, null);
  assert.equal(attrition.periodAttrition.practice.percentage, null);
  assert.ok(attrition.periodAttrition.practice.reasons.includes("incomplete-window-or-follow-up-coverage"));
  assert.ok(attrition.periodAttrition.practice.reasons.includes("left-censored-establishment"));
  assert.equal(attrition.periodAttrition.practice.allHistoricalClientsCertified, false);
  const noProof = clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1, attendanceCoverage: [] });
  assert.equal(noProof.attrition["3mo"], null, "observed visit dates cannot supply an available-history range");
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("both histories use recorded same-clinician closes and distinct consult cohorts without mutating evidence", () => {
  const input = fixture();
  const before = structuredClone(input);
  deepFreeze(input);
  const periods = historicalPerformancePeriods(input);
  assert.deepEqual(Object.keys(periods), ["3mo", "year"]);
  assert.deepEqual(periods["3mo"].window.cohort, { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(periods.year.window.cohort, { start: "2025-10-01", end: "2026-09-30" });
  assert.equal(periods["3mo"].consults.practice.consultations, 2);
  assert.equal(periods["3mo"].consults.practice.pending, 1);
  assert.equal(periods["3mo"].consults.practice.converted, 0);
  assert.equal(periods["3mo"].consults.practice.evaluated, 1);
  assert.equal(periods["3mo"].consults.practice.conversionRate, 0);
  assert.equal(periods["3mo"].consults.practice.observedTreatmentStarts, 0);
  assert.equal(periods.year.consults.practice.consultations, 3);
  assert.equal(periods.year.consults.practice.pending, 1);
  assert.equal(periods.year.consults.practice.converted, 1);
  assert.equal(periods.year.consults.practice.evaluated, 2);
  assert.equal(periods.year.consults.practice.conversionRate, 50);
  assert.equal(periods.year.consults.practice.observedTreatmentStarts, 1);
  for (const period of ["3mo", "year"] as const) {
    assert.equal(periods[period].consults.measurement, "consult_to_scheduled_session");
    assert.equal(periods[period].consults.bookingEvidenceAvailable, true);
    assert.deepEqual(periods[period], historicalPerformance({ ...input, period }));
  }
  assert.deepEqual(input, before);
});

test("both calls preserve selected-team calendar, classification, overrides, attribution and follow-up evidence", () => {
  const base = fixture();
  const selected = snapshot([], "2026-08-31", "Legacy Lane");
  const unrelated = snapshot([], "2026-10-14", "Moss");
  const input: HistoricalPerformanceInput = {
    ...base,
    consultSnapshots: base.snapshots,
    calendarSnapshots: [selected, unrelated],
    calendarScope: {
      clinicians: [{ id: 1, label: "Lane", goalId: 1 }, { id: 2, label: "Moss", goalId: 2 }],
      teamId: 1,
      declarations: { version: 1, mappings: [{ sourceLabel: "Legacy Lane", clinicianLabel: "Lane", clinicianId: 1, teamId: 1 }], sourceSets: [] },
    },
    classificationSnapshots: [snapshot([visit("retained", "2026-05-01")])],
    overrides: { [sameDayVisitKey(visit("retained", "2026-07-03"))]: 2 },
    cohortClinicianNames: ["Lane"],
    excludedFollowUpEvidence: [{ clientId: "retained", serviceDate: "2026-10-10" }],
  };
  const before = structuredClone(input);
  deepFreeze(input);
  const periods = historicalPerformancePeriods(input);
  for (const period of ["3mo", "year"] as const) {
    assert.deepEqual(periods[period], historicalPerformance({ ...input, period }));
    assert.equal(periods[period].window.calendarThrough, "2026-08-31");
    assert.equal(periods[period].window.asOf, input.today);
    assert.equal(periods[period].window.cohort.end, "2026-08-31");
  }
  assert.equal(periods["3mo"].window.cohort.start, "2026-06-01");
  assert.equal(periods.year.window.cohort.start, "2025-09-01");
  assert.deepEqual(input, before);
});

test("activity selector calculations and stray selector periods cannot change either history", () => {
  const input = fixture();
  const expected = historicalPerformancePeriods(input);
  for (const range of [{ start: "2026-07-01", end: "2026-07-31" }, { start: "2026-08-01", end: "2026-08-31" }]) {
    summarizeConsultConversions(input.snapshots, {}, range.start, range.end, input.today);
    for (const period of ["3mo", "year"] as const) {
      const selectorInput = { ...input, period, periodRange: range };
      assert.deepEqual(historicalPerformancePeriods(selectorInput), expected);
    }
  }
});

test("missing evidence preserves unknown values and unverified coverage in both periods", () => {
  const periods = historicalPerformancePeriods({ snapshots: [], today: "2026-10-14" });
  for (const result of Object.values(periods)) {
    assert.equal(result.activity, null);
    assert.deepEqual(result.clinicians, []);
    assert.equal(result.consults.practice.conversionRate, null);
    assert.equal(result.consults.coverageVerified, false);
  }
});

test("recent-minus-baseline differences preserve percentage-point and monthly units and unknowns", () => {
  const periods = historicalPerformancePeriods(fixture());
  assert.equal(historicalPeriodDifference(periods["3mo"].consults.practice.conversionRate, periods.year.consults.practice.conversionRate), -50);
  assert.equal(historicalPeriodDifference(25, 75), -50);
  assert.equal(historicalPeriodDifference(2.5, 1.25), 1.25);
  assert.equal(historicalPeriodDifference(0, 0), 0);
  assert.equal(historicalPeriodDifference(0, 10), -10);
  for (const unknown of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(historicalPeriodDifference(unknown, 0), null);
    assert.equal(historicalPeriodDifference(0, unknown), null);
  }
});

test("Team and Sessions integrate both histories while activity-date consults remain separate", () => {
  const source = readFileSync(new URL("../pages/practice-workspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bhistoricalPeriod\b|\bsetHistoricalPeriod\b/);
  assert.match(source, /const historicalReports = useMemo\(\(\) => historicalPerformancePeriods\(/);
  assert.match(source, /const historicalMetrics = historicalReports\["3mo"\]/);
  const hook = source.slice(source.indexOf("  const historicalReports ="), source.indexOf("  const clinicianActivityByName ="));
  assert.doesNotMatch(hook, /periodRange|sharedPeriod|customPeriod/);
  const team = source.slice(source.indexOf('{section === "clinicians" && ('), source.indexOf('{section === "sessions" && ('));
  for (const kind of ["retention", "attrition", "consult"]) {
    assert.ok(team.includes(`values={historicalValuesFor("${kind}", person.label)}`));
    assert.ok(!team.includes(`difference={historicalDifferenceFor("${kind}", person.label)}`));
  }
  assert.doesNotMatch(team, /\{historicalControls\}/);
  assert.match(team, /<HistoricalSessionCapacity capacity=\{historicalCapacityById.get\(person.id\)\} reports=\{historicalReports\}/);
  assert.match(team, /<summary>Selected activity dates<\/summary>/);
  assert.match(team, /sessionEvidenceBounds.start/);
  assert.match(team, /sessionEvidence.observedCompleted/);
  const capacityHook = source.slice(source.indexOf("  const historicalCapacityById ="), source.indexOf("  const historicalEarningsById ="));
  assert.match(capacityHook, /useMemo/);
  assert.match(capacityHook, /selectedClinicianIds: \[person.id\]/);
  assert.doesNotMatch(capacityHook, /periodRange|sharedPeriod|customPeriod/);
  assert.ok(source.indexOf("  const historicalCapacityById =") < source.indexOf("  if (!workspace || !context || query.isError"));
  const sessions = source.slice(source.indexOf('{section === "sessions" && ('), source.indexOf('{section === "retention" && ('));
  for (const kind of ["retention", "attrition", "consult"]) {
    assert.ok(sessions.includes(`historicalValuesFor("${kind}", compareWholePractice ? "Whole Practice" : selectedContributorName, compareWholePractice)`));
  }
  assert.doesNotMatch(sessions, /\{historicalControls\}/);
  assert.match(sessions, /className="pw-clinical-metric-grid pw-sessions-clinical-grid"/);
  const stackStart = sessions.indexOf('{widgetGrid("sessions", <>');
  const stackEnd = sessions.indexOf('</>, "pw-sessions-history-widgets", "small")}', stackStart);
  const historyStack = stackStart >= 0 && stackEnd > stackStart ? sessions.slice(stackStart, stackEnd) : null;
  assert.ok(historyStack, "historical metrics and selected consultations share the editable grid below the full-width chart");
  assert.equal([...historyStack.matchAll(/<section\b/g)].length, 3);
  assert.match(historyStack, /aria-label="Historical close rate card"/);
  assert.match(historyStack, /aria-label="Retention card"/);
  assert.match(historyStack, /aria-label="Attrition card"/);
  assert.doesNotMatch(historyStack, /aria-label="Session trends card"/);
  assert.doesNotMatch(historyStack, /data-widget-id="current-consultations"/);
  assert.match(historyStack, /pw-close-rate-details/);
  assert.ok(historyStack.indexOf("pw-close-rate-details") < historyStack.indexOf('data-widget-id="session-progression"'));
  assert.match(historyStack, /Last 3 mature months/);
  assert.match(sessions, /activityPeriodCaption\(sharedPeriod, periodRange\)/);
  assert.match(sessions, /rows=\{consultComparisonRows(?:\.map|\})/);
  assert.match(sessions, /contributorConsult\?\.observedConversionRate/);
  assert.match(source, /clinicalComparisonRowsFor\(kind, period\)/);
  assert.match(source, /kind === "consult" \? currentConsultPeople : people/);
  const historicalValues = source.slice(source.indexOf("  const historicalValuesFor ="), source.indexOf("  const consultComparisonRows ="));
  assert.match(historicalValues, /<details><summary>Counts and coverage<\/summary>/);
  assert.match(historicalValues, /kind === "attrition"[\s\S]*MaturedStartsSummary[\s\S]*<details><summary>Counts and coverage/);
  assert.match(historicalValues, /comparison=\{metric.maturedStartsComparison\}/);
  assert.match(historicalValues, /comparison=\{row.maturedStartsComparison\}/);
  assert.doesNotMatch(historicalValues, /<details\s+open/);
  assert.match(historicalValues, /rows=\{comparisonRows\.map\(\(row\) => \(\{ \.\.\.row, detail: undefined \}\)\)\}/);
  assert.match(historicalValues, /<p key=\{row.id\}>\{row.label\}: \{row.detail\}<\/p>/);
  assert.match(source, /const unit = kind === "attrition" \? "endings \/ month" : "percentage points"/);
});
