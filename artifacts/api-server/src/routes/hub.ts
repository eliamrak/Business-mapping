import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  hubWorkspacesTable,
  hubHistoryTable,
  hubAttachmentsTable,
  cliniciansTable,
  staffMembersTable,
  sessionRecordsTable,
} from "@workspace/db";
import {
  emptyWorkspace,
  workspaceSchema,
  collections,
  forecast,
  eventIssues,
  funnelSchema,
  referencedClinicianIds,
  type Workspace,
  type Context,
} from "@workspace/practice/hub";
import { z } from "@workspace/practice";
import { spreadsheetPreview } from "../lib/spreadsheet-preview";
import Papa from "papaparse";

const router = Router();
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
};
const numericFields = new Set([
  "sessionRate",
  "sessionsPerWeek",
  "weeksWorkedPerYear",
  "preCapClinicianSplit",
  "preCapPracticeSplit",
  "capAmount",
  "postCapClinicianSplit",
  "postCapPracticeSplit",
  "w2EmployerFicaPct",
  "futaSutaPct",
  "workersCompPct",
  "otherEmployerBurdenPct",
  "nonClinicalHoursPerWeek",
  "nonClinicalHourlyRate",
  "annualSalary",
  "hourlyRate",
  "hoursPerWeek",
  "weeksPerYear",
]);
const numeric = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      numericFields.has(key) && typeof value === "string"
        ? Number(value)
        : value,
    ]),
  );
const writeSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().min(0),
    action: z.string().trim().min(1).max(200),
    data: workspaceSchema,
  })
  .strict();
const serialize = (row: typeof hubWorkspacesTable.$inferSelect) => ({
  revision: row.revision,
  data: workspaceSchema.parse(row.data),
  updatedAt: row.updatedAt.toISOString(),
});
async function current() {
  const [row] = await db
    .select()
    .from(hubWorkspacesTable)
    .where(eq(hubWorkspacesTable.id, 1));
  return row
    ? serialize(row)
    : { revision: 0, data: emptyWorkspace(), updatedAt: null };
}
function protectHistory(previous: Workspace, next: Workspace) {
  for (const p of previous.periods.filter((p) => p.status === "finalized")) {
    const replacement = next.periods.find((x) => x.id === p.id);
    const changed =
      JSON.stringify(replacement) !== JSON.stringify(p) ||
      JSON.stringify(
        previous.transactions.filter((t) => t.periodId === p.id),
      ) !==
        JSON.stringify(next.transactions.filter((t) => t.periodId === p.id)) ||
      JSON.stringify(previous.funnels.filter((t) => t.periodId === p.id)) !==
        JSON.stringify(next.funnels.filter((t) => t.periodId === p.id));
    if (
      changed &&
      (!replacement ||
        replacement.correctionReason.trim().length < 8 ||
        replacement.correctionReason === p.correctionReason)
    )
      throw new Error(
        `A new correction reason is required for finalized period ${p.name}.`,
      );
  }
  for (const key of collections)
    for (const original of previous[key])
      if (!next[key].some((item) => item.id === original.id))
        throw new Error(
          "Existing records cannot be removed. Archive them to preserve history.",
        );
  const errors = eventIssues(next.events);
  if (errors.length) throw new Error(errors.join(" "));
}

