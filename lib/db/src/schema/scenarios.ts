import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessGoalsTable } from "./businessGoals";

export const scenariosTable = pgTable("scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes"),
  businessGoalId: integer("business_goal_id").references(() => businessGoalsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertScenarioSchema = createInsertSchema(scenariosTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertScenario = z.infer<typeof insertScenarioSchema>;
export type Scenario = typeof scenariosTable.$inferSelect;
