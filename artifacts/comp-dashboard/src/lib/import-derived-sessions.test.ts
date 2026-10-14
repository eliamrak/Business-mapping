import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRecord } from "@workspace/practice";
import {
  emptyWorkspace,
  monthFlow,
  type Context,
} from "@workspace/practice/hub";
import { sameDayVisitKey, type LocalSnapshot } from "./retention-local.ts";
import { buildImportedSessionOverlay } from "./import-derived-sessions.ts";
import { buildSessionTrend, selectedPeriodSessionSummary } from "./session-trend.ts";
import { observedBiweeklySessionRecords, summarizeLast1099Period, summarizeSessionOverview } from "./session-overview.ts";

const clinician = (id: number, label: string, goalId: number | null = 7) => ({
  id,
  goalId,
  label,
  roleType: "associate",
  classification: "1099" as const,
  sessionRate: 175,
  sessionsPerWeek: 20,
  weeksWorkedPerYear: 48,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  capEnabled: false,
  capAmount: 0,
  postCapClinicianSplit: 60,
  postCapPracticeSplit: 40,
  w2EmployerFicaPct: 0,
  futaSutaPct: 0,
  workersCompPct: 0,
  otherEmployerBurdenPct: 0,
  nonClinicalHoursPerWeek: 0,
  nonClinicalHourlyRate: 0,
});

const context = (sessions: SessionRecord[] = []): Context => ({
  clinicians: [clinician(1, "Dr Lane"), clinician(2, "Dr Moss")],
  staff: [],
  sessions,
});

const record = (
  clinicianId: number,
  start: string,
  end: string,
  completed: number,
): SessionRecord => ({
  id: 10 + clinicianId,
  clinicianId,
  start,
  end,
  completed,
  desired: completed,
  cancelled: null,
  noShow: null,
  scheduled: null,
  inPerson: null,
  telehealth: null,
  sourceAttachmentId: null,
  revision: 1,
  updatedAt: `${end}T12:00:00.000Z`,
});

const attendanceSnapshot = (
  rows: Extract<LocalSnapshot, { kind: "attendance" }>["rows"],
): LocalSnapshot => ({
  id: "attendance-test",
  kind: "attendance",
  importedAt: "2026-10-13T12:00:00.000Z",
  coverageStart: rows.map((row) => row.serviceDate).sort()[0],
  coverageEnd: rows
    .map((row) => row.serviceDate)
    .sort()
    .at(-1)!,
  sourceHash: "attendance-hash",
  rows,
});

const billingSnapshot = (
  rows: Extract<LocalSnapshot, { kind: "billing" }>["rows"],
): LocalSnapshot => ({
  id: "billing-test",
  kind: "billing",
  importedAt: "2026-10-13T12:00:00.000Z",
  coverageStart: rows.map((row) => row.serviceDate).sort()[0],
  coverageEnd: rows
    .map((row) => row.serviceDate)
    .sort()
    .at(-1)!,
  sourceHash: "billing-hash",
  rows,
});

test("attendance coverage belongs only to clinicians mapped in each snapshot", () => {
  const snapshot = attendanceSnapshot([
    { clientId: "a", clinician: "Dr Lane", serviceDate: "2026-09-16", location: "Room A", status: "show", sourceRowHash: "coverage-a" },
    { clientId: "b", clinician: "Dr Lane", serviceDate: "2026-10-12", location: "Room A", status: "show", sourceRowHash: "coverage-b" },
  ]);
  const overlay = buildImportedSessionOverlay(context(), [snapshot], 7);
  assert.deepEqual(overlay.attendanceCoverage, []);
  assert.deepEqual(overlay.attendanceObservedSpans[0].clinicianIds, [1]);
  assert.equal(overlay.attendanceObservedSpans[0].start, "2026-09-16");
  assert.equal(overlay.attendanceObservedSpans[0].end, "2026-10-12");
  assert.equal(overlay.derivedSessions.length, 2);
});

