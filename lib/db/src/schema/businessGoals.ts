import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const businessGoalsTable = pgTable("business_goals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  timeHorizon: text("time_horizon").notNull().default("1year"),
  ownerPayGoal: numeric("owner_pay_goal", { precision: 12, scale: 2 }).notNull().default("0"),
  secondOwnerPayGoal: numeric("second_owner_pay_goal", { precision: 12, scale: 2 }).notNull().default("0"),
  annualOverheadGoal: numeric("annual_overhead_goal", { precision: 12, scale: 2 }).notNull().default("0"),
  businessProfitGoal: numeric("business_profit_goal", { precision: 12, scale: 2 }).notNull().default("0"),
  buildingFundGoal: numeric("building_fund_goal", { precision: 12, scale: 2 }).notNull().default("0"),
  emergencyReserveGoal: numeric("emergency_reserve_goal", { precision: 12, scale: 2 }).notNull().default("0"),
  growthFundGoal: numeric("growth_fund_goal", { precision: 12, scale: 2 }).notNull().default("0"),
  desiredCliniciansCount: integer("desired_clinicians_count").notNull().default(1),
  desiredOwnerClinicalCaseload: integer("desired_owner_clinical_caseload").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBusinessGoalSchema = createInsertSchema(businessGoalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBusinessGoal = z.infer<typeof insertBusinessGoalSchema>;
export type BusinessGoal = typeof businessGoalsTable.$inferSelect;
