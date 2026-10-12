import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalRetentionMetrics,
  exportLocalBackup,
  importAttendanceCsv,
  importBillingCsv,
  importLocalBackup,
  mergeSnapshot,
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