test("snapshot complete report proof certifies visit-free endpoints; false and invalid proofs do not", () => {
  const rows = [2, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 27].flatMap((day) =>
    Array.from({ length: 3 }, (_, index) => ({ clientId: `proof-${day}-${index}`, clinician: "Dr Lane",
      serviceDate: `2026-10-${String(day).padStart(2, "0")}`, location: "Room A", status: "show" as const,
      sourceRowHash: `proof-${day}-${index}` })));
  const snapshot = attendanceSnapshot(rows);
  const period = { start: "2026-10-01", end: "2026-10-28" };
  const overlay = buildImportedSessionOverlay(context(), [{ ...snapshot, reportCoverage: { ...period, complete: true as const } }], 7);
  assert.deepEqual(overlay.attendanceCoverage, [{ clinicianId: 1, ...period }]);
  assert.deepEqual(overlay.coveredZeroSessions.filter((item) => item.start === period.start || item.start === period.end).map((item) => item.completed), [0, 0]);
  assert.equal(selectedPeriodSessionSummary(overlay.context.sessions, [1], period, overlay.attendanceCoverage).completedWeekly, 9);
  assert.equal(summarizeLast1099Period(overlay.context.sessions, "2026-10-22", overlay.attendanceCoverage, 1)?.completed, 18);
  assert.equal(overlay.context.sessions.some((item) => item.clinicianId === 2), false);
  for (const reportCoverage of [{ ...period, complete: false }, { start: "2026-10-03", end: period.end, complete: true }, { start: period.end, end: period.start, complete: true }]) {
    const invalid = { ...snapshot, reportCoverage } as unknown as Parameters<typeof buildImportedSessionOverlay>[1][number];
    assert.deepEqual(buildImportedSessionOverlay(context(), [invalid], 7).coveredZeroSessions, []);
  }
});

test("cold overlay: 12 session-bearing dates, 36 visits, Oct 1-28 coverage yields 9/week and 18 in Oct 8-21", () => {
  const dates = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 28];
  const rows = dates.flatMap((day) => Array.from({ length: 3 }, (_, index) => ({
    clientId: `client-${day}-${index}`, clinician: "Dr Lane", serviceDate: `2026-10-${String(day).padStart(2, "0")}`,
    location: "Room A", status: "show", sourceRowHash: `gate-${day}-${index}`,
  })));
  const snapshot = attendanceSnapshot(rows);
  const overlay = buildImportedSessionOverlay(context(), [{ ...snapshot, reportCoverage: { start: "2026-10-01", end: "2026-10-28", complete: true } }], 7);
  const period = { start: "2026-10-01", end: "2026-10-28" };
  const summary = selectedPeriodSessionSummary(overlay.context.sessions, [1], period, overlay.attendanceCoverage);
  assert.equal(summary.observedCompleted, 36);
  assert.equal(summary.completedWeekly, 9);
  assert.equal(summary.observedCoverageDays, 28);
  const weeks = buildSessionTrend(overlay.context.sessions, [1], [1, 2], period, () => 20, undefined, overlay.attendanceCoverage);
  assert.deepEqual(weeks.filter((week) => week.completed !== null).map((week) => week.completed), [9, 9, 9]);
  assert.equal(summarizeLast1099Period(overlay.context.sessions, "2026-10-22", overlay.attendanceCoverage, 1)?.completed, 18);
  assert.equal(overlay.context.sessions.filter((item) => item.clinicianId === 1).length, 28);
  assert.equal(overlay.context.sessions.some((item) => item.clinicianId === 2), false);
});
test("covered zero records respect clinician active bounds and reject invalid coverage", () => {
  const rows = [1, 28].map((day) => ({ clientId: `active-${day}`, clinician: "Dr Lane", serviceDate: `2026-10-${String(day).padStart(2, "0")}`, location: "Room A", status: "show", sourceRowHash: `active-${day}` }));
  const snapshot = attendanceSnapshot(rows);
  const overlay = buildImportedSessionOverlay(context(), [{ ...snapshot, reportCoverage: { start: "2026-10-01", end: "2026-10-28", complete: true } }], 7, {}, { clinicianActiveRangesBasis: "employment", clinicianActiveRanges: [{ clinicianId: 1, start: "2026-10-08", end: "2026-10-21" }] });
  assert.equal(overlay.coveredZeroSessions.length, 14);
  assert.ok(overlay.coveredZeroSessions.every((item) => item.start >= "2026-10-08" && item.end <= "2026-10-21" && item.clinicianId === 1));
  assert.deepEqual(buildImportedSessionOverlay(context(), [{ ...snapshot, coverageStart: "2026-10-30", coverageEnd: "2026-10-01" }], 7).coveredZeroSessions, []);
});

