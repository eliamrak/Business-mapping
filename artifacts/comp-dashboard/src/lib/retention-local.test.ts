import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildLocalRetentionMetrics,
  buildLocalVisitReconciliation,
  exportLocalBackup,
  importAttendanceCsv,
  importBillingCsv,
  importLocalBackup,
  importLocalPackage,
  mergeSnapshot,
  mergeLocalPackage,
  replaceOverlappingPackageSnapshots,
  replaceOverlappingSnapshots,
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
  assert.deepEqual(
    metrics.attendanceByClinician.find((row) => row.clinician === "Dr Lane"),
    {
      clinician: "Dr Lane",
      shows: 2,
      clientCancelled: 1,
      noShows: 1,
      clinicianCancelled: 0,
      uniqueActiveClients: 1,
      firstObservedClients: 0,
      retainedClients: 1,
      immatureClientsExcluded: 0,
    },
  );
  assert.deepEqual(
    metrics.attendanceByClinician.find((row) => row.clinician === "Dr Moss"),
    {
      clinician: "Dr Moss",
      shows: 2,
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
  assert.doesNotMatch(source, /Local-only package workspace/);
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

test("visit reconciliation leaves same-day multiple rows reviewable", () => {
  const attendance =
    importAttendanceCsv(`Client,Clinician,Date of service,Location,Status
CID-same,Dr Lane,2026-10-01,Room A,show
CID-same,Dr Lane,2026-10-01,Room A,show`).snapshot;
  const billing =
    importBillingCsv(`Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-same,Dr Lane,150,90837
2026-10-01,CID-same,Dr Lane,150,90837`).snapshot;
  const reconciliation = buildLocalVisitReconciliation([attendance, billing]);

  assert.equal(reconciliation.matchedVisits, 0);
  assert.equal(reconciliation.ambiguousGroups, 1);
  assert.equal(reconciliation.ambiguousAttendanceRows, 2);
  assert.equal(reconciliation.ambiguousBillingRows, 2);
  assert.equal(reconciliation.rows[0].status, "ambiguous");
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

test("Practice package preserves same-day legitimate session volume", () => {
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
  assert.equal(attendance?.shows, 2);
  assert.equal(attendance?.retainedClients, 0);
  assert.equal(attendance?.uniqueActiveClients, 1);
  assert.equal(billing?.billedRows, 2);
  assert.equal(billing?.totalFeesCharged, 300);
});

test("same-day duplicate sessions are not collapsed or joined without appointment IDs", () => {
  const attendance = importAttendanceCsv(attendanceCsv).snapshot;
  const billing = importBillingCsv(billingCsv).snapshot;
  const mossAttendance = buildLocalRetentionMetrics([
    attendance,
  ]).attendanceByClinician.find((row) => row.clinician === "Dr Moss");
  const mossBilling = buildLocalRetentionMetrics([
    billing,
  ]).billingByClinician.find((row) => row.clinician === "Dr Moss");
  assert.equal(mossAttendance?.shows, 2);
  assert.equal(mossAttendance?.retainedClients, 0);
  assert.equal(mossAttendance?.firstObservedClients, 1);
  assert.equal(mossBilling?.billedRows, 2);
  assert.equal(mossBilling?.totalFeesCharged, 250);
});

test("same-day repeat shows stay session volume without becoming return retention", () => {
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

  assert.equal(lane?.shows, 2);
  assert.equal(lane?.uniqueActiveClients, 1);
  assert.equal(lane?.retainedClients, 0);
  assert.equal(lane?.firstObservedClients, 1);
  assert.equal(lane?.immatureClientsExcluded, 0);
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
  const backup = exportLocalBackup([attendance, billing], {
    "90837": 53,
    "90834": 38,
  });
  const restored = importLocalBackup(backup);

  assert.deepEqual(restored.snapshots, [attendance, billing]);
  assert.deepEqual(restored.billingCodeMinutes, { "90837": 53, "90834": 38 });
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
