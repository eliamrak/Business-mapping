import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessGoalsTable } from "./businessGoals";

export const staffMembersTable = pgTable("staff_members", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").references(() => businessGoalsTable.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  roleType: text("role_type").notNull().default("admin"),
  classification: text("classification").notNull().default("w2"),
  annualSalary: numeric("annual_salary", { precision: 12, scale: 2 }),
  hourlyRate: numeric("hourly_rate", { precision: 8, scale: 2 }),
  hoursPerWeek: numeric("hours_per_week", { precision: 6, scale: 2 }),
  weeksPerYear: numeric("weeks_per_year", { precision: 6, scale: 2 }).notNull().default("52"),
  w2EmployerFicaPct: numeric("w2_employer_fica_pct", { precision: 7, scale: 4 }).notNull().default("7.65"),
  futaSutaPct: numeric("futa_suta_pct", { precision: 7, scale: 4 }).notNull().default("1.0"),
  workersCompPct: numeric("workers_comp_pct", { precision: 7, scale: 4 }).notNull().default("0.5"),
  otherEmployerBurdenPct: numeric("other_employer_burden_pct", { precision: 7, scale: 4 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertStaffMemberSchema = createInsertSchema(staffMembersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStaffMember = z.infer<typeof insertStaffMemberSchema>;
export type StaffMember = typeof staffMembersTable.$inferSelect;