router.get("/hub", async (_req, res) => res.json(await current()));
router.get("/hub/entry", async (_req, res) => {
  const snapshot = await current();
  const clinicians = await db
    .select({
      id: cliniciansTable.id,
      label: cliniciansTable.label,
      goalId: cliniciansTable.goalId,
    })
    .from(cliniciansTable);
  return res.json({
    revision: snapshot.revision,
    teamId: snapshot.data.settings.teamId,
    clinicians: clinicians.filter(
      (c) => c.goalId === snapshot.data.settings.teamId,
    ),
    periods: snapshot.data.periods
      .filter((p) => !p.archived && p.status !== "finalized")
      .map((p) => ({ id: p.id, name: p.name, start: p.start, end: p.end })),
    campaigns: snapshot.data.campaigns
      .filter((c) => !c.archived)
      .map((c) => ({ id: c.id, name: c.name })),
    funnels: snapshot.data.funnels
      .filter((f) =>
        snapshot.data.periods.some(
          (p) => p.id === f.periodId && p.status !== "finalized",
        ),
      )
      .map(
        ({ attributedRevenue, attributedSessions, deliveryCosts, sourceAttachmentId, notes, ...entry }) => entry,
      ),
  });
});
router.post("/hub/entry/funnel", async (req, res) => {
  const input = z
    .object({
      requestId: z.uuid(),
      expectedRevision: z.number().int().min(0),
      entry: funnelSchema,
    })
    .strict()
    .safeParse(req.body);
  if (!input.success)
    return res.status(400).json({ error: "Check the funnel values." });
  try {
    const revision = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7422,1)`);
      const [repeat] = await tx
        .select()
        .from(hubHistoryTable)
        .where(eq(hubHistoryTable.requestId, input.data.requestId));
      if (repeat) {
        if (canonical(repeat.command) !== canonical(input.data))
          throw new Error("Request ID already used.");
        return repeat.revision;
      }
      const [existing] = await tx
        .select()
        .from(hubWorkspacesTable)
        .where(eq(hubWorkspacesTable.id, 1));
      if (!existing || existing.revision !== input.data.expectedRevision)
        throw new Error(
          "Workspace changed. Refresh and review before saving again.",
        );
      const data = workspaceSchema.parse(existing.data);
      const period = data.periods.find(
        (p) => p.id === input.data.entry.periodId,
      );
      if (!period || period.archived || period.status === "finalized")
        throw new Error("Choose an open reporting period.");
      const previous = data.funnels.find((f) => f.id === input.data.entry.id);
      if (previous && previous.periodId !== input.data.entry.periodId)
        throw new Error("A saved entry cannot be moved to another period.");
      const entry = {
        ...input.data.entry,
        attributedRevenue: previous?.attributedRevenue ?? null,
        attributedSessions: previous?.attributedSessions ?? null,
        deliveryCosts: previous?.deliveryCosts ?? null,
        sourceAttachmentId: previous?.sourceAttachmentId ?? null,
        notes: previous?.notes ?? "",
      };
      data.funnels = previous
        ? data.funnels.map((f) => (f.id === previous.id ? entry : f))
        : [...data.funnels, entry];
      const validated = workspaceSchema.safeParse(data);
      if (!validated.success)
        throw new Error(validated.error.issues.map((i) => i.message).join(" "));
      const revision = existing.revision + 1,
        updatedAt = new Date();
      await tx
        .update(hubWorkspacesTable)
        .set({ revision, data: validated.data, updatedAt })
        .where(eq(hubWorkspacesTable.id, 1));
      await tx.insert(hubHistoryTable).values({
        workspaceId: 1,
        revision,
        requestId: input.data.requestId,
        actor: res.locals.actor,
        action: "Updated lead-generation actuals",
        command: input.data,
        snapshot: validated.data,
      });
      return revision;
    });
    return res.json({ revision });
  } catch (error) {
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Could not save entry.",
    });
  }
});
router.get("/hub/context", async (_req, res) => {
  const clinicians = await db.select().from(cliniciansTable),
    staff = await db.select().from(staffMembersTable),
    sessions = await db.select().from(sessionRecordsTable);
  return res.json({
    clinicians: clinicians.map(numeric),
    staff: staff.map(numeric),
    sessions: sessions.map((r) => ({
      ...r,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});
router.post("/hub", async (req, res) => {
  const parsed = writeSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 10)
        .join("\n"),
    });
  const command = parsed.data;
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7422,1)`);
      const [repeat] = await tx
        .select()
        .from(hubHistoryTable)
        .where(eq(hubHistoryTable.requestId, command.requestId));
      if (repeat) {
        if (canonical(repeat.command) !== canonical(command))
          throw new Error(
            "This request ID was already used. Reload before retrying.",
          );
        return {
          revision: repeat.revision,
          data: repeat.snapshot,
          updatedAt: repeat.createdAt.toISOString(),
        };
      }
      const [existing] = await tx
        .select()
        .from(hubWorkspacesTable)
        .where(eq(hubWorkspacesTable.id, 1));
      if ((existing?.revision ?? 0) !== command.expectedRevision)
        throw new Error(
          "A newer version was saved. Reload the latest workspace before applying your changes.",
        );
      const previous = existing
        ? workspaceSchema.parse(existing.data)
        : emptyWorkspace();
      protectHistory(previous, command.data);
      const clinicians = await tx
        .select({ id: cliniciansTable.id })
        .from(cliniciansTable);
      const known = new Set(clinicians.map((c) => c.id));
      if (
        [...referencedClinicianIds(command.data)].some((id) => !known.has(id))
      )
        throw new Error(
          "A linked clinician no longer exists. Refresh and select an existing clinician.",
        );
      for (const p of command.data.proposals) {
        const old = previous.proposals.find((x) => x.id === p.id);
        if (
          old?.approvedAt &&
          ["approvedAt", "approvedIds", "baseline", "changes"].some(
            (key) =>
              canonical(old[key as keyof typeof old]) !==
              canonical(p[key as keyof typeof p]),
          )
        )
          throw new Error(
            "An approved baseline cannot be rewritten. Duplicate the proposal to revise its assumptions.",
          );
        if (
          p.approvedAt &&
          (!old?.approvedAt ||
            canonical(old.approvedIds) !== canonical(p.approvedIds) ||
            canonical(old.baseline) !== canonical(p.baseline))
        )
          throw new Error(
            "Use the proposal approval action to establish an approved baseline.",
          );
      }
      const revision = command.expectedRevision + 1,
        updatedAt = new Date();
      await tx
        .insert(hubWorkspacesTable)
        .values({ id: 1, revision, data: command.data, updatedAt })
        .onConflictDoUpdate({
          target: hubWorkspacesTable.id,
          set: { revision, data: command.data, updatedAt },
        });
      await tx.insert(hubHistoryTable).values({
        workspaceId: 1,
        revision,
        requestId: command.requestId,
        actor: res.locals.actor,
        action: command.action,
        command,
        snapshot: command.data,
      });
      return {
        revision,
        data: command.data,
        updatedAt: updatedAt.toISOString(),
      };
    });
    return res.json(result);
  } catch (error) {
    return res.status(409).json({
      error:
        error instanceof Error
          ? error.message
          : "Could not save the workspace.",
    });
  }
});

