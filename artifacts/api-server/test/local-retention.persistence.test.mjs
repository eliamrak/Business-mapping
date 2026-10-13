import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import net from "node:net";
import express from "express";

const require = createRequire(new URL("../package.json", import.meta.url));
const { Client } = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
)("pg");

const source = process.env.EMC_TEST_DATABASE_URL;
if (!source || !["127.0.0.1", "localhost"].includes(new URL(source).hostname))
  throw new Error(
    "Set EMC_TEST_DATABASE_URL to a loopback Postgres database. This suite creates its own disposable test database.",
  );

let admin, server, base, testDatabaseUrl, pool, testClient;
const databaseName = `emc_retention_test_${Date.now()}_${process.pid}`;

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/practice-local-import-package-v1.golden.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

const packageFor = (packageId, start, end, suffix) => ({
  format: "emc-practice-local-import-package",
  version: 1,
  packageId,
  exportedAt: "2026-10-13T15:00:00.000Z",
  collections: {
    attendance: {
      coverageStart: start,
      coverageEnd: end,
      rowCount: 3,
      rows: [
        {
          clientId: `client-${suffix}-alpha`,
          clinician: "Dr Synthetic",
          serviceDate: start,
          location: "Room TPA",
          status: "show",
        },
        {
          clientId: `client-${suffix}-alpha`,
          clinician: "Dr Synthetic",
          serviceDate: end,
          location: "Room TPA",
          status: "show",
        },
        {
          clientId: `client-${suffix}-same-day`,
          clinician: "Dr Synthetic",
          serviceDate: start,
          location: "Room TPA",
          status: "show",
        },
      ],
    },
    billing: {
      coverageStart: start,
      coverageEnd: end,
      rowCount: 2,
      rows: [
        {
          clientId: `client-${suffix}-alpha`,
          clinician: "Dr Synthetic",
          serviceDate: start,
          totalFeeCharged: 150,
          billingCode: "90837",
        },
        {
          clientId: `client-${suffix}-billed-only`,
          clinician: "Dr Synthetic",
          serviceDate: end,
          totalFeeCharged: 125,
          billingCode: "90834",
        },
      ],
    },
  },
  billingCodeMinutes: { 90837: 60, 90834: 45 },
});

async function call(
  path,
  body,
  method = body ? "POST" : "GET",
  actor = "owner@example.test",
) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      "x-synthetic-actor": actor,
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
  testDatabaseUrl = url.toString();
  execFileSync("psql", [testDatabaseUrl, "-v", "ON_ERROR_STOP=1"], {
    input: readFileSync(
      new URL(
        "../../../lib/db/migrations/006_local_retention_imports.sql",
        import.meta.url,
      ),
      "utf8",
    ),
    stdio: ["pipe", "pipe", "pipe"],
  });
  process.env.DATABASE_URL = testDatabaseUrl;
  testClient = new Client({ connectionString: testDatabaseUrl });
  await testClient.connect();
  const route = (await import("../src/routes/localRetention.ts")).default;
  ({ pool } = await import("../../../lib/db/src/index.ts"));
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use((req, res, next) => {
    res.locals.actor = req.get("x-synthetic-actor") ?? "owner@example.test";
    res.locals.role = "owner";
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

test("converted package history survives reload-style requests and aggregates", async () => {
  const first = await call("/local-retention/packages", { package: fixture() });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.status, "added");
  assert.equal(first.data.snapshots.length, 2);
  assert.equal(first.data.snapshots[0].rows.length, 4);
  assert.equal(first.data.snapshots[1].rows.length, 4);

  const reloaded = await call("/local-retention");
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.data.snapshots.length, 2);
  assert.deepEqual(reloaded.data.billingCodeMinutes, {
    90837: 60,
    90834: 45,
    "00000": 15,
  });

  const duplicate = await call("/local-retention/packages", {
    package: fixture(),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.status, "duplicate");
  assert.equal(duplicate.data.snapshots.length, 2);

  const changedSameId = fixture();
  changedSameId.collections.billing.rows[0].totalFeeCharged = 151;
  const rejectedChangedSameId = await call("/local-retention/packages", {
    package: changedSameId,
  });
  assert.equal(rejectedChangedSameId.status, 409);
  assert.equal(rejectedChangedSameId.data.status, "blocked");

  const second = await call("/local-retention/packages", {
    package: packageFor(
      "pkg-synthetic-october-second",
      "2026-10-21",
      "2026-11-03",
      "second",
    ),
  });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.status, "added");
  assert.equal(second.data.snapshots.length, 4);
  assert.equal(
    second.data.snapshots
      .filter((snapshot) => snapshot.kind === "attendance")
      .reduce((sum, snapshot) => sum + snapshot.rows.length, 0),
    7,
  );
  assert.equal(
    second.data.snapshots
      .filter((snapshot) => snapshot.kind === "billing")
      .reduce((sum, snapshot) => sum + snapshot.rows.length, 0),
    6,
  );
});

