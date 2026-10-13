import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  emptyWorkspace,
  forecast,
  roomSchema,
  type Context,
} from "@workspace/practice/hub";
import {
  buildLocalRetentionMetrics,
  buildLocalVisitReconciliation,
  estimateLocalClientActivity,
  exportLocalBackup,
  importAttendanceCsv,
  importBillingCsv,
  importLocalBackup,
  importLocalPackage,
  mergeImportedLocationRooms,
  mergeSnapshot,
  mergeLocalPackage,
  replaceOverlappingPackageSnapshots,
  replaceOverlappingSnapshots,
  sameDayVisitKey,
} from "./retention-local.ts";

const attendanceCsv = `Client,Clinician,Date of service,Location,Status
CID-alpha,Dr Lane,2026-10-01,Room A,show
CID-alpha,Dr Lane,2026-10-15,Room A,show
CID-beta,Dr Lane,2026-10-02,Room B,no show
CID-gamma,Dr Lane,2026-10-03,Room B,cancelled
CID-delta,Dr Moss,2026-10-04,Room C,clinician cancelled
CID-epsilon,Dr Moss,2026-10-10,Room C,show
CID-epsilon,Dr Moss,2026-10-10,Room C,show`;

const billingCsv = `Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-alpha,Dr Lane,$150,90837
2026-10-15,CID-alpha,Dr Lane,150,90837
2026-10-02,CID-beta,Dr Lane,100,NO-SHOW
2026-10-10,CID-epsilon,Dr Moss,125,90834
2026-10-10,CID-epsilon,Dr Moss,125,90834`;

const forecastClinician = {
  id: 1,
  label: "Dr Forecast",
  goalId: null,
  sessionRate: 100,
  sessionsPerWeek: 40,
  weeksWorkedPerYear: 52.1786,
  capEnabled: false,
  capAmount: 50000,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  postCapClinicianSplit: 75,
  postCapPracticeSplit: 25,
  classification: "w2" as const,
  w2EmployerFicaPct: 7.65,
  futaSutaPct: 1,
  workersCompPct: 0.5,
  otherEmployerBurdenPct: 0.85,
};
const forecastContext: Context = {
  clinicians: [forecastClinician],
  staff: [],
  sessions: [],
};

function forecastWorkspace() {
  const workspace = emptyWorkspace("2026-10-01");
  workspace.settings.baselineMode = "manual";
  workspace.settings.baselineWeeklySessions = 20;
  workspace.settings.baselineRetentionPct = 100;
  workspace.settings.defaultInPersonPct = 100;
  workspace.settings.horizonMonths = 1;
  return workspace;
}

function attendanceSnapshot(
  csv: string,
  coverageStart: string,
  coverageEnd: string,
) {
  return {
    ...importAttendanceCsv(csv).snapshot,
    coverageStart,
    coverageEnd,
  };
}

const packageFixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../../docs/practice-local-import-package-v1.golden.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

test("local imports keep billing and attendance as separate fact tables", () => {
  const attendance = importAttendanceCsv(
    attendanceCsv,
    "2026-10-12T00:00:00Z",
  ).snapshot;
  const billing = importBillingCsv(billingCsv, "2026-10-12T00:00:00Z").snapshot;
  const metrics = buildLocalRetentionMetrics([attendance, billing], {
    "90837": 53,
    "90834": 38,
  });

  assert.equal(metrics.attendanceRows, 7);
  assert.equal(metrics.billingRows, 5);
  assert.equal(metrics.rawShowRows, 4);
  assert.equal(metrics.derivedShowVisits, 3);
  assert.equal(metrics.collapsedDuplicateShowRows, 1);
  assert.deepEqual(
    metrics.attendanceByClinician.find((row) => row.clinician === "Dr Lane"),
    {
      clinician: "Dr Lane",
      shows: 2,
      clientCancelled: 1,
      noShows: 1,
      clinicianCancelled: 0,
      uniqueActiveClients: 1,
      firstObservedClients: 1,
      retainedClients: 0,
      immatureClientsExcluded: 0,
    },
  );
  assert.deepEqual(
    metrics.attendanceByClinician.find((row) => row.clinician === "Dr Moss"),
    {
      clinician: "Dr Moss",
      shows: 1,
      clientCancelled: 0,
      noShows: 0,
      clinicianCancelled: 1,
      uniqueActiveClients: 1,
      firstObservedClients: 1,
      retainedClients: 0,
      immatureClientsExcluded: 1,
    },
  );
  assert.equal(
    metrics.billingByClinician.find((row) => row.clinician === "Dr Lane")
      ?.billedRows,
    3,
  );
  assert.equal(
    metrics.billingByClinician.find((row) => row.clinician === "Dr Lane")
      ?.totalFeesCharged,
    400,
  );
  assert.equal(
    metrics.billingByClinician.find((row) => row.clinician === "Dr Lane")
      ?.configuredMinuteRows,
    2,
  );
});

