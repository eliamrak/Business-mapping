import { publicationPolicyHash } from "./publication-policy";
import type { KnowledgeDocument, KnowledgeScope } from "@workspace/practice/knowledge";
import { pipelineConfigSchema } from "./import-contracts";
import { activateKnowledgeBundle, readPipelineKnowledge, stageKnowledgeBundle, type ImportContext, type KnowledgePipelineStore, type KnowledgeSourceAdapter } from "./import-pipeline";
import { KnowledgeError, knowledgeScope } from "./service";

/** Server-only configuration capability. Never populate from query/body/source bytes. Null means disabled. */
export function createKnowledgeRuntime(store: KnowledgePipelineStore, configuration: () => unknown, now: () => number = Date.now) {
  function config(scope: KnowledgeScope) {
    const raw = configuration();
    const value = pipelineConfigSchema.parse(raw ?? { practiceId: scope.practiceId, enabled: false });
    if (value.practiceId !== scope.practiceId) throw new KnowledgeError(403, "KNOWLEDGE_SCOPE_MISMATCH");
    return value;
  }
  function authorize(scope: KnowledgeScope, context: ImportContext) {
    const verified = knowledgeScope(context.role, context.principalId, scope.practiceId);
    if (verified.principalId !== scope.principalId) throw new KnowledgeError(403, "KNOWLEDGE_SCOPE_MISMATCH");
  }
  return {
    /** The route supplies a scope derived exclusively from verified Clerk locals + deployment configuration. */
    async read(scope: KnowledgeScope, context: ImportContext): Promise<KnowledgeDocument[]> {
      authorize(scope, context);
      const settings = config(scope);
      if (!settings.enabled || settings.permissionMaxAgeMs === null) return [];
      let readStore = store;
      if (settings.publicationMode === "owner-bridge") {
        const snapshot = await store.read(scope), approval = snapshot?.publication;
        if (!snapshot || !approval || !settings.publicationPolicyVersion || approval.policyVersion !== settings.publicationPolicyVersion || approval.policyHash !== publicationPolicyHash(settings) ||
          approval.approvedBy !== scope.principalId || approval.revision !== snapshot.activeRevision || approval.manifestHash !== snapshot.activeManifestHash) return [];
        settings.approvedManifestHash = approval.manifestHash;
        // Approval pin and publication are read from one atomic snapshot, never separate stores/config updates.
        readStore = { read: async () => structuredClone(snapshot), compareAndSwap: async () => { throw new Error("Read-only snapshot"); } };
      }
      const documents = await readPipelineKnowledge(context, settings, readStore);
      // Evaluate at response time, after potentially delayed storage I/O.
      const checkedNow = now();
      if (!Number.isFinite(checkedNow)) return [];
      // Until a stale-display policy/UI is reviewed, the app withholds stale snapshots.
      return documents.filter(document => {
        const verifiedAt = document.lastPermissionCheckAt === null ? NaN : Date.parse(document.lastPermissionCheckAt);
        return !document.stale && Number.isFinite(verifiedAt) && verifiedAt <= checkedNow && checkedNow - verifiedAt < settings.permissionMaxAgeMs!;
      }).map(document => ({ id: document.resourceId,
        title: document.title, category: document.category, version: document.version, contentHash: document.contentHash,
        approvedAt: document.approvedAt, content: document.projection }));
    },
    // Internal runner only: no import/activation HTTP endpoints or provider implementation.
    async stage(scope: KnowledgeScope, context: ImportContext, manifest: string, adapter: KnowledgeSourceAdapter, at: string) {
      authorize(scope, context);
      const settings = config(scope);
      if (settings.publicationMode === "owner-bridge") throw new KnowledgeError(403, "KNOWLEDGE_USE_PUBLICATION_BRIDGE");
      return stageKnowledgeBundle(context, settings, manifest, adapter, store, at);
    },
    async activate(scope: KnowledgeScope, context: ImportContext, at: string) {
      authorize(scope, context);
      const settings = config(scope);
      if (settings.publicationMode === "owner-bridge") throw new KnowledgeError(403, "KNOWLEDGE_USE_PUBLICATION_BRIDGE");
      return activateKnowledgeBundle(context, settings, store, at);
    },
  };
}
