import {
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
  jsonb,
  uuid,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const hubWorkspacesTable = pgTable("hub_workspaces", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const hubHistoryTable = pgTable(
  "hub_history",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => hubWorkspacesTable.id),
    revision: integer("revision").notNull(),
    requestId: uuid("request_id").notNull().unique(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    command: jsonb("command").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("hub_history_workspace_revision").on(
      table.workspaceId,
      table.revision,
    ),
  ],
);
export const hubAttachmentsTable = pgTable("hub_attachments", {
  id: uuid("id").primaryKey(),
  periodId: uuid("period_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  data: text("data").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const hubUsersTable = pgTable("hub_users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  disabled: integer("disabled").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const hubAuthSessionsTable = pgTable("hub_auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const localRetentionSnapshotsTable = pgTable(
  "local_retention_snapshots",
  {
    id: serial("id").primaryKey(),
    practiceId: text("practice_id").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    kind: text("kind").notNull(),
    packageId: text("package_id"),
    packageExportedAt: timestamp("package_exported_at", {
      withTimezone: true,
    }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    coverageStart: date("coverage_start").notNull(),
    coverageEnd: date("coverage_end").notNull(),
    sourceHash: text("source_hash").notNull(),
    rowCount: integer("row_count").notNull(),
    rows: jsonb("rows").notNull(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("local_retention_practice_snapshot").on(
      table.practiceId,
      table.snapshotId,
    ),
    uniqueIndex("local_retention_kind_source_hash").on(
      table.practiceId,
      table.kind,
      table.sourceHash,
    ),
    uniqueIndex("local_retention_package_kind").on(
      table.practiceId,
      table.packageId,
      table.kind,
    ),
    check(
      "local_retention_snapshot_kind",
      sql`${table.kind} IN ('attendance', 'billing')`,
    ),
    check(
      "local_retention_snapshot_dates",
      sql`${table.coverageEnd} >= ${table.coverageStart}`,
    ),
    check("local_retention_snapshot_rows", sql`${table.rowCount} > 0`),
  ],
);

export const localRetentionSettingsTable = pgTable("local_retention_settings", {
  id: serial("id").primaryKey(),
  practiceId: text("practice_id").notNull().unique(),
  billingCodeMinutes: jsonb("billing_code_minutes")
    .notNull()
    .default(sql`'{}'::jsonb`),
  actor: text("actor").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const localRetentionImportEventsTable = pgTable(
  "local_retention_import_events",
  {
    id: serial("id").primaryKey(),
    practiceId: text("practice_id").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    packageId: text("package_id"),
    command: jsonb("command").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);
