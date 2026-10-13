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

test("partial import overlap uses exact imported facts and drops stale aggregate manual totals", () => {
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
  assert.equal(overlay.diagnostic.manualImportOverrideCount, 12);
  assert.equal(
    overlay.context.sessions.some((item) => item.id === 11),
    false,
  );
});

test("complete imported attendance coverage replaces overlapping manual actuals in the overlay", () => {
  const overlay = buildImportedSessionOverlay(
    context([record(1, "2026-10-01", "2026-10-14", 12)]),
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
          serviceDate: "2026-10-14",
          location: "Room A",
          status: "show",
          sourceRowHash: "a2",
        },
      ]),
    ],
    7,
  );

  assert.equal(overlay.derivedSessions.length, 2);
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
