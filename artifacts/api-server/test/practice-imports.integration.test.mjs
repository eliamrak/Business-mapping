import { test } from "node:test";
import assert from "node:assert/strict";

const base = process.env.EMC_TEST_API_URL;
if (!base || !["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error(
    "Set EMC_TEST_API_URL to the isolated local test API. Never run against production.",
  );

const call = async (path, body, method = body ? "POST" : "GET") => {
  const response = await fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: response.status === 204 ? null : await response.json(),
  };
};

const packageFor = (packageId, startDay, endDay, fee = 150) => ({
  format: "emc-practice-local-import-package",
  version: 1,
  packageId,
  exportedAt: "2026-10-13T14:00:00.000Z",
  collections: {
    attendance: {
      coverageStart: `2026-10-${String(startDay).padStart(2, "0")}`,
      coverageEnd: `2026-10-${String(endDay).padStart(2, "0")}`,
      rowCount: 3,
      rows: [
        {
          clientId: "client-alpha",
          clinician: "Dr Lane",
          serviceDate: `2026-10-${String(startDay).padStart(2, "0")}`,
          location: "Room A",
          status: "show",
        },
        {
          clientId: "client-alpha",
          clinician: "Dr Lane",
          serviceDate: `2026-10-${String(endDay).padStart(2, "0")}`,
          location: "Room A",
          status: "show",
        },
        {
          clientId: "client-alpha",
          clinician: "Dr Lane",
          serviceDate: `2026-10-${String(endDay).padStart(2, "0")}`,
          location: "Room A",
          status: "show",
        },
      ],
    },
    billing: {
      coverageStart: `2026-10-${String(startDay).padStart(2, "0")}`,
      coverageEnd: `2026-10-${String(endDay).padStart(2, "0")}`,
      rowCount: 2,
      rows: [
        {
          clientId: "client-alpha",
          clinician: "Dr Lane",
          serviceDate: `2026-10-${String(startDay).padStart(2, "0")}`,
          totalFeeCharged: fee,
          billingCode: "90837",
        },
        {
          clientId: "client-alpha",
          clinician: "Dr Lane",
          serviceDate: `2026-10-${String(endDay).padStart(2, "0")}`,
          totalFeeCharged: fee,
          billingCode: "90837",
        },
      ],
    },
  },
  billingCodeMinutes: { 90837: 60 },
});

test("converted package history persists, is idempotent, and rejects changed package IDs", async () => {
  const packageId = `pkg-synthetic-${Date.now()}`;
  const first = await call("/practice-imports/package", {
    package: packageFor(packageId, 1, 14),
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.status, "added");
  assert.equal(first.data.snapshots.length, 2);
  assert.equal(first.data.snapshots[0].rows.length, 3);

  const reloaded = await call("/practice-imports");
  assert.equal(reloaded.status, 200);
  assert.ok(
    reloaded.data.packages.some((item) => item.packageId === packageId),
  );

  const duplicate = await call("/practice-imports/package", {
    package: packageFor(packageId, 1, 14),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.status, "duplicate");

  const changed = await call("/practice-imports/package", {
    package: packageFor(packageId, 1, 14, 175),
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.data.code, "PACKAGE_ID_CHANGED_CONTENT");
});

test("overlap replacement requires preview and preserves unrelated history", async () => {
  const prefix = `pkg-overlap-${Date.now()}`;
  assert.equal(
    (
      await call("/practice-imports/package", {
        package: packageFor(`${prefix}-a`, 1, 14),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/practice-imports/package", {
        package: packageFor(`${prefix}-b`, 15, 28),
      })
    ).status,
    200,
  );
  const preview = await call("/practice-imports/package", {
    package: packageFor(`${prefix}-replacement`, 8, 21),
  });
  assert.equal(preview.status, 409);
  assert.equal(preview.data.code, "OVERLAP_REVIEW_REQUIRED");
  assert.equal(preview.data.existing.length, 2);

  const replaced = await call("/practice-imports/package", {
    package: packageFor(`${prefix}-replacement`, 8, 21),
    replaceOverlaps: true,
  });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.data.status, "replaced");
  assert.ok(
    replaced.data.snapshots.some(
      (item) =>
        item.coverageStart === "2026-10-08" &&
        item.coverageEnd === "2026-10-21",
    ),
  );
});
