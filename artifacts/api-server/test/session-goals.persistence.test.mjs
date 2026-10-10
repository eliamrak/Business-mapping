import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(new URL("../../..", import.meta.url).pathname);
const apiRequire = createRequire(new URL("../package.json", import.meta.url));
const { build } = apiRequire("esbuild");
const { Client } = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
)("pg");

const source = process.env.DATABASE_URL;
if (!source || !["127.0.0.1", "localhost"].includes(new URL(source).hostname))
  throw new Error(
    "Set DATABASE_URL to a disposable loopback Postgres database. This test writes synthetic data and must never run against production.",
  );

const client = new Client({ connectionString: source });

async function loadProductionHelpers() {
  const dir = mkdtempSync(
    path.join(root, "artifacts/api-server/test/.session-goals-"),
  );
  const entry = path.join(dir, "entry.ts");
  const outfile = path.join(dir, "session-goals.cjs");
  const helperPath = path.join(
    root,
    "artifacts/api-server/src/lib/session-goals.ts",
  );
  writeFileSync(
    entry,
    `
      export {
        listSessionGoalsForGoal,
        saveSessionGoal,
        SessionGoalConflict,
      } from ${JSON.stringify(helperPath)};
      export { pool } from "@workspace/db";
    `,
  );
  await build({
    entryPoints: [entry],
    outfile,
    absWorkingDir: root,
    nodePaths: [path.join(root, "artifacts/api-server/node_modules")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    packages: "bundle",
    external: ["pg-native"],
    logLevel: "silent",
  });
  const mod = createRequire(import.meta.url)(outfile);
  return {
    ...mod,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function workspaceForTeam(teamId) {
  return {
    settings: {
      teamId,
      forecastStart: "2026-01-01",
      historicalStart: "2026-01-01",
      historicalEnd: "2026-01-31",
    },
    categories: [],
    budgets: [],
    locations: [],
    rooms: [],
    clinicians: [],
    terms: [],
    campaigns: [],
    funnels: [],
    transactions: [],
    familyPaychecks: [],
    periods: [],
    allocations: [],
    hiring: [],
    events: [],
    goals: [],
    proposals: [],
    kpis: [],
    rules: [],
  };
}

async function insertGoal(name) {
  const result = await client.query(
    "INSERT INTO business_goals (name) VALUES ($1) RETURNING id",
    [name],
  );
  return result.rows[0].id;
}

async function insertClinician(label, goalId) {
  const result = await client.query(
    "INSERT INTO clinicians (label, goal_id) VALUES ($1, $2) RETURNING id",
    [label, goalId],
  );
  return result.rows[0].id;
}

async function countRows(table, where, params) {
  const result = await client.query(
    `SELECT count(*)::int AS count FROM ${table} WHERE ${where}`,
    params,
  );
  return result.rows[0].count;
}

const comparableGoals = (goals) =>
  goals.map((goal) => ({
    clinicianId: goal.clinicianId,
    year: goal.year,
    sessionsPerWeek: goal.sessionsPerWeek,
  }));

test("session goals persist through production helpers without rewriting period history", async () => {
  await client.connect();
  let helpers;
  let helperPool;
  try {
    helpers = await loadProductionHelpers();
    const {
      listSessionGoalsForGoal,
      saveSessionGoal,
      SessionGoalConflict,
      pool,
    } = helpers;
    helperPool = pool;
    const stamp = `${Date.now()}-${process.pid}`;
    const teamA = await insertGoal(`Session goal persistence A ${stamp}`);
    const teamB = await insertGoal(`Session goal persistence B ${stamp}`);
    const clinicianA = await insertClinician("Goal persistence A", teamA);
    const clinicianB = await insertClinician("Goal persistence B", teamB);
    const unassigned = await insertClinician("Goal persistence unassigned", null);
    const goalOnly = await insertClinician("Goal persistence removable", teamA);

    await client.query(
      `
        INSERT INTO hub_workspaces (id, data)
        VALUES (1, $1)
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
      `,
      [workspaceForTeam(teamA)],
    );
    const record = await client.query(
      `
        INSERT INTO session_records (
          clinician_id,
          period_start,
          period_end,
          completed,
          desired,
          cancelled,
          no_show
        )
        VALUES ($1, '2026-01-01', '2026-01-14', 31, 44, 0, 0)
        RETURNING id, revision
      `,
      [clinicianA],
    );
    await client.query(
      `
        INSERT INTO session_record_history (
          record_id,
          revision,
          request_id,
          command,
          snapshot,
          actor
        )
        VALUES ($1, $2, $3, $4, $5, 'Synthetic persistence test')
      `,
      [
        record.rows[0].id,
        record.rows[0].revision,
        randomUUID(),
        { type: "create" },
        { completed: 31, desired: 44 },
      ],
    );

    await saveSessionGoal(
      { clinicianId: clinicianA, year: 2025, sessionsPerWeek: 9 },
      { requireActiveTeam: true },
    );
    await saveSessionGoal(
      { clinicianId: clinicianA, year: 2026, sessionsPerWeek: 15 },
      { requireActiveTeam: true },
    );
    await saveSessionGoal(
      { clinicianId: clinicianA, year: 2026, sessionsPerWeek: 18 },
      { requireActiveTeam: true },
    );
    await assert.rejects(
      saveSessionGoal(
        { clinicianId: clinicianB, year: 2027, sessionsPerWeek: 7 },
        { requireActiveTeam: true },
      ),
      (error) =>
        error instanceof SessionGoalConflict && error.status === 403,
    );
    assert.equal(
      await countRows(
        "session_goal_years",
        "clinician_id = $1 AND goal_year = 2027",
        [clinicianB],
      ),
      0,
    );

    await saveSessionGoal({
      clinicianId: clinicianB,
      year: 2026,
      sessionsPerWeek: 6,
    });
    await saveSessionGoal({
      clinicianId: unassigned,
      year: 2026,
      sessionsPerWeek: 5,
    });
    await saveSessionGoal({
      clinicianId: goalOnly,
      year: 2026,
      sessionsPerWeek: 14,
    });

    assert.deepEqual(comparableGoals(await listSessionGoalsForGoal(teamA)), [
      { clinicianId: clinicianA, year: 2025, sessionsPerWeek: 9 },
      { clinicianId: clinicianA, year: 2026, sessionsPerWeek: 18 },
      { clinicianId: goalOnly, year: 2026, sessionsPerWeek: 14 },
    ]);
    assert.deepEqual(comparableGoals(await listSessionGoalsForGoal(teamB)), [
      { clinicianId: clinicianB, year: 2026, sessionsPerWeek: 6 },
    ]);
    assert.deepEqual(
      comparableGoals(await listSessionGoalsForGoal("unassigned")),
      [{ clinicianId: unassigned, year: 2026, sessionsPerWeek: 5 }],
    );

    const historical = await client.query(
      `
        SELECT completed, desired
        FROM session_records
        WHERE clinician_id = $1
      `,
      [clinicianA],
    );
    assert.deepEqual(historical.rows, [{ completed: 31, desired: 44 }]);
    const history = await client.query(
      `
        SELECT snapshot
        FROM session_record_history
        WHERE record_id = $1
      `,
      [record.rows[0].id],
    );
    assert.deepEqual(history.rows, [{ snapshot: { completed: 31, desired: 44 } }]);

    await client.query("DELETE FROM clinicians WHERE id = $1", [goalOnly]);
    assert.equal(
      await countRows("session_goal_years", "clinician_id = $1", [goalOnly]),
      0,
    );
    assert.deepEqual(comparableGoals(await listSessionGoalsForGoal(teamA)), [
      { clinicianId: clinicianA, year: 2025, sessionsPerWeek: 9 },
      { clinicianId: clinicianA, year: 2026, sessionsPerWeek: 18 },
    ]);

  } finally {
    if (helperPool) await helperPool.end();
    if (helpers) helpers.cleanup();
    await client.end();
  }
});
