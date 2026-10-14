import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  emptyWorkspace,
  proposalSchema,
  periodSchema,
  eventSchema,
  workspaceSchema,
} from "../src/hub/index.ts";

const root = path.resolve(new URL("../../..", import.meta.url).pathname);
const require = createRequire(
  path.join(root, "artifacts/api-server/package.json"),
);
const { build } = require("esbuild");

// Bundle the production router, replacing only its database boundary with synthetic rows.
async function fixture() {
  const rows = {
    workspace: [],
    history: [],
    clinicians: [],
    staff: [],
    sessions: [],
    attachments: [],
  };
  const database = {
    select() {
      let table, predicate;
      const query = {
        from(value) {
          table = value.name;
          return query;
        },
        where(value) {
          predicate = value;
          return query;
        },
        orderBy() {
          return query;
        },
        limit() {
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve(
            structuredClone(
              rows[table].filter(
                (row) =>
                  !predicate || row[predicate.column.key] === predicate.value,
              ),
            ),
          ).then(resolve, reject);
        },
      };
      return query;
    },
    insert(table) {
      return {
        values(value) {
          const persist = () => {
            const row = structuredClone(value);
            if (table.name === "history") row.createdAt = new Date();
            rows[table.name].push(row);
          };
          return {
            onConflictDoUpdate({ set }) {
              if (rows[table.name].length)
                rows[table.name][0] = { id: 1, ...structuredClone(set) };
              else persist();
              return Promise.resolve();
            },
            then(resolve, reject) {
              persist();
              return Promise.resolve().then(resolve, reject);
            },
          };
        },
      };
    },
    update(table) {
      return {
        set(value) {
          return {
            where() {
              Object.assign(rows[table.name][0], structuredClone(value));
              return Promise.resolve();
            },
          };
        },
      };
    },
    async execute() {},
    async transaction(callback) {
      const before = structuredClone(rows);
      try {
        return await callback(database);
      } catch (error) {
        Object.assign(rows, before);
        throw error;
      }
    },
  };
  const key = `focused-plan-contract-${randomUUID()}`;
  globalThis[key] = database;
  const dir = mkdtempSync(path.join(tmpdir(), "focused-plan-contract-"));
  const outfile = path.join(dir, "router.cjs");
  await build({
    entryPoints: [path.join(root, "artifacts/api-server/src/routes/hub.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
    plugins: [
      {
        name: "synthetic-database",
        setup(build) {
          build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: "db",
            namespace: "synthetic",
          }));
          build.onResolve({ filter: /^drizzle-orm$/ }, () => ({
            path: "drizzle",
            namespace: "synthetic",
          }));
          build.onResolve({ filter: /spreadsheet-preview$/ }, () => ({
            path: "spreadsheet",
            namespace: "synthetic",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "synthetic" },
            ({ path: name }) => ({
              contents:
                name === "spreadsheet"
                  ? "export const spreadsheetPreview = () => { throw new Error('Outside this contract'); };"
                  : name === "drizzle"
                    ? "export const eq = (column,value) => ({column,value}); export const and = (...values) => values; export const desc = value => value; export const sql = () => null;"
                    : `export const db = globalThis[${JSON.stringify(key)}];
               const table = name => ({name, id:{key:'id'}, requestId:{key:'requestId'}, revision:{key:'revision'}});
               export const hubWorkspacesTable=table('workspace'), hubHistoryTable=table('history'),
                 cliniciansTable=table('clinicians'), staffMembersTable=table('staff'),
                 sessionRecordsTable=table('sessions'), hubAttachmentsTable=table('attachments');`,
            }),
          );
        },
      },
    ],
  });
  const router = require(outfile).default;
  return {
    rows,
    async call(method, route, body, params = {}) {
      const layer = router.stack.find(
        (item) => item.route?.path === route && item.route.methods[method],
      );
      assert.ok(layer, `${method} ${route} production handler exists`);
      const response = {
        locals: { actor: "synthetic@example.test" },
        statusCode: 200,
        body: undefined,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(value) {
          this.body = structuredClone(value);
          return this;
        },
      };
      await layer.route.stack[0].handle({ body, params }, response);
      return { status: response.statusCode, data: response.body };
    },
    cleanup() {
      delete globalThis[key];
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("ordinary workspace handler persists focused-plan adoption and retains approval/history protections", async () => {
  const f = await fixture();
  try {
    const data = emptyWorkspace("2026-01-01");
    const change = eventSchema.parse({
      id: randomUUID(),
      name: "Synthetic action",
      date: "2026-02-01",
      field: "custom",
      value: 0,
    });
    const proposal = proposalSchema.parse({
      id: randomUUID(),
      name: "Synthetic focus",
      changes: [change],
    });
    data.proposals.push(proposal);
    data.periods.push(
      periodSchema.parse({
        id: randomUUID(),
        name: "Synthetic finalized month",
        start: "2026-01-01",
        end: "2026-01-31",
        status: "finalized",
        revenue: 100,
        expensesComplete: true,
      }),
    );
    const command = (data, revision, requestId = randomUUID()) => ({
      data,
      expectedRevision: revision,
      requestId,
      action: "Synthetic adoption",
    });
    assert.equal((await f.call("post", "/hub", command(data, 0))).status, 200);
    const adoption = {
      id: randomUUID(),
      name: "Synthetic focus",
      archived: false,
      notes: "",
      sourceAttachmentId: null,
      proposalId: proposal.id,
      adoptedAt: "2026-02-01T00:00:00.000Z",
      adoptedRevision: 1,
      focusKpis: ["sessions", "profit"],
      highlights: ["Synthetic selected action"],
      assumptionSignature: "synthetic-v1",
    };
    const consultCorrection = {
      id: randomUUID(), name: "Synthetic closer correction", archived: false,
      notes: "Manual client review", sourceAttachmentId: null,
      clientId: "synthetic-client", outcome: "confirmed_closer", clinicianName: "Synthetic closer",
    };
    const next = { ...data, focusedPlanAdoptions: [adoption], consultAttributionOverrides: [consultCorrection] };
    const body = command(next, 1);
    const saved = await f.call("post", "/hub", body);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.data.focusedPlanAdoptions, [adoption]);
    assert.deepEqual(saved.data.data.consultAttributionOverrides, [consultCorrection]);
    assert.deepEqual(saved.data.data.proposals[0], proposal);
    assert.deepEqual(
      (await f.call("get", "/hub")).data.data.focusedPlanAdoptions,
      [adoption],
    );
    assert.deepEqual((await f.call("get", "/hub")).data.data.consultAttributionOverrides, [consultCorrection]);
    assert.deepEqual(
      (
        await f.call("get", "/hub/history/:revision", undefined, {
          revision: "2",
        })
      ).data.data.focusedPlanAdoptions,
      [adoption],
    );
    assert.equal(f.rows.history.length, 2);
    const repeated = await f.call("put", "/hub", body);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.data.revision, saved.data.revision);
    assert.deepEqual(repeated.data.data, saved.data.data);
    assert.equal(f.rows.history.length, 2);
    assert.equal((await f.call("post", "/hub", command(next, 1))).status, 409);
    assert.equal(
      (await f.call("put", "/hub", { ...body, action: "Changed replay" }))
        .status,
      409,
    );

    const forged = structuredClone(next);
    forged.proposals[0].approvedAt = adoption.adoptedAt;
    forged.proposals[0].baseline = { synthetic: true };
    const rejected = await f.call("post", "/hub", command(forged, 2));
    assert.equal(rejected.status, 409);
    assert.match(rejected.data.error, /proposal approval action/);
    const removed = { ...next, focusedPlanAdoptions: [] };
    assert.equal(
      (await f.call("post", "/hub", command(removed, 2))).status,
      409,
    );
    const correction = structuredClone(next);
    correction.periods[0].revenue = 200;
    assert.equal(
      (await f.call("post", "/hub", command(correction, 2))).status,
      409,
    );
    assert.equal(f.rows.history.length, 2);

    for (const patch of [
      { adoptedAt: "not-a-date" },
      { adoptedRevision: -1 },
      { adoptedRevision: 0.5 },
      { focusKpis: [] },
      { focusKpis: ["sessions", "profit", "cash"] },
      { focusKpis: ["sessions", "sessions"] },
      { focusKpis: [""] },
      { highlights: [null] },
      { assumptionSignature: "" },
      { baseline: {} },
      { proposalId: randomUUID() },
    ]) {
      const invalid = {
        ...next,
        focusedPlanAdoptions: [{ ...adoption, ...patch }],
      };
      assert.equal(
        (await f.call("put", "/hub", command(invalid, 2))).status,
        400,
        JSON.stringify(patch),
      );
    }
    const future = {
      ...next,
      focusedPlanAdoptions: [{ ...adoption, adoptedRevision: 3 }],
    };
    assert.equal((await f.call("put", "/hub", command(future, 2))).status, 409);

    const approval = await f.call(
      "post",
      "/hub/proposals/:id/approve",
      {
        requestId: randomUUID(),
        expectedRevision: 2,
        changeIds: [change.id],
      },
      { id: proposal.id },
    );
    assert.equal(approval.status, 200, JSON.stringify(approval.data));
    const approved = structuredClone(approval.data.data.proposals[0]);
    assert.ok(approved.approvedAt);
    assert.ok(approved.baseline);
    const withApprovedBaseline = structuredClone(approval.data.data);
    withApprovedBaseline.focusedPlanAdoptions[0].notes = "Synthetic review";
    const updated = await f.call(
      "put",
      "/hub",
      command(withApprovedBaseline, 3),
    );
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.data.data.proposals[0], approved);
    for (const field of ["approvedAt", "baseline", "approvedIds", "changes"]) {
      const edited = structuredClone(f.rows.workspace[0].data);
      edited.proposals[0][field] =
        field === "approvedAt"
          ? null
          : field === "baseline"
            ? { synthetic: "changed" }
            : field === "approvedIds"
              ? [randomUUID()]
              : [
                  eventSchema.parse({
                    id: randomUUID(),
                    name: "Synthetic change",
                    date: "2026-02-01",
                    field: "custom",
                    value: 0,
                  }),
                ];
      const result = await f.call("put", "/hub", command(edited, 4));
      assert.equal(result.status, 409, field);
      assert.match(result.data.error, /approved baseline cannot be rewritten/);
    }
    assert.equal(f.rows.workspace[0].revision, 4);
    assert.equal(f.rows.history.length, 4);
  } finally {
    f.cleanup();
  }
});

