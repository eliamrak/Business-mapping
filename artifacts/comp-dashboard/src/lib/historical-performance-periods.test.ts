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
  assert.deepEqual(result.clinician["3mo"], practiceReports["3mo"]);
  assert.equal(result.clinician["3mo"], practiceReports["3mo"], "unclipped covered history reuses the base report");
  assert.deepEqual(input, before);
  const gap = clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1, practiceReports,
    attendanceCoverage: [{ clinicianId: 1, start: "2026-06-01", end: "2026-07-31" },
      { clinicianId: 1, start: "2026-08-02", end: "2026-10-14" }] });
  assert.equal(gap.clinician.year, null);
  assert.equal(gap.ranges.year.coverageComplete, false);
  assert.equal(clinicianHistoricalPerformancePeriods({ ...input, clinicianId: 1, attendanceCoverage: [] }).clinician.year, null);
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("both histories expose distinct weighted results simultaneously without mutating evidence", () => {
  const input = fixture();
  const before = structuredClone(input);
  deepFreeze(input);
  const periods = historicalPerformancePeriods(input);
  assert.deepEqual(Object.keys(periods), ["3mo", "year"]);
  assert.deepEqual(periods["3mo"].window.cohort, { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(periods.year.window.cohort, { start: "2025-10-01", end: "2026-09-30" });
  assert.equal(periods["3mo"].consults.practice.conversionRate, 0);
  assert.equal(periods["3mo"].consults.practice.evaluated, 1);
  assert.equal(periods.year.consults.practice.conversionRate, 50);
  assert.equal(periods.year.consults.practice.evaluated, 2);
  for (const period of ["3mo", "year"] as const) {
    assert.equal(periods[period].consults.practice.pending, 1);
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
    assert.ok(team.includes(`difference={historicalDifferenceFor("${kind}", person.label)}`));
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
  const stackStart = sessions.indexOf('<div className="pw-clinical-history-stack">');
  const stackEnd = sessions.indexOf('<section className="pw-metric-panel pw-consult-summary">', stackStart);
  const historyStack = stackStart >= 0 && stackEnd > stackStart ? sessions.slice(stackStart, stackEnd) : null;
  assert.ok(historyStack, "historical close rate, retention and attrition share one unframed stack");
  assert.equal([...historyStack.matchAll(/<section\b/g)].length, 3);
  assert.match(historyStack, /aria-label="Historical close rate card"/);
  assert.match(historyStack, /aria-label="Retention card"/);
  assert.match(historyStack, /aria-label="Attrition card"/);
  assert.doesNotMatch(historyStack, /aria-label="Session trends card"/);
  assert.match(sessions, /activityPeriodCaption\(sharedPeriod, periodRange\)/);
  assert.match(sessions, /rows=\{consultComparisonRows(?:\.map|\})/);
  assert.match(sessions, /contributorConsult\?\.conversionRate/);
  assert.match(source, /clinicalComparisonRowsFor\(kind, period\)/);
  assert.match(source, /kind === "consult" \? currentConsultPeople : people/);
  const historicalValues = source.slice(source.indexOf("  const historicalValuesFor ="), source.indexOf("  const consultComparisonRows ="));
  assert.match(historicalValues, /detail: <details><summary>Counts and coverage<\/summary>/);
  assert.doesNotMatch(historicalValues, /<details\s+open/);
  assert.match(historicalValues, /rows=\{comparisonRows\.map\(\(row\) => \(\{ \.\.\.row, detail: undefined \}\)\)\}/);
  assert.match(historicalValues, /<p key=\{row.id\}>\{row.label\}: \{row.detail\}<\/p>/);
  assert.match(source, /const unit = kind === "attrition" \? "endings \/ month" : "percentage points"/);
});