test("retention workspace copy describes saved authenticated history", () => {
  const source = readFileSync(
    new URL(
      "../components/practice/local-retention-workspace.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /Saved import history/);
  assert.match(source, /saved to authenticated practice storage/);
  assert.match(source, /Billed fees/);
  assert.match(source, /row\.reviewReason !== null/);
  assert.match(source, /not an action queue/);
  assert.doesNotMatch(source, /Local-only package workspace/);
});

test("client activity estimate uses retained pairs without treating maturity as retention", () => {
  const attendance = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-retained-a,Dr Lane,2026-01-05,Room A,show
CID-retained-a,Dr Lane,2026-01-19,Room A,show
CID-retained-a,Dr Lane,2026-02-02,Room A,show
CID-retained-b,Dr Lane,2026-02-10,Room A,show
CID-retained-b,Dr Lane,2026-03-10,Room A,show
CID-single-mature,Dr Lane,2026-01-20,Room A,show
CID-immature,Dr Lane,2026-03-25,Room A,show
CID-active,Dr Moss,2026-03-12,Room B,show`,
    "2025-12-01",
    "2026-03-31",
  );
  const estimate = estimateLocalClientActivity([attendance])!;

  assert.equal(estimate.coverageStart, "2025-12-01");
  assert.equal(estimate.coverageEnd, "2026-03-31");
  assert.equal(estimate.inactivityDays, 56);
  assert.deepEqual(estimate.eligibleInactivityMonths, ["2026-02", "2026-03"]);
  assert.equal(estimate.retainedClientPairs, 1);
  assert.equal(estimate.matureNonRetainedClientPairs, 1);
  assert.equal(estimate.immatureClientPairsExcluded, 3);
  assert.equal(estimate.leftCensoredClientPairs, 0);
  assert.equal(estimate.rightCensoredClientPairs, 3);
  assert.equal(estimate.inactiveClientTransitions, 1);
  assert.equal(estimate.activeClientMonthDenominator, 1);
  assert.equal(estimate.inactiveRelationshipTransitions, 1);
  assert.equal(estimate.activeRelationshipMonthDenominator, 1);
  assert.equal(estimate.averageInactiveClientTransitionsPerMonth, 0.5);
  assert.equal(estimate.observedAttendedSessionsPerRetainedClient, 3);
  assert.ok(estimate.observedAttendedSessionsPerMonth > 1);
  assert.ok(estimate.estimatedMonths >= 1);
  assert.equal(estimate.monthlyAttritionRate, 1);
  assert.equal(estimate.latestCompleteMonth, "2026-03");
  assert.equal(estimate.activeClientsInLatestCompleteMonth, 1);
  assert.equal(estimate.estimatedClientsLeavingPerMonth, 0.5);
});

test("client activity estimate separates immature starts from estimates", () => {
  const attendance = importAttendanceCsv(
    `Client,Clinician,Date of service,Location,Status
CID-single-a,Dr Lane,2026-01-05,Room A,show
CID-single-b,Dr Lane,2026-01-19,Room A,show
CID-no-show,Dr Lane,2026-01-20,Room A,no show`,
  ).snapshot;
  const estimate = estimateLocalClientActivity([attendance])!;

  assert.equal(estimate.retainedClientPairs, 0);
  assert.equal(estimate.immatureClientPairsExcluded, 2);
  assert.equal(estimate.monthlyAttritionRate, null);
  assert.equal(estimate.observedAttendedSessionsPerRetainedClient, null);
});

test("client inactivity estimate does not count pre-retention starts as established attrition", () => {
  const attendance = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-one-a,Dr Lane,2026-01-01,Room A,show
CID-one-b,Dr Moss,2026-01-15,Room B,show`,
    "2025-12-01",
    "2026-04-30",
  );
  const estimate = estimateLocalClientActivity([attendance])!;

  assert.equal(estimate.retainedClientPairs, 0);
  assert.equal(estimate.observedAttendedSessionsPerRetainedClient, null);
  assert.equal(estimate.observedAttendedSessionsPerMonth, null);
  assert.equal(estimate.estimatedMonths, null);
  assert.deepEqual(estimate.eligibleInactivityMonths, [
    "2026-02",
    "2026-03",
    "2026-04",
  ]);
  assert.equal(estimate.inactiveClientTransitions, 0);
  assert.equal(estimate.activeClientMonthDenominator, 0);
  assert.equal(estimate.averageInactiveClientTransitionsPerMonth, 0);
  assert.equal(estimate.monthlyAttritionPct, null);
  assert.equal(estimate.estimatedClientsLeavingPerMonth, 0);
});

test("client inactivity estimate counts the 56-day boundary and reactivation", () => {
  const attendance = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-boundary,Dr Lane,2026-01-01,Room A,show
CID-boundary,Dr Lane,2026-01-15,Room A,show
CID-boundary,Dr Lane,2026-01-29,Room A,show
CID-boundary,Dr Lane,2026-03-26,Room A,show
CID-after,Dr Lane,2026-01-01,Room A,show
CID-after,Dr Lane,2026-01-15,Room A,show
CID-after,Dr Lane,2026-01-29,Room A,show
CID-after,Dr Lane,2026-03-27,Room A,show`,
    "2025-12-01",
    "2026-04-30",
  );
  const estimate = estimateLocalClientActivity([attendance])!;

  assert.deepEqual(
    estimate.monthlyInactiveClientTransitions.map((row) => [
      row.month,
      row.inactiveClientTransitions,
      row.activeClientsAtStart,
    ]),
    [
      ["2026-02", 0, 2],
      ["2026-03", 1, 2],
      ["2026-04", 0, 2],
    ],
  );
  assert.equal(estimate.inactiveClientTransitions, 1);
  assert.equal(estimate.inactiveClientReactivations, 1);
  assert.equal(estimate.averageInactiveClientTransitionsPerMonth, 1 / 3);
  assert.ok(Math.abs(estimate.monthlyAttritionPct! - 100 / 6) < 0.000001);
});

test("client inactivity estimate ignores uncovered gaps and partial current months", () => {
  const gappedJanuary = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-gap,Dr Lane,2026-01-01,Room A,show
CID-gap,Dr Lane,2026-01-10,Room A,show`,
    "2026-01-01",
    "2026-01-31",
  );
  const gappedMarch = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-other,Dr Lane,2026-03-01,Room A,show
CID-other,Dr Lane,2026-03-10,Room A,show`,
    "2026-03-01",
    "2026-03-31",
  );

  const gappedEstimate = estimateLocalClientActivity([
    gappedJanuary,
    gappedMarch,
  ])!;
  assert.deepEqual(gappedEstimate.eligibleInactivityMonths, []);
  assert.equal(gappedEstimate.monthlyAttritionPct, null);
  assert.equal(gappedEstimate.estimatedClientsLeavingPerMonth, null);

  const partialApril = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-partial,Dr Lane,2026-01-01,Room A,show
CID-partial,Dr Lane,2026-01-10,Room A,show
CID-partial,Dr Lane,2026-01-20,Room A,show
CID-partial,Dr Lane,2026-03-20,Room A,show`,
    "2025-12-01",
    "2026-04-15",
  );
  const estimate = estimateLocalClientActivity([partialApril])!;

  assert.deepEqual(estimate.eligibleInactivityMonths, ["2026-02", "2026-03"]);
  assert.equal(estimate.inactiveClientTransitions, 1);
  assert.deepEqual(
    estimate.monthlyInactiveClientTransitions.map((row) => [
      row.month,
      row.inactiveClientTransitions,
    ]),
    [
      ["2026-02", 0],
      ["2026-03", 1],
    ],
  );
});

