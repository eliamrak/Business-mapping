import { before, after, test } from "node:test";
import { legacyConverterFixture } from "../../../verification/legacy-converter-fixture.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import net from "node:net";
import express from "express";
import { createHash } from "node:crypto";

const require = createRequire(new URL("../package.json", import.meta.url));
const { Client } = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
)("pg");
const esbuild = require("esbuild");

const source = process.env.EMC_TEST_DATABASE_URL;
if (!source || !["127.0.0.1", "localhost"].includes(new URL(source).hostname))
  throw new Error(
    "Set EMC_TEST_DATABASE_URL to a loopback Postgres database. This suite creates its own disposable test database.",
  );

let admin, server, base, pool, testClient;
const databaseName = `emc_practice_import_test_${Date.now()}_${process.pid}`;

const packageFor = ({
  packageId,
  attendanceStart = "2026-10-01",
  attendanceEnd = "2026-10-14",
  billingStart = attendanceStart,
  billingEnd = attendanceEnd,
  attendanceCode = "alpha",
  billingCode = "90837",
  fee = 150,
  minutes = { 90837: 60 },
}) => ({
  format: "emc-practice-local-import-package",
  version: 1,
  packageId,
  exportedAt: "2026-10-13T14:00:00.000Z",
  collections: {
    attendance: {
      coverageStart: attendanceStart,
      coverageEnd: attendanceEnd,
      rowCount: 2,
      rows: [
        {
          clientId: `client-${attendanceCode}`,
          clinician: "Dr Lane",
          serviceDate: attendanceStart,
          location: "Room A",
          status: "show",
        },
        {
          clientId: `client-${attendanceCode}`,
          clinician: "Dr Lane",
          serviceDate: attendanceEnd,
          location: "Room A",
          status: "show",
        },
      ],
    },
    billing: {
      coverageStart: billingStart,
      coverageEnd: billingEnd,
      rowCount: 2,
      rows: [
        {
          clientId: `client-${attendanceCode}`,
          clinician: "Dr Lane",
          serviceDate: billingStart,
          totalFeeCharged: fee,
          billingCode,
        },
        {
          clientId: `client-${attendanceCode}`,
          clinician: "Dr Lane",
          serviceDate: billingEnd,
          totalFeeCharged: fee,
          billingCode,
        },
      ],
    },
  },
  billingCodeMinutes: minutes,
});

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const rowHash = (parts) =>
  createHash("sha256").update(stableJson(parts)).digest("hex").slice(0, 16);
const normalizeClinician = (value) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();
const sameDayVisitKey = (row) =>
  rowHash([
    "same-day-visit",
    row.clientId,
    normalizeClinician(row.clinician),
    row.serviceDate,
  ]);

const sameDayPackageFor = ({
  packageId,
  location = "Room Same",
  rowCount = 2,
  fee = 150,
}) => {
  const attendanceRows = Array.from({ length: rowCount }, () => ({
    clientId: "client-same-day",
    clinician: "Dr Lane",
    serviceDate: "2026-10-10",
    location,
    status: "show",
  }));
  const billingRows = Array.from({ length: rowCount }, () => ({
    clientId: "client-same-day",
    clinician: "Dr Lane",
    serviceDate: "2026-10-10",
    totalFeeCharged: fee,
    billingCode: "90837",
  }));
  return {
    format: "emc-practice-local-import-package",
    version: 1,
    packageId,
    exportedAt: "2026-10-13T14:00:00.000Z",
    collections: {
      attendance: {
        coverageStart: "2026-10-10",
        coverageEnd: "2026-10-10",
        rowCount,
        rows: attendanceRows,
      },
      billing: {
        coverageStart: "2026-10-10",
        coverageEnd: "2026-10-10",
        rowCount,
        rows: billingRows,
      },
    },
    billingCodeMinutes: { 90837: 60 },
  };
};

async function call(
  path,
  body,
  method = body ? "POST" : "GET",
  {
    actor = "owner-a@example.test",
    practice = "practice-one@example.test",
  } = {},
) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      "x-synthetic-actor": actor,
      "x-synthetic-practice": practice,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
  };
}