test("declared Oct 1-28 coverage includes visit-free endpoints and ignores compensation effective dates", () => {
  const dates = [2, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 27];
  const rows = dates.flatMap((day) => Array.from({ length: 3 }, (_, index) => ({
    clientId: `endpoint-${day}-${index}`, clinician: "Dr Lane", serviceDate: `2026-10-${String(day).padStart(2, "0")}`,
    location: "Room A", status: "show", sourceRowHash: `endpoint-${day}-${index}`,
  })));
  const snapshot = attendanceSnapshot(rows);
  const overlay = buildImportedSessionOverlay(context(), [{ ...snapshot, reportCoverage: { start: "2026-10-01", end: "2026-10-28", complete: true } }], 7, {}, {
    clinicianActiveRanges: [{ clinicianId: 1, start: "2026-10-10", end: null }],
  });
  assert.deepEqual(overlay.attendanceCoverage, [{ clinicianId: 1, start: "2026-10-01", end: "2026-10-28" }]);
  for (const date of ["2026-10-01", "2026-10-28"]) assert.equal(overlay.coveredZeroSessions.find((item) => item.start === date)?.completed, 0);
  const summary = selectedPeriodSessionSummary(overlay.context.sessions, [1], { start: "2026-10-01", end: "2026-10-28" }, overlay.attendanceCoverage);
  assert.equal(summary.completedWeekly, 9);
  assert.equal(summary.observedCompleted, 36);
  assert.equal(summary.observedCoverageDays, 28);
  assert.equal(overlay.context.sessions.some((item) => item.clinicianId === 2), false);
  assert.equal(summarizeLast1099Period(overlay.context.sessions, "2026-10-22", overlay.attendanceCoverage, 1)?.completed, 18);
  const weeks = buildSessionTrend(overlay.context.sessions, [1], [1, 2], { start: "2026-10-01", end: "2026-10-28" }, () => 20, undefined, overlay.attendanceCoverage);
  assert.deepEqual(weeks.filter((week) => week.completed !== null).map((week) => week.completed), [9, 9, 9]);
});

test("a later clinician-only snapshot never extends another clinician's coverage", () => {
  const initial = attendanceSnapshot(["Dr Lane", "Dr Moss"].flatMap((clinician) => [1, 14].map((day) => ({
    clientId: `${clinician}-${day}`, clinician, serviceDate: `2026-10-${String(day).padStart(2, "0")}`,
    location: "Room A", status: "show", sourceRowHash: `initial-${clinician}-${day}`,
  }))));
  const later = attendanceSnapshot([{ clientId: "later-lane", clinician: "Dr Lane", serviceDate: "2026-10-15", location: "Room A", status: "show", sourceRowHash: "later-lane" }]);
  const overlay = buildImportedSessionOverlay(context(), [initial, later], 7);
  assert.deepEqual(overlay.attendanceCoverage, []);
  assert.equal(overlay.context.sessions.some((record) => record.clinicianId === 2 && record.start === "2026-10-15"), false);
});

