import { Router } from "express";
import { db } from "@workspace/db";
import { cliniciansTable, businessGoalsTable } from "@workspace/db";
import { eq, isNull, inArray } from "drizzle-orm";

const router = Router();

function toApiClinician(row: typeof cliniciansTable.$inferSelect) {
  return {
    id: row.id,
    goalId: row.goalId ?? null,
    label: row.label,
    roleType: row.roleType,
    classification: row.classification,
    sessionRate: Number(row.sessionRate),
    sessionsPerWeek: Number(row.sessionsPerWeek),
    weeksWorkedPerYear: Number(row.weeksWorkedPerYear),
    preCapClinicianSplit: Number(row.preCapClinicianSplit),
    preCapPracticeSplit: Number(row.preCapPracticeSplit),
    capEnabled: row.capEnabled,
    capAmount: Number(row.capAmount),
    postCapClinicianSplit: Number(row.postCapClinicianSplit),
    postCapPracticeSplit: Number(row.postCapPracticeSplit),
    w2EmployerFicaPct: Number(row.w2EmployerFicaPct),
    futaSutaPct: Number(row.futaSutaPct),
    workersCompPct: Number(row.workersCompPct),
    otherEmployerBurdenPct: Number(row.otherEmployerBurdenPct),
    nonClinicalHoursPerWeek: Number(row.nonClinicalHoursPerWeek),
    nonClinicalHourlyRate: Number(row.nonClinicalHourlyRate),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function defaultsForClassification(classification: string) {
  if (classification === "1099") {
    return { preCapClinicianSplit: "60", preCapPracticeSplit: "40", postCapClinicianSplit: "95", postCapPracticeSplit: "5" };
  }
  return { preCapClinicianSplit: "60", preCapPracticeSplit: "40", postCapClinicianSplit: "75", postCapPracticeSplit: "25" };
}

router.get("/clinicians", async (req, res) => {
  const rawGoalId = req.query.goalId;
  const goalId = rawGoalId !== undefined ? Number(rawGoalId) : undefined;
  const clinicians = goalId !== undefined && !isNaN(goalId)
    ? await db.select().from(cliniciansTable).where(eq(cliniciansTable.goalId, goalId)).orderBy(cliniciansTable.createdAt)
    : await db.select().from(cliniciansTable).orderBy(cliniciansTable.createdAt);
  res.json(clinicians.map(toApiClinician));
});

router.post("/clinicians/copy-to-goal", async (req, res) => {
  const { ids, toGoalId } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || !toGoalId) {
    return res.status(400).json({ error: "ids (array) and toGoalId required" });
  }
  const sources = await db.select().from(cliniciansTable).where(inArray(cliniciansTable.id, ids.map(Number)));
  if (!sources.length) return res.status(404).json({ error: "No clinicians found" });
  const copies = await db.insert(cliniciansTable).values(
    sources.map(({ id: _id, createdAt: _c, updatedAt: _u, goalId: _g, ...rest }) => ({
      ...rest,
      goalId: Number(toGoalId),
    }))
  ).returning();
  return res.status(201).json(copies.map(toApiClinician));
});

router.post("/clinicians", async (req, res) => {
  const body = req.body;
  const classification = body.classification ?? "w2";
  const splits = defaultsForClassification(classification);
  const [clinician] = await db.insert(cliniciansTable).values({
    goalId: body.goalId !== undefined ? Number(body.goalId) : null,
    label: body.label ?? "New Clinician",
    roleType: body.roleType ?? "associate",
    classification,
    sessionRate: String(body.sessionRate ?? 175),
    sessionsPerWeek: String(body.sessionsPerWeek ?? 20),
    weeksWorkedPerYear: String(body.weeksWorkedPerYear ?? 48),
    preCapClinicianSplit: body.preCapClinicianSplit !== undefined ? String(body.preCapClinicianSplit) : splits.preCapClinicianSplit,
    preCapPracticeSplit: body.preCapPracticeSplit !== undefined ? String(body.preCapPracticeSplit) : splits.preCapPracticeSplit,
    capEnabled: body.capEnabled !== undefined ? body.capEnabled : true,
    capAmount: String(body.capAmount ?? 50000),
    postCapClinicianSplit: body.postCapClinicianSplit !== undefined ? String(body.postCapClinicianSplit) : splits.postCapClinicianSplit,
    postCapPracticeSplit: body.postCapPracticeSplit !== undefined ? String(body.postCapPracticeSplit) : splits.postCapPracticeSplit,
    w2EmployerFicaPct: String(body.w2EmployerFicaPct ?? 7.65),
    futaSutaPct: String(body.futaSutaPct ?? 1.0),
    workersCompPct: String(body.workersCompPct ?? 0.5),
    otherEmployerBurdenPct: String(body.otherEmployerBurdenPct ?? 0),
    nonClinicalHoursPerWeek: String(body.nonClinicalHoursPerWeek ?? 0),
    nonClinicalHourlyRate: String(body.nonClinicalHourlyRate ?? 0),
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(toApiClinician(clinician));
});

router.get("/clinicians/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [clinician] = await db.select().from(cliniciansTable).where(eq(cliniciansTable.id, id));
  if (!clinician) return res.status(404).json({ error: "Not found" });
  return res.json(toApiClinician(clinician));
});

router.patch("/clinicians/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const numFields = ["sessionRate", "sessionsPerWeek", "weeksWorkedPerYear", "preCapClinicianSplit", "preCapPracticeSplit", "capAmount", "postCapClinicianSplit", "postCapPracticeSplit", "w2EmployerFicaPct", "futaSutaPct", "workersCompPct", "otherEmployerBurdenPct", "nonClinicalHoursPerWeek", "nonClinicalHourlyRate"];
  const strFields = ["label", "roleType", "classification", "notes"];
  const boolFields = ["capEnabled"];
  const dbFieldMap: Record<string, string> = {
    sessionRate: "sessionRate", sessionsPerWeek: "sessionsPerWeek", weeksWorkedPerYear: "weeksWorkedPerYear",
    preCapClinicianSplit: "preCapClinicianSplit", preCapPracticeSplit: "preCapPracticeSplit",
    capAmount: "capAmount", postCapClinicianSplit: "postCapClinicianSplit", postCapPracticeSplit: "postCapPracticeSplit",
    w2EmployerFicaPct: "w2EmployerFicaPct", futaSutaPct: "futaSutaPct", workersCompPct: "workersCompPct",
    otherEmployerBurdenPct: "otherEmployerBurdenPct",
    nonClinicalHoursPerWeek: "nonClinicalHoursPerWeek", nonClinicalHourlyRate: "nonClinicalHourlyRate",
  };
  for (const f of numFields) {
    if (body[f] !== undefined) updates[dbFieldMap[f] ?? f] = String(body[f]);
  }
  for (const f of strFields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  for (const f of boolFields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  const [clinician] = await db.update(cliniciansTable).set(updates).where(eq(cliniciansTable.id, id)).returning();
  if (!clinician) return res.status(404).json({ error: "Not found" });
  return res.json(toApiClinician(clinician));
});

router.delete("/clinicians/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.delete(cliniciansTable).where(eq(cliniciansTable.id, id)).returning();
  if (!result.length) return res.status(404).json({ error: "Not found" });
  return res.status(204).send();
});

router.post("/clinicians/:id/duplicate", async (req, res) => {
  const id = Number(req.params.id);
  const [original] = await db.select().from(cliniciansTable).where(eq(cliniciansTable.id, id));
  if (!original) return res.status(404).json({ error: "Not found" });
  const { id: _id, createdAt: _c, updatedAt: _u, label, ...rest } = original;
  const [copy] = await db.insert(cliniciansTable).values({ ...rest, label: `${label} (Copy)` }).returning();
  return res.status(201).json(toApiClinician(copy));
});

export default router;
