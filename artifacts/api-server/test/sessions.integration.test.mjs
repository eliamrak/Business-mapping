import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

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
let goal, clinician, entry, initial;
before(async () => {
  goal = (
    await call("/business-goals", { name: `Session integration ${Date.now()}` })
  ).data;
  clinician = (
    await call("/clinicians", {
      label: "Integration clinician",
      goalId: goal.id,
      sessionRate: 160,
      sessionsPerWeek: 20,
      nonClinicalHoursPerWeek: 2,
      nonClinicalHourlyRate: 25,
    })
  ).data;
  entry = {
    clinicianId: clinician.id,
    start: "2026-09-07",
    end: "2026-09-20",
    completed: 56,
    desired: 70,
    cancelled: null,
    noShow: 0,
  };
  initial = { entry, requestId: randomUUID(), expectedRevision: null };
});

test("validation does not accept missing, negative, fractional or impossible data", async () => {
  for (const changes of [
    { completed: -1 },
    { completed: 2.4 },
    { desired: null },
    { start: "2026-02-30" },
    { end: "2026-09-01" },
  ]) {
    assert.equal(
      (
        await call("/session-records", {
          ...initial,
          requestId: randomUUID(),
          entry: { ...entry, ...changes },
        })
      ).status,
      400,
    );
  }
  assert.equal((await call("/session-records?goalId=invalid")).status, 400);
});
test("duplicate simultaneous requests write exactly one revision", async () => {
  const [first, retry] = await Promise.all([
    call("/session-records", initial),
    call("/session-records", initial),
  ]);
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.deepEqual(first.data, retry.data);
  assert.equal(first.data.revision, 1);
  const history = await call(`/session-records/${first.data.id}/history`);
  assert.equal(history.data.length, 1);
});
test("idempotency key cannot be reused for a changed payload", async () => {
  assert.equal(
    (
      await call("/session-records", {
        ...initial,
        entry: { ...entry, completed: 1 },
      })
    ).status,
    409,
  );
});
test("overlapping or duplicate periods are rejected, adjacent periods are allowed", async () => {
  for (const range of [
    { start: "2026-09-10", end: "2026-09-25" },
    { start: "2026-09-20", end: "2026-09-30" },
    { start: entry.start, end: entry.end },
  ]) {
    assert.equal(
      (
        await call("/session-records", {
          entry: { ...entry, ...range },
          requestId: randomUUID(),
          expectedRevision: null,
        })
      ).status,
      409,
    );
  }
  assert.equal(
    (
      await call("/session-records", {
        entry: { ...entry, start: "2026-09-21", end: "2026-10-04" },
        requestId: randomUUID(),
        expectedRevision: null,
      })
    ).status,
    200,
  );
});
test("corrections retain original history and reject stale revisions", async () => {
  const update = await call("/session-records", {
    entry: { ...entry, completed: 60 },
    requestId: randomUUID(),
    expectedRevision: 1,
  });
  assert.equal(update.status, 200);
  assert.equal(update.data.revision, 2);
  const stale = await call("/session-records", {
    entry: { ...entry, completed: 61 },
    requestId: randomUUID(),
    expectedRevision: 1,
  });
  assert.equal(stale.status, 409);
  const history = (await call(`/session-records/${update.data.id}/history`))
    .data;
  assert.equal(history.length, 2);
  assert.equal(history[0].entry.completed, 60);
  assert.equal(history[1].entry.completed, 56);
});
test("competing edits cannot silently overwrite one another", async () => {
  const results = await Promise.all(
    [62, 63].map((completed) =>
      call("/session-records", {
        entry: { ...entry, completed },
        requestId: randomUUID(),
        expectedRevision: 2,
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(
    results.find((result) => result.status === 200).data.revision,
    3,
  );
});
test("concurrent overlapping new periods are serialized", async () => {
  const results = await Promise.all(
    [
      { start: "2026-11-01", end: "2026-11-14" },
      { start: "2026-11-07", end: "2026-11-20" },
    ].map((range) =>
      call("/session-records", {
        entry: { ...entry, ...range },
        requestId: randomUUID(),
        expectedRevision: null,
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
});
test("team isolation and persistence leave compensation assumptions unchanged", async () => {
  const records = (await call(`/session-records?goalId=${goal.id}`)).data;
  assert.equal(records.length, 3);
  assert.ok(records.every((record) => record.clinicianId === clinician.id));
  assert.ok(
    !(await call("/session-records?goalId=unassigned")).data.some(
      (record) => record.clinicianId === clinician.id,
    ),
  );
  assert.deepEqual((await call(`/clinicians/${clinician.id}`)).data, clinician);
});
test("history is protected from clinician deletion", async () => {
  const result = await call(`/clinicians/${clinician.id}`, null, "DELETE");
  assert.equal(result.status, 409);
  assert.equal((await call(`/clinicians/${clinician.id}`)).status, 200);
});
test("existing share links can still be issued and revoked", async () => {
  const shared = await call(`/clinicians/${clinician.id}/generate-link`, {});
  assert.equal(shared.status, 200);
  assert.equal(
    (await call(`/clinicians/by-token/${shared.data.shareToken}`)).status,
    200,
  );
  assert.equal(
    (await call(`/clinicians/${clinician.id}/revoke-link`, {})).status,
    200,
  );
  assert.equal(
    (await call(`/clinicians/by-token/${shared.data.shareToken}`)).status,
    404,
  );
});
