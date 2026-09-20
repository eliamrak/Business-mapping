import { Router } from "express";
import { db } from "@workspace/db";
import { businessGoalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

function toApiGoal(row: typeof businessGoalsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    timeHorizon: row.timeHorizon,
    ownerPayGoal: Number(row.ownerPayGoal),
    secondOwnerPayGoal: Number(row.secondOwnerPayGoal),
    annualOverheadGoal: Number(row.annualOverheadGoal),
    businessProfitGoal: Number(row.businessProfitGoal),
    buildingFundGoal: Number(row.buildingFundGoal),
    emergencyReserveGoal: Number(row.emergencyReserveGoal),
    growthFundGoal: Number(row.growthFundGoal),
    desiredCliniciansCount: row.desiredCliniciansCount,
    desiredOwnerClinicalCaseload: row.desiredOwnerClinicalCaseload,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/business-goals", async (_req, res) => {
  const goals = await db.select().from(businessGoalsTable).orderBy(businessGoalsTable.createdAt);
  res.json(goals.map(toApiGoal));
});

router.post("/business-goals", async (req, res) => {
  const body = req.body;
  const [goal] = await db.insert(businessGoalsTable).values({
    name: body.name ?? "New Goal",
    timeHorizon: body.timeHorizon ?? "1year",
    ownerPayGoal: String(body.ownerPayGoal ?? 0),
    secondOwnerPayGoal: String(body.secondOwnerPayGoal ?? 0),
    annualOverheadGoal: String(body.annualOverheadGoal ?? 0),
    businessProfitGoal: String(body.businessProfitGoal ?? 0),
    buildingFundGoal: String(body.buildingFundGoal ?? 0),
    emergencyReserveGoal: String(body.emergencyReserveGoal ?? 0),
    growthFundGoal: String(body.growthFundGoal ?? 0),
    desiredCliniciansCount: body.desiredCliniciansCount ?? 1,
    desiredOwnerClinicalCaseload: body.desiredOwnerClinicalCaseload ?? 0,
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(toApiGoal(goal));
});

router.get("/business-goals/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [goal] = await db.select().from(businessGoalsTable).where(eq(businessGoalsTable.id, id));
  if (!goal) return res.status(404).json({ error: "Not found" });
  return res.json(toApiGoal(goal));
});

router.patch("/business-goals/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.timeHorizon !== undefined) updates.timeHorizon = body.timeHorizon;
  if (body.ownerPayGoal !== undefined) updates.ownerPayGoal = String(body.ownerPayGoal);
  if (body.secondOwnerPayGoal !== undefined) updates.secondOwnerPayGoal = String(body.secondOwnerPayGoal);
  if (body.annualOverheadGoal !== undefined) updates.annualOverheadGoal = String(body.annualOverheadGoal);
  if (body.businessProfitGoal !== undefined) updates.businessProfitGoal = String(body.businessProfitGoal);
  if (body.buildingFundGoal !== undefined) updates.buildingFundGoal = String(body.buildingFundGoal);
  if (body.emergencyReserveGoal !== undefined) updates.emergencyReserveGoal = String(body.emergencyReserveGoal);
  if (body.growthFundGoal !== undefined) updates.growthFundGoal = String(body.growthFundGoal);
  if (body.desiredCliniciansCount !== undefined) updates.desiredCliniciansCount = body.desiredCliniciansCount;
  if (body.desiredOwnerClinicalCaseload !== undefined) updates.desiredOwnerClinicalCaseload = body.desiredOwnerClinicalCaseload;
  if (body.notes !== undefined) updates.notes = body.notes;
  const [goal] = await db.update(businessGoalsTable).set(updates).where(eq(businessGoalsTable.id, id)).returning();
  if (!goal) return res.status(404).json({ error: "Not found" });
  return res.json(toApiGoal(goal));
});

router.delete("/business-goals/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.delete(businessGoalsTable).where(eq(businessGoalsTable.id, id)).returning();
  if (!result.length) return res.status(404).json({ error: "Not found" });
  return res.status(204).send();
});

router.post("/business-goals/:id/duplicate", async (req, res) => {
  const id = Number(req.params.id);
  const [original] = await db.select().from(businessGoalsTable).where(eq(businessGoalsTable.id, id));
  if (!original) return res.status(404).json({ error: "Not found" });
  const { id: _id, createdAt: _c, updatedAt: _u, name, ...rest } = original;
  const [copy] = await db.insert(businessGoalsTable).values({ ...rest, name: `${name} (Copy)` }).returning();
  return res.status(201).json(toApiGoal(copy));
});

export default router;
