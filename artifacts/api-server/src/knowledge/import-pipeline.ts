import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { knowledgeContentSchema, type KnowledgeScope } from "@workspace/practice/knowledge";
import { KnowledgeError, knowledgeScope, knowledgeContentHash } from "./service";
import { manifestSchema, pipelineConfigSchema, semanticMasterSchema, sourceMetadataSchema,
  type Manifest, type PipelineConfig, type SemanticMaster, type Projection } from "./import-contracts";

export const sourceHash = (bytes: string) => createHash("sha256").update(bytes, "utf8").digest("hex");
export type SourceResult = { status: "available"; metadata: unknown; bytes: string }
  | { status: "network-error" | "permission-denied" | "deleted" | "unapproved" };
/** Read-only source capability: opaque allowlisted file IDs only; no URL, credentials or writes. */
export interface KnowledgeSourceAdapter { readFile(fileId: string): Promise<SourceResult>; }
export type ImportContext = { role: unknown; principalId: unknown };
type SourceGrant = PipelineConfig["sources"][number];
export type PreparedResource = { fileId: string; sourceRevision: string; masterBytes: string; master: SemanticMaster; masterHash: string;
  projection: Projection; projectionHash: string; grant: SourceGrant };
export type Bundle = { verifiedAt: string; manifestBytes: string; manifest: Manifest; manifestHash: string; resources: PreparedResource[] };
type SourceState = { resourceId: string; status: "available" | "stale" | "tombstoned"; checkedAt: string; lastVerifiedAt: string | null; approvalEpoch: number; reason?: string };
export type PipelineState = KnowledgeScope & {
  publication?: { policyVersion: string; policyHash: string; approvedBy: string; approvedAt: string; revision: number; manifestHash: string;
    requests: Record<string, { digest: string; revision: number; manifestHash: string }> };
  generation: number; activeRevision: number; activeManifestHash: string | null; activeManifestBytes: string | null; staged: Bundle | null;
  active: Record<string, PreparedResource>; masters: Record<string, { bytes: string; hash: string }>;
  sources: Record<string, SourceState>; tombstones: Record<string, { approvalEpoch: number; blockedVersion: number; reason: string }>;
  /** Owner-scoped projection cache; atomically evicted with active pointers. No embeddings/AI. */
  cache: Record<string, { hash: string; projection: Projection }>;
  receipts: Array<{ manifestHash: string; status: "staged" | "activated" | "rejected" | "stale" | "revoked"; reason: string; at: string }>;
};
/** CAS must atomically persist the WHOLE scoped state, or nothing. Never implement as per-resource writes. */
export interface KnowledgePipelineStore {
  read(scope: KnowledgeScope): Promise<PipelineState | null>;
  compareAndSwap(scope: KnowledgeScope, expectedGeneration: number, next: PipelineState): Promise<boolean>;
}
const blank = (scope: KnowledgeScope): PipelineState => ({ ...scope, generation: 0, activeRevision: 0, activeManifestHash: null, activeManifestBytes: null,
  staged: null, active: {}, masters: {}, sources: {}, tombstones: {}, cache: {}, receipts: [] });