test("client inactivity estimate avoids first-month left-censoring artifacts", () => {
  const attendance = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-left,Dr Lane,2026-01-01,Room A,show
CID-left,Dr Lane,2026-01-15,Room A,show
CID-left,Dr Lane,2026-01-29,Room A,show`,
    "2026-01-01",
    "2026-03-31",
  );
  const estimate = estimateLocalClientActivity([attendance])!;

  assert.deepEqual(estimate.eligibleInactivityMonths, ["2026-03"]);
  assert.equal(estimate.inactiveClientTransitions, 1);
  assert.equal(estimate.activeClientMonthDenominator, 1);
  assert.equal(estimate.leftCensoredClientPairs, 1);
});

test("client inactivity estimate collapses duplicate visits and separates clinician relationships", () => {
  const attendance = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-duplicate,Dr Lane,2026-01-01,Room A,show
CID-duplicate,Dr Lane,2026-01-01,Room A,show
CID-duplicate,Dr Lane,2026-01-15,Room A,show
CID-duplicate,Dr Lane,2026-01-29,Room A,show
CID-duplicate,Dr Lane,2026-03-27,Room A,show
CID-transfer,Dr Lane,2026-01-01,Room A,show
CID-transfer,Dr Lane,2026-01-15,Room A,show
CID-transfer,Dr Lane,2026-01-29,Room A,show
CID-transfer,Dr Moss,2026-01-30,Room B,show
CID-transfer,Dr Moss,2026-02-10,Room B,show
CID-transfer,Dr Moss,2026-02-20,Room B,show`,
    "2025-12-01",
    "2026-04-30",
  );
  const estimate = estimateLocalClientActivity([attendance])!;

  assert.equal(estimate.retainedClientPairs, 3);
  assert.equal(estimate.inactiveClientTransitions, 2);
  assert.equal(estimate.inactiveClientReactivations, 1);
  assert.equal(estimate.inactiveRelationshipTransitions, 3);
  assert.equal(estimate.inactiveRelationshipReactivations, 1);
  assert.deepEqual(
    estimate.monthlyInactiveClientTransitions.map((row) => [
      row.month,
      row.inactiveClientTransitions,
    ]),
    [
      ["2026-02", 0],
      ["2026-03", 1],
      ["2026-04", 1],
    ],
  );
});

test("client activity estimate does not treat coverage gaps as complete months", () => {
  const earlyMarch = importAttendanceCsv(
    `Client,Clinician,Date of service,Location,Status
CID-retained,Dr Lane,2026-03-01,Room A,show
CID-early,Dr Lane,2026-03-10,Room A,show`,
  ).snapshot;
  const lateMarch = importAttendanceCsv(
    `Client,Clinician,Date of service,Location,Status
CID-retained,Dr Lane,2026-03-20,Room A,show
CID-late,Dr Lane,2026-03-31,Room A,show`,
  ).snapshot;
  const estimate = estimateLocalClientActivity([earlyMarch, lateMarch])!;

  assert.equal(estimate.latestCompleteMonth, null);
  assert.equal(estimate.activeClientsInLatestCompleteMonth, null);
  assert.equal(estimate.estimatedClientsLeavingPerMonth, null);
});

test("client activity estimate accepts adjacent and overlapping coverage intervals", () => {
  const firstHalf = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-retained-a,Dr Lane,2026-01-01,Room A,show
CID-retained-a,Dr Lane,2026-01-15,Room A,show`,
    "2025-11-01",
    "2026-01-15",
  );
  const secondHalf = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-retained-b,Dr Lane,2026-01-16,Room A,show
CID-retained-b,Dr Lane,2026-01-31,Room A,show`,
    "2026-01-16",
    "2026-01-31",
  );
  const overlappingStart = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-retained-c,Dr Moss,2026-02-01,Room B,show
CID-retained-c,Dr Moss,2026-02-20,Room B,show`,
    "2025-12-01",
    "2026-02-20",
  );
  const overlappingEnd = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-retained-d,Dr Moss,2026-02-15,Room B,show
CID-retained-d,Dr Moss,2026-02-28,Room B,show`,
    "2026-02-15",
    "2026-02-28",
  );

  assert.equal(
    estimateLocalClientActivity([firstHalf, secondHalf])!.latestCompleteMonth,
    "2026-01",
  );
  assert.equal(
    estimateLocalClientActivity([overlappingStart, overlappingEnd])!
      .latestCompleteMonth,
    "2026-02",
  );
});

test("client activity estimate recognizes a fully covered leap February", () => {
  const leapFebruary = attendanceSnapshot(
    `Client,Clinician,Date of service,Location,Status
CID-retained,Dr Lane,2028-02-01,Room A,show
CID-retained,Dr Lane,2028-02-29,Room A,show`,
    "2027-12-01",
    "2028-02-29",
  );

  assert.equal(
    estimateLocalClientActivity([leapFebruary])!.latestCompleteMonth,
    "2028-02",
  );
});

test("client activity monthly frequency uses covered days, not uncovered gaps", () => {
  const january = importAttendanceCsv(
    `Client,Clinician,Date of service,Location,Status
CID-retained,Dr Lane,2026-01-01,Room A,show
CID-retained,Dr Lane,2026-01-31,Room A,show
CID-january,Dr Lane,2026-01-31,Room A,show`,
  ).snapshot;
  const march = importAttendanceCsv(
    `Client,Clinician,Date of service,Location,Status
CID-retained,Dr Lane,2026-03-15,Room A,show
CID-march,Dr Lane,2026-03-01,Room A,show`,
  ).snapshot;
  const estimate = estimateLocalClientActivity([january, march])!;

  assert.ok(estimate.observedAttendedSessionsPerMonth! > 1.9);
  assert.ok(estimate.observedAttendedSessionsPerMonth! < 2.1);
  assert.equal(estimate.latestCompleteMonth, null);
});

test("visit reconciliation matches only unambiguous accumulated counterparts", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-alpha,Dr Lane,2026-10-01,Room A,show
CID-beta,Dr Lane,2026-10-02,Room A,show
CID-gamma,Dr Moss,2026-10-03,Room B,show`).snapshot;
  const billing =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-alpha,dr   lane,150,90837
2026-10-04,CID-delta,Dr Lane,125,90834`).snapshot;
  const reconciliation = buildLocalVisitReconciliation([attendance, billing]);

  assert.equal(reconciliation.matchedVisits, 1);
  assert.equal(reconciliation.totalMatchedFeesCharged, 150);
  assert.equal(reconciliation.attendanceOnlyRows, 2);
  assert.equal(reconciliation.billingOnlyRows, 1);
  assert.equal(reconciliation.ambiguousGroups, 0);
  assert.deepEqual(
    reconciliation.rows.map((row) => row.status),
    ["matched", "attendance_only", "attendance_only", "billing_only"],
  );
});

test("visit reconciliation backfills missing counterparts without double-counting", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-alpha,Dr Lane,2026-10-01,Room A,show`).snapshot;
  const billing =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-alpha,Dr Lane,150,90837`).snapshot;
  const before = buildLocalVisitReconciliation([attendance]);
  const after = buildLocalVisitReconciliation([attendance, billing]);

  assert.equal(before.matchedVisits, 0);
  assert.equal(before.attendanceOnlyRows, 1);
  assert.equal(after.matchedVisits, 1);
  assert.equal(after.attendanceOnlyRows, 0);
  assert.equal(after.billingOnlyRows, 0);
});

test("visit reconciliation resolves same-day duplicates by derived appointment count", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-same,Dr Lane,2026-10-01,Room A,show
CID-same,Dr Lane,2026-10-01,Room A,show`).snapshot;
  const oneBilling =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-same,Dr Lane,150,90837`).snapshot;
  const twoBilling =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-same,Dr Lane,150,90837
