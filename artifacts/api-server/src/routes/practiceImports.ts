import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import {
  db,
  practiceImportAuditTable,
  practiceImportPackagesTable,
  practiceImportSnapshotsTable,
  cliniciansTable,
} from "@workspace/db";
import { z } from "@workspace/practice";
import { parseBillingResolutionJournal, parseStoredImportDeclarations } from "../lib/import-backup-validation";
import { assessAutomaticOverlap, overlapReviewMessage, sameSourceCoverageChanged } from "../lib/import-overlap-reconciliation";
import { importDeclarationsSchema, normalizeProviderLabel, prepareBillingChargeResolution, reconcileBillingEvidence,
  resolveImportedProvider, bindBillingResolutions, resolveHistoricalBillingProvider,
  validateHistoricalBillingProviders, restoreHistoricalBillingProviders, unverifiedDeletionMarker, deletionMarkerGuidance, legacyServiceCodes, planNextReportPeriod, type StoredImportDeclarations } from "@workspace/practice/hub";

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
  cancellationSubtype?: "late_cancelled";
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
    clinician: nonEmpty.refine((value) => !unverifiedDeletionMarker(value), { message: deletionMarkerGuidance }),
    serviceDate: dateSchema,
    location: nonEmpty.nullable(),
    status: z.enum(attendanceStatuses),
    cancellationSubtype: z.literal("late_cancelled").optional(),
    billingCode: nonEmpty.refine((value) => !unverifiedDeletionMarker(value), { message: deletionMarkerGuidance }).nullable().optional(),
    visitKind: visitKindSchema,
  })
  .strict().refine(row => row.cancellationSubtype === undefined || row.status === "cancelled", { message: "Late cancellation detail requires cancelled status." });
const billingRowSchema = z
  .object({
    clientId: nonEmpty,
    clinician: nonEmpty.refine((value) => !unverifiedDeletionMarker(value), { message: deletionMarkerGuidance }),
    serviceDate: dateSchema,
    totalFeeCharged: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
    billingCode: nonEmpty.refine((value) => !unverifiedDeletionMarker(value), { message: deletionMarkerGuidance }).nullable(),
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

async function packageSources(connection: Pick<typeof db, "execute">, practiceId: string, accountId: string,
  snapshots: { packageImportId: string; kind: string; sourceHash: string }[], packages: { id: string; packageId: string }[]) {
  const activeIds = new Set(snapshots.map(row => `${row.kind}-${row.sourceHash}`));
  const validPair = (value: unknown): value is string[] => Array.isArray(value) && value.length === 2
    && value.every(id => typeof id === "string" && activeIds.has(id))
    && value.filter(id => id.startsWith("attendance-")).length === 1
    && value.filter(id => id.startsWith("billing-")).length === 1;
  const audit = await connection.execute(sql`SELECT package_id, detail FROM practice_import_audit
    WHERE practice_id = ${practiceId} AND account_id = ${accountId}
    AND action IN ('import', 'retain-overlap', 'replace-overlap') LIMIT 10001`);
  const result = new Map<string, string[]>();
  if (audit.rows.length >= 10001) return result;
  for (const pkg of packages) {
    const receipts = audit.rows.filter(row => row.package_id === pkg.packageId)
      .map(row => (row.detail as { sourceIds?: unknown } | null)?.sourceIds).filter(value => value !== undefined);
    if (receipts.length) {
      if (receipts.every(validPair) && new Set(receipts.map(ids => [...ids].sort().join("|"))).size === 1)
        result.set(pkg.id, [...receipts[0] as string[]].sort());
    } else {
      const owned = snapshots.filter(row => row.packageImportId === pkg.id).map(row => `${row.kind}-${row.sourceHash}`);
      if (validPair(owned)) result.set(pkg.id, owned.sort());
    }
  }
  return result;
}

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
  const packageSourceIds = await packageSources(db, practiceId, accountId, snapshots, packages);
  return {
    ...(await readBillingResolutionJournal(db, practiceId, accountId)),
    declarations: await readDeclarations(db, practiceId, accountId),
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
      sourceIds: [...(packageSourceIds.get(row.id) ?? [])].sort(),
    })),
  };
}