test("overlap requires explicit replacement and backup restore is durable", async () => {
  const before = await call("/local-retention");
  const overlapPackage = packageFor(
    "pkg-synthetic-october-overlap",
    "2026-10-10",
    "2026-10-24",
    "overlap",
  );
  const blocked = await call("/local-retention/packages", {
    package: overlapPackage,
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.status, "overlap");
  assert.equal((await call("/local-retention")).data.snapshots.length, 4);

  const replaced = await call("/local-retention/packages", {
    package: overlapPackage,
    replaceOverlaps: true,
  });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.data));
  assert.equal(replaced.data.status, "replaced");
  assert.equal(replaced.data.snapshots.length, 2);
  assert.ok(
    replaced.data.snapshots.every((snapshot) =>
      snapshot.id.includes("package-"),
    ),
  );

  const restored = await call(
    "/local-retention/backup",
    {
      backup: {
        format: "emc-local-retention-v1",
        exportedAt: "2026-10-13T16:00:00.000Z",
        snapshots: before.data.snapshots,
        billingCodeMinutes: before.data.billingCodeMinutes,
      },
    },
    "PUT",
  );
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal(restored.data.status, "restored");
  assert.equal((await call("/local-retention")).data.snapshots.length, 4);
});

test("separate authenticated principals cannot see each other's history", async () => {
  const otherActor = "other-owner@example.test";
  assert.equal(
    (await call("/local-retention", undefined, "GET", otherActor)).data
      .snapshots.length,
    0,
  );
  const imported = await call(
    "/local-retention/packages",
    {
      package: packageFor(
        "pkg-synthetic-other-principal",
        "2026-12-01",
        "2026-12-14",
        "other",
      ),
    },
    "POST",
    otherActor,
  );
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.snapshots.length, 2);
  assert.equal(
    (await call("/local-retention", undefined, "GET", otherActor)).data
      .snapshots.length,
    2,
  );
  assert.equal((await call("/local-retention")).data.snapshots.length, 4);
});

test("successful imports and corrections leave scoped audit history", async () => {
  const result = await testClient.query(
    `
      SELECT practice_id, action, package_id
      FROM local_retention_import_events
      ORDER BY id
    `,
  );
  assert.deepEqual(
    result.rows.map((row) => row.practice_id).sort(),
    [
      "other-owner@example.test",
      "owner@example.test",
      "owner@example.test",
      "owner@example.test",
      "owner@example.test",
      "owner@example.test",
    ].sort(),
  );
  assert.ok(result.rows.some((row) => row.action === "import_package"));
  assert.ok(result.rows.some((row) => row.action === "duplicate_package"));
  assert.ok(result.rows.some((row) => row.action === "replace_package"));
  assert.ok(result.rows.some((row) => row.action === "restore_backup"));
});