2026-10-01,CID-same,Dr Lane,150,90837`).snapshot;
  const defaultOne = buildLocalVisitReconciliation([attendance, oneBilling]);
  const defaultTwo = buildLocalVisitReconciliation([attendance, twoBilling]);
  const confirmedTwo = buildLocalVisitReconciliation([attendance, oneBilling], {
    [sameDayVisitKey(attendance.rows[0])]: 2,
  });

  assert.equal(defaultOne.matchedVisits, 1);
  assert.equal(defaultOne.ambiguousGroups, 0);
  assert.equal(defaultOne.rows[0].status, "matched");
  assert.equal(defaultTwo.matchedVisits, 1);
  assert.equal(defaultTwo.totalMatchedFeesCharged, 300);
  assert.equal(defaultTwo.ambiguousGroups, 0);
  assert.equal(confirmedTwo.matchedVisits, 0);
  assert.equal(confirmedTwo.ambiguousGroups, 1);
  assert.equal(
    confirmedTwo.rows[0].reviewReason,
    "Confirmed attended visits exceed billing rows for this client, clinician, and date.",
  );
});

test("visit reconciliation keeps statuses and coverage exceptions out of action review", () => {
  const attendance = importAttendanceCsv(
    `Client,Clinician,Date of service,Location,Status
CID-cancel,Dr Lane,2026-10-01,Room A,Cancelled
CID-clinician,Dr Lane,2026-10-02,Room A,Clinician Cancelled
CID-mixed,Dr Lane,2026-10-03,Room A,show
CID-mixed,Dr Lane,2026-10-03,Room A,no show`,
  ).snapshot;
  const billing = importBillingCsv(
    `Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-02,CID-clinician,Dr Lane,75,LATE-CANCEL
2026-10-03,CID-mixed,Dr Lane,150,90837
2026-10-20,CID-outside,Dr Lane,150,90837`,
  ).snapshot;
  const reconciliation = buildLocalVisitReconciliation([attendance, billing]);
  const metrics = buildLocalRetentionMetrics([attendance], {});
  const reviewRows = reconciliation.rows.filter(
    (row) => row.status !== "matched" && row.reviewReason !== null,
  );

  assert.equal(reconciliation.attendanceOnlyRows, 1);
  assert.equal(reconciliation.billingOnlyRows, 1);
  assert.equal(reconciliation.ambiguousGroups, 0);
  assert.equal(reviewRows.length, 0);
  assert.equal(
    reconciliation.rows.find((row) => row.clientId === "CID-outside")
      ?.reviewReason,
    null,
  );
  assert.deepEqual(
    reconciliation.rows.map((row) => [row.clientId, row.status]),
    [
      ["CID-cancel", "attendance_only"],
      ["CID-clinician", "matched"],
      ["CID-mixed", "matched"],
      ["CID-outside", "billing_only"],
    ],
  );
  assert.deepEqual(metrics.attendanceByClinician[0], {
    clinician: "Dr Lane",
    shows: 1,
    clientCancelled: 1,
    noShows: 1,
    clinicianCancelled: 1,
    uniqueActiveClients: 1,
    firstObservedClients: 1,
    retainedClients: 0,
    immatureClientsExcluded: 1,
  });
});

test("single Practice package validates collections and imports atomically", () => {
  const parsed = importLocalPackage(
    packageFixture(),
    "2026-10-13T14:05:00.000Z",
  );
  assert.equal(parsed.packageId, "pkg-synthetic-october-v1");
  assert.equal(parsed.snapshots.length, 2);
  assert.deepEqual(parsed.billingCodeMinutes, {
    "90837": 60,
    "90834": 45,
    "00000": 15,
  });
  assert.equal(parsed.snapshots[0].kind, "attendance");
  assert.equal(parsed.snapshots[1].kind, "billing");
  assert.equal(parsed.snapshots[0].coverageStart, "2026-10-01");
  assert.equal(parsed.snapshots[1].coverageEnd, "2026-10-20");

  const merged = mergeLocalPackage([], {}, parsed);
  assert.equal(merged.status, "added");
  assert.equal(merged.snapshots.length, 2);
  assert.deepEqual(merged.billingCodeMinutes, {
    "90837": 60,
    "90834": 45,
    "00000": 15,
  });
  const metrics = buildLocalRetentionMetrics(
    merged.snapshots,
    merged.billingCodeMinutes,
  );
  assert.equal(metrics.attendanceRows, 4);
  assert.equal(metrics.billingRows, 4);
  assert.equal(
    metrics.attendanceByClinician.find((row) => row.clinician === "Dr Moss")
      ?.shows,
    1,
  );
  assert.equal(
    metrics.billingByClinician.find((row) => row.clinician === "Dr Moss")
      ?.billedRows,
    1,
  );
});

test("Practice package accepts coordinated optional consultation metadata", () => {
  const packageData = packageFixture();
  packageData.collections.attendance.rows[0].billingCode = "Phone";
  packageData.collections.attendance.rows[0].appointmentTime = "09:00";
  packageData.collections.attendance.rows[0].visitKind = "consultation";
  packageData.collections.billing.rows[0].appointmentTime = null;
  packageData.collections.billing.rows[0].visitKind = "consultation";
  const parsed = importLocalPackage(packageData);

  assert.equal(parsed.snapshots[0].rows[0].visitKind, "consultation");
  assert.equal(parsed.snapshots[0].rows[0].billingCode, "Phone");
  assert.equal(parsed.snapshots[0].rows[0].appointmentTime, "09:00");
  assert.equal(parsed.snapshots[1].rows[0].visitKind, "consultation");
  assert.equal(parsed.snapshots[1].rows[0].appointmentTime, null);
  assert.throws(() => {
    const invalid = packageFixture();
    invalid.collections.attendance.rows[0].visitKind = "treatment";
    importLocalPackage(invalid);
  }, /visitKind must be consultation/);
  assert.throws(() => {
    const leaked = packageFixture();
    leaked.collections.attendance.rows[0].appointmentTitle = "Client name";
    importLocalPackage(leaked);
  }, /unsupported fields: appointmentTitle/);
});

test("Practice package rejects malformed coverage, counts, fees and identity fields", () => {
  const badCount = packageFixture();
  badCount.collections.attendance.rowCount = 99;
  assert.throws(() => importLocalPackage(badCount), /rowCount must match/);

  const badCoverage = packageFixture();
  badCoverage.collections.billing.coverageStart = "2026-10-02";
  assert.throws(
    () => importLocalPackage(badCoverage),
    /coverage does not match/,
  );

  const badFee = packageFixture();
  badFee.collections.billing.rows[0].totalFeeCharged = -1;
  assert.throws(() => importLocalPackage(badFee), /totalFeeCharged/);

  const badStatus = packageFixture();
  badStatus.collections.attendance.rows[0].status = "checked in";
  assert.throws(() => importLocalPackage(badStatus), /invalid status/);

  const identityLeak = {
    ...packageFixture(),
    sourcePath: "/Users/example/private.xlsx",
  };
  assert.throws(
    () => importLocalPackage(identityLeak),
    /unsupported fields: sourcePath/,
  );

  const rowIdentityLeak = packageFixture();
  rowIdentityLeak.collections.attendance.rows[0] = {
    ...rowIdentityLeak.collections.attendance.rows[0],
    clientName: "Synthetic Name",
  };
  assert.throws(
    () => importLocalPackage(rowIdentityLeak),
    /unsupported fields: clientName/,
  );

  const unreadableClinicianKey = packageFixture();
  unreadableClinicianKey.collections.attendance.rows[0] = {
    ...unreadableClinicianKey.collections.attendance.rows[0],
    clinicianId: "clinician-private-key",
  };
  assert.throws(
    () => importLocalPackage(unreadableClinicianKey),
    /unsupported fields: clinicianId/,
  );

  const crosswalkLeak = {
    ...packageFixture(),
    crosswalk: { "client-alpha": "Synthetic Name" },
  };
  assert.throws(
    () => importLocalPackage(crosswalkLeak),
    /unsupported fields: crosswalk/,
  );
});

test("Practice package skips duplicate snapshots while allowing backfilled counterparts", () => {
  const parsed = importLocalPackage(
    packageFixture(),
    "2026-10-13T14:05:00.000Z",
  );
  const first = mergeLocalPackage([], {}, parsed);
  assert.equal(first.status, "added");
  const duplicate = mergeLocalPackage(
    first.snapshots,
    first.billingCodeMinutes,
    parsed,
  );
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.snapshots.length, 2);

  const mixed = mergeLocalPackage([parsed.snapshots[0]], {}, parsed);
  assert.equal(mixed.status, "added");
  assert.equal(mixed.snapshots.length, 2);
  assert.deepEqual(mixed.snapshots, [parsed.snapshots[0], parsed.snapshots[1]]);
});

test("Practice package failures do not mutate current local state", () => {
  const existing = importAttendanceCsv(attendanceCsv).snapshot;
  const state = {
    snapshots: [existing],
    billingCodeMinutes: { "90837": 60 },
  };
  const before = JSON.stringify(state);
  const invalid = packageFixture();
  invalid.collections.attendance.rows[0].serviceDate = "2026-02-30";
  assert.throws(() => importLocalPackage(invalid), /valid YYYY-MM-DD date/);
  assert.equal(JSON.stringify(state), before);

  const mixed = mergeLocalPackage(state.snapshots, state.billingCodeMinutes, {
    ...importLocalPackage(packageFixture()),
    snapshots: [existing, importLocalPackage(packageFixture()).snapshots[1]],
  });
  assert.equal(mixed.status, "added");
  assert.equal(JSON.stringify(state), before);
});

test("Practice package overlap is explicit and replacement preserves unrelated snapshots", () => {
  const wideAttendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-old,Dr Lane,2026-09-20,Room A,show
CID-old,Dr Lane,2026-10-10,Room A,show`).snapshot;
  const wideBilling =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-09-20,CID-old,Dr Lane,150,90837
