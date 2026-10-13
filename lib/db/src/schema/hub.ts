import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  uuid,
  uniqueIndex,
  date,
  index,
} from "drizzle-orm/pg-core";

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

export const practiceImportPackagesTable = pgTable(
  "practice_import_packages",
  {
    id: uuid("id").primaryKey(),
    practiceId: text("practice_id").notNull(),
    accountId: text("account_id").notNull(),
    packageId: text("package_id").notNull(),
    contentHash: text("content_hash").notNull(),
    exportedAt: timestamp("exported_at", { withTimezone: true }).notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    importedBy: text("imported_by").notNull(),
    billingCodeMinutes: jsonb("billing_code_minutes").notNull().default({}),
    sameDayVisitOverrides: jsonb("same_day_visit_overrides")
      .notNull()
      .default({}),
    active: integer("active").notNull().default(1),
  },
  (table) => [
    uniqueIndex("practice_import_packages_scope_package").on(
      table.practiceId,
      table.accountId,
      table.packageId,
    ),
  ],
);

export const practiceImportSnapshotsTable = pgTable(
  "practice_import_snapshots",
  {
    id: uuid("id").primaryKey(),
    packageImportId: uuid("package_import_id")
      .notNull()
      .references(() => practiceImportPackagesTable.id, {
        onDelete: "restrict",
      }),
    practiceId: text("practice_id").notNull(),
    accountId: text("account_id").notNull(),
    kind: text("kind").notNull(),
    coverageStart: date("coverage_start").notNull(),
    coverageEnd: date("coverage_end").notNull(),
    sourceHash: text("source_hash").notNull(),
    rowCount: integer("row_count").notNull(),
    rows: jsonb("rows").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("practice_import_snapshots_scope_active").on(
      table.practiceId,
      table.accountId,
      table.active,
      table.kind,
      table.coverageStart,
      table.coverageEnd,
    ),
  ],
);

export const practiceImportAuditTable = pgTable("practice_import_audit", {
  id: uuid("id").primaryKey(),
  practiceId: text("practice_id").notNull(),
  accountId: text("account_id").notNull(),
  packageId: text("package_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  detail: jsonb("detail").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
