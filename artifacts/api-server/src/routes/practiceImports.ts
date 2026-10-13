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
const sameDayVisitOverridesBodySchema = z
  .object({ sameDayVisitOverrides: sameDayVisitOverridesSchema })
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
  sourceHash: string;
  rows: unknown;
}): Snapshot => ({
  id: `${row.kind}-${row.sourceHash}`,
  kind: row.kind as FactKind,
  importedAt: row.createdAt.toISOString(),
  coverageStart: row.coverageStart,
  coverageEnd: row.coverageEnd,
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
              snapshot.sourceHash === row.sourceHash,
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
    if (overlapping.length && !body.data.replaceOverlaps)
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
    const replacementOverrides = overlapping.length
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
      sameDayVisitOverrides: replacementOverrides,
    });
    await tx.insert(practiceImportSnapshotsTable).values(
      snapshotsToInsert.map((snapshot) => ({
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
      incoming: result.incoming,
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
        .select()
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
