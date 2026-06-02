import { Router } from "express";
import { db } from "@workspace/db";
import { currentRealityTable } from "@workspace/db";

const router = Router();

function toApiReality(row: typeof currentRealityTable.$inferSelect) {
  return {
    id: row.id,
    currentOwnerPay: Number(row.currentOwnerPay),
    currentSecondOwnerPay: Number(row.currentSecondOwnerPay),
    currentAnnualOverhead: Number(row.currentAnnualOverhead),
    currentBusinessProfit: Number(row.currentBusinessProfit),
    currentCashReserve: Number(row.currentCashReserve),
    currentBuildingFund: Number(row.currentBuildingFund),
    currentCliniciansCount: row.currentCliniciansCount,
    currentAvgSessionRate: Number(row.currentAvgSessionRate),
    currentAvgSessionsPerWeek: Number(row.currentAvgSessionsPerWeek),
    currentAvgWeeksWorkedPerYear: Number(row.currentAvgWeeksWorkedPerYear),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/current-reality", async (_req, res) => {
  const rows = await db.select().from(currentRealityTable).limit(1);
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  return res.json(toApiReality(rows[0]));
});

router.put("/current-reality", async (req, res) => {
  const body = req.body;
  const existing = await db.select().from(currentRealityTable).limit(1);

  if (existing.length) {
    const [updated] = await db
      .update(currentRealityTable)
      .set({
        currentOwnerPay: body.currentOwnerPay !== undefined ? String(body.currentOwnerPay) : undefined,
        currentSecondOwnerPay: body.currentSecondOwnerPay !== undefined ? String(body.currentSecondOwnerPay) : undefined,
        currentAnnualOverhead: body.currentAnnualOverhead !== undefined ? String(body.currentAnnualOverhead) : undefined,
        currentBusinessProfit: body.currentBusinessProfit !== undefined ? String(body.currentBusinessProfit) : undefined,
        currentCashReserve: body.currentCashReserve !== undefined ? String(body.currentCashReserve) : undefined,
        currentBuildingFund: body.currentBuildingFund !== undefined ? String(body.currentBuildingFund) : undefined,
        currentCliniciansCount: body.currentCliniciansCount,
        currentAvgSessionRate: body.currentAvgSessionRate !== undefined ? String(body.currentAvgSessionRate) : undefined,
        currentAvgSessionsPerWeek: body.currentAvgSessionsPerWeek !== undefined ? String(body.currentAvgSessionsPerWeek) : undefined,
        currentAvgWeeksWorkedPerYear: body.currentAvgWeeksWorkedPerYear !== undefined ? String(body.currentAvgWeeksWorkedPerYear) : undefined,
        updatedAt: new Date(),
      })
      .returning();
    return res.json(toApiReality(updated));
  }

  const [created] = await db
    .insert(currentRealityTable)
    .values({
      currentOwnerPay: String(body.currentOwnerPay ?? 0),
      currentSecondOwnerPay: String(body.currentSecondOwnerPay ?? 0),
      currentAnnualOverhead: String(body.currentAnnualOverhead ?? 0),
      currentBusinessProfit: String(body.currentBusinessProfit ?? 0),
      currentCashReserve: String(body.currentCashReserve ?? 0),
      currentBuildingFund: String(body.currentBuildingFund ?? 0),
      currentCliniciansCount: body.currentCliniciansCount ?? 1,
      currentAvgSessionRate: String(body.currentAvgSessionRate ?? 175),
      currentAvgSessionsPerWeek: String(body.currentAvgSessionsPerWeek ?? 20),
      currentAvgWeeksWorkedPerYear: String(body.currentAvgWeeksWorkedPerYear ?? 48),
    })
    .returning();
  return res.json(toApiReality(created));
});

export default router;
