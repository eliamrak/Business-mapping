import { z } from "zod/v4";
import type { BillingChargeResolution, BillingChargeResolutionEvidence } from "./billing-resolution.ts";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
export const normalizeProviderLabel = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
export const providerMappingSchema = z.object({
  sourceLabel: z.string().trim().min(1).max(200),
  clinicianId: z.number().int().positive(),
  clinicianLabel: z.string().trim().min(1).max(200),
  teamId: z.number().int().positive().nullable(),
}).strict();
export const sourceSetCoverageSchema = z.object({
  kind: z.enum(["attendance", "billing"]),
  snapshotIds: z.array(z.string().regex(/^(attendance|billing)-[0-9a-f]{8,64}$/)).min(1).max(1000),
  clinicianIds: z.array(z.number().int().positive()).min(1).max(1000),
  start: date,
  end: date,
  complete: z.literal(true),
}).strict().refine((row) => row.start <= row.end, { message: "Coverage dates are reversed." });
export const historicalBillingProviderSchema = z.object({
  id: z.uuid(),
  sourceLabel: z.string().trim().min(1).max(200),
  sourceSets: z.array(z.object({
    snapshotIds: z.array(z.string().regex(/^billing-[0-9a-f]{8,64}$/)).min(1).max(1000),
    start: date, end: date, complete: z.literal(true),
  }).strict().refine((row) => row.start <= row.end, { message: "Coverage dates are reversed." })).min(1).max(100),
}).strict();
export const importDeclarationsSchema = z.object({
  version: z.literal(1),
  mappings: z.array(providerMappingSchema).max(1000),
  sourceSets: z.array(sourceSetCoverageSchema).max(100),
  historicalBillingProviders: z.array(historicalBillingProviderSchema).max(1000).optional(),
}).strict().superRefine((data, ctx) => {
  const keys = data.mappings.map((row) => normalizeProviderLabel(row.sourceLabel));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["mappings"], message: "A source label may have only one mapping." });
  const history = data.historicalBillingProviders ?? [];
  const historicalKeys = history.map((row) => normalizeProviderLabel(row.sourceLabel));
  if (new Set(history.map((row) => row.id)).size !== history.length || new Set(historicalKeys).size !== history.length || historicalKeys.some((key) => keys.includes(key)))
    ctx.addIssue({ code: "custom", path: ["historicalBillingProviders"], message: "Historical billing identities must be unique and separate from clinician mappings." });
  for (const provider of history) for (const set of provider.sourceSets) if (new Set(set.snapshotIds).size !== set.snapshotIds.length)
    ctx.addIssue({ code: "custom", path: ["historicalBillingProviders"], message: "Historical billing source members must be unique." });
  for (const [i, set] of data.sourceSets.entries()) {
    if (new Set(set.snapshotIds).size !== set.snapshotIds.length || new Set(set.clinicianIds).size !== set.clinicianIds.length)
      ctx.addIssue({ code: "custom", path: ["sourceSets", i], message: "Duplicate source or clinician in coverage set." });
  }
});
export type ImportDeclarations = z.infer<typeof importDeclarationsSchema>;
/** In-memory composition only. Billing approvals are stored in their separate audit journal. */
export type ImportEvidenceDeclarations = ImportDeclarations & { billingResolutions?: readonly BillingChargeResolutionEvidence[] };
export type ProviderMapping = z.infer<typeof providerMappingSchema>;
export type SourceSetCoverage = z.infer<typeof sourceSetCoverageSchema>;
export type HistoricalBillingProvider = z.infer<typeof historicalBillingProviderSchema>;
export const historicalBillingJournalSchema = z.object({
  version: z.literal(1), declarationRevision: z.number().int().positive(),
  providers: z.array(historicalBillingProviderSchema).max(1000),
}).strict();

/** Separate append-only metadata lets older releases ignore this feature without failing strict declaration reads. */
export function restoreHistoricalBillingProviders(details: readonly unknown[], declarationRevision: number) {
  if (details.length > 1000 || (details.length > 0 && (!Number.isInteger(declarationRevision) || declarationRevision < 1))) throw new Error("Historical billing metadata requires review.");
  const rows = details.map((detail) => {
    const parsed = historicalBillingJournalSchema.safeParse(detail);
    if (!parsed.success) throw new Error("Historical billing metadata requires review.");
    return parsed.data;
  }).sort((a, b) => a.declarationRevision - b.declarationRevision);
  if (rows.some((row, index) => row.declarationRevision > declarationRevision || (index > 0 && row.declarationRevision === rows[index - 1].declarationRevision))) throw new Error("Historical billing metadata requires review.");
  const identities = new Map<string, string>();
  for (const row of rows) for (const provider of row.providers) {
    const label = normalizeProviderLabel(provider.sourceLabel);
    if (identities.has(provider.id) && identities.get(provider.id) !== label) throw new Error("Historical billing metadata requires review.");
    identities.set(provider.id, label);
  }
  const providers = rows.at(-1)?.providers;
  if (providers && !importDeclarationsSchema.safeParse({ version: 1, mappings: [], sourceSets: [], historicalBillingProviders: providers }).success) throw new Error("Historical billing metadata requires review.");
  return providers;
}

