import { z } from "@workspace/practice";
import { googleReadConfigSchema, DRIVE_METADATA_FIELDS, GoogleReadFailure, type GoogleReadClient } from "./google-read-adapter";

export const GOOGLE_DRIVE_READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const opaqueId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
export const googleTransportSetupSchema = z.object({
  enabled: z.boolean().default(false),
  expectedServiceAccountEmail: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/),
  expectedReaderPermissionId: opaqueId,
  scope: z.literal(GOOGLE_DRIVE_READ_SCOPE),
  permissionMaxAgeMs: z.number().int().min(1).max(86400000),
  timeoutMs: z.number().int().min(1).max(30000),
  registration: googleReadConfigSchema,
}).strict().refine(value => value.registration.files.every(file => file.readerPrincipalId === value.expectedReaderPermissionId), "Reader binding mismatch");
/** Opaque tokens come ONLY from a future explicitly configured, reviewed dedicated-identity issuer. No ADC/owner-token fallback. */
export interface DedicatedGoogleTokenSource {
  getToken(request: { serviceAccountEmail: string; scope: typeof GOOGLE_DRIVE_READ_SCOPE; signal: AbortSignal }): Promise<{
    accessToken: string; serviceAccountEmail: string; scope: string; expiresAtMs: number;
  }>;
}
export type GoogleHttpTransport = (url: string, init: RequestInit) => Promise<Response>;
function safeError(status: number, reason: string) { return new GoogleReadFailure(status, reason); }
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw safeError(503, "timeout");
  let listener: () => void = () => {};
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    listener = () => reject(safeError(503, "timeout")); signal.addEventListener("abort", listener, { once: true });
  })]); } finally { signal.removeEventListener("abort", listener); }
}
async function body(response: Response, limit: number, signal: AbortSignal) {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || BigInt(length) > BigInt(limit))) {
    void response.body?.cancel().catch(() => {}); throw safeError(400, "size-limit");
  }
  if (!response.body) throw safeError(400, "empty-response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) {
    const value = await abortable(reader.read(), signal); if (value.done) break;
    size += value.value.byteLength; if (size > limit) throw safeError(400, "size-limit"); chunks.push(value.value);
  } return Buffer.concat(chunks); }
  finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** Concrete fixed-endpoint GET transport. Requires explicit injection; never creates a token source or fetch client. */
export function createGoogleDriveTransport(input: unknown, tokens: DedicatedGoogleTokenSource, http: GoogleHttpTransport,
  now: () => number = Date.now): GoogleReadClient {
  // Configuration may be secret-adjacent; expose no raw Zod input/error detail.
  const parsed = googleTransportSetupSchema.safeParse(input);
  if (!parsed.success) throw safeError(400, "invalid-server-configuration");
  const config = parsed.data;
  async function request(fileId: string, operation: "metadata" | "export" | "media", maxBytes: number) {
    const file = config.registration.files.find(value => value.fileId === fileId && value.approvedForImport);
    if (!config.enabled || !config.registration.enabled || !file) throw safeError(403, "transport-disabled-or-unregistered");
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 500000 || operation !== "metadata" && maxBytes > file.maxBytes)
      throw safeError(400, "invalid-payload-limit");
    if (operation === "export" && file.kind !== "google-doc" || operation === "media" && file.kind === "google-doc") throw safeError(400, "source-type-mismatch");
    const url = new URL("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + (operation === "export" ? "/export" : ""));
    if (operation === "metadata") url.searchParams.set("fields", DRIVE_METADATA_FIELDS);
    else url.searchParams.set(operation === "export" ? "mimeType" : "alt", operation === "export" ? "text/plain" : "media");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      let token;
      try { token = await abortable(tokens.getToken({ serviceAccountEmail: config.expectedServiceAccountEmail, scope: GOOGLE_DRIVE_READ_SCOPE, signal: controller.signal }), controller.signal); }
      catch { throw safeError(controller.signal.aborted ? 503 : 401, "token-unavailable"); }
      const time = now();
      if (!Number.isFinite(time) || token.serviceAccountEmail !== config.expectedServiceAccountEmail || token.scope !== GOOGLE_DRIVE_READ_SCOPE ||
        !Number.isFinite(token.expiresAtMs) || token.expiresAtMs <= time + config.timeoutMs ||
        typeof token.accessToken !== "string" || !/^[A-Za-z0-9._~-]{1,4096}$/.test(token.accessToken)) throw safeError(401, "token-binding-invalid");
      const response = await abortable(http(url.toString(), { method: "GET", redirect: "manual", credentials: "omit", cache: "no-store",
        headers: { Authorization: "Bearer " + token.accessToken, Accept: operation === "export" ? "text/plain" : "application/json" }, signal: controller.signal }), controller.signal);
      if (response.redirected || response.status >= 300 && response.status < 400 || response.url && response.url !== url.toString()) throw safeError(403, "redirect-rejected");
      if (!response.ok) {
        let reason = "provider-failure";
        try {
          const detail = JSON.parse(new TextDecoder().decode(await body(response, 16384, controller.signal)));
          const candidate = detail?.error?.errors?.[0]?.reason;
          if (["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"].includes(candidate)) reason = candidate;
        } catch { /* Never propagate provider body, URLs, headers, or error messages. */ }
        throw safeError(response.status, reason);
      }
      const expected = operation === "export" ? "text/plain" : "application/json";
      if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== expected) throw safeError(400, "unexpected-content-type");
      return await body(response, maxBytes, controller.signal);
    } catch (error) {
      // Only our enumerated reason codes are returned. Never forward an injected exception/cause.
      const reasons = ["timeout", "token-unavailable", "token-binding-invalid", "redirect-rejected", "provider-failure", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "unexpected-content-type", "size-limit", "empty-response"];
      if (error instanceof GoogleReadFailure && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 && reasons.includes(error.reason)) throw safeError(error.status, error.reason);
      throw safeError(503, "transport-failure");
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return {
    async metadata(fileId, fields) {
      if (fields !== DRIVE_METADATA_FIELDS) throw safeError(400, "unsupported-field-mask");
      const bytes = await request(fileId, "metadata", 65536);
      try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw safeError(400, "invalid-metadata-json"); }
    },
    // Own successful reads do not prove full restricted sharing or Viewer-only ACLs. Existing gate is unchanged.
    async authority() { return { status: "unknown", reason: "authority-policy-review-required" }; },
    async exportText(fileId, mimeType, maxBytes) {
      if (mimeType !== "text/plain") throw safeError(400, "unsupported-export-type");
      const bytes = await request(fileId, "export", maxBytes); return (async function* () { yield bytes; })();
    },
    async downloadJson(fileId, maxBytes) { const bytes = await request(fileId, "media", maxBytes); return (async function* () { yield bytes; })(); },
  };
}
/** Environment acknowledgement only. Even a true flag cannot enable the production route. */
export function googleProductionSetupState(env: Readonly<Record<string, string | undefined>>) {
  if (env.PRACTICE_KNOWLEDGE_GOOGLE_ENABLED && env.PRACTICE_KNOWLEDGE_GOOGLE_ENABLED !== "false")
    throw safeError(403, "live-setup-not-approved");
  return { enabled: false as const, missing: ["approved-project-and-identity", "explicit-token-issuer", "registered-sources", "reviewed-authority-policy"] };
}