test("legacy observed spans never certify gaps or a daily import hiring window", () => {
  const rows = Array.from({ length: 14 }, (_, index) => ({ clientId: `legacy-${index}`, clinician: "Dr Lane", serviceDate: `2026-10-${String(index + 8).padStart(2, "0")}`, location: "Room A", status: "show", sourceRowHash: `legacy-${index}` }));
  const snapshot = attendanceSnapshot(rows);
  const overlay = buildImportedSessionOverlay(context(), [snapshot], 7);
  assert.deepEqual(overlay.attendanceCoverage, []);
  assert.deepEqual(overlay.coveredZeroSessions, []);
  const period = { start: "2026-10-08", end: "2026-10-21" };
  const summary = selectedPeriodSessionSummary(overlay.context.sessions, [1], period);
  assert.equal(summary.completedWeekly, null);
  assert.equal(summary.observedCompleted, 14);
  const weeks = buildSessionTrend(overlay.context.sessions, [1], [1], period, () => 20);
  assert.ok(weeks.every((week) => week.completed === null));
  assert.equal(weeks.reduce((total, week) => total + (week.observedCompleted ?? 0), 0), 14);
  assert.equal(summarizeLast1099Period(overlay.context.sessions, "2026-10-22", [], 1)?.coverageComplete, false);
  assert.equal(observedBiweeklySessionRecords(overlay.context.sessions, 1, "2026-10-22").length, 0);
  assert.equal(summarizeSessionOverview(overlay.context.sessions, [], 20).averageWeekly, null);
});

test("independent audit: January 1-14 manual 40 plus January 7 import stays unknown", () => {
  const manual = { ...record(1, "2026-01-01", "2026-01-14", 40), sourceAttachmentId: 123 };
  const fallback = { ...record(1, "2026-01-15", "2026-01-28", 20), id: 12 };
  const source = context([manual, fallback]);
  const before = JSON.stringify(source);
  const overlay = buildImportedSessionOverlay(source, [attendanceSnapshot([{
    clientId: "synthetic-client", clinician: "Dr Lane", serviceDate: "2026-01-07",
    location: "Synthetic Room", status: "show", sourceRowHash: "synthetic-row",
  }])], 7);
  assert.deepEqual(overlay.conflictedManualSessions, [{ ...manual, status: "unknown" }]);
  assert.equal(overlay.context.sessions.reduce((sum, row) => sum + row.completed, 0), 21);
  assert.ok(overlay.context.sessions.includes(fallback));
  assert.equal(overlay.diagnostic.manualImportOverrideCount, 0);
  assert.equal(overlay.diagnostic.manualImportConflictCount, 1);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(overlay.attendanceCoverage, []);
});

test("independent audit exact one-day import exposes original 40 without summing 41", () => {
  const manual = record(1, "2026-01-01", "2026-01-14", 40);
  const snapshot = attendanceSnapshot([{
    clientId: "synthetic-client", clinician: "Dr Lane", serviceDate: "2026-01-07",
    location: "Synthetic Room", status: "show", sourceRowHash: "synthetic-row",
  }]);
  const overlay = buildImportedSessionOverlay(context([manual]), [snapshot], 7);
  assert.deepEqual(overlay.conflictedManualSessions, [{ ...manual, status: "unknown" }]);
  assert.equal(overlay.context.sessions.reduce((sum, row) => sum + row.completed, 0), 1);
  assert.equal(overlay.context.sessions.filter(row => row.id >= 0).length, 0);
  assert.equal(selectedPeriodSessionSummary(overlay.context.sessions, [1], manual, overlay.attendanceCoverage).completedWeekly, null);
});

test("adjacent verified reports replace aggregates including visit-free dates; gaps stay unknown", () => {
  const manual = record(1, "2026-01-01", "2026-01-14", 40);
  const proof = (start: string, end: string, status: "show" | "cancelled" = "show"): LocalSnapshot => ({
    ...attendanceSnapshot([{
      clientId: start, clinician: "Dr Lane", serviceDate: start, location: "Room A",
      status, sourceRowHash: start,
    }]),
    reportCoverage: { start, end, complete: true },
  });
  const complete = buildImportedSessionOverlay(context([manual]), [proof("2026-01-01", "2026-01-07"), proof("2026-01-08", "2026-01-14")], 7);
  assert.deepEqual(complete.conflictedManualSessions, []);
  assert.equal(complete.diagnostic.manualImportOverrideCount, 40);
  assert.equal(complete.context.sessions.reduce((sum, row) => sum + row.completed, 0), 2);
  const gap = buildImportedSessionOverlay(context([manual]), [proof("2026-01-01", "2026-01-06"), proof("2026-01-08", "2026-01-14")], 7);
  assert.equal(gap.conflictedManualSessions.length, 1);
  assert.equal(gap.diagnostic.manualImportOverrideCount, 0);
  const zero = buildImportedSessionOverlay(context([manual]), [proof("2026-01-01", "2026-01-14", "cancelled")], 7);
  assert.deepEqual(zero.conflictedManualSessions, []);
  assert.equal(zero.coveredZeroSessions.length, 14);
  assert.equal(zero.context.sessions.reduce((sum, row) => sum + row.completed, 0), 0);
});