async function readDeclarations(connection: Pick<typeof db, "execute">, practiceId: string, accountId: string): Promise<StoredImportDeclarations | null> {
  const availability = await connection.execute(sql`SELECT to_regclass('practice_import_declarations') IS NOT NULL AS available`);
  if (availability.rows[0]?.available !== true) return null;
  const result = await connection.execute(sql`SELECT revision, data, confirmed_at FROM practice_import_declarations WHERE practice_id = ${practiceId} AND account_id = ${accountId}`);
  const row = result.rows[0];
  if (!row) return null;
  const journal = await connection.execute(sql`SELECT detail FROM practice_import_audit WHERE practice_id = ${practiceId} AND account_id = ${accountId} AND action = 'confirm-historical-billing-providers' LIMIT 1001`);
  return parseStoredImportDeclarations(row.data, Number(row.revision), new Date(String(row.confirmed_at)).toISOString(), journal.rows.map((entry) => entry.detail));
}

async function readBillingResolutionJournal(connection: Pick<typeof db, "execute">, practiceId: string, accountId: string) {
  const result = await connection.execute(sql`SELECT detail FROM practice_import_audit
    WHERE practice_id = ${practiceId} AND account_id = ${accountId} AND action = 'accept-billing-charge-exception' LIMIT 1001`);
  return parseBillingResolutionJournal(result.rows.map(row => row.detail));
}

function billingApprovalCases(snapshots: Snapshot[], practiceId: string, accountId: string) {
  const entries = snapshots.flatMap((source) => source.kind === "billing"
    ? (source.rows as BillingRow[]).map((row) => ({ row, snapshotId: source.id })) : []);
  const byRow = new Map(entries.map((entry) => [entry.row, entry]));
  return reconcileBillingEvidence(entries).map((group) => {
    const members = group.rows.map((row) => byRow.get(row)!);
    const caseToken = sha256([practiceId, accountId, members.map((entry) => stableJson(entry)).sort()]);
    return { group, members, caseToken, draft: prepareBillingChargeResolution(members) };
  });
}

router.get("/practice-imports/billing-resolution-candidates", async (_req, res) => {
  const { practiceId, accountId } = scope(res);
  const history = await historyFor(practiceId, accountId);
  const roster = await db.select().from(cliniciansTable);
  const data = history.declarations?.data;
  const effective = reconcileBillingEvidence(history.snapshots.flatMap((source) => source.kind === "billing"
    ? (source.rows as BillingRow[]).map((row) => ({ row, snapshotId: source.id })) : []), bindBillingResolutions(history.billingResolutions, roster, data));
  const states = new Map(effective.map((group) => [group.row, group]));
  const candidates = billingApprovalCases(history.snapshots, practiceId, accountId).flatMap(({ group, members, caseToken, draft }) => {
    const state = states.get(group.row)!;
    if (!group.conflicting && !group.ambiguous && !state.resolutionId && !state.resolutionStale) return [];
    const mapping = draft && data?.mappings.find((row) => normalizeProviderLabel(row.sourceLabel) === normalizeProviderLabel(draft.clinicianLabel));
    const clinicianId = mapping ? resolveImportedProvider(draft!.clinicianLabel, roster, mapping.teamId, data) : null;
    const historicalProviderId = draft ? resolveHistoricalBillingProvider(draft.clinicianLabel, roster, data) : null;
    return [{ caseToken, clinicianLabel: group.row.clinician, serviceDate: group.row.serviceDate,
      billingCode: group.row.billingCode, amounts: draft?.charges.map((row) => row.amount) ?? null,
      rawRowCount: group.rows.length, sourceCount: new Set(members.map((row) => row.snapshotId)).size,
      conflicting: group.conflicting, ambiguous: group.ambiguous, resolutionId: state.resolutionId ?? null,
      stale: !!state.resolutionStale, canAccept: !!draft && (clinicianId !== null || historicalProviderId !== null) && !state.resolutionId && !state.resolutionStale }];
  });
  return res.json({ revision: history.billingResolutionRevision, candidates });
});

