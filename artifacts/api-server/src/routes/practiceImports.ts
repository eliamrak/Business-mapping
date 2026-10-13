import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  sourceRowHash: string;
};
type BillingRow = {
  clientId: string;
  clinician: string;
  serviceDate: string;
  totalFeeCharged: number;
  billingCode: string | null;
  sourceRowHash: string;
};
type Snapshot = {
  id: string;
  kind: FactKind;
  importedAt: string;
  coverageStart: string;
  coverageEnd: string;
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
const packageRowLimit = 100_000;
const billingCodeMinutesSchema = z
  .record(
    z.string().trim().min(1).max(80),
    z.number().finite().min(1).max(1440),
  )
  .default({});
const attendanceRowSchema = z
  .object({
    clientId: nonEmpty,
    clinician: nonEmpty,
    serviceDate: dateSchema,
    location: nonEmpty.nullable(),
    status: z.enum(attendanceStatuses),
  })
  .strict();
const billingRowSchema = z
  .object({
    clientId: nonEmpty,
    clinician: nonEmpty,
    serviceDate: dateSchema,
    totalFeeCharged: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
    billingCode: nonEmpty.nullable(),
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
            rowCount: z.number().int().min(1).max(packageRowLimit),
            rows: z.array(attendanceRowSchema).min(1).max(packageRowLimit),
          })
          .strict(),
        billing: z
          .object({
            coverageStart: dateSchema,
            coverageEnd: dateSchema,
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
  })
  .strict();
const minutesBodySchema = z
  .object({ billingCodeMinutes: billingCodeMinutesSchema })
  .strict();

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

function toSnapshots(
  input: z.infer<typeof packageSchema>,
  importedAt = new Date().toISOString(),
) {
  const attendanceRows: AttendanceRow[] = input.collections.attendance.rows.map(
    (row, index) => ({
      ...row,
      sourceRowHash: rowHash([input.packageId, "attendance", row, index]),
    }),
  );
  const billingRows: BillingRow[] = input.collections.billing.rows.map(
    (row, index) => ({
      ...row,
      sourceRowHash: rowHash([input.packageId, "billing", row, index]),
    }),
  );
  const attendanceCoverage = coverage(attendanceRows);
  const billingCoverage = coverage(billingRows);
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
      sourceHash: attendanceSourceHash,
      rows: attendanceRows,
    },
    {
      id: `package-billing-${billingSourceHash}`,
      kind: "billing" as const,
      importedAt,
      coverageStart: input.collections.billing.coverageStart,
      coverageEnd: input.collections.billing.coverageEnd,
      sourceHash: billingSourceHash,
      rows: billingRows,
    },
  ];
}

async function historyFor(practiceId: string, accountId: string) {
  const [snapshots, packages] = await Promise.all([
    db
      .select()
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
  return {
    snapshots: snapshots.map(
      (row): Snapshot => ({
        id: `${row.kind}-${row.sourceHash}`,
        kind: row.kind as FactKind,
        importedAt: row.createdAt.toISOString(),
        coverageStart: row.coverageStart,
        coverageEnd: row.coverageEnd,
        sourceHash: row.sourceHash,
        rows: row.rows as AttendanceRow[] | BillingRow[],
      }),
    ),
    billingCodeMinutes: packages.reduce<Record<string, number>>(
      (acc, row) => ({
        ...acc,
        ...(row.billingCodeMinutes as Record<string, number>),
      }),
      {},
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
    exportedAt: input.exportedAt,
    snapshots: snapshots.map(
      ({ kind, coverageStart, coverageEnd, sourceHash }) => ({
        kind,
        coverageStart,
        coverageEnd,
        sourceHash,
      }),
    ),
    billingCodeMinutes: input.billingCodeMinutes ?? {},
  });
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${practiceId}), hashtext(${accountId}))`,
    );
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
      .select()
      .from(practiceImportSnapshotsTable)
      .where(
        and(
          eq(practiceImportSnapshotsTable.practiceId, practiceId),
          eq(practiceImportSnapshotsTable.accountId, accountId),
          eq(practiceImportSnapshotsTable.active, 1),
        ),
      );
    const overlapping = active.filter((row) =>
      snapshots.some((snapshot) => overlaps(row, snapshot)),
    );
    if (overlapping.length && !body.data.replaceOverlaps)
      return {
        status: "overlap" as const,
        existing: overlapping.map((row) => ({
          kind: row.kind,
          coverageStart: row.coverageStart,
          coverageEnd: row.coverageEnd,
          rowCount: row.rowCount,
        })),
      };
    const packageImportId = randomUUID();
    if (overlapping.length)
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
      ...new Set(overlapping.map((row) => row.packageImportId)),
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
      billingCodeMinutes: input.billingCodeMinutes ?? {},
    });
    await tx.insert(practiceImportSnapshotsTable).values(
      snapshots.map((snapshot) => ({
        id: randomUUID(),
        packageImportId,
        practiceId,
        accountId,
        kind: snapshot.kind,
        coverageStart: snapshot.coverageStart,
        coverageEnd: snapshot.coverageEnd,
        sourceHash: snapshot.sourceHash,
        rowCount: snapshot.rows.length,
        rows: snapshot.rows,
      })),
    );
    await tx.insert(practiceImportAuditTable).values({
      id: randomUUID(),
      practiceId,
      accountId,
      packageId: input.packageId,
      action: overlapping.length ? "replace-overlap" : "import",
      actor,
      detail: {
        replacedSnapshotCount: overlapping.length,
        attendanceRows: snapshots[0].rows.length,
        billingRows: snapshots[1].rows.length,
      },
    });
    return {
      status: overlapping.length ? ("replaced" as const) : ("added" as const),
    };
  });
  if (result.status === "changed-package")
    return res.status(409).json({
      code: "PACKAGE_ID_CHANGED_CONTENT",
      error:
        "This package ID was already imported with different contents. Create a corrected package with a new package ID.",
    });
  if (result.status === "overlap")
    return res.status(409).json({
      code: "OVERLAP_REVIEW_REQUIRED",
      error: "This package overlaps existing converted history.",
      existing: result.existing,
      incoming: snapshots.map((snapshot) => ({
        kind: snapshot.kind,
        coverageStart: snapshot.coverageStart,
        coverageEnd: snapshot.coverageEnd,
        rowCount: snapshot.rows.length,
      })),
    });
  return res.json({
    status: result.status,
    ...(await historyFor(practiceId, accountId)),
  });
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

export default router;