router.post("/hub/proposals/:id/approve", async (req, res) => {
  const parsed = z
    .object({
      requestId: z.uuid(),
      expectedRevision: z.number().int().min(0),
      changeIds: z.array(z.uuid()).min(1),
      context: z.unknown().optional(),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Select changes to approve." });
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7422,1)`);
      const [repeat] = await tx
        .select()
        .from(hubHistoryTable)
        .where(eq(hubHistoryTable.requestId, parsed.data.requestId));
      const command = { ...parsed.data, proposalId: req.params.id };
      if (repeat) {
        if (canonical(repeat.command) !== canonical(command))
          throw new Error("Request ID already used.");
        return {
          revision: repeat.revision,
          data: repeat.snapshot,
          updatedAt: repeat.createdAt.toISOString(),
        };
      }
      const [existing] = await tx
        .select()
        .from(hubWorkspacesTable)
        .where(eq(hubWorkspacesTable.id, 1));
      if (!existing || existing.revision !== parsed.data.expectedRevision)
        throw new Error("Workspace changed. Reload before approval.");
      const workspace = workspaceSchema.parse(existing.data),
        proposal = workspace.proposals.find((p) => p.id === req.params.id);
      if (!proposal || proposal.approvedAt || proposal.status !== "draft")
        throw new Error(
          "Only an unapproved draft can be approved. Duplicate an approved proposal for a revision.",
        );
      const chosen = proposal.changes.filter(
        (c) => parsed.data.changeIds.includes(c.id) && c.enabled,
      );
      if (chosen.length !== parsed.data.changeIds.length)
        throw new Error("Some selected changes are missing or disabled.");
      const errors = eventIssues([...workspace.events, ...chosen]);
      if (errors.length) throw new Error(errors.join(" "));
      const clinicianRows = await tx.select().from(cliniciansTable),
        staffRows = await tx.select().from(staffMembersTable),
        sessions = await tx.select().from(sessionRecordsTable);
      const context = {
        clinicians: clinicianRows.map(numeric),
        staff: staffRows.map(numeric),
        sessions: sessions.map((s) => ({
          ...s,
          updatedAt: s.updatedAt.toISOString(),
        })),
      } as unknown as Context;
      const baseline = forecast(workspace, context),
        proposed = forecast(workspace, context, chosen);
      proposal.baseline = {
        before: baseline,
        after: proposed,
        settings: workspace.settings,
        approvedRevision: existing.revision,
      };
      proposal.approvedAt = new Date().toISOString();
      proposal.status = "active";
      proposal.approvedIds = chosen.map((c) => c.id);
      workspace.events.push(
        ...chosen.map((c) => ({ ...c, initiativeId: proposal.id })),
      );
      const revision = existing.revision + 1,
        updatedAt = new Date();
      await tx
        .update(hubWorkspacesTable)
        .set({ data: workspace, revision, updatedAt })
        .where(eq(hubWorkspacesTable.id, 1));
      await tx.insert(hubHistoryTable).values({
        workspaceId: 1,
        revision,
        requestId: parsed.data.requestId,
        actor: res.locals.actor,
        action: `Approved proposal: ${proposal.name}`,
        command,
        snapshot: workspace,
      });
      return { revision, data: workspace, updatedAt: updatedAt.toISOString() };
    });
    return res.json(result);
  } catch (error) {
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Approval failed.",
    });
  }
});
router.get("/hub/history", async (_req, res) =>
  res.json(
    await db
      .select({
        revision: hubHistoryTable.revision,
        actor: hubHistoryTable.actor,
        action: hubHistoryTable.action,
        createdAt: hubHistoryTable.createdAt,
      })
      .from(hubHistoryTable)
      .orderBy(desc(hubHistoryTable.revision))
      .limit(200),
  ),
);
router.get("/hub/history/:revision", async (req, res) => {
  const [row] = await db
    .select()
    .from(hubHistoryTable)
    .where(eq(hubHistoryTable.revision, Number(req.params.revision)));
  return row
    ? res.json({ revision: row.revision, data: row.snapshot })
    : res.sendStatus(404);
});
router.get("/hub/export", async (_req, res) => {
  const snapshot = await current();
  const attachments = await db.select().from(hubAttachmentsTable);
  const history = await db
    .select()
    .from(hubHistoryTable)
    .orderBy(hubHistoryTable.revision);
  res.attachment("emc-business-hub-backup.json");
  return res.json({
    format: "emc-hub-v1",
    exportedAt: new Date().toISOString(),
    ...snapshot,
    attachments,
    history,
  });
});

const uploadSchema = z
  .object({
    id: z.uuid(),
    periodId: z.uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((n) => !/[\x00-\x1f/\\]/.test(n)),
    data: z.string().max(14000000),
  })
  .strict();
router.get("/hub/attachments", async (_req, res) =>
  res.json(
    await db
      .select({
        id: hubAttachmentsTable.id,
        periodId: hubAttachmentsTable.periodId,
        name: hubAttachmentsTable.name,
        mime: hubAttachmentsTable.mime,
        size: hubAttachmentsTable.size,
        actor: hubAttachmentsTable.actor,
        createdAt: hubAttachmentsTable.createdAt,
      })
      .from(hubAttachmentsTable)
      .orderBy(desc(hubAttachmentsTable.createdAt)),
  ),
);
router.post("/hub/attachments", async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "Choose a supported file up to 10 MB." });
  const { id, periodId, name, data } = parsed.data;
  const state = await current();
  const period = state.data.periods.find((p) => p.id === periodId);
  if (!period || period.status === "finalized")
    return res.status(409).json({
      error: "Attach documents to a draft or reviewed reporting period.",
    });
  const ext = name.toLowerCase().split(".").pop()!,
    mimes: Record<string, string> = {
      csv: "text/csv",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
    };
  if (!mimes[ext] || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    return res
      .status(400)
      .json({ error: "Allowed formats: CSV, XLSX, PDF, PNG, JPEG, WebP." });
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > 10 * 1024 * 1024 || !bytes.length)
    return res
      .status(400)
      .json({ error: "File must be between 1 byte and 10 MB." });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const [existing] = await db
    .select()
    .from(hubAttachmentsTable)
    .where(eq(hubAttachmentsTable.id, id));
  if (existing)
    return existing.sha256 === sha256 && existing.periodId === periodId
      ? res.json({ id, name, size: bytes.length })
      : res.status(409).json({ error: "Attachment ID already used." });
  const file = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7422,1)`);
    const [duplicate] = await tx
      .select()
      .from(hubAttachmentsTable)
      .where(
        and(
          eq(hubAttachmentsTable.periodId, periodId),
          eq(hubAttachmentsTable.sha256, sha256),
        ),
      );
    if (duplicate) return duplicate;
    const [created] = await tx
      .insert(hubAttachmentsTable)
      .values({
        id,
        periodId,
        name,
        mime: mimes[ext],
        data,
        size: bytes.length,
        sha256,
        actor: res.locals.actor,
      })
      .returning();
    return created;
  });
  return res
    .status(file.id === id ? 201 : 200)
    .json({ id: file.id, name: file.name, size: file.size });
});
router.get("/hub/attachments/:id", async (req, res) => {
  if (!z.uuid().safeParse(req.params.id).success) return res.sendStatus(400);
  const [file] = await db
    .select()
    .from(hubAttachmentsTable)
    .where(eq(hubAttachmentsTable.id, req.params.id));
  if (!file) return res.sendStatus(404);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.attachment(file.name);
  res.type(file.mime);
  return res.send(Buffer.from(file.data, "base64"));
});
router.get("/hub/attachments/:id/preview", async (req, res) => {
  if (!z.uuid().safeParse(req.params.id).success) return res.sendStatus(400);
  const [file] = await db
    .select()
    .from(hubAttachmentsTable)
    .where(eq(hubAttachmentsTable.id, req.params.id));
  if (!file) return res.sendStatus(404);
  try {
    if (file.name.toLowerCase().endsWith(".csv")) {
      const parsed = Papa.parse<string[]>(
        Buffer.from(file.data, "base64").toString("utf8"),
        { skipEmptyLines: "greedy", preview: 1001 },
      );
      if (parsed.errors.length)
        return res.status(400).json({ error: parsed.errors[0].message });
      return res.json({
        sheets: [{ name: "CSV", rows: parsed.data }],
        limited: parsed.meta.truncated,
      });
    }
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      return res.json(await spreadsheetPreview(file.data));
    }
    return res.json({ sheets: [], manual: true });
  } catch {
    return res.status(400).json({
      error:
        "This document could not be read as a spreadsheet. Keep it as a source attachment and enter reviewed values manually.",
    });
  }
});
router.post("/hub/export-csv", async (req, res) => {
  const parsed = z
    .object({
      rows: z
        .array(
          z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
        )
        .max(10000),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.sendStatus(400);
  res.attachment("emc-report.csv");
  res.type("text/csv");
  return res.send(Papa.unparse(parsed.data.rows, { escapeFormulae: true }));
});
export default router;