const billingAcceptanceSchema = z.object({
  caseToken: z.string().regex(/^[0-9a-f]{64}$/), expectedRevision: z.number().int().nonnegative(), confirmed: z.literal(true),
  clinicianLabel: nonEmpty, serviceDate: dateSchema, amounts: z.tuple([z.number().finite().positive(), z.number().finite().positive()]),
  approvalNote: z.string().trim().min(1).max(2000),
}).strict();
router.post("/practice-imports/billing-resolutions", async (req, res) => {
  const body = billingAcceptanceSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Select the exact two-charge case, expected metadata revision, approval note and explicit confirmation." });
  const { practiceId, accountId, actor } = scope(res);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${practiceId}), hashtext(${accountId}))`);
    const old = await readDeclarations(tx, practiceId, accountId);
    if (!old) return "declarations";
    const active = await tx.select(snapshotColumns).from(practiceImportSnapshotsTable).where(and(
      eq(practiceImportSnapshotsTable.practiceId, practiceId), eq(practiceImportSnapshotsTable.accountId, accountId), eq(practiceImportSnapshotsTable.active, 1),
    ));
    const snapshots = active.map(snapshotFromRow);
    const cases = billingApprovalCases(snapshots, practiceId, accountId);
    const journal = await readBillingResolutionJournal(tx, practiceId, accountId);
    const stored = journal.billingResolutions;
    const roster = await tx.select().from(cliniciansTable);
    const exact = cases.find((row) => row.caseToken === body.data.caseToken);
    const previous = stored.find((row) => row.approvalToken === body.data.caseToken);
    const effective = reconcileBillingEvidence(snapshots.flatMap((source) => source.kind === "billing"
      ? (source.rows as BillingRow[]).map((row) => ({ row, snapshotId: source.id })) : []), bindBillingResolutions(stored, roster, old.data));
    const applied = previous ? effective.find((group) => group.resolutionId === previous.id)
      : exact ? effective.find((group) => group.row === exact.group.row) : undefined;
    const selector = (row: { clinicianLabel: string; serviceDate: string; charges: Array<{ amount: number }> }) =>
      normalizeProviderLabel(row.clinicianLabel) === normalizeProviderLabel(body.data.clinicianLabel) && row.serviceDate === body.data.serviceDate
      && stableJson(row.charges.map((charge) => charge.amount).sort((a, b) => a - b)) === stableJson([...body.data.amounts].sort((a, b) => a - b));
    if (previous && applied?.resolutionId === previous.id && selector(previous)) return "duplicate";
    if (exact && applied?.resolutionId) {
      const resolution = stored.find((row) => row.id === applied.resolutionId)!;
      if (selector(resolution)) return "duplicate";
    }
    if (journal.billingResolutionRevision !== body.data.expectedRevision || !exact) return "stale";
    if (!exact.draft || !selector(exact.draft) || (!exact.group.conflicting && !exact.group.ambiguous)) return "invalid";
    const draft = exact.draft;
    if (stored.some((row) => row.clientId === draft.clientId && normalizeProviderLabel(row.clinicianLabel) === normalizeProviderLabel(draft.clinicianLabel)
      && row.serviceDate === draft.serviceDate && row.billingCode === draft.billingCode)) return "stale";
    const mapping = old.data.mappings.find((row) => normalizeProviderLabel(row.sourceLabel) === normalizeProviderLabel(draft.clinicianLabel));
    const clinicianId = mapping ? resolveImportedProvider(draft.clinicianLabel, roster, mapping.teamId, old.data) : null;
    const historicalProviderId = resolveHistoricalBillingProvider(draft.clinicianLabel, roster, old.data);
    if (clinicianId === null && historicalProviderId === null) return "mapping";
    const resolution = { ...draft, id: randomUUID(), approvalToken: body.data.caseToken,
      ...(clinicianId !== null ? { clinicianId } : { historicalProviderId: historicalProviderId! }),
      confirmedAt: new Date().toISOString(), approvalNote: body.data.approvalNote };
    await tx.insert(practiceImportAuditTable).values({ id: randomUUID(), practiceId, accountId, packageId: "billing-resolution:" + resolution.id,
      action: "accept-billing-charge-exception", actor,
      detail: { resolution, oldRevision: journal.billingResolutionRevision, revision: journal.billingResolutionRevision + 1, rawRowCount: exact.members.length,
        basis: "owner-confirmation", affectsAttendance: false } });
    return "saved";
  });
  if (result === "declarations" || result === "mapping") return res.status(409).json({ error: "An existing confirmed provider mapping is required before accepting this billing case." });
  if (result === "stale") return res.status(409).json({ error: "The case, pinned evidence or metadata revision changed. Reload and review; no exception was saved." });
  if (result === "invalid") return res.status(400).json({ error: "This is not the exact eligible two-charge case. No attendance count or source facts were changed." });
  return res.json({ ...(await historyFor(practiceId, accountId)), resolutionStatus: result });
});

router.put("/practice-imports/declarations", async (req, res) => {
  const parsed = z.object({ expectedRevision: z.number().int().nonnegative(), confirmed: z.literal(true), data: importDeclarationsSchema,
    nextPeriod: z.object({ packageId: z.string().min(1).max(200), sourceIds: z.array(z.string().regex(/^(attendance|billing)-[0-9a-f]{8,64}$/)).length(2), teamId: z.number().int().positive().nullable() }).strict().optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter explicit provider mappings, source-set dates and confirmation." });
  const { practiceId, accountId, actor } = scope(res);
  const { data: incomingData, expectedRevision } = parsed.data;
  if ([...incomingData.sourceSets, ...(incomingData.historicalBillingProviders ?? []).flatMap((provider) => provider.sourceSets)].some((set) => set.end > new Date().toISOString().slice(0, 10))) return res.status(400).json({ error: "Coverage cannot end in the future." });
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${practiceId}), hashtext(${accountId}))`);
    const available = await tx.execute(sql`SELECT to_regclass('practice_import_declarations') IS NOT NULL AS available`);
    if (available.rows[0]?.available !== true) return "migration";
    const old = await readDeclarations(tx, practiceId, accountId);
    if ((old?.revision ?? 0) !== expectedRevision) return "stale";
    const data = { ...incomingData, ...(incomingData.historicalBillingProviders === undefined && old?.data.historicalBillingProviders
      ? { historicalBillingProviders: old.data.historicalBillingProviders } : {}) };
    const roster = await tx.select().from(cliniciansTable);
    const active = await tx.select(snapshotColumns).from(practiceImportSnapshotsTable).where(and(
      eq(practiceImportSnapshotsTable.practiceId, practiceId), eq(practiceImportSnapshotsTable.accountId, accountId), eq(practiceImportSnapshotsTable.active, 1),
    ));
    const snapshots = active.map(snapshotFromRow);
    let nextPeriodAudit: { period: { start: string; end: string; payDate: string } | null; sourceIds: string[]; carryover: { rows: number; matched: number; conflicts: number } } | null = null;
    if (parsed.data.nextPeriod) {
      const packages = await tx.select().from(practiceImportPackagesTable).where(and(
        eq(practiceImportPackagesTable.practiceId, practiceId), eq(practiceImportPackagesTable.accountId, accountId), eq(practiceImportPackagesTable.active, 1),
      ));
      const pkg = packages.find(row => row.packageId === parsed.data.nextPeriod!.packageId);
      const pair = pkg ? (await packageSources(tx, practiceId, accountId, active, packages)).get(pkg.id) : undefined;
      if (!pair || stableJson(pair) !== stableJson([...parsed.data.nextPeriod.sourceIds].sort()))
        return { status: "next-period-review" as const, reasons: ["This source pair does not match the saved upload. Reload saved history before reconciling."], period: null };
      const journal = await readBillingResolutionJournal(tx, practiceId, accountId);
      const plan = planNextReportPeriod({ snapshots, storedDeclarations: old, roster, teamId: parsed.data.nextPeriod.teamId,
        newSourceIds: parsed.data.nextPeriod.sourceIds, today: new Date().toISOString().slice(0, 10), billingResolutions: journal.billingResolutions });
      if (plan.status !== "ready" || !plan.data || stableJson(plan.data) !== stableJson(data))
        return { status: "next-period-review" as const, reasons: plan.reasons.length ? plan.reasons : ["The reporting-period proposal changed. Reload saved history before reconciling."], period: plan.period };
      nextPeriodAudit = { period: plan.period, sourceIds: parsed.data.nextPeriod.sourceIds, carryover: plan.carryover };
    }
    if (validateHistoricalBillingProviders(data, roster, snapshots).length) return "historical";
    for (const provider of data.historicalBillingProviders ?? []) {
      const prior = old?.data.historicalBillingProviders?.find((row) => row.id === provider.id);
      if (prior && normalizeProviderLabel(prior.sourceLabel) !== normalizeProviderLabel(provider.sourceLabel)) return "historical";
    }
    for (const mapping of data.mappings) {
      const target = roster.find((row) => row.id === mapping.clinicianId);
      if (!target || target.label !== mapping.clinicianLabel || (target.goalId ?? null) !== mapping.teamId
        || normalizeProviderLabel(mapping.sourceLabel) !== normalizeProviderLabel(target.label)) return "target";
      if (!snapshots.some((source) => source.rows.some((row) => normalizeProviderLabel(row.clinician) === normalizeProviderLabel(mapping.sourceLabel)))) return "source";
    }
    for (const set of data.sourceSets) {
      const members = set.snapshotIds.map((id) => snapshots.filter((row) => row.id === id));
      if (members.some((matches) => matches.length !== 1 || matches[0].kind !== set.kind)) return "source";
      if (members.flat().some((snapshot) => snapshot.rows.some((row) => !dateSchema.safeParse(row.serviceDate).success || row.serviceDate < set.start || row.serviceDate > set.end))) return "range";
      for (const id of set.clinicianIds) {
        const mappings = data.mappings.filter((row) => row.clinicianId === id);
        if (!mappings.length || !mappings.some((mapping) => members.flat().some((snapshot) => snapshot.rows.some((row) => normalizeProviderLabel(row.clinician) === normalizeProviderLabel(mapping.sourceLabel))))) return "target";
      }
      // A declaration cannot silently certify a provider omitted from its explicit scope.
      if (members.flat().some((snapshot) => snapshot.rows.some((row) => !data.mappings.some((mapping) => set.clinicianIds.includes(mapping.clinicianId) && normalizeProviderLabel(mapping.sourceLabel) === normalizeProviderLabel(row.clinician)) && resolveHistoricalBillingProvider(row.clinician, roster, data) === null))) return "target";
    }
    const { historicalBillingProviders, ...storedData } = data;
    const historyChanged = stableJson(historicalBillingProviders ?? []) !== stableJson(old?.data.historicalBillingProviders ?? []);
    if (historyChanged) {
      const journal = await tx.execute(sql`SELECT detail FROM practice_import_audit WHERE practice_id = ${practiceId} AND account_id = ${accountId} AND action = 'confirm-historical-billing-providers' LIMIT 1001`);
      try { restoreHistoricalBillingProviders([...journal.rows.map((entry) => entry.detail), { version: 1, declarationRevision: expectedRevision + 1, providers: historicalBillingProviders ?? [] }], expectedRevision + 1); }
      catch { return "historical"; }
    }
    const saved = await tx.execute(sql`INSERT INTO practice_import_declarations (practice_id, account_id, revision, data, confirmed_at, confirmed_by)
      VALUES (${practiceId}, ${accountId}, ${expectedRevision + 1}, ${JSON.stringify(storedData)}::jsonb, now(), ${actor})
      ON CONFLICT (practice_id, account_id) DO UPDATE SET revision = EXCLUDED.revision, data = EXCLUDED.data, confirmed_at = EXCLUDED.confirmed_at, confirmed_by = EXCLUDED.confirmed_by
      WHERE practice_import_declarations.revision = ${expectedRevision} RETURNING revision`);
    if (saved.rows.length !== 1) throw new Error("Import declaration revision changed during confirmation.");
    if (historyChanged)
      await tx.insert(practiceImportAuditTable).values({ id: randomUUID(), practiceId, accountId, packageId: "historical-billing-providers", action: "confirm-historical-billing-providers", actor,
        detail: { version: 1, declarationRevision: expectedRevision + 1, providers: historicalBillingProviders ?? [] } });
    await tx.insert(practiceImportAuditTable).values({ id: randomUUID(), practiceId, accountId, packageId: "import-declarations", action: "confirm-import-declarations", actor,
      detail: { oldDeclarations: old, newDeclarations: storedData, revision: expectedRevision + 1,
        basis: nextPeriodAudit ? "known-next-reporting-period" : "owner-confirmation", ...(nextPeriodAudit ? { nextPeriod: nextPeriodAudit } : {}) } });
    return "saved";
  });
  if (typeof result === "object" && result.status === "next-period-review") return res.status(409).json({ code: "NEXT_PERIOD_REVIEW_REQUIRED", error: result.reasons.join(" "), period: result.period });
  if (result === "migration") return res.status(503).json({ code: "IMPORT_DECLARATIONS_MIGRATION_REQUIRED", error: "Apply migration 009 before confirming mappings and source sets." });
  if (result === "stale") return res.status(409).json({ error: "Import declarations changed. Reload before confirming." });
  if (result === "historical") return res.status(400).json({ error: "Historical billing identity or frozen source coverage needs review. Do not create a clinician card or reuse an active clinician name." });
  if (result !== "saved") return res.status(400).json({ error: result === "range" ? "Source-set coverage must contain every member's valid service dates." : "A provider target, explicit source scope or source-set member needs review." });
  return res.json(await historyFor(practiceId, accountId));
});

