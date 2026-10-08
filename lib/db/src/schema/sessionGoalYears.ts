import {
  pgTable,
  serial,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cliniciansTable } from "./clinicians";

export const sessionGoalYearsTable = pgTable(
  "session_goal_years",
  {
    id: serial("id").primaryKey(),
    clinicianId: integer("clinician_id")
      .notNull()
      .references(() => cliniciansTable.id, { onDelete: "restrict" }),
    year: integer("goal_year").notNull(),
    sessionsPerWeek: numeric("sessions_per_week", {
      precision: 6,
      scale: 2,
    }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("session_goal_years_clinician_year").on(
      table.clinicianId,
      table.year,
    ),
    check(
      "session_goal_years_valid",
      sql`${table.year} BETWEEN 2000 AND 2100 AND ${table.sessionsPerWeek} BETWEEN 0 AND 100`,
    ),
  ],
);