function fail(code: string): never { throw new KnowledgeError(409, code); }
function bind(context: ImportContext, input: unknown) {
  const config = pipelineConfigSchema.parse(input);
  const scope = knowledgeScope(context.role, context.principalId, config.practiceId);
  return { config, scope };
}
async function load(store: KnowledgePipelineStore, scope: KnowledgeScope) {
  const state = await store.read(scope) ?? blank(scope);
  if (state.practiceId !== scope.practiceId || state.principalId !== scope.principalId) fail("KNOWLEDGE_STORE_SCOPE_MISMATCH");
  return structuredClone(state);
}
async function save(store: KnowledgePipelineStore, scope: KnowledgeScope, state: PipelineState) {
  const expected = state.generation; state.generation++;
  if (!await store.compareAndSwap(scope, expected, state)) fail("KNOWLEDGE_CONCURRENT_CHANGE");
}
function receipt(state: PipelineState, hash: string, status: PipelineState["receipts"][number]["status"], reason: string, at: string) {
  state.receipts.push({ manifestHash: hash, status, reason, at });
}
function tombstone(state: PipelineState, fileId: string, resourceId: string, epoch: number, reason: string, at: string) {
  const existing = state.tombstones[resourceId];
  state.tombstones[resourceId] = { approvalEpoch: Math.max(epoch, existing?.approvalEpoch ?? 0),
    blockedVersion: Math.max(state.active[resourceId]?.master.version ?? 0, existing?.blockedVersion ?? 0), reason };
  delete state.active[resourceId]; delete state.cache[resourceId];
  state.sources[fileId] = { resourceId, status: "tombstoned", checkedAt: at, lastVerifiedAt: state.sources[fileId]?.lastVerifiedAt ?? null, approvalEpoch: epoch, reason };
  state.staged = null;
}
function sameScope(value: KnowledgeScope, scope: KnowledgeScope) {
  return value.practiceId === scope.practiceId && value.principalId === scope.principalId;
}
function allowed(config: PipelineConfig, resourceId: string, fileId: string) {
  return config.sources.find(source => source.resourceId === resourceId && source.fileId === fileId && source.approvedForImport);
}
/** Stable first occurrence wins; semantic content precedes overlapping display labels. */
export function projectMaster(input: unknown): Projection {
  const master = semanticMasterSchema.parse(input);
  const blocks: Projection["blocks"] = []; const seen = new Set<string>();
  const add = (kind: "heading" | "paragraph", text: string) => {
    const key = text.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    if (!seen.has(key)) { seen.add(key); blocks.push({ kind, text: text.trim() }); }
  };
  add("heading", master.title);
  if (master.semantic.kind === "document") master.semantic.paragraphs.forEach(text => add("paragraph", text));
  else {
    const nodes = master.semantic.kind === "map" ? master.semantic.nodes : master.semantic.stages;
    nodes.forEach(node => { add("heading", node.label); add("paragraph", node.description); });
    if (master.semantic.kind === "map") master.semantic.edges.forEach(edge => add("paragraph", edge.label));
  }
  master.displayText.forEach(text => add("paragraph", text));
  master.links.forEach(link => add("paragraph", link.label)); // Deliberately no URL fetch or executable link rendering.
  return knowledgeContentSchema.parse({ blocks });
}
function validBundle(bundle: Bundle, scope: KnowledgeScope, config: PipelineConfig, state: PipelineState) {
  const manifest = manifestSchema.parse(JSON.parse(bundle.manifestBytes));
  if (!sameScope(manifest, scope) || sourceHash(bundle.manifestBytes) !== bundle.manifestHash || config.approvedManifestHash !== bundle.manifestHash ||
    !isDeepStrictEqual(manifest, bundle.manifest) || bundle.resources.length !== manifest.entries.length) fail("KNOWLEDGE_INVALID_BUNDLE");
  for (const entry of manifest.entries) {
    const item = bundle.resources.find(resource => resource.master.resourceId === entry.resourceId);
    const grant = allowed(config, entry.resourceId, entry.fileId);
    if (!item || !grant || !isDeepStrictEqual(grant, item.grant)) fail("KNOWLEDGE_SOURCE_NOT_APPROVED");
    const master = semanticMasterSchema.parse(JSON.parse(item.masterBytes));
    const prior = state.active[entry.resourceId]; const revoked = state.tombstones[entry.resourceId];
    if (!sameScope(master, scope) || master.resourceId !== entry.resourceId || master.version !== entry.version || master.approval !== "approved" ||
      item.fileId !== entry.fileId || item.sourceRevision !== entry.sourceRevision || sourceHash(item.masterBytes) !== entry.masterHash ||
      item.masterHash !== entry.masterHash || !isDeepStrictEqual(master, item.master) ||
      knowledgeContentHash(projectMaster(master)) !== item.projectionHash || knowledgeContentHash(item.projection) !== item.projectionHash)
      fail("KNOWLEDGE_CONTENT_MISMATCH");
    if (revoked && (grant.approvalEpoch <= revoked.approvalEpoch || master.version <= revoked.blockedVersion)) fail("KNOWLEDGE_REAPPROVAL_REQUIRED");
    if (prior && (master.version < prior.master.version || master.version === prior.master.version && item.masterHash !== prior.masterHash)) fail("KNOWLEDGE_STALE_RESOURCE_VERSION");
    const retained = state.masters[`${entry.resourceId}:${entry.version}`];
    if (retained && retained.hash !== entry.masterHash) fail("KNOWLEDGE_IMMUTABLE_VERSION_CONFLICT");
  }
  if (manifest.revision < state.activeRevision || manifest.revision === state.activeRevision && bundle.manifestHash !== state.activeManifestHash)
    fail("KNOWLEDGE_STALE_MANIFEST");
}
/** Internal preparatory runner. Nothing calls it from app routes, jobs or schedulers. */
export async function stageKnowledgeBundle(context: ImportContext, configInput: unknown, manifestBytes: string,
  adapter: KnowledgeSourceAdapter, store: KnowledgePipelineStore, at: string) {
  const { config, scope } = bind(context, configInput);
  if (!config.enabled) return { status: "disabled" as const };
  if (manifestBytes.length > 100000 || !Number.isFinite(Date.parse(at))) fail("KNOWLEDGE_INVALID_INPUT");
  const manifestHash = sourceHash(manifestBytes);
  if (manifestHash !== config.approvedManifestHash) fail("KNOWLEDGE_MANIFEST_NOT_APPROVED");
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes));
  if (!sameScope(manifest, scope)) fail("KNOWLEDGE_SCOPE_MISMATCH");
  const state = await load(store, scope);
  const resources: PreparedResource[] = []; let rejection: string | null = null; let revoked = false; let stale = false;
  // Configuration removal revokes existing content even when the incoming bundle is incomplete.
  for (const current of Object.values(state.active)) if (!allowed(config, current.master.resourceId, current.fileId)) {
    tombstone(state, current.fileId, current.master.resourceId, current.grant.approvalEpoch, "source-not-approved", at); revoked = true;
  }
  for (const entry of manifest.entries) {
    const grant = allowed(config, entry.resourceId, entry.fileId);
    if (!grant) { tombstone(state, entry.fileId, entry.resourceId, state.sources[entry.fileId]?.approvalEpoch ?? 0, "source-not-approved", at); revoked = true; rejection = "source-not-approved"; continue; }
    let response: SourceResult;
    try { response = await adapter.readFile(entry.fileId); } catch { response = { status: "network-error" }; }
    if (response.status === "network-error") {
      // A transient failure cannot restore a tombstone or certify a permission grant.
      if (state.sources[entry.fileId]?.status !== "tombstoned") state.sources[entry.fileId] = { resourceId: entry.resourceId, status: "stale", checkedAt: at, lastVerifiedAt: state.sources[entry.fileId]?.lastVerifiedAt ?? null, approvalEpoch: grant.approvalEpoch, reason: "network-error" };
      stale = true; rejection = "network-error"; continue;
    }
    if (response.status !== "available") {
      tombstone(state, entry.fileId, entry.resourceId, grant.approvalEpoch, response.status, at); revoked = true; rejection = response.status; continue;
    }
    const metadata = sourceMetadataSchema.safeParse(response.metadata);
    if (!metadata.success || metadata.data.fileId !== entry.fileId || metadata.data.parentId !== grant.parentId || metadata.data.sourceOwnerId !== grant.sourceOwnerId || metadata.data.readerPrincipalId !== grant.readerPrincipalId) {
      tombstone(state, entry.fileId, entry.resourceId, grant.approvalEpoch, "permission-mismatch", at); revoked = true; rejection = "permission-mismatch"; continue;
    }
    try {
      if (metadata.data.revision !== entry.sourceRevision || response.bytes.length > 500000 || sourceHash(response.bytes) !== entry.masterHash) fail("KNOWLEDGE_SOURCE_REVISION_OR_HASH_MISMATCH");
      const master = semanticMasterSchema.parse(JSON.parse(response.bytes));
      if (master.approval !== "approved") { tombstone(state, entry.fileId, entry.resourceId, grant.approvalEpoch, "unapproved", at); revoked = true; rejection = "unapproved"; continue; }
      const projection = projectMaster(master);
      resources.push({ fileId: entry.fileId, sourceRevision: entry.sourceRevision, masterBytes: response.bytes, master, masterHash: entry.masterHash, projection, projectionHash: knowledgeContentHash(projection), grant });
    } catch { rejection = "invalid-source"; }
  }
  const bundle = { verifiedAt: at, manifestBytes, manifest, manifestHash, resources };
  if (!rejection) try { validBundle(bundle, scope, config, state); } catch { rejection = "invalid-bundle"; }
  if (rejection) {
    state.staged = null;
    receipt(state, manifestHash, revoked ? "revoked" : stale ? "stale" : "rejected", rejection, at);
    await save(store, scope, state); return { status: "rejected" as const, reason: rejection };
  }
  if (state.activeManifestHash === manifestHash) {
    // Replays still checked permissions above; they never reactivate revoked resources.
    for (const item of resources) state.sources[item.fileId] = { resourceId: item.master.resourceId, status: "available", checkedAt: at, lastVerifiedAt: at, approvalEpoch: item.grant.approvalEpoch };
    await save(store, scope, state); return { status: "unchanged" as const };
  }
  if (state.staged?.manifestHash === manifestHash) {
    state.staged = bundle; await save(store, scope, state); return { status: "already-staged" as const };
  }
  state.staged = bundle; receipt(state, manifestHash, "staged", "all-members-validated", at);
  await save(store, scope, state); return { status: "staged" as const };
}
export async function activateKnowledgeBundle(context: ImportContext, configInput: unknown, store: KnowledgePipelineStore, at: string) {
  const { config, scope } = bind(context, configInput);
  if (!config.enabled) return { status: "disabled" as const };
  if (!Number.isFinite(Date.parse(at))) fail("KNOWLEDGE_INVALID_INPUT");
  const state = await load(store, scope); const bundle = state.staged;
  if (!bundle) fail("KNOWLEDGE_NO_STAGED_BUNDLE");
  const age = Date.parse(at) - Date.parse(bundle.verifiedAt);
  if (!Number.isFinite(age) || age < 0 || age > 300000) fail("KNOWLEDGE_STAGE_EXPIRED");
  validBundle(bundle, scope, config, state);
  // Replace the whole manifest membership. Missing prior members become tombstones, not orphaned readable content.
  const members = new Set(bundle.resources.map(item => item.master.resourceId));
  for (const item of Object.values(state.active)) if (!members.has(item.master.resourceId)) tombstone(state, item.fileId, item.master.resourceId, item.grant.approvalEpoch, "removed-from-manifest", at);
  const active: PipelineState["active"] = {}, cache: PipelineState["cache"] = {};
  for (const item of bundle.resources) {
    const id = item.master.resourceId; active[id] = item; cache[id] = { hash: item.projectionHash, projection: item.projection };
    state.masters[`${id}:${item.master.version}`] = { bytes: item.masterBytes, hash: item.masterHash };
    state.sources[item.fileId] = { resourceId: id, status: "available", checkedAt: bundle.verifiedAt, lastVerifiedAt: bundle.verifiedAt, approvalEpoch: item.grant.approvalEpoch };
    delete state.tombstones[id];
  }
  state.active = active; state.cache = cache; state.activeRevision = bundle.manifest.revision; state.activeManifestHash = bundle.manifestHash; state.activeManifestBytes = bundle.manifestBytes; state.staged = null;
  receipt(state, bundle.manifestHash, "activated", "atomic-manifest", at); await save(store, scope, state);
  return { status: "activated" as const };
}
/** No cached output is returned without current role, configuration, tombstone and hash checks. */
export async function readPipelineKnowledge(context: ImportContext, configInput: unknown, store: KnowledgePipelineStore) {
  const { config, scope } = bind(context, configInput);
  if (!config.enabled) return [];
  const state = await load(store, scope);
  if (!state.activeManifestBytes || !config.approvedManifestHash || state.activeManifestHash !== config.approvedManifestHash ||
    sourceHash(state.activeManifestBytes) !== config.approvedManifestHash) return [];
  let manifest: Manifest;
  try { manifest = manifestSchema.parse(JSON.parse(state.activeManifestBytes)); } catch { return []; }
  if (!sameScope(manifest, scope) || manifest.revision !== state.activeRevision) return [];
  return Object.entries(state.active).flatMap(([resourceId, item]) => {
    const parsed = semanticMasterSchema.safeParse(item.master);
    if (!parsed.success || parsed.data.resourceId !== resourceId) return [];
    const entry = manifest.entries.find(value => value.resourceId === resourceId);
    const retained = state.masters[`${resourceId}:${parsed.data.version}`];
    if (!entry || entry.version !== parsed.data.version || entry.fileId !== item.fileId || entry.sourceRevision !== item.sourceRevision ||
      entry.masterHash !== item.masterHash || !retained || retained.hash !== entry.masterHash ||
      retained.bytes !== item.masterBytes || sourceHash(retained.bytes) !== entry.masterHash) return [];
    let rawMaster: SemanticMaster;
    try { rawMaster = semanticMasterSchema.parse(JSON.parse(item.masterBytes)); } catch { return []; }
    if (!isDeepStrictEqual(rawMaster, parsed.data)) return [];
    const grant = allowed(config, item.master.resourceId, item.fileId); const source = state.sources[item.fileId];
    if (!grant || !isDeepStrictEqual(grant, item.grant) || state.tombstones[item.master.resourceId] || !source || source.status === "tombstoned" ||
      !sameScope(item.master, scope) || item.master.approval !== "approved" || item.master.approvedBy !== scope.principalId ||
      sourceHash(item.masterBytes) !== item.masterHash || knowledgeContentHash(projectMaster(item.master)) !== item.projectionHash) return [];
    return [{ resourceId: item.master.resourceId, title: item.master.title, category: item.master.category, version: item.master.version,
      approvedAt: manifest.approvedAt, contentHash: item.projectionHash,
      projection: projectMaster(item.master), stale: source.status === "stale", lastPermissionCheckAt: source.lastVerifiedAt }];
  });
}