test("legacy workspaces default focused-plan history to empty and collection IDs stay unique", () => {
  const data = emptyWorkspace("2026-01-01");
  delete data.focusedPlanAdoptions;
  assert.deepEqual(workspaceSchema.parse(data).focusedPlanAdoptions, []);
  const proposal = proposalSchema.parse({
    id: randomUUID(),
    name: "Synthetic plan",
  });
  data.proposals = [proposal];
  const adoption = {
    id: randomUUID(),
    name: "Synthetic adoption",
    proposalId: proposal.id,
    adoptedAt: "2026-02-01T00:00:00Z",
    adoptedRevision: 1,
    focusKpis: ["sessions"],
    highlights: [],
    assumptionSignature: "synthetic",
  };
  assert.equal(
    workspaceSchema.safeParse({
      ...data,
      focusedPlanAdoptions: [
        { ...adoption, assumptionSignature: "x".repeat(200000) },
      ],
    }).success,
    true,
  );
  assert.equal(
    workspaceSchema.safeParse({
      ...data,
      focusedPlanAdoptions: [
        { ...adoption, assumptionSignature: "x".repeat(200001) },
      ],
    }).success,
    false,
  );
  data.focusedPlanAdoptions = [adoption, adoption];
  const result = workspaceSchema.safeParse(data);
  assert.equal(result.success, false);
  assert.match(result.error.message, /Duplicate record ID/);
});
