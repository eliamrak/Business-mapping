import { Router } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  localRetentionImportEventsTable,
  localRetentionSettingsTable,
  localRetentionSnapshotsTable,
} from "@workspace/db";
import {
  importLocalPackage,
  importLocalBackup,
  mergeLocalPackage,
  replaceOverlappingPackageSnapshots,
  z,
  type BillingCodeMinutes,
  type LocalSnapshot,
} from "@workspace/practice";
import { logger } from "../lib/logger.ts";

const router = Router();
const writeSchema = z
  .object({
    package: z.unknown(),
    replaceOverlaps: z.boolean().optional().default(false),
  })
  .strict();

class RetentionConflict extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? "Retention import conflict"));
    this.status = status;
    this.payload = payload;
  }
}

const dateString = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value);

const timestampString = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);

const practiceId = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;

function toSnapshot(
  row: typeof localRetentionSnapshotsTable.$inferSelect,
): LocalSnapshot {
  const base = {
    id: row.snapshotId,
    importedAt: timestampString(row.importedAt),
    coverageStart: dateString(row.coverageStart),
    coverageEnd: dateString(row.coverageEnd),
    sourceHash: row.sourceHash,
  };
  if (row.kind === "attendance")
    return { ...base, kind: "attendance", rows: row.rows as never };
  return { ...base, kind: "billing", rows: row.rows as never };
}

async function loadHistory(practice: string, tx: any = db) {
  const rows = await tx
    .select()
    .from(localRetentionSnapshotsTable)
    .where(eq(localRetentionSnapshotsTable.practiceId, practice))
    .orderBy(
      asc(localRetentionSnapshotsTable.coverageStart),
      asc(localRetentionSnapshotsTable.kind),
      asc(localRetentionSnapshotsTable.id),
    );
  const [settings] = await tx
    .select()
    .from(localRetentionSettingsTable)
    .where(eq(localRetentionSettingsTable.practiceId, practice));
  return {
    snapshots: rows.map(toSnapshot),
    billingCodeMinutes:
      (settings?.billingCodeMinutes as BillingCodeMinutes | undefined) ?? {},
  };
}

async function insertSnapshots(
  tx: any,
  practice: string,
  snapshots: LocalSnapshot[],
  actor: string,
  packageInfo?: { packageId: string; exportedAt: string },
) {
  if (snapshots.length) {
    await tx.insert(localRetentionSnapshotsTable).values(
      snapshots.map((snapshot) => ({
        practiceId: practice,
        snapshotId: snapshot.id,
        kind: snapshot.kind,
        packageId:
          packageInfo && snapshot.id.startsWith("package-")
            ? packageInfo.packageId
            : null,
        packageExportedAt:
          packageInfo && snapshot.id.startsWith("package-")
            ? new Date(packageInfo.exportedAt)
            : null,
        importedAt: new Date(snapshot.importedAt),
        coverageStart: snapshot.coverageStart,
        coverageEnd: snapshot.coverageEnd,
        sourceHash: snapshot.sourceHash,
        rowCount: snapshot.rows.length,
        rows: snapshot.rows,
        actor,
      })),
    );
  }
}

async function saveSettings(
  tx: any,
  practice: string,
  billingCodeMinutes: BillingCodeMinutes,
  actor: string,
) {
  await tx
    .insert(localRetentionSettingsTable)
    .values({
      practiceId: practice,
      billingCodeMinutes,
      actor,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: localRetentionSettingsTable.practiceId,
      set: { billingCodeMinutes, actor, updatedAt: new Date() },
    });
}

async function recordEvent(
  tx: any,
  practice: string,
  actor: string,
  action: string,
  packageId: string | null,
  command: unknown,
  snapshot: unknown,
) {
  await tx.insert(localRetentionImportEventsTable).values({
    practiceId: practice,
    actor,
    action,
    packageId,
    command,
    snapshot,
  });
}

function metadata(snapshots: LocalSnapshot[]) {
  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    kind: snapshot.kind,
    coverageStart: snapshot.coverageStart,
    coverageEnd: snapshot.coverageEnd,
    rowCount: snapshot.rows.length,
    sourceHash: snapshot.sourceHash,
  }));
}

router.get("/local-retention", async (_req, res) => {
  const practice = practiceId(res.locals.actor);
  if (!practice)
    return res.status(403).json({ error: "Owner access is required." });
  try {
    return res.json(await loadHistory(practice));
  } catch (error) {
    logger.error({ error }, "Failed to load local retention history");
    return res
      .status(500)
      .json({ error: "Retention history could not be loaded." });
  }
});

