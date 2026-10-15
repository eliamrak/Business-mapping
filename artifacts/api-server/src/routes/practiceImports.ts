import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import {
  db,
  practiceImportAuditTable,
  practiceImportPackagesTable,
  practiceImportSnapshotsTable,
} from "@workspace/db";
import { z } from "@workspace/practice";

const router = Router();

const attendanceStatuses = [
  "show",
  "cancelled",
  "no show",
  "clinician cancelled",
] as const;
type FactKind = "attendance" | "billing";
type AttendanceRow = {
  clientId: string;
  clinician: string;
  serviceDate: string;
  location: string | null;
  status: (typeof attendanceStatuses)[number];
  billingCode?: string | null;
  visitKind?: "consultation";
  sourceRowHash: string;
};
type BillingRow = {
  clientId: string;
  clinician: string;
  serviceDate: string;
  totalFeeCharged: number;
  billingCode: string | null;
  visitKind?: "consultation";
  sourceRowHash: string;
};
type Snapshot = {
  id: string;
  kind: FactKind;
  importedAt: string;
  coverageStart: string;
  coverageEnd: string;
  reportCoverage?: { start: string; end: string; complete: true } | null;
  sourceHash: string;
  rows: AttendanceRow[] | BillingRow[];
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  });
const nonEmpty = z.string().trim().min(1).max(200);
const reportCoverageSchema = z.object({
  start: dateSchema,
  end: dateSchema,
  complete: z.literal(true),
}).strict().refine((value) => value.start <= value.end);
const visitKindSchema = z.literal("consultation").optional();
const packageRowLimit = 100_000;
const billingCodeMinutesSchema = z
  .record(
    z.string().trim().min(1).max(80),
    z.number().finite().min(1).max(1440),
  )
  .default({});
const sameDayVisitOverridesSchema = z
  .record(z.string().regex(/^[0-9a-f]{16}$/), z.number().int().min(1).max(20))
  .default({});
const attendanceRowSchema = z
  .object({
    clientId: nonEmpty,
    clinician: nonEmpty,
    serviceDate: dateSchema,
    location: nonEmpty.nullable(),
    status: z.enum(attendanceStatuses),
    billingCode: nonEmpty.nullable().optional(),
    visitKind: visitKindSchema,
  })
  .strict();
const billingRowSchema = z
  .object({
    clientId: nonEmpty,
    clinician: nonEmpty,
    serviceDate: dateSchema,
    totalFeeCharged: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
    billingCode: nonEmpty.nullable(),
    visitKind: visitKindSchema,
  })
  .strict();
const packageSchema = z
  .object({
    format: z.literal("emc-practice-local-import-package"),
    version: z.literal(1),
    packageId: nonEmpty.max(160),
    exportedAt: z.iso.datetime(),
    collections: z
      .object({
        attendance: z
          .object({
            coverageStart: dateSchema,
            coverageEnd: dateSchema,
            reportCoverage: reportCoverageSchema.optional(),
            rowCount: z.number().int().min(1).max(packageRowLimit),
            rows: z.array(attendanceRowSchema).min(1).max(packageRowLimit),
          })
          .strict(),
        billing: z
          .object({
            coverageStart: dateSchema,
            coverageEnd: dateSchema,
            reportCoverage: reportCoverageSchema.optional(),
            rowCount: z.number().int().min(1).max(packageRowLimit),
            rows: z.array(billingRowSchema).min(1).max(packageRowLimit),
          })
          .strict(),
      })
      .strict(),
    billingCodeMinutes: billingCodeMinutesSchema.optional(),
  })
  .strict();
const importBodySchema = z
  .object({
    package: packageSchema,
    replaceOverlaps: z.boolean().default(false),
    retainOverlaps: z.boolean().default(false),
  })
  .strict()
  .refine((body) => !(body.replaceOverlaps && body.retainOverlaps), { message: "Choose either retain or replace, not both." });
const minutesBodySchema = z
  .object({ billingCodeMinutes: billingCodeMinutesSchema })
  .strict();
