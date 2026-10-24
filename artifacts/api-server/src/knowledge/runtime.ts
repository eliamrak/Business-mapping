import type { KnowledgeDocument, KnowledgeScope } from "@workspace/practice/knowledge";
import { pipelineConfigSchema } from "./import-contracts";
import { activateKnowledgeBundle, readPipelineKnowledge, stageKnowledgeBundle, type ImportContext, type KnowledgePipelineStore, type KnowledgeSourceAdapter } from "./import-pipeline";
import { KnowledgeError, knowledgeScope } from "./service";

/** Server-only configuration capability. Never populate from query/body/source bytes. Null means disabled. */
export function createKnowledgeRuntime(store: KnowledgePipelineStore, configuration: () => unknown) {
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
      const documents = await readPipelineKnowledge(context, config(scope), store);
      // Until a stale-display policy/UI is reviewed, the app withholds stale snapshots.
      return documents.filter(document => !document.stale).map(document => ({ id: document.resourceId,
        title: document.title, category: document.category, version: document.version, contentHash: document.contentHash,
        approvedAt: document.approvedAt, content: document.projection }));
    },
    // Internal runner only: no import/activation HTTP endpoints or provider implementation.
    async stage(scope: KnowledgeScope, context: ImportContext, manifest: string, adapter: KnowledgeSourceAdapter, at: string) {
      authorize(scope, context);
      return stageKnowledgeBundle(context, config(scope), manifest, adapter, store, at);
    },
    async activate(scope: KnowledgeScope, context: ImportContext, at: string) {
      authorize(scope, context);
      return activateKnowledgeBundle(context, config(scope), store, at);
    },
  };
}