router.post("/local-retention/packages", async (req, res) => {
  const practice = practiceId(res.locals.actor);
  const actor = res.locals.actor ?? "Unknown actor";
  if (!practice)
    return res.status(403).json({ error: "Owner access is required." });
  const parsed = writeSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Choose a Practice import package." });
  let incoming;
  try {
    incoming = importLocalPackage(parsed.data.package);
  } catch (error) {
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "The package could not be read.",
    });
  }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7422, 12)`);
      const existingPackageRows = await tx
        .select({
          kind: localRetentionSnapshotsTable.kind,
          sourceHash: localRetentionSnapshotsTable.sourceHash,
        })
        .from(localRetentionSnapshotsTable)
        .where(
          and(
            eq(localRetentionSnapshotsTable.practiceId, practice),
            eq(localRetentionSnapshotsTable.packageId, incoming.packageId),
          ),
        );
      if (existingPackageRows.length) {
        const incomingHashes = new Map(
          incoming.snapshots.map((snapshot) => [
            snapshot.kind,
            snapshot.sourceHash,
          ]),
        );
        const samePackage = existingPackageRows.every(
          (row) =>
            (row.kind === "attendance" || row.kind === "billing") &&
            incomingHashes.get(row.kind) === row.sourceHash,
        );
        if (!samePackage)
          throw new RetentionConflict(409, {
            status: "blocked",
            error:
              "A saved package already uses this package ID with different contents. Export a new package ID before importing.",
            warnings: incoming.warnings,
            history: await loadHistory(practice, tx),
          });
      }
      const current = await loadHistory(practice, tx);
      const merged = mergeLocalPackage(
        current.snapshots,
        current.billingCodeMinutes,
        incoming,
      );
      if (merged.status === "duplicate") {
        await recordEvent(
          tx,
          practice,
          actor,
          "duplicate_package",
          incoming.packageId,
          { packageId: incoming.packageId },
          { snapshots: metadata(incoming.snapshots) },
        );
        return {
          ...current,
          status: "duplicate" as const,
          warnings: merged.warnings,
        };
      }
      if (merged.status === "blocked")
        throw new RetentionConflict(409, {
          status: "blocked",
          error: merged.reason,
          warnings: merged.warnings,
          history: current,
        });
      if (merged.status === "overlap" && !parsed.data.replaceOverlaps)
        throw new RetentionConflict(409, {
          status: "overlap",
          error:
            "This package overlaps saved retention history. Confirm replacement before changing stored data.",
          packageId: incoming.packageId,
          existing: metadata(merged.existing),
          warnings: merged.warnings,
          history: current,
        });
      const next =
        merged.status === "overlap"
          ? replaceOverlappingPackageSnapshots(
              current.snapshots,
              current.billingCodeMinutes,
              incoming.snapshots,
              incoming.billingCodeMinutes,
            )
          : merged;
      if (merged.status === "overlap") {
        await tx.delete(localRetentionSnapshotsTable).where(
          and(
            eq(localRetentionSnapshotsTable.practiceId, practice),
            inArray(
              localRetentionSnapshotsTable.snapshotId,
              merged.existing.map((snapshot) => snapshot.id),
            ),
          ),
        );
      }
      await insertSnapshots(tx, practice, incoming.snapshots, actor, {
        packageId: incoming.packageId,
        exportedAt: incoming.exportedAt,
      });
      await saveSettings(tx, practice, next.billingCodeMinutes, actor);
      await recordEvent(
        tx,
        practice,
        actor,
        merged.status === "overlap" ? "replace_package" : "import_package",
        incoming.packageId,
        {
          packageId: incoming.packageId,
          replaceOverlaps: parsed.data.replaceOverlaps,
        },
        {
          saved: metadata(incoming.snapshots),
          replaced:
            merged.status === "overlap" ? metadata(merged.existing) : [],
        },
      );
      return {
        snapshots: next.snapshots,
        billingCodeMinutes: next.billingCodeMinutes,
        status: merged.status === "overlap" ? "replaced" : "added",
        warnings: next.warnings,
      };
    });
    return res.json(result);
  } catch (error) {
    if (error instanceof RetentionConflict)
      return res.status(error.status).json(error.payload);
    logger.error({ error }, "Failed to save local retention package");
    return res
      .status(500)
      .json({ error: "Retention history was not changed. Retry the import." });
  }
});

router.put("/local-retention/billing-code-minutes", async (req, res) => {
  const practice = practiceId(res.locals.actor);
  const actor = res.locals.actor ?? "Unknown actor";
  if (!practice)
    return res.status(403).json({ error: "Owner access is required." });
  try {
    const current = await loadHistory(practice);
    const parsed = importLocalBackup({
      format: "emc-local-retention-v1",
      exportedAt: new Date().toISOString(),
      snapshots: current.snapshots,
      billingCodeMinutes: req.body?.billingCodeMinutes,
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7422, 12)`);
      await saveSettings(tx, practice, parsed.billingCodeMinutes, actor);
      await recordEvent(
        tx,
        practice,
        actor,
        "update_billing_code_minutes",
        null,
        { billingCodeMinutes: parsed.billingCodeMinutes },
        { snapshotCount: current.snapshots.length },
      );
    });
    return res.json(parsed);
  } catch (error) {
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Billing-code minutes could not be saved.",
    });
  }
});

router.put("/local-retention/backup", async (req, res) => {
  const practice = practiceId(res.locals.actor);
  const actor = res.locals.actor ?? "Unknown actor";
  if (!practice)
    return res.status(403).json({ error: "Owner access is required." });
  let parsed;
  try {
    parsed = importLocalBackup(req.body?.backup);
  } catch (error) {
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "The backup could not be read.",
    });
  }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7422, 12)`);
      await tx
        .delete(localRetentionSnapshotsTable)
        .where(eq(localRetentionSnapshotsTable.practiceId, practice));
      await insertSnapshots(tx, practice, parsed.snapshots, actor);
      await saveSettings(tx, practice, parsed.billingCodeMinutes, actor);
      await recordEvent(
        tx,
        practice,
        actor,
        "restore_backup",
        null,
        { snapshotCount: parsed.snapshots.length },
        { restored: metadata(parsed.snapshots) },
      );
      return { ...parsed, status: "restored" as const };
    });
    return res.json(result);
  } catch (error) {
    logger.error({ error }, "Failed to restore local retention backup");
    return res
      .status(500)
      .json({ error: "Retention history was not changed. Retry the restore." });
  }
});

export default router;