const sameDayVisitOverridesBodySchema = z
  .object({ sameDayVisitOverrides: sameDayVisitOverridesSchema })
  .strict();
const coverageConfirmationSchema = z.object({
  snapshotId: z.string().regex(/^(attendance|billing)-[0-9a-f]{8,64}$/),
  reportCoverage: reportCoverageSchema,
  expectedReportCoverage: reportCoverageSchema.nullable(),
  sourceBasis: z.enum(["source-report", "owner-confirmation"]),
  confirmed: z.literal(true),
}).strict();

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const sha256 = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");
const rowHash = (parts: unknown[]) => sha256(parts).slice(0, 16);
const normalizeClinician = (value: string) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();
const sameDayVisitKey = (
  row: Pick<AttendanceRow, "clientId" | "clinician" | "serviceDate">,
) =>
  rowHash([
    "same-day-visit",
    row.clientId,
    normalizeClinician(row.clinician),
    row.serviceDate,
  ]);
const configuredPracticeId = () =>
  (
    process.env.EMC_PRACTICE_ID?.trim() ||
    process.env.EMC_OWNER_EMAIL?.trim() ||
    "default-practice"
  ).toLowerCase();
const scope = (res: { locals: Record<string, unknown> }) => ({
  practiceId: configuredPracticeId(),
  accountId: configuredPracticeId(),
  actor: String(res.locals.actor ?? "unknown-actor"),
});
const coverage = (rows: Array<{ serviceDate: string }>) => {
  const dates = rows.map((row) => row.serviceDate).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
};
const overlaps = (
  a: { kind: string; coverageStart: string; coverageEnd: string },
  b: Snapshot,
) =>
  a.kind === b.kind &&
  a.coverageStart <= b.coverageEnd &&
  b.coverageStart <= a.coverageEnd;

const snapshotFromRow = (row: {
  kind: string;
  createdAt: Date;
  coverageStart: string;
  coverageEnd: string;
  reportCoverage?: unknown;
  sourceHash: string;
  rows: unknown;
}): Snapshot => ({
  id: `${row.kind}-${row.sourceHash}`,
  kind: row.kind as FactKind,
  importedAt: row.createdAt.toISOString(),
  coverageStart: row.coverageStart,
  coverageEnd: row.coverageEnd,
  reportCoverage: (row.reportCoverage ?? null) as Snapshot["reportCoverage"],
  sourceHash: row.sourceHash,
  rows: row.rows as AttendanceRow[] | BillingRow[],
});

const mergeSameDayVisitOverrides = (
  packages: Array<{ sameDayVisitOverrides: unknown }>,
) =>
  packages.reduce<Record<string, number>>(
    (acc, row) => ({
      ...acc,
      ...(row.sameDayVisitOverrides as Record<string, number>),
    }),
    {},
  );

