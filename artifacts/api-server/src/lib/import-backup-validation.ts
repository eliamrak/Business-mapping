import { z } from "@workspace/practice";
import {
  billingChargeResolutionSchema, importDeclarationsSchema, restoreHistoricalBillingProviders,
  type StoredImportDeclarations,
} from "@workspace/practice/hub";

const text = z.string().min(1).max(320).refine(value => value.trim().length > 0);
const stamp = z.iso.datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const scope = { practice_id: text, account_id: text };
const flag = z.union([z.literal(0), z.literal(1)]);
const minutes = z.record(z.string().trim().min(1).max(80), z.number().finite().min(1).max(1440));
const overrides = z.record(z.string().regex(/^[0-9a-f]{16}$/), z.number().int().min(1).max(20));
const proof = z.object({ start: date, end: date, complete: z.literal(true) }).strict()
  .refine(value => value.start <= value.end);
const packageRow = z.object({
  id: z.uuid(), ...scope, package_id: text, content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  exported_at: stamp, imported_at: stamp, imported_by: text,
  billing_code_minutes: minutes, same_day_visit_overrides: overrides, active: flag,
}).strict();
const commonFact = { clientId: text, clinician: text, serviceDate: date,
  sourceRowHash: z.string().min(1).max(200), billingCode: z.string().max(200).nullable().optional(),
  visitKind: z.literal("consultation").optional() };
const attendance = z.object({ ...commonFact, location: text.nullable(),
  status: z.enum(["show", "cancelled", "no show", "clinician cancelled"]),
  cancellationSubtype: z.literal("late_cancelled").optional(),
}).strict().refine(row => row.cancellationSubtype === undefined || row.status === "cancelled");
const billing = z.object({ ...commonFact, totalFeeCharged: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER) }).strict();
const snapshotRow = z.object({
  id: z.uuid(), package_import_id: z.uuid(), ...scope,
  kind: z.enum(["attendance", "billing"]), coverage_start: date, coverage_end: date,
  report_coverage: proof.nullable().optional(), source_hash: z.string().regex(/^[0-9a-f]{8,64}$/),
  row_count: z.number().int().min(1).max(100000), rows: z.array(z.unknown()).min(1).max(100000),
  active: flag, created_at: stamp,
}).strict();
const declarationRow = z.object({ ...scope, revision: z.number().int().positive(),
  data: importDeclarationsSchema, confirmed_at: stamp, confirmed_by: text }).strict();
const auditRow = z.object({ id: z.uuid(), ...scope, package_id: text, action: text, actor: text,
  detail: z.record(z.string(), z.unknown()), created_at: stamp }).strict();

/** The same invariant is used by recovery validation and the production reader. */
export function parseBillingResolutionJournal(details: readonly unknown[]) {
  const events = z.array(z.object({ revision: z.number().int().positive(),
    resolution: billingChargeResolutionSchema }).passthrough()).max(1000).parse(details)
    .sort((a, b) => a.revision - b.revision);
  if (events.some((row, index) => row.revision !== index + 1)
    || new Set(events.map(row => row.resolution.id)).size !== events.length
    || new Set(events.map(row => row.resolution.approvalToken)).size !== events.length)
    throw new Error("Billing resolution journal requires review.");
  return { billingResolutionRevision: events.length, billingResolutions: events.map(row => row.resolution) };
}

export function parseStoredImportDeclarations(
  data: unknown, revision: unknown, confirmedAt: unknown, historicalDetails: readonly unknown[],
): StoredImportDeclarations {
  const parsed = importDeclarationsSchema.parse(data);
  const confirmedRevision = z.number().int().positive().parse(revision);
  const confirmed = stamp.parse(confirmedAt);
  const historicalBillingProviders = restoreHistoricalBillingProviders(historicalDetails, confirmedRevision);
  return { revision: confirmedRevision, data: { ...parsed, ...(historicalBillingProviders ? { historicalBillingProviders } : {}) },
    confirmedAt: new Date(confirmed).toISOString() };
}

type Tables = Record<string, Record<string, unknown>[]>;
const scopeKey = (row: { practice_id: string; account_id: string }) => JSON.stringify([row.practice_id, row.account_id]);
function unique<T>(rows: T[], key: (row: T) => string) {
  if (new Set(rows.map(key)).size !== rows.length) throw new Error("Duplicate durable import identity.");
}

/** Validate all scopes and archived records without rewriting facts or reviving stale approvals. */
export function validateDurableImportBackup(tables: Tables) {
  const packages = z.array(packageRow).parse(tables.practice_import_packages);
  const snapshots = z.array(snapshotRow).parse(tables.practice_import_snapshots);
  const declarations = z.array(declarationRow).parse(tables.practice_import_declarations);
  const audits = z.array(auditRow).parse(tables.practice_import_audit);
  unique(packages, row => row.id);
  unique(packages, row => JSON.stringify([scopeKey(row), row.package_id]));
  unique(snapshots, row => row.id);
  unique(declarations, scopeKey);
  unique(audits, row => row.id);
  const parents = new Map(packages.map(row => [row.id, row]));
  for (const snapshot of snapshots) {
    const parent = parents.get(snapshot.package_import_id);
    if (!parent || scopeKey(parent) !== scopeKey(snapshot)) throw new Error("Snapshot package or practice scope does not match.");
    if (snapshot.row_count !== snapshot.rows.length || snapshot.coverage_start > snapshot.coverage_end)
      throw new Error("Snapshot row count or observed dates are invalid.");
    const rows = snapshot.kind === "attendance" ? z.array(attendance).parse(snapshot.rows) : z.array(billing).parse(snapshot.rows);
    if (rows.some(row => row.serviceDate < snapshot.coverage_start || row.serviceDate > snapshot.coverage_end))
      throw new Error("Snapshot service dates exceed its observed coverage.");
    if (snapshot.report_coverage && (snapshot.report_coverage.start > snapshot.coverage_start
      || snapshot.report_coverage.end < snapshot.coverage_end)) throw new Error("Snapshot report proof does not contain its observed dates.");
  }
  const scopeAudits = new Map<string, typeof audits>();
  for (const row of audits) {
    const key = scopeKey(row);
    const group = scopeAudits.get(key) ?? [];
    group.push(row);
    scopeAudits.set(key, group);
  }
  const scopeDeclarations = new Map(declarations.map(row => [scopeKey(row), row]));
  for (const key of new Set([...scopeDeclarations.keys(), ...scopeAudits.keys()])) {
    const events = scopeAudits.get(key) ?? [];
    parseBillingResolutionJournal(events.filter(row => row.action === "accept-billing-charge-exception").map(row => row.detail));
    const historical = events.filter(row => row.action === "confirm-historical-billing-providers").map(row => row.detail);
    const declaration = scopeDeclarations.get(key);
    if (!declaration && historical.length) throw new Error("Historical billing journal requires its declaration revision.");
    if (declaration) parseStoredImportDeclarations(declaration.data, declaration.revision, declaration.confirmed_at, historical);
  }
}
