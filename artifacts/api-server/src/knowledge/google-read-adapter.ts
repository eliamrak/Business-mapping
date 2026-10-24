import { isDeepStrictEqual } from "node:util";
import { z } from "@workspace/practice";
import { semanticMasterSchema } from "./import-contracts";
import { projectMaster, sourceHash, type KnowledgeSourceAdapter, type SourceResult } from "./import-pipeline";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).refine(v => !["__proto__", "constructor", "prototype"].includes(v));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const { semantic: _semantic, displayText: _display, links: _links, ...envelopeShape } = semanticMasterSchema.shape;
const registration = z.object({
  fileId: id, parentId: id, sourceOwnerId: id, readerPrincipalId: id, approvedForImport: z.boolean().default(false),
  kind: z.enum(["google-doc", "map-json", "cycle-json"]), driveVersion: z.string().regex(/^[1-9][0-9]*$/),
  rawHash: hash, masterHash: hash, maxBytes: z.number().int().min(1).max(500000),
  /** Explicitly approved server metadata for deterministic prose normalization; never taken from a document instruction. */
  documentEnvelope: z.object(envelopeShape).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.kind === "google-doc") !== !!value.documentEnvelope) ctx.addIssue({ code: "custom", message: "Only Docs require a publication envelope" });
});
export const googleReadConfigSchema = z.object({ enabled: z.boolean().default(false), files: z.array(registration).max(30).default([]) }).strict()
  .refine(value => new Set(value.files.map(f => f.fileId)).size === value.files.length, "Duplicate file registration");
const metadataSchema = z.object({ id, mimeType: z.string(), version: z.string().regex(/^[1-9][0-9]*$/),
  modifiedTime: z.iso.datetime(), parents: z.array(id).length(1), trashed: z.boolean(),
  capabilities: z.object({ canDownload: z.boolean() }), owners: z.array(z.object({ permissionId: id })).length(1),
  size: z.string().regex(/^[0-9]+$/).optional(), driveId: id.optional(),
});
const authoritySchema = z.object({ status: z.literal("verified"), fileId: id, readerPrincipalId: id, sourceOwnerId: id,
  permission: z.literal("viewer"), visibility: z.literal("restricted") }).strict();
