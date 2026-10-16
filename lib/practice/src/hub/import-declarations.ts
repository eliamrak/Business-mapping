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
export const importDeclarationsSchema = z.object({
  version: z.literal(1),
  mappings: z.array(providerMappingSchema).max(1000),
  sourceSets: z.array(sourceSetCoverageSchema).max(100),
}).strict().superRefine((data, ctx) => {
  const keys = data.mappings.map((row) => normalizeProviderLabel(row.sourceLabel));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["mappings"], message: "A source label may have only one mapping." });
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
    const valid = mappings.length === 1 && resolveImportedProvider(resolution.clinicianLabel, roster, mappings[0].teamId, declarations) === resolution.clinicianId;
    return { ...resolution, ...(!valid ? { mappingInvalid: true as const } : {}) };
  });
}
