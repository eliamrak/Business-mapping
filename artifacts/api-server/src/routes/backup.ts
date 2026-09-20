import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { workspaceSchema } from "@workspace/practice/hub";
import { z } from "@workspace/practice";
import { logger } from "../lib/logger";

// Explicit allowlist excludes passwords, accounts and active login sessions.
export const backupTables = [
  "business_goals",
  "current_reality",
  "clinicians",
  "staff_members",
  "scenarios",
  "scenario_clinicians",
  "scenario_staff_members",
  "hub_workspaces",
  "hub_attachments",
  "session_records",
  "session_record_history",
  "hub_history",
] as const;
const envelope = z
  .object({
    format: z.literal("emc-business-data-v1"),
    exportedAt: z.string(),
    schema: z.string().regex(/^[a-f0-9]{64}$/),
    tables: z.record(
      z.enum(backupTables),
      z.array(z.record(z.string(), z.unknown())).max(100000),
    ),
  })
  .strict();
type Backup = z.infer<typeof envelope>;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const previews = new Map<
  string,
  { backup: Backup; actor: string; expires: number; digest: string }
>();
const router = Router();
async function schemaSignature(client: { query: typeof pool.query }) {
  const result = await client.query(
    "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name, ordinal_position",
    [backupTables],
  );
  return digest(result.rows);
}
router.get("/hub/backup", async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables: Record<string, unknown[]> = {};
    for (const name of backupTables)
      tables[name] = (
        await client.query(
          `SELECT row_to_json(t) AS record FROM "${name}" t ORDER BY id`,
        )
      ).rows.map((r) => r.record);
    const schema = await schemaSignature(client);
    await client.query("COMMIT");
    res
      .set("Cache-Control", "no-store")
      .attachment("emc-business-data-backup.json");
    return res.json({
      format: "emc-business-data-v1",
      exportedAt: new Date().toISOString(),
      schema,
      tables,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ error }, "Business backup failed");
    return res
      .status(500)
      .json({ error: "Backup failed. No data was changed." });
  } finally {
    client.release();
  }
});
router.post("/hub/backup/preview", async (req, res) => {
  const parsed = envelope.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "This is not a complete EMC business-data backup." });
  const client = await pool.connect();
  try {
    const backup = parsed.data;
    if (backup.schema !== (await schemaSignature(client)))
      return res
        .status(400)
        .json({
          error:
            "Backup schema does not match this app version. Restore with the matching release.",
        });
    for (const row of backup.tables.hub_workspaces)
      workspaceSchema.parse(row.data);
    const counts: Record<string, number> = {},
      existing: Record<string, number> = {};
    for (const name of backupTables) {
      counts[name] = backup.tables[name].length;
      existing[name] = Number(
        (await client.query(`SELECT count(*) AS count FROM "${name}"`)).rows[0]
          .count,
      );
    }
    const now = Date.now();
    for (const [key, value] of previews)
      if (value.expires < now) previews.delete(key);
    if (previews.size >= 5)
      return res
        .status(429)
        .json({
          error:
            "Too many backup previews. Wait ten minutes before trying again.",
        });
    const token = randomUUID(),
      hash = digest(backup);
    const canRestore = Object.values(existing).every((n) => n === 0);
    if (canRestore)
      previews.set(token, {
        backup,
        actor: res.locals.actor,
        expires: now + 600000,
        digest: hash,
      });
    return res.json({
      token: canRestore ? token : null,
      counts,
      existing,
      canRestore,
      digest: hash,
      exportedAt: backup.exportedAt,
    });
  } catch {
    return res
      .status(400)
      .json({ error: "Backup validation failed. No data was changed." });
  } finally {
    client.release();
  }
});
router.post("/hub/backup/restore", async (req, res) => {
  const parsed = z
    .object({
      token: z.uuid(),
      digest: z.string(),
      confirmation: z.literal("RESTORE EMPTY APP"),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "Review the backup and confirm restoration first." });
  const preview = previews.get(parsed.data.token);
  if (
    !preview ||
    preview.expires < Date.now() ||
    preview.actor !== res.locals.actor ||
    preview.digest !== parsed.data.digest
  )
    return res
      .status(409)
      .json({ error: "Preview expired. Review the backup again." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query(
      `LOCK TABLE ${backupTables.map((n) => `"${n}"`).join(", ")} IN EXCLUSIVE MODE`,
    );
    if (preview.backup.schema !== (await schemaSignature(client)))
      throw new Error("schema changed");
    for (const name of backupTables)
      if (
        Number(
          (await client.query(`SELECT count(*) AS count FROM "${name}"`))
            .rows[0].count,
        )
      )
        throw new Error("Target is no longer empty");
    for (const name of backupTables) {
      await client.query(
        `INSERT INTO "${name}" SELECT * FROM json_populate_recordset(NULL::"${name}", $1::json)`,
        [JSON.stringify(preview.backup.tables[name])],
      );
      const sequence = (
        await client.query("SELECT pg_get_serial_sequence($1, 'id') AS name", [
          name,
        ])
      ).rows[0].name;
      if (sequence)
        await client.query(
          `SELECT setval($1::regclass, COALESCE((SELECT MAX(id) FROM "${name}"), 1), EXISTS(SELECT 1 FROM "${name}"))`,
          [sequence],
        );
    }
    await client.query("COMMIT");
    previews.delete(parsed.data.token);
    logger.info(
      { actor: res.locals.actor, digest: preview.digest },
      "Business data restored to empty app",
    );
    return res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error({ error }, "Business restoration failed");
    return res
      .status(409)
      .json({
        error:
          "Restore was rolled back. The target must be empty and all backup records must satisfy this app's schema.",
      });
  } finally {
    client.release();
  }
});
export default router;
