import { Router } from "express";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  cliniciansTable,
  sessionRecordsTable,
  sessionHistoryTable,
  hubWorkspacesTable,
  hubAttachmentsTable,
} from "@workspace/db";
import { sessionWriteSchema, type SessionRecord, z } from "@workspace/practice";
import { workspaceSchema } from "@workspace/practice/hub";
import Papa from "papaparse";
import { logger } from "../lib/logger";
import { spreadsheetPreview } from "../lib/spreadsheet-preview";

const router = Router();
const positiveId = (value: unknown) =>
  typeof value === "string" &&
  /^[1-9]\d*$/.test(value) &&
  Number(value) <= 2147483647
    ? Number(value)
    : null;
const toRecord = (
  row: typeof sessionRecordsTable.$inferSelect,
): SessionRecord => ({ ...row, updatedAt: row.updatedAt.toISOString() });

class SessionConflict extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

router.post("/session-records/import-preview", async (req, res) => {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(180),
      data: z.string().max(14_000_000),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Choose a CSV or XLSX file up to 10 MB." });
  const { name, data } = parsed.data;
  if (!/\.(csv|xlsx)$/i.test(name) || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    return res.status(400).json({ error: "Choose a valid CSV or XLSX file." });
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    return res.status(400).json({ error: "File must be between 1 byte and 10 MB." });
  try {
    if (/\.xlsx$/i.test(name)) return res.json(await spreadsheetPreview(data));
    const result = Papa.parse<string[]>(bytes.toString("utf8"), {
      skipEmptyLines: "greedy",
      preview: 1001,
    });
    if (result.errors.length)
      return res.status(400).json({ error: "The CSV file could not be read." });
    return res.json({
      sheets: [{ name: "CSV", rows: result.data.map((row) => row.slice(0, 80)) }],
      limited: result.meta.truncated || result.data.some((row) => row.length > 80),
    });
  } catch {
    return res.status(400).json({ error: "The spreadsheet could not be read." });
  }
});

router.get("/session-records", async (req, res) => {
  const goal = req.query.goalId;
  if (goal !== "unassigned" && positiveId(goal) === null)
    return res.status(400).json({ error: "Select a valid team." });
  if (res.locals.role === "data_entry") {
    const [hub] = await db
      .select()
      .from(hubWorkspacesTable)
      .where(eq(hubWorkspacesTable.id, 1));
    const team = hub
      ? workspaceSchema.parse(hub.data).settings.teamId
      : undefined;
    if (
      team === undefined ||
      (goal === "unassigned" ? null : Number(goal)) !== team
    )
      return res
        .status(403)
        .json({ error: "This team is outside your data-entry access." });
  }
  const rows = await db
    .select({ record: sessionRecordsTable })
    .from(sessionRecordsTable)
    .innerJoin(
      cliniciansTable,
      eq(sessionRecordsTable.clinicianId, cliniciansTable.id),
    )
    .where(
      goal === "unassigned"
        ? isNull(cliniciansTable.goalId)
        : eq(cliniciansTable.goalId, Number(goal)),
    )
    .orderBy(desc(sessionRecordsTable.end), desc(sessionRecordsTable.id));
  return res.json(rows.map((row) => toRecord(row.record)));
});

router.get("/session-records/:id/history", async (req, res) => {
  const id = positiveId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid record ID." });
  if (res.locals.role === "data_entry") {
    const [hub] = await db
      .select()
      .from(hubWorkspacesTable)
      .where(eq(hubWorkspacesTable.id, 1));
    const [record] = await db
      .select({ goalId: cliniciansTable.goalId })
      .from(sessionRecordsTable)
      .innerJoin(
        cliniciansTable,
        eq(sessionRecordsTable.clinicianId, cliniciansTable.id),
      )
      .where(eq(sessionRecordsTable.id, id));
    if (
      !hub ||
      !record ||
      record.goalId !== workspaceSchema.parse(hub.data).settings.teamId
    )
      return res
        .status(403)
        .json({ error: "This history is outside your data-entry access." });
  }
  const rows = await db
    .select()
    .from(sessionHistoryTable)
    .where(eq(sessionHistoryTable.recordId, id))
    .orderBy(desc(sessionHistoryTable.revision));
  if (!rows.length)
    return res.status(404).json({ error: "Session record not found." });
  return res.json(
    rows.map((row) => ({
      revision: row.revision,
      entry: row.snapshot,
      recordedAt: row.recordedAt.toISOString(),
      actor: row.actor,
    })),
  );
});

router.post("/session-records", async (req, res) => {
  const parsed = sessionWriteSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "Check the session entry.", issues: parsed.error.issues });
  const command = parsed.data;
  const entry = command.entry;
  try {
    const result = await db.transaction(async (tx) => {
      // Serializes overlap checks and writes for one clinician, including duplicate retries.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(7421, ${entry.clinicianId})`,
      );
      const [previousRequest] = await tx
        .select()
        .from(sessionHistoryTable)
        .where(eq(sessionHistoryTable.requestId, command.requestId));
      if (previousRequest) {
        if (
          JSON.stringify(sessionWriteSchema.parse(previousRequest.command)) !==
          JSON.stringify(command)
        ) {
          throw new SessionConflict(
            "This save request was already used for a different update. Reload the saved record before retrying.",
          );
        }
        return previousRequest.snapshot as SessionRecord;
      }
      const [clinician] = await tx
        .select({ id: cliniciansTable.id, goalId: cliniciansTable.goalId })
        .from(cliniciansTable)
        .where(eq(cliniciansTable.id, entry.clinicianId));
      if (!clinician)
        throw new SessionConflict(
          "This clinician no longer exists. Refresh the team list.",
          404,
        );
      if (entry.sourceAttachmentId) {
        if (res.locals.role === "data_entry")
          throw new SessionConflict(
            "Source document assignment requires owner access.",
            403,
          );
        const [attachment] = await tx
          .select()
          .from(hubAttachmentsTable)
          .where(eq(hubAttachmentsTable.id, entry.sourceAttachmentId));
        const [hub] = await tx
          .select()
          .from(hubWorkspacesTable)
          .where(eq(hubWorkspacesTable.id, 1));
        const period =
          hub &&
          workspaceSchema
            .parse(hub.data)
            .periods.find((p) => p.id === attachment?.periodId);
        if (
          !attachment ||
          !period ||
          period.start > entry.start ||
          period.end < entry.end
        )
          throw new SessionConflict(
            "The source attachment must belong to this reporting period.",
            400,
          );
      }
      if (res.locals.role === "data_entry") {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7422,1)`);
        const [hub] = await tx
          .select()
          .from(hubWorkspacesTable)
          .where(eq(hubWorkspacesTable.id, 1));
        const data = hub ? workspaceSchema.parse(hub.data) : null;
        if (
          !data ||
          clinician.goalId !== data.settings.teamId ||
          !data.periods.some(
            (p) =>
              !p.archived &&
              p.status !== "finalized" &&
              p.start === entry.start &&
              p.end === entry.end,
          )
        )
          throw new SessionConflict(
            "Data-entry access is limited to the active team and open reporting periods.",
            403,
          );
      }
      const overlapping = await tx
        .select()
        .from(sessionRecordsTable)
        .where(
          and(
            eq(sessionRecordsTable.clinicianId, entry.clinicianId),
            lte(sessionRecordsTable.start, entry.end),
            gte(sessionRecordsTable.end, entry.start),
          ),
        );
      const current = overlapping.find(
        (row) => row.start === entry.start && row.end === entry.end,
      );
      if (overlapping.some((row) => row.id !== current?.id)) {
        throw new SessionConflict(
          "These dates overlap a saved period. Open that entry to correct it, or choose non-overlapping dates.",
        );
      }
      if ((current?.revision ?? null) !== command.expectedRevision) {
        throw new SessionConflict(
          "This period has changed since you opened it. Reload the saved entry and review your changes before saving again.",
        );
      }
      const [saved] = current
        ? await tx
            .update(sessionRecordsTable)
            .set({
              ...entry,
              sourceAttachmentId:
                entry.sourceAttachmentId ?? current.sourceAttachmentId,
              revision: current.revision + 1,
              updatedAt: new Date(),
            })
            .where(eq(sessionRecordsTable.id, current.id))
            .returning()
        : await tx.insert(sessionRecordsTable).values(entry).returning();
      const record = toRecord(saved);
      await tx.insert(sessionHistoryTable).values({
        recordId: record.id,
        revision: record.revision,
        requestId: command.requestId,
        command,
        snapshot: record,
        actor: res.locals.actor ?? "Unknown actor",
      });
      return record;
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof SessionConflict)
      return res.status(error.status).json({ error: error.message });
    logger.error({ err: error }, "Failed to save session entry");
    return res.status(500).json({
      error:
        "The session entry could not be saved. Your changes are still here; retry the save.",
    });
  }
});

export default router;
