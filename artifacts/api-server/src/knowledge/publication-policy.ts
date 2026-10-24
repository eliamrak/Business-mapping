import { createHash } from "node:crypto";
import type { PipelineConfig } from "./import-contracts";
/** The mutable release pin is excluded; source/identity/epoch/lease policy remains independently bound. */
export function publicationPolicyHash(config: PipelineConfig) {
  const normalized = { ...config, approvedManifestHash: null,
    sources: [...config.sources].sort((a, b) => a.resourceId.localeCompare(b.resourceId)) };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