export const DRIVE_METADATA_FIELDS = "id,mimeType,version,modifiedTime,parents,trashed,capabilities(canDownload),owners(permissionId),size,driveId";
/** No generic URL/request, ACL enumeration, write or auth methods. A real implementation is intentionally absent. */
export interface GoogleReadClient {
  metadata(fileId: string, fields: typeof DRIVE_METADATA_FIELDS): Promise<unknown>;
  /** A separately verified CURRENT authority capability, not a claim inferred from canDownload or absent permissions. */
  authority(fileId: string): Promise<unknown>;
  exportText(fileId: string, mimeType: "text/plain", maxBytes: number): Promise<AsyncIterable<Uint8Array>>;
  downloadJson(fileId: string, maxBytes: number): Promise<AsyncIterable<Uint8Array>>;
}
export class GoogleReadFailure extends Error {
  constructor(public status: number, public reason: string) { super("Google source read failed"); }
}
type ReadResult = SourceResult & { reason?: string };
function failure(error: unknown): ReadResult {
  if (error instanceof GoogleReadFailure) {
    if (error.status === 429 || error.status >= 500 || error.status === 403 && ["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"].includes(error.reason))
      return { status: "network-error", reason: "transient-provider-failure" };
    if (error.status === 404) return { status: "network-error", reason: "not-found-or-inaccessible" };
    if (error.status === 401) return { status: "network-error", reason: "authentication-unavailable" };
    if (error.status === 403) return { status: "network-error", reason: "access-or-service-unverified" };
    return { status: "unapproved", reason: "unsupported-provider-response" };
  }
  // Transport implementations must wrap known access failures above; unknown exceptions certify nothing.
  return { status: "network-error", reason: "transport-failure" };
}
/** Client failures must never be mistaken for parser/decoder failures merely because both use TypeError. */
async function sourceCall<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (error instanceof GoogleReadFailure) throw error;
    throw new GoogleReadFailure(503, "transport-failure");
  }
}
async function boundedText(stream: AsyncIterable<Uint8Array>, maxBytes: number) {
  const chunks: Uint8Array[] = []; let length = 0;
  try { for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array) || (length += chunk.byteLength) > maxBytes) throw new GoogleReadFailure(400, "size-limit");
    chunks.push(chunk);
  } } catch (error) {
    if (error instanceof GoogleReadFailure) throw error;
    throw new GoogleReadFailure(503, "stream-transport-failure");
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
}
/** Lazy injected client construction is unreachable while disabled or for unregistered/unapproved IDs. */
export function createGoogleReadAdapter(configuration: () => unknown, clientFactory: () => Promise<GoogleReadClient>): KnowledgeSourceAdapter {
  return { async readFile(fileId: string): Promise<ReadResult> {
    const config = googleReadConfigSchema.parse(configuration() ?? {});
    if (!config.enabled) return { status: "unapproved", reason: "adapter-disabled" };
    const file = config.files.find(value => value.fileId === fileId && value.approvedForImport);
    if (!file) return { status: "unapproved", reason: "file-not-approved" };
    try {
      const client = await sourceCall(clientFactory);
      const authority = authoritySchema.safeParse(await sourceCall(() => client.authority(fileId)));
      if (!authority.success || authority.data.fileId !== fileId || authority.data.readerPrincipalId !== file.readerPrincipalId || authority.data.sourceOwnerId !== file.sourceOwnerId)
        return { status: "unapproved", reason: "current-authority-unverifiable" };
      const before = metadataSchema.safeParse(await sourceCall(() => client.metadata(fileId, DRIVE_METADATA_FIELDS)));
      if (!before.success) return { status: "unapproved", reason: "metadata-incomplete" };
      if (before.data.trashed) return { status: "deleted", reason: "trashed" };
      const expectedMime = file.kind === "google-doc" ? "application/vnd.google-apps.document" : "application/json";
      const matches = (value: z.infer<typeof metadataSchema>) => value.id === fileId && !value.driveId && value.parents[0] === file.parentId &&
        value.owners[0].permissionId === file.sourceOwnerId && value.mimeType === expectedMime && value.version === file.driveVersion && value.capabilities.canDownload && !value.trashed;
      if (!matches(before.data)) return { status: "unapproved", reason: "metadata-or-capability-mismatch" };
      if (before.data.size && BigInt(before.data.size) > BigInt(file.maxBytes)) return { status: "unapproved", reason: "size-limit" };
      const raw = await boundedText(await sourceCall(() => file.kind === "google-doc" ? client.exportText(fileId, "text/plain", file.maxBytes) : client.downloadJson(fileId, file.maxBytes)), file.maxBytes);
      const after = metadataSchema.safeParse(await sourceCall(() => client.metadata(fileId, DRIVE_METADATA_FIELDS)));
      if (after.success && after.data.trashed) return { status: "deleted", reason: "trashed-during-read" };
      const current = authoritySchema.safeParse(await sourceCall(() => client.authority(fileId)));
      if (!current.success || !isDeepStrictEqual(current.data, authority.data)) return { status: "unapproved", reason: "authority-changed" };
      if (!after.success || !matches(after.data) || !isDeepStrictEqual(before.data, after.data)) return { status: "unapproved", reason: "metadata-changed-during-read" };
      if (sourceHash(raw) !== file.rawHash) return { status: "unapproved", reason: "raw-hash-mismatch" };
      let bytes = raw;
      if (file.kind === "google-doc") {
        const paragraphs = raw.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
        bytes = JSON.stringify(semanticMasterSchema.parse({ ...file.documentEnvelope, semantic: { kind: "document", paragraphs }, displayText: [], links: [] }));
      }
      const master = semanticMasterSchema.parse(JSON.parse(bytes));
      if (master.approval !== "approved" || master.semantic.kind !== (file.kind === "google-doc" ? "document" : file.kind === "map-json" ? "map" : "cycle"))
        return { status: "unapproved", reason: "master-not-approved-or-wrong-kind" };
      projectMaster(master); // Validate bounded deterministic projection; no instructions/URLs are executed.
      if (sourceHash(bytes) !== file.masterHash) return { status: "unapproved", reason: "master-hash-mismatch" };
      return { status: "available", bytes, metadata: { fileId, parentId: file.parentId, sourceOwnerId: current.data.sourceOwnerId,
        readerPrincipalId: current.data.readerPrincipalId, permission: current.data.permission, visibility: current.data.visibility, revision: after.data.version } };
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError || error instanceof z.ZodError) return { status: "unapproved", reason: "invalid-content" };
      return failure(error);
    }
  } };
}
/** Changes are invalidation hints only. No listing, cursor persistence, scheduler or automatic approval. */
export function classifyGoogleChange(input: unknown, configuredIds: readonly string[]) {
  const parsed = z.object({ fileId: id, removed: z.boolean().default(false), file: z.object({ trashed: z.boolean().optional() }).optional() }).safeParse(input);
  if (!parsed.success || !configuredIds.includes(parsed.data.fileId)) return "ignore" as const;
  if (parsed.data.file?.trashed) return "deleted" as const;
  if (parsed.data.removed) return "access-lost-or-deleted" as const;
  return "revalidate" as const;
}