/** An explicit billing-only identity never becomes a clinician or resolves a staff-name collision. */
export function resolveHistoricalBillingProvider(label: string, roster: readonly { label: string }[], declarations?: ImportDeclarations | null) {
  const key = normalizeProviderLabel(label);
  if (roster.some((person) => normalizeProviderLabel(person.label) === key) || declarations?.mappings.some((row) => normalizeProviderLabel(row.sourceLabel) === key)) return null;
  const matches = declarations?.historicalBillingProviders?.filter((row) => normalizeProviderLabel(row.sourceLabel) === key) ?? [];
  return matches.length === 1 ? matches[0].id : null;
}

export function validateHistoricalBillingProviders(data: ImportDeclarations, roster: readonly { label: string }[], snapshots: readonly {
  id: string; kind: string; rows: readonly { clinician: string; serviceDate: string }[];
}[]) {
  const issues: string[] = [];
  for (const provider of data.historicalBillingProviders ?? []) {
    if (resolveHistoricalBillingProvider(provider.sourceLabel, roster, data) !== provider.id) issues.push("A historical billing label conflicts with a clinician identity; review the exact source identity.");
    for (const set of provider.sourceSets) {
      const members = set.snapshotIds.map((id) => snapshots.filter((source) => source.id === id && source.kind === "billing"));
      if (members.some((matches) => matches.length !== 1)) { issues.push("A historical billing source set is missing an active member; reconfirm its frozen sources."); continue; }
      if (!members.flat().some((source) => source.rows.some((row) => normalizeProviderLabel(row.clinician) === normalizeProviderLabel(provider.sourceLabel)))) issues.push("A historical billing provider is absent from its confirmed sources.");
      if (members.flat().some((source) => source.rows.some((row) => !date.safeParse(row.serviceDate).success || row.serviceDate < set.start || row.serviceDate > set.end))) issues.push("Historical billing coverage must enclose every member source's valid service dates.");
    }
  }
  return [...new Set(issues)];
}

export const unverifiedDeletionMarker = (value: string) => /deleted/i.test(value);
export const deletionMarkerGuidance = "Unverified deletion marker: review the export's provider/status fields before import. Confirm a historical billing-only identity explicitly; do not strip a marker or match it to a clinician automatically.";
export type StoredImportDeclarations = {
  revision: number;
  data: ImportDeclarations;
  confirmedAt: string;
};

/** An explicit mapping can resolve copies, never merge them or follow a moved/renamed target. */
export function resolveImportedProvider(
  label: string, roster: readonly { id: number; label: string; goalId?: number | null }[],
  teamId: number | null, declarations?: ImportDeclarations | null,
): number | null {
  const key = normalizeProviderLabel(label);
  const explicit = declarations?.mappings.filter((row) => normalizeProviderLabel(row.sourceLabel) === key) ?? [];
  if (explicit.length) {
    if (explicit.length !== 1) return null;
    const mapping = explicit[0];
    const target = roster.find((row) => row.id === mapping.clinicianId);
    return mapping.teamId === teamId && target && (target.goalId ?? null) === teamId
      && target.label === mapping.clinicianLabel ? target.id : null;
  }
  const matches = [...new Map(roster.filter((row) => normalizeProviderLabel(row.label) === key).map((row) => [row.id, row])).values()];
  return matches.length === 1 && (matches[0].goalId ?? null) === teamId ? matches[0].id : null;
}

export function bindBillingResolutions(resolutions: readonly BillingChargeResolution[], roster: readonly { id: number; label: string; goalId?: number | null }[], declarations?: ImportDeclarations | null): BillingChargeResolutionEvidence[] {
  return resolutions.map((resolution) => {
    const mappings = declarations?.mappings.filter((row) => normalizeProviderLabel(row.sourceLabel) === normalizeProviderLabel(resolution.clinicianLabel)) ?? [];
    const valid = resolution.historicalProviderId !== undefined
      ? resolution.clinicianId === undefined && resolveHistoricalBillingProvider(resolution.clinicianLabel, roster, declarations) === resolution.historicalProviderId
      : mappings.length === 1 && resolveImportedProvider(resolution.clinicianLabel, roster, mappings[0].teamId, declarations) === resolution.clinicianId;
    return { ...resolution, ...(!valid ? { mappingInvalid: true as const } : {}) };
  });
}
