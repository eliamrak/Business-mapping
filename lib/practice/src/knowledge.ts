import { z } from "zod/v4";

export const knowledgeCategories = ["operations", "archetypes", "voice", "resources"] as const;
export const knowledgeCategorySchema = z.enum(knowledgeCategories);
const identifier = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const plainText = z.string().trim().min(1).max(20000)
  .refine(value => !/<\/?[a-z!][^>]*>/i.test(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), "Use plain text; HTML and control characters are not supported.");
export const knowledgeScopeSchema = z.object({ practiceId: identifier, principalId: identifier }).strict();
export type KnowledgeScope = z.infer<typeof knowledgeScopeSchema>;
export const knowledgeContentSchema = z.object({
  blocks: z.array(z.object({ kind: z.enum(["heading", "paragraph"]), text: plainText }).strict()).min(1).max(100),
}).strict().refine(value => value.blocks.reduce((sum, block) => sum + block.text.length, 0) <= 100000, "Resource exceeds text limit.");
export const knowledgeResourceSchema = knowledgeScopeSchema.extend({
  id: z.uuid(), kind: z.enum(["sop", "map", "reference", "audience", "brand"]).default("reference"), title: plainText.pipe(z.string().max(160)), category: knowledgeCategorySchema,
  audience: z.literal("owner").default("owner"),
  publishedVersion: z.number().int().positive().nullable().default(null),
  archived: z.boolean().default(false),
}).strict();
export const knowledgeSourceAuthorizationSchema = knowledgeScopeSchema.extend({
  fileId: identifier, epoch: z.number().int().positive(), state: z.enum(["approved", "revoked", "deleted", "unapproved"]),
  approvedBy: identifier.nullable(), approvedAt: z.iso.datetime().nullable(),
}).strict().refine(value => value.state === "approved" ? value.approvedBy === value.principalId && value.approvedAt !== null
  : value.approvedBy === null && value.approvedAt === null, "Current source authority must be explicit");
export const knowledgePublicationSchema = z.object({ title: plainText.pipe(z.string().max(160)), category: knowledgeCategorySchema, content: knowledgeContentSchema }).strict();
export const knowledgeVersionSchema = knowledgeScopeSchema.extend({
  resourceId: z.uuid(), schemaVersion: z.literal(1).default(1), derivedViewVersion: z.literal(1).default(1), version: z.number().int().positive(),
  title: plainText.pipe(z.string().max(160)), category: knowledgeCategorySchema, publicationHash: z.string().regex(/^[a-f0-9]{64}$/),
  content: knowledgeContentSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  approval: z.enum(["draft", "approved"]).default("draft"),
  approvedBy: identifier.nullable().default(null), approvedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
  // Provenance is an opaque ID, never a URL to fetch. Google is reserved, not connected.
  source: z.object({ provider: z.enum(["manual", "google-drive"]), fileId: identifier, revision: identifier, authorizationEpoch: z.number().int().positive(), approvedForImport: z.boolean().default(false) }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.approval === "approved" ? value.approvedBy !== value.principalId || !value.approvedAt : value.approvedBy !== null || value.approvedAt !== null)
    ctx.addIssue({ code: "custom", message: "Approval must explicitly identify the bound owner and timestamp; drafts cannot contain approval metadata." });
});
export const knowledgeImportReceiptSchema = knowledgeScopeSchema.extend({
  id: z.uuid(), resourceId: z.uuid(), sourceFileId: identifier, sourceRevision: identifier,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["staged", "unchanged", "rejected"]), receivedAt: z.iso.datetime(),
  // A receipt is not approval, publication, or authorization to fetch a source.
  reason: z.enum(["validated-draft", "same-content", "invalid-content", "source-not-approved"]),
}).strict().refine(value => value.status === "staged" ? value.reason === "validated-draft"
  : value.status === "unchanged" ? value.reason === "same-content"
  : value.reason === "invalid-content" || value.reason === "source-not-approved", "Receipt status and reason must agree.");
export type KnowledgeResource = z.infer<typeof knowledgeResourceSchema>;
export type KnowledgeVersion = z.infer<typeof knowledgeVersionSchema>;
export const knowledgeDocumentSchema = z.object({
  id: z.uuid(), title: z.string().max(160), category: knowledgeCategorySchema,
  version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvedAt: z.iso.datetime(), content: knowledgeContentSchema,
}).strict();
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;
export const knowledgeResponseSchema = z.object({
  status: z.literal("ready"), sync: z.literal("not-connected"), resources: z.array(knowledgeDocumentSchema),
}).strict();