before(async () => {
  const adminUrl = new URL(source);
  adminUrl.pathname = "/postgres";
  admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName}`);
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.toString();
  execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1"], {
    input: [
      "../../../lib/db/migrations/006_practice_import_history.sql",
      "../../../lib/db/migrations/007_practice_same_day_visit_overrides.sql",
    ]
      .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
      .join("\n"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  testClient = new Client({ connectionString: url.toString() });
  await testClient.connect();
  const bundledEntry = join(
    "/tmp",
    `practice-import-route-${process.pid}-${Date.now()}.cjs`,
  );
  const bundleSource = join(
    "/tmp",
    `practice-import-route-${process.pid}-${Date.now()}.ts`,
  );
  writeFileSync(
    bundleSource,
    `
      export { default } from "${new URL("../src/routes/practiceImports.ts", import.meta.url).pathname}";
      export { pool } from "${new URL("../../../lib/db/src/index.ts", import.meta.url).pathname}";
    `,
  );
  esbuild.buildSync({
    entryPoints: [bundleSource],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: bundledEntry,
  });
  const bundled = require(bundledEntry);
  const route = bundled.default;
  pool = bundled.pool;
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use((req, res, next) => {
    res.locals.actor = req.get("x-synthetic-actor") ?? "owner-a@example.test";
    res.locals.role = "owner";
    process.env.EMC_PRACTICE_ID =
      req.get("x-synthetic-practice") ?? "practice-one@example.test";
    next();
  });
  app.use("/api", route);
  const port = await new Promise((resolve) => {
    const listener = net.createServer();
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => resolve(address.port));
    });
  });
  await new Promise((resolve) => {
    server = app.listen(port, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool?.end();
  await testClient?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
  }
});

test("coverage migration preserves legacy reads and gates proof writes, then persists declared proof", async () => {
  const options = { practice: "practice-coverage@example.test" };
  const legacy = packageFor({ packageId: "pkg-legacy-coverage" });
  const imported = await call("/practice-imports/package", { package: legacy }, "POST", options);
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.ok(imported.data.snapshots.every((snapshot) => snapshot.reportCoverage === null));
  const beforeMigration = await call("/practice-imports", undefined, "GET", options);
  assert.equal(beforeMigration.status, 200);

  const declared = packageFor({ packageId: "pkg-declared-coverage" });
  const proof = { start: "2026-10-01", end: "2026-10-31", complete: true };
  declared.collections.attendance.reportCoverage = proof;
  const blocked = await call("/practice-imports/package", { package: declared }, "POST", options);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.data.code, "REPORT_COVERAGE_MIGRATION_REQUIRED");

  const migration = readFileSync(new URL("../../../lib/db/migrations/008_practice_report_coverage.sql", import.meta.url), "utf8");
  await testClient.query(migration);
  await testClient.query(migration);
  const afterMigration = await call("/practice-imports", undefined, "GET", options);
  assert.ok(afterMigration.data.snapshots.every((snapshot) => snapshot.reportCoverage === null));
  const preview = await call("/practice-imports/package", { package: declared }, "POST", options);
  assert.equal(preview.status, 409);
  assert.equal(preview.data.code, "OVERLAP_REVIEW_REQUIRED");
  const saved = await call("/practice-imports/package", { package: declared, replaceOverlaps: true }, "POST", options);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const reloaded = await call("/practice-imports", undefined, "GET", options);
  const attendance = reloaded.data.snapshots.find((snapshot) => snapshot.kind === "attendance");
  assert.deepEqual(attendance.reportCoverage, proof);
  assert.equal(attendance.coverageStart, "2026-10-01");
  assert.equal(attendance.coverageEnd, "2026-10-14");
  assert.equal(reloaded.data.packages.find((item) => item.packageId === declared.packageId).exportedAt, declared.exportedAt);
  declared.collections.attendance.reportCoverage = { ...proof, end: "2026-11-01" };
  const changedProof = await call("/practice-imports/package", { package: declared }, "POST", options);
  assert.equal(changedProof.status, 409);
  assert.equal(changedProof.data.code, "PACKAGE_ID_CHANGED_CONTENT");
});

test("same-practice authorized actors share converted history while actor stays audit-only", async () => {
  const packageId = "pkg-same-practice";
  const first = await call("/practice-imports/package", {
    package: packageFor({ packageId }),
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.status, "added");

  const secondActor = await call("/practice-imports", undefined, "GET", {
    actor: "owner-b@example.test",
    practice: "practice-one@example.test",
  });
  assert.equal(secondActor.status, 200);
  assert.equal(secondActor.data.snapshots.length, 2);
  assert.ok(
    secondActor.data.packages.some((item) => item.packageId === packageId),
  );

  const audit = await testClient.query(
    "SELECT practice_id, account_id, actor FROM practice_import_audit WHERE package_id = $1",
    [packageId],
  );
  assert.deepEqual(audit.rows, [
    {
      practice_id: "practice-one@example.test",
      account_id: "practice-one@example.test",
      actor: "owner-a@example.test",
    },
  ]);
});

test("package import accepts coordinated optional consultation metadata", async () => {
  const consultCall = (path, body) =>
    call(path, body, "POST", { practice: "consultation-metadata@example.test" });
  const packageData = packageFor({
    packageId: "pkg-consultation-metadata",
    attendanceStart: "2026-11-01",
    attendanceEnd: "2026-11-14",
  });
  packageData.collections.attendance.rows[0].billingCode = "Phone";
  packageData.collections.attendance.rows[0].visitKind = "consultation";
  packageData.collections.billing.rows[0].visitKind = "consultation";

  const imported = await consultCall("/practice-imports/package", {
    package: packageData,
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.status, "added");
  const attendance = imported.data.snapshots.find(
    (item) => item.kind === "attendance",
  );
  const billing = imported.data.snapshots.find(
    (item) => item.kind === "billing",
  );
  assert.equal(attendance.rows[0].visitKind, "consultation");
  assert.equal(attendance.rows[0].billingCode, "Phone");
  assert.equal(billing.rows[0].visitKind, "consultation");

  const invalid = packageFor({ packageId: "pkg-invalid-visit-kind" });
  invalid.collections.attendance.rows[0].visitKind = "treatment";
  const rejected = await consultCall("/practice-imports/package", {
    package: invalid,
  });
  assert.equal(rejected.status, 400);

  const leaked = packageFor({ packageId: "pkg-title-leak" });
  leaked.collections.attendance.rows[0].appointmentTitle = "Client name";
  const titleRejected = await consultCall("/practice-imports/package", {
    package: leaked,
  });
  assert.equal(titleRejected.status, 400);

  const titledBilling = packageFor({ packageId: "pkg-billing-title-leak" });
  titledBilling.collections.billing.rows[0].appointmentTitle = "Client name";
  const billingTitleRejected = await consultCall("/practice-imports/package", {
    package: titledBilling,
  });
  assert.equal(billingTitleRejected.status, 400);

  const timed = packageFor({ packageId: "pkg-time-leak" });
  timed.collections.attendance.rows[0].appointmentTime = "09:00";
  const timeRejected = await consultCall("/practice-imports/package", {
    package: timed,
  });
  assert.equal(timeRejected.status, 400);

  const timedBilling = packageFor({ packageId: "pkg-billing-time-leak" });
  timedBilling.collections.billing.rows[0].appointmentTime = "09:00";
  const billingTimeRejected = await consultCall("/practice-imports/package", {
    package: timedBilling,
  });
  assert.equal(billingTimeRejected.status, 400);
});

test("separate configured practices cannot see each other's converted history", async () => {
  const other = await call("/practice-imports", undefined, "GET", {
    actor: "owner-c@example.test",
    practice: "practice-two@example.test",
  });
  assert.equal(other.status, 200);
  assert.equal(other.data.snapshots.length, 0);

  const imported = await call(
    "/practice-imports/package",
    { package: packageFor({ packageId: "pkg-practice-two" }) },
    "POST",
    { actor: "owner-c@example.test", practice: "practice-two@example.test" },
  );
  assert.equal(imported.status, 200, JSON.stringify(imported.data));

  assert.equal(
    (
      await call("/practice-imports", undefined, "GET", {
        actor: "owner-b@example.test",
        practice: "practice-one@example.test",
      })
    ).data.snapshots.length,
    2,
  );
});

test("package import is idempotent and rejects changed content under the same ID", async () => {
  const reexported = packageFor({ packageId: "pkg-same-practice" });
  reexported.exportedAt = "2026-10-13T15:00:00.000Z";
  const duplicate = await call("/practice-imports/package", {
    package: reexported,
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.status, "duplicate");

  const changed = await call("/practice-imports/package", {
    package: packageFor({ packageId: "pkg-same-practice", fee: 175 }),
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.data.code, "PACKAGE_ID_CHANGED_CONTENT");
});

test("later backfills skip duplicate collections and add missing counterparts", async () => {
  const basePackage = packageFor({
    packageId: "pkg-backfill-base",
    attendanceStart: "2027-01-01",
    attendanceEnd: "2027-01-14",
    billingStart: "2027-01-20",
    billingEnd: "2027-01-21",
    attendanceCode: "backfill-client",
    billingCode: "90837",
  });
  const imported = await call(
    "/practice-imports/package",
    {
      package: basePackage,
    },
    "POST",
    { practice: "practice-backfill@example.test" },
  );
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.status, "added");

  const backfill = packageFor({
    packageId: "pkg-backfill-billing",
    attendanceStart: "2027-01-01",
    attendanceEnd: "2027-01-14",
    billingStart: "2027-01-01",
    billingEnd: "2027-01-14",
    attendanceCode: "backfill-client",
    billingCode: "90834",
  });
  const filled = await call(
    "/practice-imports/package",
    { package: backfill },
    "POST",
    { practice: "practice-backfill@example.test" },
  );
  assert.equal(filled.status, 200, JSON.stringify(filled.data));
  assert.equal(filled.data.status, "added");
  assert.equal(filled.data.snapshots.length, 3);
  assert.equal(
    filled.data.snapshots.filter((item) => item.kind === "attendance").length,
    1,
  );
  assert.equal(
    filled.data.snapshots.filter((item) => item.kind === "billing").length,
    2,
  );

  const audit = await testClient.query(
    "SELECT detail FROM practice_import_audit WHERE package_id = $1",
    ["pkg-backfill-billing"],
  );
  assert.equal(audit.rows[0].detail.skippedDuplicateSnapshotCount, 1);
  assert.equal(audit.rows[0].detail.attendanceRows, 0);
  assert.equal(audit.rows[0].detail.billingRows, 2);
});

test("same-day visit confirmations persist across authenticated history reloads", async () => {
  const packageData = sameDayPackageFor({
    packageId: "pkg-same-day-confirmation",
  });
  const overrideKey = sameDayVisitKey(
    packageData.collections.attendance.rows[0],
  );
  const imported = await call(
    "/practice-imports/package",
    { package: packageData },
    "POST",
    { practice: "practice-same-day@example.test" },
  );
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.deepEqual(imported.data.sameDayVisitOverrides, {});

  const saved = await call(
    "/practice-imports/same-day-visit-overrides",
    { sameDayVisitOverrides: { [overrideKey]: 2 } },
    "PUT",
    {
      actor: "owner-a@example.test",
      practice: "practice-same-day@example.test",
    },
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.sameDayVisitOverrides, {
    [overrideKey]: 2,
  });
  assert.equal(
    saved.data.snapshots
      .find((snapshot) => snapshot.kind === "attendance")
      .rows.filter((row) => row.status === "show").length,
    2,
  );
  assert.equal(
    saved.data.snapshots
      .find((snapshot) => snapshot.kind === "billing")
      .rows.reduce((sum, row) => sum + row.totalFeeCharged, 0),
    300,
  );

  const reloaded = await call("/practice-imports", undefined, "GET", {
    actor: "owner-b@example.test",
    practice: "practice-same-day@example.test",
  });
  assert.equal(reloaded.status, 200, JSON.stringify(reloaded.data));
  assert.deepEqual(reloaded.data.sameDayVisitOverrides, {
    [overrideKey]: 2,
  });

  const duplicate = await call(
    "/practice-imports/package",
    { package: packageData },
    "POST",
    { practice: "practice-same-day@example.test" },
  );
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate.data));
  assert.equal(duplicate.data.status, "duplicate");
  assert.deepEqual(duplicate.data.sameDayVisitOverrides, {
    [overrideKey]: 2,
  });

  const replacement = sameDayPackageFor({
    packageId: "pkg-same-day-confirmation-replacement",
    location: "Room Same Replacement",
  });
  const preview = await call(
    "/practice-imports/package",
    { package: replacement },
    "POST",
    { practice: "practice-same-day@example.test" },
  );
  assert.equal(preview.status, 409);
  assert.equal(preview.data.code, "OVERLAP_REVIEW_REQUIRED");
  const replaced = await call(
    "/practice-imports/package",
    { package: replacement, replaceOverlaps: true },
    "POST",
    { practice: "practice-same-day@example.test" },
  );
  assert.equal(replaced.status, 200, JSON.stringify(replaced.data));
  assert.deepEqual(replaced.data.sameDayVisitOverrides, {
    [overrideKey]: 2,
  });
  assert.equal(
    replaced.data.snapshots
      .find((snapshot) => snapshot.kind === "attendance")
      .rows.filter((row) => row.status === "show").length,
    2,
  );
  assert.equal(
    replaced.data.snapshots
      .find((snapshot) => snapshot.kind === "billing")
      .rows.reduce((sum, row) => sum + row.totalFeeCharged, 0),
    300,
  );

  const reset = await call(
    "/practice-imports/same-day-visit-overrides",
    { sameDayVisitOverrides: {} },
    "PUT",
    { practice: "practice-same-day@example.test" },
  );
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.deepEqual(reset.data.sameDayVisitOverrides, {});
  const resetReload = await call("/practice-imports", undefined, "GET", {
    actor: "owner-b@example.test",
    practice: "practice-same-day@example.test",
  });
  assert.deepEqual(resetReload.data.sameDayVisitOverrides, {});

  const reconfirmed = await call(
    "/practice-imports/same-day-visit-overrides",
    { sameDayVisitOverrides: { [overrideKey]: 2 } },
    "PUT",
    { practice: "practice-same-day@example.test" },
  );
  assert.deepEqual(reconfirmed.data.sameDayVisitOverrides, {
    [overrideKey]: 2,
  });
  const fewerRowsReplacement = sameDayPackageFor({
    packageId: "pkg-same-day-confirmation-one-row",
    location: "Room Same Replacement One Row",
    rowCount: 1,
  });
  const fewerRows = await call(
    "/practice-imports/package",
    { package: fewerRowsReplacement, replaceOverlaps: true },
    "POST",
    { practice: "practice-same-day@example.test" },
  );
  assert.equal(fewerRows.status, 200, JSON.stringify(fewerRows.data));
  assert.deepEqual(fewerRows.data.sameDayVisitOverrides, {});
  assert.equal(
    fewerRows.data.snapshots
      .find((snapshot) => snapshot.kind === "attendance")
      .rows.filter((row) => row.status === "show").length,
    1,
  );
  assert.equal(
    fewerRows.data.snapshots
      .find((snapshot) => snapshot.kind === "billing")
      .rows.reduce((sum, row) => sum + row.totalFeeCharged, 0),
    150,
  );

  const isolated = await call("/practice-imports", undefined, "GET", {
    actor: "owner-c@example.test",
    practice: "practice-same-day-other@example.test",
  });
  assert.equal(isolated.status, 200, JSON.stringify(isolated.data));
  assert.deepEqual(isolated.data.sameDayVisitOverrides, {});

  const bad = await call(
    "/practice-imports/same-day-visit-overrides",
    { sameDayVisitOverrides: { "not-a-stable-key": 2 } },
    "PUT",
    { practice: "practice-same-day@example.test" },
  );
  assert.equal(bad.status, 400);
});

test("converted legacy files persist actual codes, fees and late cancellation through strict API validation", async () => {
  const payload = legacyConverterFixture();
  const options = { practice: "legacy-converter@example.test" };
  const rejectOnly = JSON.parse(readFileSync(new URL("../../../verification/paired-reader-reject-only-probe.json", import.meta.url), "utf8"));
  const rejectedProbe = await call("/practice-imports/package", rejectOnly, "POST", options);
  assert.equal(rejectedProbe.status, 400);
  assert.equal(rejectedProbe.data.error, "Attendance coverage and row count must match its rows.");
  assert.equal((await call("/practice-imports", undefined, "GET", options)).data.snapshots.length, 0);
  const saved = await call("/practice-imports/package", { package: payload }, "POST", options);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const reloaded = await call("/practice-imports", undefined, "GET", options);
  assert.equal(reloaded.status, 200);
  const attendance = reloaded.data.snapshots.find(snapshot => snapshot.kind === "attendance");
  const billing = reloaded.data.snapshots.find(snapshot => snapshot.kind === "billing");
  assert.equal(attendance.rows[7].status, "cancelled");
  assert.equal(attendance.rows[7].cancellationSubtype, "late_cancelled");
  assert.deepEqual(billing.rows.map(row => row.billingCode), ["1", "30001", "30002", "30003", "4", "2", "PHONE", "90837", "90837", "90837"]);
  assert.deepEqual(billing.rows.map(row => row.totalFeeCharged), [125, 151, 210, 60, 44, 25, 0, 35, 0, 0]);
  assert.equal((await call("/practice-imports/package", { package: payload }, "POST", options)).data.status, "duplicate");
  const invalid = structuredClone(payload);
  invalid.packageId += "-invalid";
  invalid.collections.attendance.rows[7].status = "show";
  assert.equal((await call("/practice-imports/package", { package: invalid }, "POST", options)).status, 400);
});

test("partial overlap replacement keeps retained package metadata and code minutes", async () => {
  const basePackage = packageFor({
    packageId: "pkg-unequal-coverage-base",
    attendanceStart: "2026-11-01",
    attendanceEnd: "2026-11-28",
    billingStart: "2026-11-01",
    billingEnd: "2026-11-14",
    attendanceCode: "unequal-base",
    billingCode: "90837",
    minutes: { 90837: 60 },
  });
  assert.equal(
    (await call("/practice-imports/package", { package: basePackage })).status,
    200,
  );

  const replacement = packageFor({
    packageId: "pkg-unequal-coverage-replacement",
    attendanceStart: "2026-12-01",
    attendanceEnd: "2026-12-14",
    billingStart: "2026-11-10",
    billingEnd: "2026-11-12",
    attendanceCode: "unequal-replacement",
    billingCode: "90834",
    minutes: { 90834: 45 },
  });
  const preview = await call("/practice-imports/package", {
    package: replacement,
  });
  assert.equal(preview.status, 409);
  assert.equal(preview.data.code, "OVERLAP_REVIEW_REQUIRED");
  assert.deepEqual(
    preview.data.existing.map((item) => item.kind),
    ["billing"],
  );

  const replaced = await call("/practice-imports/package", {
    package: replacement,
    replaceOverlaps: true,
  });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.data));
  assert.equal(replaced.data.status, "replaced");
  assert.deepEqual(replaced.data.billingCodeMinutes, {
    90837: 60,
    90834: 45,
  });
  assert.ok(
    replaced.data.packages.some(
      (item) => item.packageId === "pkg-unequal-coverage-base",
    ),
  );
  assert.ok(
    replaced.data.snapshots.some(
      (item) =>
        item.kind === "attendance" &&
        item.coverageStart === "2026-11-01" &&
        item.coverageEnd === "2026-11-28",
    ),
  );
  assert.ok(
    replaced.data.snapshots.some(
      (item) =>
        item.kind === "billing" &&
        item.coverageStart === "2026-11-10" &&
        item.coverageEnd === "2026-11-12",
    ),
  );
});
