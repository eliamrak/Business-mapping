import { createHash } from "node:crypto";
import { knowledgeContentSchema, knowledgeScopeSchema, knowledgePublicationSchema, knowledgeSourceAuthorizationSchema, knowledgeResourceSchema, knowledgeVersionSchema,
  type KnowledgeScope, type KnowledgeDocument } from "@workspace/practice/knowledge";

export class KnowledgeError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
/** Only authenticated server locals and deployment configuration may supply these values. */
export function knowledgeScope(role: unknown, principalId: unknown, configuredPracticeId: unknown): KnowledgeScope {
  if (role !== "owner" || typeof principalId !== "string" || !principalId)
    throw new KnowledgeError(403, "KNOWLEDGE_OWNER_REQUIRED");
  const parsed = knowledgeScopeSchema.safeParse({ principalId, practiceId: configuredPracticeId });
  if (!parsed.success) throw new KnowledgeError(503, "KNOWLEDGE_SCOPE_NOT_CONFIGURED");
  return parsed.data;
}
export function knowledgeContentHash(content: unknown): string {
  const normalized = knowledgeContentSchema.parse(content);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
export function knowledgePublicationHash(publication: unknown): string {
  return createHash("sha256").update(JSON.stringify(knowledgePublicationSchema.parse(publication))).digest("hex");
}
/** Repository has no clinical, financial, HR, attachment, or arbitrary-fetch methods. */
export interface KnowledgeRepository {
  readPublished(scope: KnowledgeScope): Promise<Array<{ resource: unknown; version: unknown; authorization: unknown }>>;
}
export async function listKnowledge(repository: KnowledgeRepository, scope: KnowledgeScope): Promise<KnowledgeDocument[]> {
  const binding = knowledgeScopeSchema.parse(scope);
  const rows = await repository.readPublished(binding);
  const result: KnowledgeDocument[] = [];
  for (const row of rows) {
    const resource = knowledgeResourceSchema.safeParse(row.resource);
    const version = knowledgeVersionSchema.safeParse(row.version);
    const authorization = knowledgeSourceAuthorizationSchema.safeParse(row.authorization);
    if (!resource.success || !version.success || !authorization.success) continue; // Invalid/unapproved records never become readable.
    const r = resource.data, v = version.data, a = authorization.data;
    if (r.practiceId !== binding.practiceId || r.principalId !== binding.principalId ||
      v.practiceId !== binding.practiceId || v.principalId !== binding.principalId ||
      a.practiceId !== binding.practiceId || a.principalId !== binding.principalId || a.fileId !== v.source.fileId ||
      a.state !== "approved" || a.epoch !== v.source.authorizationEpoch ||
      r.archived || !v.source.approvedForImport || r.publishedVersion !== v.version || r.id !== v.resourceId || v.approval !== "approved" ||
      knowledgeContentHash(v.content) !== v.contentHash || knowledgePublicationHash({ title: v.title, category: v.category, content: v.content }) !== v.publicationHash) continue;
    result.push({ id: r.id, title: v.title, category: v.category, version: v.version,
      contentHash: v.contentHash, approvedAt: v.approvedAt!, content: v.content });
  }
  return result.sort((a, b) => a.title.localeCompare(b.title));
}