2026-10-10,CID-old,Dr Lane,150,90837`).snapshot;
  const unrelated =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-nov,Dr Lane,2026-11-01,Room A,show`).snapshot;
  const parsed = importLocalPackage(packageFixture());
  const current = [wideAttendance, wideBilling, unrelated];
  const overlap = mergeLocalPackage(current, { "00000": 15 }, parsed);
  assert.equal(overlap.status, "overlap");
  if (overlap.status !== "overlap") throw new Error("Expected overlap.");
  assert.equal(overlap.snapshots, current);
  assert.equal(overlap.existing.length, 2);
  assert.ok(
    overlap.warnings.some((warning) =>
      warning.includes("will remove dates outside"),
    ),
  );

  const replaced = replaceOverlappingPackageSnapshots(
    current,
    { "00000": 15 },
    overlap.incoming,
    parsed.billingCodeMinutes,
  );
  assert.equal(replaced.snapshots.length, 3);
  assert.ok(replaced.snapshots.includes(unrelated));
  assert.deepEqual(replaced.billingCodeMinutes, {
    "00000": 15,
    "90837": 60,
    "90834": 45,
  });
  assert.equal(
    buildLocalRetentionMetrics(replaced.snapshots, replaced.billingCodeMinutes)
      .attendanceRows,
    5,
  );
});

test("CSV importer accepts converter-compatible randomID and date aliases", () => {
  const attendance =
    importAttendanceCsv(`randomID,Clinician,date,Location,Status
CID-alias,Dr Alias,2026-10-01,Room A,show`).snapshot;
  const billing =
    importBillingCsv(`date,randomID,Clinician,Total Fee,Billing Code
2026-10-01,CID-alias,Dr Alias,150,90837`).snapshot;
  assert.equal(attendance.rows[0].clientId, "CID-alias");
  assert.equal(attendance.rows[0].serviceDate, "2026-10-01");
  assert.equal(billing.rows[0].clientId, "CID-alias");
  assert.equal(billing.rows[0].serviceDate, "2026-10-01");
});

