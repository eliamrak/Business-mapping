import { pgTable, text, integer, uuid, jsonb, timestamp, boolean, primaryKey, foreignKey } from "drizzle-orm/pg-core";

// Definition only. This foundation does not run migrations or enable an importer.
export const knowledgeResourcesTable = pgTable("knowledge_resources", {
  practiceId: text("practice_id").notNull(), principalId: text("principal_id").notNull(), id: uuid("id").notNull(),
  kind: text("kind").notNull().default("reference"),
  title: text("title").notNull(), category: text("category").notNull(), audience: text("audience").notNull().default("owner"),
  publishedVersion: integer("published_version"), archived: boolean("archived").notNull().default(false),
}, t => [primaryKey({ columns: [t.practiceId, t.principalId, t.id] })]);
export const knowledgeVersionsTable = pgTable("knowledge_versions", {
  practiceId: text("practice_id").notNull(), principalId: text("principal_id").notNull(), resourceId: uuid("resource_id").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1), derivedViewVersion: integer("derived_view_version").notNull().default(1),
  version: integer("version").notNull(), content: jsonb("content").notNull(), contentHash: text("content_hash").notNull(),
  approval: text("approval").notNull().default("draft"), approvedBy: text("approved_by"), approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), source: jsonb("source").notNull(),
}, t => [primaryKey({ columns: [t.practiceId, t.principalId, t.resourceId, t.version] }),
  foreignKey({ columns: [t.practiceId, t.principalId, t.resourceId], foreignColumns: [knowledgeResourcesTable.practiceId, knowledgeResourcesTable.principalId, knowledgeResourcesTable.id] })]);
export const knowledgeImportReceiptsTable = pgTable("knowledge_import_receipts", {
  practiceId: text("practice_id").notNull(), principalId: text("principal_id").notNull(), id: uuid("id").notNull(), resourceId: uuid("resource_id").notNull(),
  sourceFileId: text("source_file_id").notNull(), sourceRevision: text("source_revision").notNull(), contentHash: text("content_hash").notNull(),
  status: text("status").notNull(), reason: text("reason").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.practiceId, t.principalId, t.id] }),
  foreignKey({ columns: [t.practiceId, t.principalId, t.resourceId], foreignColumns: [knowledgeResourcesTable.practiceId, knowledgeResourcesTable.principalId, knowledgeResourcesTable.id] })]);
