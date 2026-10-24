import { publicationPolicyHash } from "./publication-policy";
import { isDeepStrictEqual } from "node:util";
import { z } from "@workspace/practice";
import type { KnowledgeScope } from "@workspace/practice/knowledge";
import { manifestSchema, pipelineConfigSchema } from "./import-contracts";
import { activateKnowledgeBundle, sourceHash, stageKnowledgeBundle, type ImportContext, type KnowledgePipelineStore, type KnowledgeSourceAdapter, type PipelineState } from "./import-pipeline";
import { KnowledgeError, knowledgeScope } from "./service";

/** Candidate identity/hash is a proposal, not authority. Ownership/audience/approval are not request fields. */
export const publicationRequestSchema = z.object({
  requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
  entries: manifestSchema.shape.entries,
}).strict();
function reject(code: string, status = 409): never { throw new KnowledgeError(status, code); }
export function createKnowledgePublicationBridge(store: KnowledgePipelineStore, policy: () => unknown,
  adapter: KnowledgeSourceAdapter | null, now: () => number = Date.now) {
  return { async publish(scope: KnowledgeScope, context: ImportContext, input: unknown) {
    const verified = knowledgeScope(context.role, context.principalId, scope.practiceId);
    if (verified.principalId !== scope.principalId) reject("KNOWLEDGE_SCOPE_MISMATCH", 403);
    const parsedPolicy = pipelineConfigSchema.safeParse(policy());
    if (!parsedPolicy.success || !parsedPolicy.data.enabled || parsedPolicy.data.publicationMode !== "owner-bridge" ||
      !parsedPolicy.data.publicationPolicyVersion || !parsedPolicy.data.permissionMaxAgeMs || !adapter) reject("KNOWLEDGE_PUBLICATION_UNAVAILABLE", 503);
    const config = parsedPolicy.data;
    if (config.practiceId !== scope.practiceId) reject("KNOWLEDGE_SCOPE_MISMATCH", 403);
    const parsed = publicationRequestSchema.safeParse(input);
    if (!parsed.success) reject("KNOWLEDGE_INVALID_RELEASE_REQUEST", 400);
    const request = parsed.data;
    request.entries.sort((a, b) => a.resourceId.localeCompare(b.resourceId));
    const grants = config.sources.filter(source => source.approvedForImport);
    if (grants.length !== request.entries.length || new Set(request.entries.map(e => e.resourceId)).size !== request.entries.length ||
      new Set(request.entries.map(e => e.fileId)).size !== request.entries.length || request.entries.some(entry =>
        !grants.some(grant => grant.resourceId === entry.resourceId && grant.fileId === entry.fileId))) reject("KNOWLEDGE_RELEASE_SCOPE_NOT_APPROVED", 403);
    const digest = sourceHash(JSON.stringify(request));
    const initial = await store.read(scope);
    if (initial && (initial.practiceId !== scope.practiceId || initial.principalId !== scope.principalId)) reject("KNOWLEDGE_STORE_SCOPE_MISMATCH", 403);
    const old = initial?.publication;
    if (old && (old.policyVersion !== config.publicationPolicyVersion || old.policyHash !== publicationPolicyHash(config) || old.approvedBy !== scope.principalId)) reject("KNOWLEDGE_POLICY_RECONCILIATION_REQUIRED");
    const priorRequest = old?.requests[request.requestId];
    if (priorRequest) {
      if (priorRequest.digest !== digest) reject("KNOWLEDGE_IDEMPOTENCY_CONFLICT");
      // Return the recorded outcome only; never reactivate, renew a lease or bypass a tombstone.
      return { status: "already-published" as const, revision: priorRequest.revision, manifestHash: priorRequest.manifestHash };
    }
    if ((initial?.activeRevision ?? 0) !== request.expectedRevision) reject("KNOWLEDGE_PREDECESSOR_CONFLICT");
    if (initial?.activeRevision && !old) reject("KNOWLEDGE_POLICY_RECONCILIATION_REQUIRED");
    if (Object.keys(old?.requests ?? {}).length >= 1000) reject("KNOWLEDGE_PUBLICATION_RETENTION_REVIEW_REQUIRED", 503);
    const started = now(); if (!Number.isFinite(started)) reject("KNOWLEDGE_CLOCK_UNAVAILABLE", 503);
    const at = new Date(started).toISOString(), revision = request.expectedRevision + 1;
    // Authenticated owner intent authorizes exactly these candidate bytes; the source cannot authorize itself.
    const manifest = manifestSchema.parse({ ...scope, schemaVersion: 1, bundleId: request.requestId, revision,
      audience: "owner", approval: "approved", approvedBy: scope.principalId, approvedAt: at, entries: request.entries });
    const bytes = JSON.stringify(manifest), manifestHash = sourceHash(bytes);
    const effective = { ...config, approvedManifestHash: manifestHash };
    let shadow: PipelineState | null = structuredClone(initial);
    const isolated: KnowledgePipelineStore = {
      read: async () => structuredClone(shadow),
      compareAndSwap: async (_, expected, next) => { if ((shadow?.generation ?? 0) !== expected) return false; shadow = structuredClone(next); return true; },
    };
    const staged = await stageKnowledgeBundle(context, effective, bytes, adapter, isolated, at);
    function currentPolicy() {
      const current = pipelineConfigSchema.safeParse(policy());
      if (!current.success || !isDeepStrictEqual(current.data, config)) reject("KNOWLEDGE_POLICY_CHANGED");
    }
    async function commit(next: PipelineState) {
      currentPolicy(); next.generation = (initial?.generation ?? 0) + 1;
      if (!await store.compareAndSwap(scope, initial?.generation ?? 0, next)) reject("KNOWLEDGE_PREDECESSOR_CONFLICT");
    }
    if (staged.status !== "staged") {
      // Persist denial/staleness and cache eviction, but never advance approval/pin on an invalid/partial proposal.
      if (shadow) await commit(shadow);
      reject("KNOWLEDGE_RELEASE_VALIDATION_FAILED");
    }
    const finished = now();
    if (!Number.isFinite(finished) || finished < started || finished - started >= config.permissionMaxAgeMs! || finished - started > 300000)
      reject("KNOWLEDGE_RELEASE_AUTHORITY_EXPIRED");
    await activateKnowledgeBundle(context, effective, isolated, new Date(finished).toISOString());
    // Read through the interface after async staging to retain TypeScript's explicit state boundary.
    const next = await isolated.read(scope); if (!next) reject("KNOWLEDGE_RELEASE_VALIDATION_FAILED");
    next.publication = { policyVersion: config.publicationPolicyVersion!, policyHash: publicationPolicyHash(config), approvedBy: scope.principalId, approvedAt: at,
      revision, manifestHash, requests: { ...old?.requests, [request.requestId]: { digest, revision, manifestHash } } };
    await commit(next);
    return { status: "published" as const, revision, manifestHash };
  } };
}
export type KnowledgePublicationBridge = ReturnType<typeof createKnowledgePublicationBridge>;