function sameDayShowCounts(snapshots: Snapshot[]) {
  const counts = new Map<string, number>();
  for (const snapshot of snapshots) {
    if (snapshot.kind !== "attendance") continue;
    const seenRows = new Set<string>();
    for (const row of snapshot.rows as AttendanceRow[]) {
      if (row.status !== "show" || seenRows.has(row.sourceRowHash)) continue;
      seenRows.add(row.sourceRowHash);
      const key = sameDayVisitKey(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function reconcileSameDayVisitOverrides(
  overrides: Record<string, number>,
  snapshots: Snapshot[],
) {
  const counts = sameDayShowCounts(snapshots);
  const reconciled: Record<string, number> = {};
  for (const [key, count] of Object.entries(overrides)) {
    const supportedRows = counts.get(key) ?? 0;
    const supportedCount = Math.min(count, supportedRows);
    if (supportedCount > 1) reconciled[key] = supportedCount;
  }
  return reconciled;
}

function toSnapshots(
  input: z.infer<typeof packageSchema>,
  importedAt = new Date().toISOString(),
) {
  const attendanceRows: AttendanceRow[] = input.collections.attendance.rows.map(
    (row, index) => ({
      ...row,
      sourceRowHash: rowHash(["attendance", row, index]),
    }),
  );
  const billingRows: BillingRow[] = input.collections.billing.rows.map(
    (row, index) => ({
      ...row,
      sourceRowHash: rowHash(["billing", row, index]),
    }),
  );
  const attendanceCoverage = coverage(attendanceRows);
  const billingCoverage = coverage(billingRows);
  for (const collection of Object.values(input.collections)) {
    const proof = collection.reportCoverage;
    if (proof && (proof.start > collection.coverageStart || proof.end < collection.coverageEnd))
      throw new Error("Report coverage must contain the observed row span.");
  }
  if (
    attendanceCoverage.start !== input.collections.attendance.coverageStart ||
    attendanceCoverage.end !== input.collections.attendance.coverageEnd ||
    input.collections.attendance.rowCount !== attendanceRows.length
  )
    throw new Error("Attendance coverage and row count must match its rows.");
  if (
    billingCoverage.start !== input.collections.billing.coverageStart ||
    billingCoverage.end !== input.collections.billing.coverageEnd ||
    input.collections.billing.rowCount !== billingRows.length
  )
    throw new Error("Billing coverage and row count must match its rows.");
  const attendanceSourceHash = rowHash(
    attendanceRows.map((row) => row.sourceRowHash),
  );
  const billingSourceHash = rowHash(
    billingRows.map((row) => row.sourceRowHash),
  );
  return [
    {
      id: `package-attendance-${attendanceSourceHash}`,
      kind: "attendance" as const,
      importedAt,
      coverageStart: input.collections.attendance.coverageStart,
      coverageEnd: input.collections.attendance.coverageEnd,
      reportCoverage: input.collections.attendance.reportCoverage,
      sourceHash: attendanceSourceHash,
      rows: attendanceRows,
    },
    {
      id: `package-billing-${billingSourceHash}`,
      kind: "billing" as const,
      importedAt,
      coverageStart: input.collections.billing.coverageStart,
      coverageEnd: input.collections.billing.coverageEnd,
      reportCoverage: input.collections.billing.reportCoverage,
      sourceHash: billingSourceHash,
      rows: billingRows,
    },
  ];
}

// Whole-row JSON extraction does not reference a column absent before migration 008.
const { reportCoverage: _reportCoverageColumn, ...legacySnapshotColumns } =
  getTableColumns(practiceImportSnapshotsTable);
const snapshotColumns = {
  ...legacySnapshotColumns,
  reportCoverage: sql<Snapshot["reportCoverage"]>`to_jsonb(${practiceImportSnapshotsTable}) -> 'report_coverage'`,
};

async function historyFor(practiceId: string, accountId: string) {
  const [snapshots, packages] = await Promise.all([
    db
      .select(snapshotColumns)
      .from(practiceImportSnapshotsTable)
      .where(
        and(
          eq(practiceImportSnapshotsTable.practiceId, practiceId),
          eq(practiceImportSnapshotsTable.accountId, accountId),
          eq(practiceImportSnapshotsTable.active, 1),
        ),
      ),
    db
      .select()
      .from(practiceImportPackagesTable)
      .where(
        and(
          eq(practiceImportPackagesTable.practiceId, practiceId),
          eq(practiceImportPackagesTable.accountId, accountId),
          eq(practiceImportPackagesTable.active, 1),
        ),
      ),
  ]);
  const historySnapshots = snapshots.map(snapshotFromRow);
  return {
    snapshots: historySnapshots,
    billingCodeMinutes: packages.reduce<Record<string, number>>(
      (acc, row) => ({
        ...acc,
        ...(row.billingCodeMinutes as Record<string, number>),
      }),
      {},
    ),
    sameDayVisitOverrides: reconcileSameDayVisitOverrides(
      mergeSameDayVisitOverrides(packages),
      historySnapshots,
    ),
    packages: packages.map((row) => ({
      packageId: row.packageId,
      importedAt: row.importedAt.toISOString(),
      exportedAt: row.exportedAt.toISOString(),
      contentHash: row.contentHash,
    })),
  };
}

router.get("/practice-imports", async (_req, res) => {
  const { practiceId, accountId } = scope(res);
  return res.json(await historyFor(practiceId, accountId));
});

router.post("/practice-imports/package", async (req, res) => {
  const body = importBodySchema.safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({ error: "Choose a valid Practice import package." });
  const { practiceId, accountId, actor } = scope(res);
  const input = body.data.package;
  let snapshots: Snapshot[];
  try {
    snapshots = toSnapshots(input);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid package.",
    });
  }
  const contentHash = sha256({
    packageId: input.packageId,
    snapshots: snapshots.map(
      ({ kind, coverageStart, coverageEnd, sourceHash, reportCoverage }) => ({
        kind,
        coverageStart,
        coverageEnd,
        sourceHash,
        ...(reportCoverage ? { reportCoverage } : {}),
      }),
    ),
    billingCodeMinutes: input.billingCodeMinutes ?? {},
  });
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${practiceId}), hashtext(${accountId}))`,
    );
    const availability = await tx.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('practice_import_snapshots')
          AND attname = 'report_coverage' AND NOT attisdropped
      ) AS available
    `);
    const hasReportCoverage = availability.rows[0]?.available === true;
    if (!hasReportCoverage && snapshots.some((snapshot) => snapshot.reportCoverage))
      return { status: "migration-required" as const };
    const [samePackage] = await tx
      .select()
      .from(practiceImportPackagesTable)
      .where(
        and(
          eq(practiceImportPackagesTable.practiceId, practiceId),
          eq(practiceImportPackagesTable.accountId, accountId),
          eq(practiceImportPackagesTable.packageId, input.packageId),
        ),
      );
    if (samePackage) {
      if (samePackage.contentHash !== contentHash)
        return { status: "changed-package" as const };
      return { status: "duplicate" as const };
    }
    const active = await tx
      .select(snapshotColumns)
      .from(practiceImportSnapshotsTable)
      .where(
        and(
          eq(practiceImportSnapshotsTable.practiceId, practiceId),
          eq(practiceImportSnapshotsTable.accountId, accountId),
          eq(practiceImportSnapshotsTable.active, 1),
        ),
      );
    if (body.data.retainOverlaps && snapshots.some((snapshot) => active.some((row) =>
      snapshot.kind === row.kind && snapshot.sourceHash === row.sourceHash
      && stableJson(snapshot.reportCoverage ?? null) !== stableJson(row.reportCoverage ?? null),
    ))) return { status: "coverage-review" as const };
    const activePackages = await tx
      .select()
      .from(practiceImportPackagesTable)
      .where(
        and(
          eq(practiceImportPackagesTable.practiceId, practiceId),
          eq(practiceImportPackagesTable.accountId, accountId),
          eq(practiceImportPackagesTable.active, 1),
        ),
      );
    const duplicateActiveKeys = new Set(
      active
        .filter((row) =>
          snapshots.some(
            (snapshot) =>
              snapshot.kind === row.kind &&
              snapshot.sourceHash === row.sourceHash &&
              stableJson(snapshot.reportCoverage ?? null) === stableJson(row.reportCoverage ?? null),
          ),
        )
        .map((row) => `${row.kind}\u0000${row.sourceHash}`),
    );
    const snapshotsToInsert = snapshots.filter(
      (snapshot) =>
        !duplicateActiveKeys.has(
          `${snapshot.kind}\u0000${snapshot.sourceHash}`,
        ),
    );
    if (!snapshotsToInsert.length) return { status: "duplicate" as const };
    const overlapping = active.filter((row) =>
      snapshotsToInsert.some((snapshot) => overlaps(row, snapshot)),
    );
    if (overlapping.length && !body.data.replaceOverlaps && !body.data.retainOverlaps)
      return {
        status: "overlap" as const,
        existing: overlapping.map((row) => ({
          kind: row.kind,
          coverageStart: row.coverageStart,
          coverageEnd: row.coverageEnd,
          rowCount: row.rowCount,
        })),
        incoming: snapshotsToInsert.map((snapshot) => ({
          kind: snapshot.kind,
          coverageStart: snapshot.coverageStart,
          coverageEnd: snapshot.coverageEnd,
          rowCount: snapshot.rows.length,
        })),
      };
    const packageImportId = randomUUID();
    const replacing = overlapping.length > 0 && body.data.replaceOverlaps;
    const retaining = overlapping.length > 0 && body.data.retainOverlaps;
    const replacementOverrides = replacing
      ? reconcileSameDayVisitOverrides(
          mergeSameDayVisitOverrides(activePackages),
          [
            ...active
              .filter(
                (row) =>
                  !overlapping.some(
                    (overlappingRow) => overlappingRow.id === row.id,
                  ),
              )
              .map(snapshotFromRow),
            ...snapshotsToInsert,
          ],
        )
      : {};
    if (replacing)
      await tx
        .update(practiceImportSnapshotsTable)
        .set({ active: 0 })
        .where(
          inArray(
            practiceImportSnapshotsTable.id,
            overlapping.map((row) => row.id),
          ),
        );
    const replacedPackageIds = [
      ...new Set(replacing ? overlapping.map((row) => row.packageImportId) : []),
    ];
    if (replacedPackageIds.length) {
      const retainedPackageRows = await tx
        .select({
          packageImportId: practiceImportSnapshotsTable.packageImportId,
        })
        .from(practiceImportSnapshotsTable)
        .where(
          and(
            inArray(
              practiceImportSnapshotsTable.packageImportId,
              replacedPackageIds,
            ),
            eq(practiceImportSnapshotsTable.active, 1),
          ),
        );
      const retainedPackageIds = new Set(
        retainedPackageRows.map((row) => row.packageImportId),
      );
      const fullyReplacedPackageIds = replacedPackageIds.filter(
        (id) => !retainedPackageIds.has(id),
      );
      if (fullyReplacedPackageIds.length)
        await tx
          .update(practiceImportPackagesTable)
          .set({ active: 0 })
          .where(
            inArray(practiceImportPackagesTable.id, fullyReplacedPackageIds),
          );
    }
    await tx.insert(practiceImportPackagesTable).values({
      id: packageImportId,
      practiceId,
      accountId,
      packageId: input.packageId,
      contentHash,
      exportedAt: new Date(input.exportedAt),
      importedBy: actor,
      billingCodeMinutes: body.data.retainOverlaps ? {} : input.billingCodeMinutes ?? {},
      sameDayVisitOverrides: replacementOverrides,
    });
    for (const snapshot of snapshotsToInsert) {
      // Omit the physical column entirely for legacy writes before migration 008.
      await tx.execute(sql`
        INSERT INTO practice_import_snapshots
          (id, package_import_id, practice_id, account_id, kind,
           coverage_start, coverage_end, source_hash, row_count, rows
           ${hasReportCoverage ? sql`, report_coverage` : sql``})
        VALUES (${randomUUID()}, ${packageImportId}, ${practiceId}, ${accountId},
          ${snapshot.kind}, ${snapshot.coverageStart}, ${snapshot.coverageEnd},
          ${snapshot.sourceHash}, ${snapshot.rows.length}, ${JSON.stringify(snapshot.rows)}::jsonb
          ${hasReportCoverage ? sql`, ${snapshot.reportCoverage ? JSON.stringify(snapshot.reportCoverage) : null}::jsonb` : sql``})
      `);
    }
    await tx.insert(practiceImportAuditTable).values({
      id: randomUUID(),
      practiceId,
      accountId,
      packageId: input.packageId,
      action: replacing ? "replace-overlap" : retaining ? "retain-overlap" : "import",
      actor,
      detail: {
        replacedSnapshotCount: replacing ? overlapping.length : 0,
        retainedOverlapSnapshotCount: retaining ? overlapping.length : 0,
        skippedDuplicateSnapshotCount:
          snapshots.length - snapshotsToInsert.length,
        attendanceRows:
          snapshotsToInsert.find((snapshot) => snapshot.kind === "attendance")
            ?.rows.length ?? 0,
        billingRows:
          snapshotsToInsert.find((snapshot) => snapshot.kind === "billing")
            ?.rows.length ?? 0,
      },
    });
    return {
      status: replacing ? ("replaced" as const) : retaining ? ("retained" as const) : ("added" as const),
    };
  });
  if (result.status === "migration-required")
    return res.status(503).json({
      code: "REPORT_COVERAGE_MIGRATION_REQUIRED",
      error: "Report coverage cannot be saved until migration 008_practice_report_coverage.sql is applied.",
    });
  if (result.status === "changed-package")
    return res.status(409).json({
      code: "PACKAGE_ID_CHANGED_CONTENT",
      error:
        "This package ID was already imported with different contents. Create a corrected package with a new package ID.",
    });
  if (result.status === "coverage-review")
    return res.status(409).json({
      code: "COVERAGE_REVIEW_REQUIRED",
      error: "This source is already loaded with different report coverage. Review or revise the existing import in Confirm report coverage before importing again; retaining cannot create another active copy of the same source.",
    });
  if (result.status === "overlap")
    return res.status(409).json({
      code: "OVERLAP_REVIEW_REQUIRED",
      error: "This package overlaps existing converted history.",
      existing: result.existing,
      incoming: result.incoming,
    });
  return res.json({
    status: result.status,
    ...(await historyFor(practiceId, accountId)),
  });
});

