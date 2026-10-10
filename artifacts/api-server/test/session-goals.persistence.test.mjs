import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { Client } = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
)("pg");

const source = process.env.DATABASE_URL;
if (!source || !["127.0.0.1", "localhost"].includes(new URL(source).hostname))
  throw new Error(
    "Set DATABASE_URL to a disposable loopback Postgres database. This test writes synthetic data and must never run against production.",
  );

const client = new Client({ connectionString: source });

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

async function saveGoal(clinicianId, year, sessionsPerWeek) {
  const result = await client.query(
    `
      INSERT INTO session_goal_years (clinician_id, goal_year, sessions_per_week, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (clinician_id, goal_year)
      DO UPDATE SET sessions_per_week = EXCLUDED.sessions_per_week, updated_at = now()
      RETURNING clinician_id, goal_year, sessions_per_week
    `,
    [clinicianId, year, sessionsPerWeek],
  );
  return result.rows[0];
}

async function listGoalsForTeam(goalId) {
  const result = await client.query(
    `
      SELECT sgy.clinician_id, sgy.goal_year, sgy.sessions_per_week
      FROM session_goal_years sgy
      INNER JOIN clinicians c ON sgy.clinician_id = c.id
      WHERE c.goal_id = $1
      ORDER BY sgy.goal_year, sgy.clinician_id
    `,
    [goalId],
  );
  return result.rows.map((row) => ({
    clinicianId: row.clinician_id,
    year: row.goal_year,
    sessionsPerWeek: Number(row.sessions_per_week),
  }));
}

async function listUnassignedGoals() {
  const result = await client.query(
    `
      SELECT sgy.clinician_id, sgy.goal_year, sgy.sessions_per_week
      FROM session_goal_years sgy
      INNER JOIN clinicians c ON sgy.clinician_id = c.id
      WHERE c.goal_id IS NULL
      ORDER BY sgy.goal_year, sgy.clinician_id
    `,
  );
  return result.rows.map((row) => ({
    clinicianId: row.clinician_id,
    year: row.goal_year,
    sessionsPerWeek: Number(row.sessions_per_week),
  }));
}

test("session goals persist by clinician and year without rewriting period history", async () => {
  await client.connect();
  try {
    const stamp = `${Date.now()}-${process.pid}`;
    const teamA = await insertGoal(`Session goal persistence A ${stamp}`);
    const teamB = await insertGoal(`Session goal persistence B ${stamp}`);
    const clinicianA = await insertClinician("Goal persistence A", teamA);
    const clinicianB = await insertClinician("Goal persistence B", teamB);
    const unassigned = await insertClinician("Goal persistence unassigned", null);
    const goalOnly = await insertClinician("Goal persistence removable", teamA);

    await client.query(
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
      `,
      [clinicianA],
    );

    await saveGoal(clinicianA, 2025, 9);
    await saveGoal(clinicianA, 2026, 15);
    await saveGoal(clinicianA, 2026, 18);
    await saveGoal(clinicianB, 2026, 6);
    await saveGoal(unassigned, 2026, 5);
    await saveGoal(goalOnly, 2026, 14);

    assert.deepEqual(await listGoalsForTeam(teamA), [
      { clinicianId: clinicianA, year: 2025, sessionsPerWeek: 9 },
      { clinicianId: clinicianA, year: 2026, sessionsPerWeek: 18 },
      { clinicianId: goalOnly, year: 2026, sessionsPerWeek: 14 },
    ]);
    assert.deepEqual(await listGoalsForTeam(teamB), [
      { clinicianId: clinicianB, year: 2026, sessionsPerWeek: 6 },
    ]);
    assert.deepEqual(await listUnassignedGoals(), [
      { clinicianId: unassigned, year: 2026, sessionsPerWeek: 5 },
    ]);

    const historical = await client.query(
      `
        SELECT completed, desired
        FROM session_records
        WHERE clinician_id = $1
      `,
      [clinicianA],
    );
    assert.deepEqual(historical.rows, [{ completed: 31, desired: 44 }]);

    await client.query("DELETE FROM clinicians WHERE id = $1", [goalOnly]);
    assert.deepEqual(await listGoalsForTeam(teamA), [
      { clinicianId: clinicianA, year: 2025, sessionsPerWeek: 9 },
      { clinicianId: clinicianA, year: 2026, sessionsPerWeek: 18 },
    ]);
  } finally {
    await client.end();
  }
});