test("imported attendance locations can backfill reviewable rooms idempotently", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-alpha,Dr Lane,2026-10-01,  Room A  ,show
CID-beta,Dr Lane,2026-10-02,room   a,no show
CID-gamma,Dr Moss,2026-10-03,Telehealth,show
CID-delta,Dr Moss,2026-10-04,,show`).snapshot;
  const workspace = {
    settings: { forecastStart: "2026-10-01" },
    rooms: [
      {
        id: "manual-room",
        name: "Room B",
        archived: false,
        notes: "Keep my settings",
        planningOnly: false,
        start: "2026-09-01",
        end: null,
        sourceAttachmentId: null,
        locationId: null,
        weeklyHours: 32,
        sessionMinutes: 45,
        usablePct: 75,
        telehealthUsesRoom: true,
        usage: "dedicated" as const,
        dedicatedClinicianId: 12,
        assignments: [],
        skippedWeeks: [],
        blocks: [],
      },
    ],
  };
  let nextId = 0;
  const first = mergeImportedLocationRooms(
    workspace,
    [attendance],
    () => `new-room-${++nextId}`,
  );
  assert.deepEqual(
    first.addedRooms.map((room) => room.name),
    ["Room A", "Telehealth"],
  );
  assert.equal(first.addedRooms[0].planningOnly, true);
  assert.equal(first.addedRooms[0].weeklyHours, 0);
  assert.equal(first.addedRooms[0].telehealthUsesRoom, false);
  assert.match(first.addedRooms[1].notes, /physical room, telehealth label/);
  assert.deepEqual(first.workspace.rooms[0], workspace.rooms[0]);

  const second = mergeImportedLocationRooms(
    first.workspace,
    [attendance],
    () => {
      throw new Error("no additional IDs should be needed");
    },
  );
  assert.equal(second.addedRooms.length, 0);
  assert.equal(second.workspace.rooms.length, 3);
});

test("imported attendance locations preserve existing room names case-insensitively", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-alpha,Dr Lane,2026-10-01, room   a ,show
CID-beta,Dr Lane,2026-10-02,Room C,show`).snapshot;
  const workspace = {
    settings: { forecastStart: "2026-10-01" },
    rooms: [
      {
        id: "manual-room-a",
        name: "Room A",
        archived: false,
        notes: "Manual settings stay put",
        planningOnly: false,
        start: "2026-09-01",
        end: null,
        sourceAttachmentId: null,
        locationId: null,
        weeklyHours: 40,
        sessionMinutes: 60,
        usablePct: 85,
        telehealthUsesRoom: false,
        usage: "shared" as const,
        dedicatedClinicianId: null,
        assignments: [],
        skippedWeeks: [],
        blocks: [],
      },
    ],
  };

  const result = mergeImportedLocationRooms(
    workspace,
    [attendance],
    () => "room-c",
  );
  assert.deepEqual(
    result.addedRooms.map((room) => room.name),
    ["Room C"],
  );
  assert.deepEqual(result.workspace.rooms[0], workspace.rooms[0]);
});

test("imported attendance locations do not cap forecast room capacity", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-alpha,Dr Lane,2026-10-01,Room A,show`).snapshot;
  const withoutRooms = forecastWorkspace();
  const importedOnly = mergeImportedLocationRooms(
    withoutRooms,
    [attendance],
    () => randomUUID(),
  ).workspace;

  assert.equal(importedOnly.rooms.length, 1);
  assert.equal(importedOnly.rooms[0].planningOnly, true);
  assert.equal(importedOnly.rooms[0].weeklyHours, 0);
  assert.equal(
    forecast(importedOnly, forecastContext)[0].values.sessions,
    forecast(withoutRooms, forecastContext)[0].values.sessions,
  );
  assert.equal(
    forecast(importedOnly, forecastContext)[0].values.roomCapacity,
    null,
  );

  const manualRoom = forecastWorkspace();
  manualRoom.rooms = [
    roomSchema.parse({
      id: randomUUID(),
      name: "Manual Room",
      start: "2026-10-01",
      weeklyHours: 5,
      usablePct: 100,
    }),
  ];
  const withManualRoom = mergeImportedLocationRooms(
    manualRoom,
    [attendance],
    () => randomUUID(),
  ).workspace;

  assert.equal(withManualRoom.rooms.length, 2);
  assert.equal(withManualRoom.rooms[0].planningOnly, false);
  assert.equal(withManualRoom.rooms[0].weeklyHours, 5);
  assert.equal(withManualRoom.rooms[1].planningOnly, true);
  assert.equal(
    forecast(withManualRoom, forecastContext)[0].values.sessions,
    forecast(manualRoom, forecastContext)[0].values.sessions,
  );
  assert.equal(
    forecast(withManualRoom, forecastContext)[0].values.roomCapacity,
    forecast(manualRoom, forecastContext)[0].values.roomCapacity,
  );
});

test("Practice package collapses same-day show rows until an extra visit is confirmed", () => {
  const packageData = packageFixture();
  packageData.packageId = "pkg-same-day-synthetic";
  packageData.collections.attendance = {
    coverageStart: "2026-10-10",
    coverageEnd: "2026-10-10",
    rowCount: 2,
    rows: [
      {
        clientId: "client-same",
        clinician: "Dr Lane",
        serviceDate: "2026-10-10",
        location: "Room A",
        status: "show",
      },
      {
        clientId: "client-same",
        clinician: "Dr Lane",
        serviceDate: "2026-10-10",
        location: "Room A",
        status: "show",
      },
    ],
  };
  packageData.collections.billing = {
    coverageStart: "2026-10-10",
    coverageEnd: "2026-10-10",
    rowCount: 2,
    rows: [
      {
        clientId: "client-same",
        clinician: "Dr Lane",
        serviceDate: "2026-10-10",
        totalFeeCharged: 150,
        billingCode: "90837",
      },
      {
        clientId: "client-same",
        clinician: "Dr Lane",
        serviceDate: "2026-10-10",
        totalFeeCharged: 150,
        billingCode: "90837",
      },
    ],
  };
  const parsed = importLocalPackage(packageData);
  const metrics = buildLocalRetentionMetrics(
    parsed.snapshots,
    parsed.billingCodeMinutes,
  );
  const attendance = metrics.attendanceByClinician.find(
    (row) => row.clinician === "Dr Lane",
  );
  const billing = metrics.billingByClinician.find(
    (row) => row.clinician === "Dr Lane",
  );
  assert.equal(metrics.rawShowRows, 2);
  assert.equal(metrics.derivedShowVisits, 1);
  assert.equal(metrics.collapsedDuplicateShowRows, 1);
  assert.equal(attendance?.shows, 1);
  assert.equal(attendance?.retainedClients, 0);
  assert.equal(attendance?.uniqueActiveClients, 1);
  assert.equal(billing?.billedRows, 2);
  assert.equal(billing?.totalFeesCharged, 300);

  const overrideKey = sameDayVisitKey(parsed.snapshots[0].rows[0]);
  const confirmed = buildLocalRetentionMetrics(
    parsed.snapshots,
    parsed.billingCodeMinutes,
    { [overrideKey]: 2 },
  );
  assert.equal(
    confirmed.attendanceByClinician.find((row) => row.clinician === "Dr Lane")
      ?.shows,
    2,
  );
  assert.equal(confirmed.collapsedDuplicateShowRows, 0);
});

test("same-day duplicate shows collapse by default but billing line items stay separate", () => {
  const attendance = importAttendanceCsv(attendanceCsv).snapshot;
  const billing = importBillingCsv(billingCsv).snapshot;
  const mossAttendance = buildLocalRetentionMetrics([
    attendance,
  ]).attendanceByClinician.find((row) => row.clinician === "Dr Moss");
  const mossBilling = buildLocalRetentionMetrics([
    billing,
  ]).billingByClinician.find((row) => row.clinician === "Dr Moss");
  assert.equal(mossAttendance?.shows, 1);
  assert.equal(mossAttendance?.retainedClients, 0);
  assert.equal(mossAttendance?.firstObservedClients, 1);
  assert.equal(mossBilling?.billedRows, 2);
  assert.equal(mossBilling?.totalFeesCharged, 250);
});

test("Phone-only meet-and-greets stay raw but do not become treatment metrics", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-phone,Dr Lane,2026-10-01,Room A,show
CID-treatment,Dr Lane,2026-10-02,Room A,show
CID-treatment,Dr Lane,2026-10-16,Room A,show
CID-treatment,Dr Lane,2026-10-30,Room A,show`).snapshot;
  const billing =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-phone,Dr Lane,0,Phone
