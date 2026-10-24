import { and, eq, sql } from "drizzle-orm";
import { db, knowledgeResourcesTable as resources, knowledgeVersionsTable as versions, knowledgeSourceAuthorizationsTable as authorizations } from "@workspace/db";
import type { KnowledgeRepository } from "./service";

export const knowledgeRepository: KnowledgeRepository = {
  async readPublished(scope) {
    const rows = await db.select({ resource: resources, version: versions, authorization: authorizations }).from(resources).innerJoin(versions, and(
      eq(versions.practiceId, resources.practiceId), eq(versions.principalId, resources.principalId),
      eq(versions.resourceId, resources.id), eq(versions.version, resources.publishedVersion),
    )).innerJoin(authorizations, and(eq(authorizations.practiceId, resources.practiceId), eq(authorizations.principalId, resources.principalId),
      eq(authorizations.fileId, sql`${versions.source}->>'fileId'`))).where(and(eq(resources.practiceId, scope.practiceId), eq(resources.principalId, scope.principalId),
      eq(resources.archived, false), eq(resources.audience, "owner"), eq(versions.approval, "approved"), eq(authorizations.state, "approved"))).limit(100);
    return rows.map(row => ({ resource: row.resource, authorization: { ...row.authorization, approvedAt: row.authorization.approvedAt?.toISOString() ?? null }, version: { ...row.version,
      createdAt: row.version.createdAt.toISOString(), approvedAt: row.version.approvedAt?.toISOString() ?? null } }));
  },
};
