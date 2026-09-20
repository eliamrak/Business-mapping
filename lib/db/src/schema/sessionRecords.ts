import {
  pgTable,
  serial,
  integer,
  date,
  timestamp,
  uniqueIndex,
  check,
  uuid,
  jsonb,
  text,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cliniciansTable } from "./clinicians";
import { hubAttachmentsTable } from "./hub";

export const sessionRecordsTable = pgTable(
  "session_records",
  {
    id: serial("id").primaryKey(),
    clinicianId: integer("clinician_id")
      .notNull()
      .references(() => cliniciansTable.id, { onDelete: "restrict" }),
    start: date("period_start").notNull(),
    end: date("period_end").notNull(),
    completed: integer("completed").notNull(),
    desired: integer("desired").notNull(),
    cancelled: integer("cancelled"),
    noShow: integer("no_show"),
    scheduled: integer("scheduled"),
    inPerson: integer("in_person"),
    telehealth: integer("telehealth"),
    sourceAttachmentId: uuid("source_attachment_id").references(
      () => hubAttachmentsTable.id,
      { onDelete: "restrict" },
    ),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("session_records_clinician_period").on(
      table.clinicianId,
      table.start,
      table.end,
    ),
    check(
      "session_records_dates",
      sql`${table.end} >= ${table.start} AND ${table.end} - ${table.start} < 366`,
    ),
    check(
      "session_records_counts",
      sql`${table.completed} BETWEEN 0 AND 10000 AND ${table.desired} BETWEEN 0 AND 10000 AND (${table.cancelled} IS NULL OR ${table.cancelled} BETWEEN 0 AND 10000) AND (${table.noShow} IS NULL OR ${table.noShow} BETWEEN 0 AND 10000)`,
    ),
    check(
      "session_records_detail_counts",
      sql`(${table.scheduled} IS NULL OR ${table.scheduled} BETWEEN ${table.completed} AND 10000) AND (${table.inPerson} IS NULL OR ${table.inPerson} BETWEEN 0 AND ${table.completed}) AND (${table.telehealth} IS NULL OR ${table.telehealth} BETWEEN 0 AND ${table.completed}) AND (${table.inPerson} IS NULL OR ${table.telehealth} IS NULL OR ${table.inPerson} + ${table.telehealth} = ${table.completed})`,
    ),
  ],
);

export const sessionHistoryTable = pgTable(
  "session_record_history",
  {
    id: serial("id").primaryKey(),
    recordId: integer("record_id")
      .notNull()
      .references(() => sessionRecordsTable.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    requestId: uuid("request_id").notNull().unique(),
    command: jsonb("command").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    actor: text("actor").notNull().default("Legacy entry"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("session_history_record_revision").on(
      table.recordId,
      table.revision,
    ),
  ],
);