2026-10-02,CID-treatment,Dr Lane,150,90837
2026-10-16,CID-treatment,Dr Lane,150,90837
2026-10-30,CID-treatment,Dr Lane,150,90837`).snapshot;
  const metrics = buildLocalRetentionMetrics([attendance, billing], {
    Phone: 15,
    "90837": 53,
  });
  const attendanceMetric = metrics.attendanceByClinician[0];
  const billingMetric = metrics.billingByClinician[0];
  const reconciliation = buildLocalVisitReconciliation([attendance, billing]);

  assert.equal(metrics.attendanceRows, 4);
  assert.equal(metrics.billingRows, 4);
  assert.equal(metrics.rawShowRows, 4);
  assert.equal(metrics.derivedShowVisits, 3);
  assert.equal(attendanceMetric.shows, 3);
  assert.equal(attendanceMetric.retainedClients, 1);
  assert.equal(billingMetric.billedRows, 3);
  assert.equal(billingMetric.configuredMinuteRows, 3);
  assert.equal(billingMetric.totalFeesCharged, 450);
  assert.equal(reconciliation.matchedVisits, 3);
  assert.equal(reconciliation.rows.length, 4);
  assert.equal(
    reconciliation.rows.find((row) => row.clientId === "CID-phone")
      ?.reviewReason,
    null,
  );
});

test("explicit consultation attendance stays out of reconciliation action rows", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-consult,Dr Lane,2026-10-01,Room A,show
CID-consult-only,Dr Lane,2026-10-03,Room A,show
CID-mixed,Dr Lane,2026-10-02,Room A,show
CID-mixed,Dr Lane,2026-10-02,Room A,show`).snapshot;
  attendance.rows[0].visitKind = "consultation";
  attendance.rows[1].visitKind = "consultation";
  attendance.rows[2].visitKind = "consultation";
  const billing =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-consult,Dr Lane,150,90837
2026-10-03,CID-other,Dr Lane,150,90837
2026-10-02,CID-mixed,Dr Lane,150,90837`).snapshot;
  const metrics = buildLocalRetentionMetrics([attendance, billing]);
  const reconciliation = buildLocalVisitReconciliation([attendance, billing]);

  assert.equal(metrics.rawShowRows, 4);
  assert.equal(metrics.derivedShowVisits, 1);
  assert.equal(metrics.attendanceByClinician[0].shows, 1);
  assert.equal(reconciliation.matchedVisits, 1);
  assert.equal(
    reconciliation.rows.find((row) => row.clientId === "CID-consult")?.status,
    "billing_only",
  );
  assert.equal(
    reconciliation.rows.find((row) => row.clientId === "CID-mixed")?.status,
    "matched",
  );
  const consultOnly = reconciliation.rows.find(
    (row) => row.clientId === "CID-consult-only",
  );
  assert.equal(consultOnly?.status, "matched");
  assert.equal(consultOnly?.reviewReason, null);
});

test("mixed Phone and treatment billing preserves same-day treatment evidence", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-mixed,Dr Lane,2026-10-01,Room A,show
CID-mixed,Dr Lane,2026-10-01,Room A,show
CID-mixed,Dr Lane,2026-10-15,Room A,show
CID-mixed,Dr Lane,2026-10-29,Room A,show`).snapshot;
  const billing =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-mixed,Dr Lane,0,Phone
2026-10-01,CID-mixed,Dr Lane,150,90837
2026-10-15,CID-mixed,Dr Lane,150,90837
2026-10-29,CID-mixed,Dr Lane,150,90837`).snapshot;
  const metrics = buildLocalRetentionMetrics([attendance, billing]);
  const reconciliation = buildLocalVisitReconciliation([attendance, billing]);

  assert.equal(metrics.rawShowRows, 4);
  assert.equal(metrics.derivedShowVisits, 3);
  assert.equal(metrics.attendanceByClinician[0].retainedClients, 1);
  assert.equal(metrics.billingByClinician[0].billedRows, 3);
  assert.equal(reconciliation.matchedVisits, 3);
  assert.equal(reconciliation.ambiguousGroups, 0);
});

test("same-day repeat shows collapse without becoming return retention", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-same,Dr Lane,2026-10-01,Room A,show
CID-same,Dr Lane,2026-10-01,Room A,show`).snapshot;
  const billing =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-20,CID-later,Dr Lane,150,90837`).snapshot;
  const lane = buildLocalRetentionMetrics([
    attendance,
    billing,
  ]).attendanceByClinician.find((row) => row.clinician === "Dr Lane");

  assert.equal(lane?.shows, 1);
  assert.equal(lane?.uniqueActiveClients, 1);
  assert.equal(lane?.retainedClients, 0);
  assert.equal(lane?.firstObservedClients, 1);
  assert.equal(lane?.immatureClientsExcluded, 0);
});

test("same-day review preserves mixed statuses and clinician boundaries", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-same,Dr Lane,2026-10-01,Room A,show
CID-same,Dr Lane,2026-10-01,Room B,show
CID-same,Dr Moss,2026-10-01,Room C,show
CID-same,Dr Lane,2026-10-01,Room A,cancelled`).snapshot;
  const base = buildLocalRetentionMetrics([attendance]);
  assert.equal(base.rawShowRows, 3);
  assert.equal(base.derivedShowVisits, 2);
  assert.equal(base.collapsedDuplicateShowRows, 1);
  assert.equal(
    base.attendanceByClinician.find((row) => row.clinician === "Dr Lane")
      ?.shows,
    1,
  );
  assert.equal(
    base.attendanceByClinician.find((row) => row.clinician === "Dr Lane")
      ?.clientCancelled,
    1,
  );
  assert.equal(
    base.attendanceByClinician.find((row) => row.clinician === "Dr Moss")
      ?.shows,
    1,
  );

  const laneShow = attendance.rows.find(
    (row) => row.status === "show" && row.clinician === "Dr Lane",
  )!;
  const confirmed = buildLocalRetentionMetrics(
    [attendance],
    {},
    {
      [sameDayVisitKey(laneShow)]: 2,
    },
  );
  assert.equal(confirmed.derivedShowVisits, 3);
  assert.equal(
    confirmed.attendanceByClinician.find((row) => row.clinician === "Dr Lane")
      ?.shows,
    2,
  );
});