router.put("/practice-imports/report-coverage", async (req, res) => {
  const body = coverageConfirmationSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Enter report dates, source basis, explicit confirmation and the expected prior coverage." });
  const { practiceId, accountId, actor } = scope(res);
  const proof = body.data.reportCoverage;
  if (proof.end > new Date().toISOString().slice(0, 10))
    return res.status(400).json({ error: "Confirmed report coverage cannot end in the future." });
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${practiceId}), hashtext(${accountId}))`);
    const availability = await tx.execute(sql`
      SELECT EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('practice_import_snapshots')
          AND attname = 'report_coverage' AND NOT attisdropped) AS available
    `);
    if (availability.rows[0]?.available !== true) return { status: "migration-required" as const };
    const active = await tx.select(snapshotColumns).from(practiceImportSnapshotsTable).where(and(
      eq(practiceImportSnapshotsTable.practiceId, practiceId),
      eq(practiceImportSnapshotsTable.accountId, accountId),
      eq(practiceImportSnapshotsTable.active, 1),
    ));
    const matches = active.filter((row) => `${row.kind}-${row.sourceHash}` === body.data.snapshotId);
    if (!matches.length) return { status: "not-found" as const };
    if (matches.length !== 1) return { status: "ambiguous" as const };
    const snapshot = matches[0];
    const oldReportCoverage = snapshot.reportCoverage ?? null;
    if (stableJson(oldReportCoverage) !== stableJson(body.data.expectedReportCoverage)) return { status: "stale" as const };
    const rows = snapshot.rows as Array<{ serviceDate: string }>;
    if (!dateSchema.safeParse(snapshot.coverageStart).success || !dateSchema.safeParse(snapshot.coverageEnd).success
      || snapshot.coverageStart > snapshot.coverageEnd || proof.start > snapshot.coverageStart || proof.end < snapshot.coverageEnd
      || !Array.isArray(rows) || rows.some((row) => !dateSchema.safeParse(row?.serviceDate).success || row.serviceDate < proof.start || row.serviceDate > proof.end))
      return { status: "invalid-range" as const };
    const updated = await tx.update(practiceImportSnapshotsTable).set({ reportCoverage: proof }).where(and(
      eq(practiceImportSnapshotsTable.id, snapshot.id),
      eq(practiceImportSnapshotsTable.practiceId, practiceId),
      eq(practiceImportSnapshotsTable.accountId, accountId),
      eq(practiceImportSnapshotsTable.active, 1),
      sql`${practiceImportSnapshotsTable.reportCoverage} IS NOT DISTINCT FROM ${oldReportCoverage === null ? null : JSON.stringify(oldReportCoverage)}::jsonb`,
    )).returning({ id: practiceImportSnapshotsTable.id });
    if (updated.length !== 1) return { status: "stale" as const };
    await tx.insert(practiceImportAuditTable).values({
      id: randomUUID(), practiceId, accountId, packageId: body.data.snapshotId,
      action: "confirm-report-coverage", actor,
      detail: { snapshotId: body.data.snapshotId, oldReportCoverage, newReportCoverage: proof,
        sourceBasis: body.data.sourceBasis, confirmed: true },
    });
    return { status: "saved" as const };
  });
  if (result.status === "migration-required") return res.status(503).json({ code: "REPORT_COVERAGE_MIGRATION_REQUIRED", error: "Report coverage cannot be saved until migration 008_practice_report_coverage.sql is applied." });
  if (result.status === "not-found") return res.status(404).json({ error: "That active import was not found in this practice." });
  if (result.status === "ambiguous") return res.status(409).json({ code: "AMBIGUOUS_SNAPSHOT_ID", error: "Multiple active imports share this identity. Resolve the duplicate before confirming coverage." });
  if (result.status === "stale") return res.status(409).json({ code: "STALE_REPORT_COVERAGE", error: "Report coverage changed. Reload import history before confirming again." });
  if (result.status === "invalid-range") return res.status(400).json({ error: "Report coverage must contain the observed bounds and every valid service date. Contradictory or invalid source dates require source review." });
  return res.json(await historyFor(practiceId, accountId));
});

router.put("/practice-imports/billing-code-minutes", async (req, res) => {
  const body = minutesBodySchema.safeParse(req.body);
  if (!body.success)
    return res.status(400).json({ error: "Check the billing-code minutes." });
  const { practiceId, accountId, actor } = scope(res);
  await db.transaction(async (tx) => {
    await tx
      .update(practiceImportPackagesTable)
      .set({ billingCodeMinutes: body.data.billingCodeMinutes })
      .where(
        and(
          eq(practiceImportPackagesTable.practiceId, practiceId),
          eq(practiceImportPackagesTable.accountId, accountId),
          eq(practiceImportPackagesTable.active, 1),
        ),
      );
    await tx.insert(practiceImportAuditTable).values({
      id: randomUUID(),
      practiceId,
      accountId,
      packageId: "billing-code-minutes",
      action: "update-billing-code-minutes",
      actor,
      detail: { codeCount: Object.keys(body.data.billingCodeMinutes).length },
    });
  });
  return res.json(await historyFor(practiceId, accountId));
});

router.put("/practice-imports/same-day-visit-overrides", async (req, res) => {
  const body = sameDayVisitOverridesBodySchema.safeParse(req.body);
  if (!body.success)
    return res
      .status(400)
      .json({ error: "Check the same-day visit overrides." });
  const { practiceId, accountId, actor } = scope(res);
  await db.transaction(async (tx) => {
    const snapshots = (
      await tx
        .select(snapshotColumns)
        .from(practiceImportSnapshotsTable)
        .where(
          and(
            eq(practiceImportSnapshotsTable.practiceId, practiceId),
            eq(practiceImportSnapshotsTable.accountId, accountId),
            eq(practiceImportSnapshotsTable.active, 1),
          ),
        )
    ).map(snapshotFromRow);
    const sameDayVisitOverrides = reconcileSameDayVisitOverrides(
      body.data.sameDayVisitOverrides,
      snapshots,
    );
    await tx
      .update(practiceImportPackagesTable)
      .set({ sameDayVisitOverrides })
      .where(
        and(
          eq(practiceImportPackagesTable.practiceId, practiceId),
          eq(practiceImportPackagesTable.accountId, accountId),
          eq(practiceImportPackagesTable.active, 1),
        ),
      );
    await tx.insert(practiceImportAuditTable).values({
      id: randomUUID(),
      practiceId,
      accountId,
      packageId: "same-day-visit-overrides",
      action: "update-same-day-visit-overrides",
      actor,
      detail: {
        requestedOverrideCount: Object.keys(body.data.sameDayVisitOverrides)
          .length,
        storedOverrideCount: Object.keys(sameDayVisitOverrides).length,
      },
    });
  });
  return res.json(await historyFor(practiceId, accountId));
});

export default router;
