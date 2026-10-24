import { and, eq } from "drizzle-orm";
import { db, knowledgeResourcesTable as resources, knowledgeVersionsTable as versions } from "@workspace/db";
import type { KnowledgeRepository } from "./service";

export const knowledgeRepository: KnowledgeRepository = {
  async readPublished(scope) {
    const rows = await db.select({ resource: resources, version: versions }).from(resources).innerJoin(versions, and(
      eq(versions.practiceId, resources.practiceId), eq(versions.principalId, resources.principalId),
      eq(versions.resourceId, resources.id), eq(versions.version, resources.publishedVersion),
    )).where(and(eq(resources.practiceId, scope.practiceId), eq(resources.principalId, scope.principalId),
      eq(resources.archived, false), eq(resources.audience, "owner"), eq(versions.approval, "approved"))).limit(100);
    return rows.map(row => ({ resource: row.resource, version: { ...row.version,
      createdAt: row.version.createdAt.toISOString(), approvedAt: row.version.approvedAt?.toISOString() ?? null } }));
  },
};
