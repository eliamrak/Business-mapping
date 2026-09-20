import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const { Client } = createRequire(
  new URL("../lib/db/package.json", import.meta.url),
)("pg");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const apply = process.argv.includes("--apply");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(7422, 9)");
  const rows = (
    await client.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'",
    )
  ).rows;
  const has = (table, column) =>
    rows.some(
      (r) => r.table_name === table && (!column || r.column_name === column),
    );
  const legacy = [
    "business_goals",
    "current_reality",
    "clinicians",
    "staff_members",
    "scenarios",
    "scenario_clinicians",
    "scenario_staff_members",
  ];
  if (legacy.some((table) => !has(table)))
    throw new Error(
      "Original app schema is incomplete. Do not run these migrations on an unknown database.",
    );
  if (has("session_records") !== has("session_record_history"))
    throw new Error("Partial session schema needs review before migration.");
  const hub = [
    "hub_workspaces",
    "hub_history",
    "hub_attachments",
    "hub_users",
    "hub_auth_sessions",
  ];
  if (hub.some((table) => has(table)) && !hub.every((table) => has(table)))
    throw new Error("Partial hub schema needs review before migration.");
  const files = [];
  if (!has("session_records")) files.push("001_session_records.sql");
  if (!has("hub_workspaces")) files.push("002_business_hub.sql");
  if (
    !has("session_records", "scheduled") ||
    !has("session_records", "in_person") ||
    !has("session_records", "telehealth") ||
    !has("session_record_history", "actor")
  )
    files.push("003_session_detail.sql");
  if (!has("session_records", "source_attachment_id"))
    files.push("004_session_sources.sql");
  console.log(
    JSON.stringify(
      { mode: apply ? "apply" : "inspection only", pending: files },
      null,
      2,
    ),
  );
  if (apply) {
    if (process.env.EMC_DATABASE_BACKUP_VERIFIED !== "true")
      throw new Error(
        "Verify a protected backup and target database, then set EMC_DATABASE_BACKUP_VERIFIED=true.",
      );
    for (const file of files) {
      const sql = await readFile(
        new URL(`../lib/db/migrations/${file}`, import.meta.url),
        "utf8",
      );
      await client.query(sql);
      console.log(`Applied ${file}`);
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(7422, 9)").catch(() => {});
  await client.end();
}
