import { z } from "@workspace/practice";
import { knowledgeScopeSchema, knowledgeContentSchema, knowledgeCategorySchema } from "@workspace/practice/knowledge";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).refine(value => !["__proto__", "constructor", "prototype"].includes(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(10000).refine(value => !/<\/?[a-z!][^>]*>/i.test(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), "Plain text only");
const node = z.object({ id, label: text, description: text }).strict();
const semantic = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document"), paragraphs: z.array(text).min(1).max(80) }).strict(),
  z.object({ kind: z.literal("map"), nodes: z.array(node).min(1).max(40), edges: z.array(z.object({ from: id, to: id, label: text }).strict()).max(80) }).strict(),
  z.object({ kind: z.literal("cycle"), stages: z.array(node).min(2).max(40) }).strict(),
]);
export const semanticMasterSchema = knowledgeScopeSchema.extend({
  schemaVersion: z.literal(1), resourceId: z.uuid(), version: z.number().int().positive(),
  title: text.pipe(z.string().max(160)), category: knowledgeCategorySchema,
  audience: z.literal("owner"), approval: z.enum(["draft", "approved"]), approvedBy: id.nullable(), approvedAt: z.iso.datetime().nullable(),
  semantic,
  /** Approved presentation labels may overlap semantic text; never replace the master. */
  displayText: z.array(text).max(80).default([]),
  /** Provenance/content links only. No code in this pipeline follows links. */
  links: z.array(z.object({ label: text, href: z.string().url().refine(value => {
    const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password;
  }, "Only non-credentialed HTTPS content links are supported") }).strict()).max(20).default([]),
}).strict().superRefine((master, ctx) => {
  if (master.approval === "approved" ? master.approvedBy !== master.principalId || master.approvedAt === null : master.approvedBy !== null || master.approvedAt !== null)
    ctx.addIssue({ code: "custom", message: "Invalid explicit approval" });
  if (master.semantic.kind === "map" || master.semantic.kind === "cycle") {
    const nodes = master.semantic.kind === "map" ? master.semantic.nodes : master.semantic.stages;
    const ids = new Set(nodes.map(value => value.id));
    if (ids.size !== nodes.length) ctx.addIssue({ code: "custom", message: "Duplicate semantic node" });
    if (master.semantic.kind === "map" && master.semantic.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to)))
      ctx.addIssue({ code: "custom", message: "Unknown edge endpoint" });
  }
});
export const manifestSchema = knowledgeScopeSchema.extend({
  schemaVersion: z.literal(1), bundleId: id, revision: z.number().int().positive(),
  audience: z.literal("owner"), approval: z.literal("approved"), approvedBy: id, approvedAt: z.iso.datetime(),
  entries: z.array(z.object({ resourceId: z.uuid(), fileId: id, sourceRevision: id, version: z.number().int().positive(), masterHash: hash }).strict()).min(1).max(30),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.approvedBy !== manifest.principalId) ctx.addIssue({ code: "custom", message: "Manifest approval must name the bound owner" });
  if (new Set(manifest.entries.map(entry => entry.resourceId)).size !== manifest.entries.length || new Set(manifest.entries.map(entry => entry.fileId)).size !== manifest.entries.length)
    ctx.addIssue({ code: "custom", message: "Duplicate manifest resource/file" });
});
export const pipelineConfigSchema = knowledgeScopeSchema.omit({ principalId: true }).extend({
  enabled: z.boolean().default(false),
  /** Server-approved immutable manifest bytes; never obtained from the source itself. */
  approvedManifestHash: hash.nullable().default(null),
  sources: z.array(z.object({ resourceId: z.uuid(), fileId: id, parentId: id, sourceOwnerId: id, readerPrincipalId: id,
    approvalEpoch: z.number().int().positive(), approvedForImport: z.boolean().default(false) }).strict()).max(30).default([]),
}).strict().refine(config => new Set(config.sources.map(source => source.fileId)).size === config.sources.length && new Set(config.sources.map(source => source.resourceId)).size === config.sources.length, "Duplicate allowlist entry");
export const sourceMetadataSchema = z.object({ fileId: id, parentId: id, sourceOwnerId: id, readerPrincipalId: id,
  permission: z.literal("viewer"), visibility: z.literal("restricted"), revision: id }).strict();
export type SemanticMaster = z.infer<typeof semanticMasterSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;
export type Projection = z.infer<typeof knowledgeContentSchema>;
