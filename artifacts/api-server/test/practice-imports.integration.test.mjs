import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import net from "node:net";
import express from "express";

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
    input: readFileSync(
      new URL(
        "../../../lib/db/migrations/006_practice_import_history.sql",
        import.meta.url,
      ),
      "utf8",
    ),
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
  const duplicate = await call("/practice-imports/package", {
    package: packageFor({ packageId: "pkg-same-practice" }),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.status, "duplicate");

  const changed = await call("/practice-imports/package", {
    package: packageFor({ packageId: "pkg-same-practice", fee: 175 }),
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.data.code, "PACKAGE_ID_CHANGED_CONTENT");
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