test("unmapped or other-clinician imports cannot displace manual fallback", () => {
  const manual = record(1, "2026-01-01", "2026-01-14", 40);
  const snapshot = attendanceSnapshot([{
    clientId: "other", clinician: "Dr Moss", serviceDate: "2026-01-07",
    location: "Room A", status: "show", sourceRowHash: "other",
  }]);
  const overlay = buildImportedSessionOverlay(context([manual]), [snapshot], 7);
  assert.ok(overlay.context.sessions.includes(manual));
  assert.deepEqual(overlay.conflictedManualSessions, []);
});

test("imports derive attended sessions from show rows without using billed no-shows", () => {
  const overlay = buildImportedSessionOverlay(
    context(),
    [
      attendanceSnapshot([
        {
          clientId: "client-a",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          location: "Room A",
          status: "show",
          sourceRowHash: "a1",
        },
        {
          clientId: "client-b",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          location: "Room A",
          status: "no show",
          sourceRowHash: "a2",
        },
      ]),
      billingSnapshot([
        {
          clientId: "client-b",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          totalFeeCharged: 75,
          billingCode: "NO-SHOW",
          sourceRowHash: "b1",
        },
      ]),
    ],
    7,
  );

  assert.equal(overlay.derivedSessions.length, 1);
  assert.equal(overlay.derivedSessions[0].completed, 1);
  assert.equal(overlay.diagnostic.excludedNonShowRows, 1);
  assert.equal(overlay.importedBillingActuals.length, 1);
  assert.equal(overlay.diagnostic.billedFees, 75);
});

test("repeated snapshots do not duplicate derived sessions", () => {
  const imported = attendanceSnapshot([
    {
      clientId: "client-a",
      clinician: "Dr Lane",
      serviceDate: "2026-10-01",
      location: "Room A",
      status: "show",
      sourceRowHash: "a1",
    },
  ]);
  const overlay = buildImportedSessionOverlay(
    context(),
    [imported, imported],
    7,
  );

  assert.equal(overlay.derivedSessions.length, 1);
  assert.equal(overlay.derivedSessions[0].completed, 1);
});

test("partial import overlap uses exact imports and preserves manual conflict evidence", () => {
  const overlay = buildImportedSessionOverlay(
    context([record(1, "2026-10-01", "2026-10-14", 12)]),
    [
      attendanceSnapshot([
        {
          clientId: "client-a",
          clinician: "Dr Lane",
          serviceDate: "2026-10-07",
          location: "Room A",
          status: "show",
          sourceRowHash: "a1",
        },
        {
          clientId: "client-c",
          clinician: "Dr Lane",
          serviceDate: "2026-10-15",
          location: "Room A",
          status: "show",
          sourceRowHash: "a2",
        },
      ]),
    ],
    7,
  );

  assert.equal(overlay.derivedSessions.length, 2);
  assert.deepEqual(
    overlay.derivedSessions.map((item) => item.start),
    ["2026-10-07", "2026-10-15"],
  );
  assert.equal(overlay.diagnostic.manualImportConflictCount, 1);
  assert.equal(overlay.diagnostic.manualOverlapCount, 1);
  assert.equal(overlay.diagnostic.manualImportOverrideCount, 0);
  assert.equal(overlay.conflictedManualSessions[0].completed, 12);
  assert.equal(overlay.conflictedManualSessions[0].status, "unknown");
  assert.equal(
    overlay.context.sessions.some((item) => item.id === 11),
    false,
  );
});

