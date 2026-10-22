import { z } from "zod/v4";
import type { BillingCodeResolution } from "./billing-code-resolution.ts";

const anchor = z.object({ snapshotId: z.string().min(1).max(300), sourceRowHash: z.string().min(1).max(200) }).strict();
const charge = z.object({ amount: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER), anchor }).strict();
export const billingChargeResolutionSchema = z.object({
  id: z.uuid(),
  approvalToken: z.string().regex(/^[0-9a-f]{64}$/),
  clinicianId: z.number().int().positive().optional(),
  historicalProviderId: z.uuid().optional(),
  clinicianLabel: z.string().trim().min(1).max(200),
  /** Existing de-identified key, retained internally; never displayed in candidate/review output. */
  clientId: z.string().trim().min(1).max(200),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billingCode: z.string().max(200),
  visitKind: z.string().max(100),
  charges: z.tuple([charge, charge]),
  confirmedAt: z.iso.datetime(),
  approvalNote: z.string().trim().min(1).max(2000),
}).strict().refine(row => (row.clinicianId !== undefined) !== (row.historicalProviderId !== undefined), {
  message: "An approval requires exactly one clinician or historical billing identity.",
});
export type BillingChargeResolution = z.infer<typeof billingChargeResolutionSchema>;
export type BillingResolution = BillingChargeResolution | BillingCodeResolution;
/** Derived validation only; never persisted as part of an approval. */
export type BillingChargeResolutionEvidence = BillingResolution & { mappingInvalid?: true };
