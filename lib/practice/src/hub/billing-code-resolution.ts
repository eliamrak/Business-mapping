import { z } from "zod/v4";
import type { EncounterBillingRow } from "./billing-evidence.ts";
import { isConsultationService, isDocumentationService } from "./service-codes.ts";

const text = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
export const billingEncounterKey = (row: EncounterBillingRow) => JSON.stringify([row.clientId.trim(), text(row.clinician), row.serviceDate]);
export type BillingCodeEntry<T extends EncounterBillingRow = EncounterBillingRow> = { snapshotId: string; row: T };
const evidenceSchema = z.object({
  snapshotId: z.string().min(1).max(300), sourceRowHash: z.string().min(1).max(200),
  billingCode: z.string().max(200).nullable(), visitKind: z.string().max(100).nullable(),
  cancellationSubtype: z.string().max(100).nullable(), totalFeeCharged: z.number().finite(),
}).strict();
export const billingCodeResolutionSchema = z.object({
  kind: z.literal("billing-code"), id: z.uuid(), approvalToken: z.string().regex(/^[0-9a-f]{64}$/),
  clinicianId: z.number().int().positive().optional(), historicalProviderId: z.uuid().optional(),
  clinicianLabel: z.string().trim().min(1).max(200), clientId: z.string().trim().min(1).max(200),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  evidence: z.array(evidenceSchema).min(2).max(1000),
  selected: z.object({ snapshotId: z.string().min(1).max(300), sourceRowHash: z.string().min(1).max(200) }).strict(),
  confirmedAt: z.iso.datetime(), approvalNote: z.string().trim().min(1).max(2000),
}).strict().refine(row => (row.clinicianId !== undefined) !== (row.historicalProviderId !== undefined), {
  message: "A code choice requires exactly one confirmed provider identity.",
}).refine(row => new Set(row.evidence.map(entry => entry.snapshotId)).size === row.evidence.length
  && row.evidence.some(entry => entry.snapshotId === row.selected.snapshotId && entry.sourceRowHash === row.selected.sourceRowHash), {
  message: "A code choice must select one of its exact single-row source anchors.",
});
export type BillingCodeResolution = z.infer<typeof billingCodeResolutionSchema>;
export const isBillingCodeResolution = (row: unknown): row is BillingCodeResolution => !!row && typeof row === "object" && "kind" in row && row.kind === "billing-code";
const evidence = ({ snapshotId, row }: BillingCodeEntry) => ({ snapshotId, sourceRowHash: row.sourceRowHash,
  billingCode: row.billingCode ?? null, visitKind: row.visitKind ?? null,
  cancellationSubtype: row.cancellationSubtype ?? null, totalFeeCharged: row.totalFeeCharged });
const orderedEvidence = (entries: readonly BillingCodeEntry[]) => entries.map(evidence)
  .sort((a, b) => a.snapshotId.localeCompare(b.snapshotId) || a.sourceRowHash.localeCompare(b.sourceRowHash));
const serviceKind = (row: EncounterBillingRow) => isConsultationService(row) ? "consultation" : isDocumentationService(row) ? "documentation" : "treatment";
const hashFacts = (row: EncounterBillingRow) => JSON.stringify([billingEncounterKey(row), row.billingCode ?? null,
  row.visitKind ?? null, row.cancellationSubtype ?? null, row.totalFeeCharged]);
export function billingCodeHashConflicts(entries: readonly BillingCodeEntry[], members: readonly BillingCodeEntry[]) {
  const expected = new Map(members.map(entry => [entry.row.sourceRowHash, hashFacts(entry.row)]));
  return entries.some(entry => expected.has(entry.row.sourceRowHash) && expected.get(entry.row.sourceRowHash) !== hashFacts(entry.row));
}

/** This resolves alternate codes for one charge, never same-day visit multiplicity. */
export function prepareBillingCodeResolution<T extends EncounterBillingRow>(entries: readonly BillingCodeEntry<T>[]) {
  if (entries.length < 2 || entries.length > 1000) return null;
  const first = entries[0].row;
  // PHONE versus literal zero is the disputed code itself, not an independently
  // exported visit-kind conflict. It may be reviewed only for a free encounter.
  const freePhoneZeroDispute = entries.some(({ row }) => text(row.billingCode) === "phone")
    && entries.some(({ row }) => text(row.billingCode) === "0")
    && entries.every(({ row }) => ["phone", "0"].includes(text(row.billingCode))
      && row.totalFeeCharged === 0 && row.visitKind == null);
  if (!first.clientId.trim() || !text(first.clinician) || new Set(entries.map(entry => entry.snapshotId)).size !== entries.length
    || entries.some(({ snapshotId, row }) => !snapshotId || !row.sourceRowHash?.trim() || !Number.isFinite(row.totalFeeCharged)
      || billingEncounterKey(row) !== billingEncounterKey(first) || row.totalFeeCharged !== first.totalFeeCharged
      || serviceKind(row) !== serviceKind(first) && !freePhoneZeroDispute
      || (row.visitKind ?? null) !== (first.visitKind ?? null) || (row.cancellationSubtype ?? null) !== (first.cancellationSubtype ?? null))
    || new Set(entries.map(({ row }) => text(row.billingCode))).size < 2
    || billingCodeHashConflicts(entries, entries)) return null;
  return { clientId: first.clientId.trim(), clinicianLabel: first.clinician, serviceDate: first.serviceDate,
    evidence: orderedEvidence(entries) };
}

export function acceptedBillingCodeRow<T extends EncounterBillingRow>(entries: readonly BillingCodeEntry<T>[], resolution: BillingCodeResolution): T | null {
  const draft = prepareBillingCodeResolution(entries);
  if (!draft || draft.clientId !== resolution.clientId || text(draft.clinicianLabel) !== text(resolution.clinicianLabel)
    || draft.serviceDate !== resolution.serviceDate || JSON.stringify(draft.evidence) !== JSON.stringify(resolution.evidence)) return null;
  return entries.find(entry => entry.snapshotId === resolution.selected.snapshotId
    && entry.row.sourceRowHash === resolution.selected.sourceRowHash)?.row ?? null;
}
