import { pgTable, serial, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const currentRealityTable = pgTable("current_reality", {
  id: serial("id").primaryKey(),
  currentOwnerPay: numeric("current_owner_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  currentSecondOwnerPay: numeric("current_second_owner_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  currentAnnualOverhead: numeric("current_annual_overhead", { precision: 12, scale: 2 }).notNull().default("0"),
  currentBusinessProfit: numeric("current_business_profit", { precision: 12, scale: 2 }).notNull().default("0"),
  currentCashReserve: numeric("current_cash_reserve", { precision: 12, scale: 2 }).notNull().default("0"),
  currentBuildingFund: numeric("current_building_fund", { precision: 12, scale: 2 }).notNull().default("0"),
  currentCliniciansCount: integer("current_clinicians_count").notNull().default(1),
  currentAvgSessionRate: numeric("current_avg_session_rate", { precision: 8, scale: 2 }).notNull().default("175"),
  currentAvgSessionsPerWeek: numeric("current_avg_sessions_per_week", { precision: 6, scale: 2 }).notNull().default("20"),
  currentAvgWeeksWorkedPerYear: numeric("current_avg_weeks_worked_per_year", { precision: 6, scale: 2 }).notNull().default("48"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCurrentRealitySchema = createInsertSchema(currentRealityTable).omit({ id: true, updatedAt: true });
export type InsertCurrentReality = z.infer<typeof insertCurrentRealitySchema>;
export type CurrentReality = typeof currentRealityTable.$inferSelect;