test("unknown status and missing required columns block import", () => {
  assert.throws(
    () =>
      importAttendanceCsv(
        "Client,Clinician,Date of service,Status\nA,B,2026-10-01,left voicemail",
      ),
    /Unknown attendance status/,
  );
  assert.throws(
    () => importBillingCsv("Date of Service,Client,Total Fee\n2026-10-01,A,1"),
    /Missing required columns: clinician/,
  );
});

test("identical re-import is idempotent and partial overlap requires choice", () => {
  const first = importBillingCsv(billingCsv, "2026-10-12T00:00:00Z").snapshot;
  const added = mergeSnapshot([], first);
  assert.equal(added.status, "added");
  const duplicate = mergeSnapshot(added.snapshots, first);
  assert.equal(duplicate.status, "duplicate");

  const overlap = importBillingCsv(`Date of Service,Client,Clinician,Total Fee
2026-10-15,CID-alpha,Dr Lane,150
2026-10-29,CID-zeta,Dr Lane,150`).snapshot;
  const pending = mergeSnapshot(duplicate.snapshots, overlap);
  assert.equal(pending.status, "overlap");
  if (pending.status !== "overlap") throw new Error("Expected overlap.");
  const replaced = replaceOverlappingSnapshots(
    pending.snapshots,
    pending.incoming,
  );
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].sourceHash, overlap.sourceHash);
});

test("local parsing and metrics do not use network or browser storage", () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (() => {
    calls.push("fetch");
    throw new Error("network should not be used");
  }) as typeof fetch;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        calls.push("getItem");
        return null;
      },
      setItem() {
        calls.push("setItem");
      },
    },
  });
  try {
    const attendance = importAttendanceCsv(attendanceCsv).snapshot;
    const billing = importBillingCsv(billingCsv).snapshot;
    buildLocalRetentionMetrics([attendance, billing], {});
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = originalFetch;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("local backup restore validates and sanitizes exported shape", () => {
  const attendance = importAttendanceCsv(
    attendanceCsv,
    "2026-10-12T00:00:00Z",
  ).snapshot;
  const billing = importBillingCsv(billingCsv, "2026-10-12T00:00:00Z").snapshot;
  attendance.rows[0].appointmentTime = "09:00";
  attendance.rows[0].billingCode = "Phone";
  attendance.rows[0].visitKind = "consultation";
  billing.rows[0].appointmentTime = null;
  billing.rows[0].visitKind = "consultation";
  const backup = exportLocalBackup(
    [attendance, billing],
    {
      "90837": 53,
      "90834": 38,
    },
    {
      "0123456789abcdef": 2,
    },
  );
  const restored = importLocalBackup(backup);

  assert.deepEqual(restored.snapshots, [attendance, billing]);
  assert.deepEqual(restored.billingCodeMinutes, { "90837": 53, "90834": 38 });
  assert.deepEqual(restored.sameDayVisitOverrides, {
    "0123456789abcdef": 2,
  });
});

test("local backup restore rejects duplicate same-kind snapshots", () => {
  const attendance = importAttendanceCsv(
    attendanceCsv,
    "2026-10-12T00:00:00Z",
  ).snapshot;
  const backup = exportLocalBackup([attendance, attendance], {});

  assert.throws(() => importLocalBackup(backup), /duplicates snapshot/);
});

test("local backup restore rejects overlapping same-kind snapshots", () => {
  const first =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-alpha,Dr Lane,2026-10-01,Room A,show
CID-beta,Dr Lane,2026-10-10,Room A,show`).snapshot;
  const second =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-gamma,Dr Lane,2026-10-10,Room B,show
CID-delta,Dr Lane,2026-10-20,Room B,show`).snapshot;
  const backup = exportLocalBackup([first, second], {});

  assert.throws(() => importLocalBackup(backup), /overlaps snapshot/);
});

test("local backup restore accepts non-overlapping same-kind snapshots", () => {
  const first =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-alpha,Dr Lane,2026-10-01,Room A,show`).snapshot;
  const second =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-beta,Dr Lane,2026-10-20,Room B,show`).snapshot;
  const backup = exportLocalBackup([first, second], {});
  const restored = importLocalBackup(backup);

  assert.deepEqual(restored.snapshots, [first, second]);
});

test("local backup restore allows attendance and billing coverage to coexist", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-alpha,Dr Lane,2026-10-01,Room A,show`).snapshot;
  const billing =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-alpha,Dr Lane,150,90837`).snapshot;
  const backup = exportLocalBackup([attendance, billing], { "90837": 53 });
  const restored = importLocalBackup(backup);

  assert.deepEqual(restored.snapshots, [attendance, billing]);
  assert.deepEqual(restored.billingCodeMinutes, { "90837": 53 });
});

test("local backup restore rejects invalid snapshots and billing-code minutes", () => {
  const attendance = importAttendanceCsv(
    attendanceCsv,
    "2026-10-12T00:00:00Z",
  ).snapshot;
  const backup = exportLocalBackup([attendance], { "90837": 53 });

  assert.throws(
    () =>
      importLocalBackup({
        ...backup,
        snapshots: [
          {
            ...attendance,
            rows: [{ ...attendance.rows[0], status: "left voicemail" }],
          },
        ],
      }),
    /invalid status/,
  );
  assert.throws(
    () =>
      importLocalBackup({
        ...backup,
        snapshots: [
          {
            ...attendance,
            rows: [{ ...attendance.rows[0], serviceDate: "2026-02-30" }],
          },
        ],
      }),
    /valid YYYY-MM-DD date/,
  );
  assert.throws(
    () =>
      importLocalBackup({
        ...backup,
        billingCodeMinutes: { "90837": -5 },
      }),
    /billing-code minutes/,
  );
  assert.throws(
    () =>
      importLocalBackup({
        ...backup,
        sameDayVisitOverrides: { "not-a-stable-key": 2 },
      }),
    /same-day visit override keys/,
  );
  assert.throws(
    () =>
      importLocalBackup({
        ...backup,
        sameDayVisitOverrides: { "0123456789abcdef": 1.5 },
      }),
    /same-day visit override counts/,
  );
});

test("local backup restore rejects invalid billing fees before returning snapshots", () => {
  const billing = importBillingCsv(billingCsv, "2026-10-12T00:00:00Z").snapshot;
  const backup = exportLocalBackup([billing], { "90837": 53 });

  assert.throws(
    () =>
      importLocalBackup({
        ...backup,
        snapshots: [
          {
            ...billing,
            rows: [{ ...billing.rows[0], totalFeeCharged: -1 }],
          },
        ],
      }),
    /totalFeeCharged/,
  );
  assert.throws(
    () =>
      importLocalBackup({
        ...backup,
        snapshots: [
          {
            ...billing,
            coverageEnd: "2026-12-31",
          },
        ],
      }),
    /coverage does not match/,
  );
});