router.get("/practice-imports/capabilities", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({
    readerProtocol: "legacy-codes-late-cancellation-v1",
    packageFormat: "emc-practice-local-import-package",
    packageVersion: 1,
    cancellationSubtypes: ["late_cancelled"],
    billingCodeEncoding: "string-or-null",
    unclassifiedZero: { storedCode: "0", defaultMinutes: null, equivalentToFiveZeros: false },
    serviceCodes: legacyServiceCodes,
  });
});

router.get("/practice-imports", async (_req, res) => {
  const { practiceId, accountId } = scope(res);
  return res.json(await historyFor(practiceId, accountId));
});

router.post("/practice-imports/package", async (req, res) => {
  const body = importBodySchema.safeParse(req.body);
  if (!body.success) {
    const marker = body.error.issues.some((issue) => issue.message === deletionMarkerGuidance
      || (issue.code === "unrecognized_keys" && issue.keys.some(unverifiedDeletionMarker)));
    return res
      .status(400)
      .json({ error: marker ? deletionMarkerGuidance : "Choose a valid Practice import package; review unsupported provider/status fields before import." });
  }
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
    const activeSnapshots = active.map(snapshotFromRow);
    if (sameSourceCoverageChanged(activeSnapshots, snapshots))
      return { status: "coverage-review" as const };
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
    // Declared bounds select evidence to review; they do not grant completeness.
    // Keep replacement's observed-overlap scope unchanged.
    const admissionBounds = (snapshot: Snapshot) => {
      const proof = reportCoverageSchema.safeParse(snapshot.reportCoverage);
      return proof.success && proof.data.start <= snapshot.coverageStart && proof.data.end >= snapshot.coverageEnd
        ? { ...snapshot, coverageStart: proof.data.start, coverageEnd: proof.data.end } : snapshot;
    };
    const reviewOverlapping = active.filter((row) => snapshotsToInsert.some(snapshot =>
      overlaps(admissionBounds(snapshotFromRow(row)), admissionBounds(snapshot))));
    let automaticRetention = false;
    let automaticReviewRequired = false;
    let overlapReason: string | undefined;
    // Complete-report omissions and saved aliases can conflict outside observed row spans.
    if (reviewOverlapping.length && !body.data.replaceOverlaps && !body.data.retainOverlaps) {
      // requireAccess restricts this route to this installation's configured owner.
      // Clinicians are installation-wide (no tenant columns), as in /clinicians and existing identity routes.
      // Import sources/declarations remain scoped by practiceId + accountId; never infer a tenant from goalId.
      const roster = await tx.select({ id: cliniciansTable.id, label: cliniciansTable.label, goalId: cliniciansTable.goalId }).from(cliniciansTable);
      const declarations = await readDeclarations(tx, practiceId, accountId);
      const savedVisitOverrides = mergeSameDayVisitOverrides(activePackages);
      const assessment = assessAutomaticOverlap(activeSnapshots, snapshotsToInsert, (label) => {
        const matches = roster.filter(person => normalizeProviderLabel(person.label) === normalizeProviderLabel(label));
        // Alias migration and historical billing-only source sets require explicit identity review.
        return matches.length === 1 && resolveImportedProvider(label, roster, matches[0].goalId ?? null, declarations?.data) === matches[0].id;
      }, row => savedVisitOverrides[sameDayVisitKey(row)] !== undefined, (label) => {
        const key = normalizeProviderLabel(label);
        const mappings = declarations?.data.mappings.filter(mapping => normalizeProviderLabel(mapping.sourceLabel) === key) ?? [];
        // Even a stale saved alias is related evidence, not permission to select its facts.
        if (mappings.length === 1) return mappings[0].clinicianId;
        const matches = roster.filter(person => normalizeProviderLabel(person.label) === key);
        return matches.length === 1 ? matches[0].id : null;
      });
      automaticRetention = assessment.safe;
      automaticReviewRequired = !assessment.safe;
      overlapReason = assessment.reason;
    }
    if (automaticReviewRequired)
      return {
        status: "overlap" as const,
        reason: overlapReason,
        existing: reviewOverlapping.map((row) => ({
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
    const retaining = automaticRetention || (overlapping.length > 0 && body.data.retainOverlaps);
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
      billingCodeMinutes: retaining || body.data.retainOverlaps ? {} : input.billingCodeMinutes ?? {},
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
        sourceIds: snapshots.map(snapshot => `${snapshot.kind}-${snapshot.sourceHash}`).sort(),
        replacedSnapshotCount: replacing ? overlapping.length : 0,
        retainedOverlapSnapshotCount: retaining ? (automaticRetention ? reviewOverlapping.length : overlapping.length) : 0,
        automaticOverlapReconciliation: automaticRetention,
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
      error: overlapReviewMessage(result.reason),
      reason: result.reason,
      existing: result.existing,
      incoming: result.incoming,
    });
  return res.json({
    status: result.status,
    importedSourceIds: snapshots.map(source => `${source.kind}-${source.sourceHash}`),
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