test("complete imported attendance coverage replaces overlapping manual actuals in the overlay", () => {
  const overlay = buildImportedSessionOverlay(
    context([record(1, "2026-10-01", "2026-10-14", 12)]),
    [
      { ...attendanceSnapshot([
        {
          clientId: "client-a",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          location: "Room A",
          status: "show",
          sourceRowHash: "a1",
        },
        {
          clientId: "client-b",
          clinician: "Dr Lane",
          serviceDate: "2026-10-14",
          location: "Room A",
          status: "show",
          sourceRowHash: "a2",
        },
      ]), reportCoverage: { start: "2026-10-01", end: "2026-10-14", complete: true } },
    ],
    7,
  );

  assert.equal(overlay.derivedSessions.length, 2);
  assert.equal(overlay.diagnostic.manualOverlapCount, 1);
  assert.equal(overlay.diagnostic.manualImportOverrideCount, 12);
  assert.equal(
    overlay.context.sessions.some((item) => item.id === 11),
    false,
  );
  assert.equal(
    overlay.context.sessions.reduce((sum, item) => sum + item.completed, 0),
    2,
  );
});

test("same-day shows collapse by default and month boundaries stay exact", () => {
  const repeatedShow = {
    clientId: "client-a",
    clinician: "Dr Lane",
    serviceDate: "2026-10-31",
    location: "Room A",
    status: "show" as const,
    sourceRowHash: "a1",
  };
  const overlay = buildImportedSessionOverlay(
    context(),
    [
      attendanceSnapshot([
        repeatedShow,
        {
          clientId: "client-a",
          clinician: "Dr Lane",
          serviceDate: "2026-10-31",
          location: "Room A",
          status: "show",
          sourceRowHash: "a2",
        },
        {
          clientId: "client-a",
          clinician: "Dr Lane",
          serviceDate: "2026-11-01",
          location: "Room A",
          status: "show",
          sourceRowHash: "a3",
        },
      ]),
    ],
    7,
  );

  assert.deepEqual(
    overlay.derivedSessions.map((item) => [item.start, item.completed]),
    [
      ["2026-10-31", 1],
      ["2026-11-01", 1],
    ],
  );
  assert.equal(overlay.diagnostic.rawAttendedRows, 3);
  assert.equal(overlay.diagnostic.collapsedDuplicateShowRows, 1);

  const workspace = emptyWorkspace("2026-10-01");
  workspace.settings.teamId = 7;
  workspace.settings.collectionPct = 100;
  const october = monthFlow(
    workspace,
    overlay.context,
    "2026-10-01",
    "2026-11-10",
  );
  assert.equal(october.sessions, 1);

  const confirmed = buildImportedSessionOverlay(
    context(),
    [
      attendanceSnapshot([
        repeatedShow,
        {
          ...repeatedShow,
          sourceRowHash: "a2",
        },
      ]),
    ],
    7,
    { [sameDayVisitKey(repeatedShow)]: 2 },
  );
  assert.deepEqual(
    confirmed.derivedSessions.map((item) => [item.start, item.completed]),
    [["2026-10-31", 2]],
  );
  assert.equal(confirmed.diagnostic.sameDayVisitOverrideCount, 1);
});

test("current month projection uses imported backfill plus weekly-average remainder", () => {
  const overlay = buildImportedSessionOverlay(
    context(),
    [
      attendanceSnapshot([
        {
          clientId: "client-a",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          location: "Room A",
          status: "show",
          sourceRowHash: "a1",
        },
      ]),
    ],
    7,
  );

  const workspace = emptyWorkspace("2026-10-01");
  workspace.settings.teamId = 7;
  workspace.settings.collectionPct = 100;
  const october = monthFlow(
    workspace,
    overlay.context,
    "2026-10-01",
    "2026-10-02",
    { fullMonthProjection: true },
  );

  assert.equal(october.sessionDataThrough, "2026-10-01");
  assert.equal(october.basisLabel, "Projection");
  assert.ok(october.sessions !== null && october.sessions > 1);
});

