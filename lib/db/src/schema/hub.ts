import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  uuid,
  uniqueIndex,
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
