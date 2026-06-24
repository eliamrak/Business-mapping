import { pgTable, serial, text, numeric, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessGoalsTable } from "./businessGoals";

export const cliniciansTable = pgTable("clinicians", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").references(() => businessGoalsTable.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  roleType: text("role_type").notNull().default("associate"),
  classification: text("classification").notNull().default("w2"),
  sessionRate: numeric("session_rate", { precision: 8, scale: 2 }).notNull().default("175"),
  sessionsPerWeek: numeric("sessions_per_week", { precision: 6, scale: 2 }).notNull().default("20"),
  weeksWorkedPerYear: numeric("weeks_worked_per_year", { precision: 6, scale: 2 }).notNull().default("48"),
  preCapClinicianSplit: numeric("pre_cap_clinician_split", { precision: 7, scale: 4 }).notNull().default("60"),
  preCapPracticeSplit: numeric("pre_cap_practice_split", { precision: 7, scale: 4 }).notNull().default("40"),
  capEnabled: boolean("cap_enabled").notNull().default(true),
  capAmount: numeric("cap_amount", { precision: 12, scale: 2 }).notNull().default("50000"),
  postCapClinicianSplit: numeric("post_cap_clinician_split", { precision: 7, scale: 4 }).notNull().default("75"),
  postCapPracticeSplit: numeric("post_cap_practice_split", { precision: 7, scale: 4 }).notNull().default("25"),
  w2EmployerFicaPct: numeric("w2_employer_fica_pct", { precision: 7, scale: 4 }).notNull().default("7.65"),
  futaSutaPct: numeric("futa_suta_pct", { precision: 7, scale: 4 }).notNull().default("1.0"),
  workersCompPct: numeric("workers_comp_pct", { precision: 7, scale: 4 }).notNull().default("0.5"),
  otherEmployerBurdenPct: numeric("other_employer_burden_pct", { precision: 7, scale: 4 }).notNull().default("0"),
  nonClinicalHoursPerWeek: numeric("non_clinical_hours_per_week", { precision: 6, scale: 2 }).notNull().default("0"),
  nonClinicalHourlyRate: numeric("non_clinical_hourly_rate", { precision: 8, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  shareToken: text("share_token"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertClinicianSchema = createInsertSchema(cliniciansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClinician = z.infer<typeof insertClinicianSchema>;
export type Clinician = typeof cliniciansTable.$inferSelect;