test("billed fees feed revenue without adding attended sessions", () => {
  const overlay = buildImportedSessionOverlay(
    context(),
    [
      attendanceSnapshot([
        {
          clientId: "client-a",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          location: "Room A",
          status: "show",
          sourceRowHash: "a1",
        },
      ]),
      billingSnapshot([
        {
          clientId: "client-a",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          totalFeeCharged: 150,
          billingCode: "90837",
          sourceRowHash: "b1",
        },
        {
          clientId: "client-b",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          totalFeeCharged: 75,
          billingCode: "NO-SHOW",
          sourceRowHash: "b2",
        },
      ]),
    ],
    7,
  );

  const workspace = emptyWorkspace("2026-10-01");
  workspace.settings.teamId = 7;
  workspace.settings.collectionPct = 100;
  const october = monthFlow(
    workspace,
    overlay.context,
    "2026-10-01",
    "2026-10-01",
  );

  assert.equal(october.sessions, 1);
  assert.equal(october.revenue, 225);
});

test("Phone-only meet-and-greet rows do not derive treatment sessions or fees", () => {
  const overlay = buildImportedSessionOverlay(
    context(),
    [
      attendanceSnapshot([
        {
          clientId: "client-phone",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          location: "Room A",
          status: "show",
          sourceRowHash: "a-phone",
        },
        {
          clientId: "client-treatment",
          clinician: "Dr Lane",
          serviceDate: "2026-10-02",
          location: "Room A",
          status: "show",
          sourceRowHash: "a-treatment",
        },
      ]),
      billingSnapshot([
        {
          clientId: "client-phone",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          totalFeeCharged: 0,
          billingCode: "Phone",
          sourceRowHash: "b-phone",
        },
        {
          clientId: "client-treatment",
          clinician: "Dr Lane",
          serviceDate: "2026-10-02",
          totalFeeCharged: 150,
          billingCode: "90837",
          sourceRowHash: "b-treatment",
        },
      ]),
    ],
    7,
  );

  assert.deepEqual(
    overlay.derivedSessions.map((item) => [item.start, item.completed]),
    [["2026-10-02", 1]],
  );
  assert.equal(overlay.importedBillingActuals.length, 1);
  assert.equal(overlay.importedBillingActuals[0].totalFeeCharged, 150);
  assert.equal(overlay.diagnostic.rawAttendedRows, 1);
  assert.equal(overlay.diagnostic.billedRows, 1);
  assert.equal(overlay.diagnostic.billedFees, 150);
});

test("attendance Phone billing code alone does not derive treatment sessions", () => {
  const overlay = buildImportedSessionOverlay(
    context(),
    [
      attendanceSnapshot([
        {
          clientId: "client-phone",
          clinician: "Dr Lane",
          serviceDate: "2026-10-01",
          location: "Room A",
          status: "show",
          billingCode: " PHONE ",
          sourceRowHash: "a-phone",
        },
        {
          clientId: "client-treatment",
          clinician: "Dr Lane",
          serviceDate: "2026-10-02",
          location: "Room A",
          status: "show",
          sourceRowHash: "a-treatment",
        },
      ]),
    ],
    7,
  );

  assert.deepEqual(
    overlay.derivedSessions.map((item) => [item.start, item.completed]),
    [["2026-10-02", 1]],
  );
  assert.equal(overlay.diagnostic.rawAttendedRows, 1);
});

test("missing and ambiguous clinician mappings exclude imported rows", () => {
  const source = context();
  source.clinicians.push(clinician(3, "Dr Moss"));
  const overlay = buildImportedSessionOverlay(
    source,
    [
      attendanceSnapshot([
        {
          clientId: "client-a",
          clinician: "Dr Unknown",
          serviceDate: "2026-10-01",
          location: "Room A",
          status: "show",
          sourceRowHash: "a1",
        },
        {
          clientId: "client-b",
          clinician: "Dr Moss",
          serviceDate: "2026-10-01",
          location: "Room A",
          status: "show",
          sourceRowHash: "a2",
        },
      ]),
    ],
    7,
  );

  assert.equal(overlay.derivedSessions.length, 0);
  assert.deepEqual(overlay.diagnostic.missingClinicianLabels, ["Dr Unknown"]);
  assert.deepEqual(overlay.diagnostic.ambiguousClinicianLabels, ["Dr Moss"]);
});
