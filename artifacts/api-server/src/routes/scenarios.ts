import { Router } from "express";
import { db } from "@workspace/db";
import { scenariosTable, scenarioCliniciansTable, scenarioStaffMembersTable, staffMembersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { toApiScenarioStaffMember } from "./staff";

const router = Router();

function toApiScenarioClinician(row: typeof scenarioCliniciansTable.$inferSelect) {
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    sourceClinicianId: row.sourceClinicianId,
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
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toApiScenario(row: typeof scenariosTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    businessGoalId: row.businessGoalId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function toApiScenarioDetail(row: typeof scenariosTable.$inferSelect) {
  const [clinicians, staffMembers] = await Promise.all([
    db.select().from(scenarioCliniciansTable)
      .where(eq(scenarioCliniciansTable.scenarioId, row.id))
      .orderBy(scenarioCliniciansTable.createdAt),
    db.select().from(scenarioStaffMembersTable)
      .where(eq(scenarioStaffMembersTable.scenarioId, row.id))
      .orderBy(scenarioStaffMembersTable.createdAt),
  ]);
  return {
    ...toApiScenario(row),
    clinicians: clinicians.map(toApiScenarioClinician),
    staffMembers: staffMembers.map(toApiScenarioStaffMember),
  };
}

// ── Scenarios ──────────────────────────────────────────────────────────────

router.get("/scenarios", async (_req, res) => {
  const scenarios = await db.select().from(scenariosTable).orderBy(scenariosTable.createdAt);
  res.json(scenarios.map(toApiScenario));
});

router.post("/scenarios", async (req, res) => {
  const body = req.body;
  const [scenario] = await db.insert(scenariosTable).values({
    name: body.name ?? "New Scenario",
    notes: body.notes ?? null,
    businessGoalId: body.businessGoalId ?? null,
  }).returning();
  res.status(201).json(toApiScenario(scenario));
});

router.get("/scenarios/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [scenario] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, id));
  if (!scenario) return res.status(404).json({ error: "Not found" });
  return res.json(await toApiScenarioDetail(scenario));
});

router.patch("/scenarios/:id", async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.notes !== undefined) updates.notes = body.notes;
  if ("businessGoalId" in body) updates.businessGoalId = body.businessGoalId;
  const [scenario] = await db.update(scenariosTable).set(updates).where(eq(scenariosTable.id, id)).returning();
  if (!scenario) return res.status(404).json({ error: "Not found" });
  return res.json(toApiScenario(scenario));
});

router.delete("/scenarios/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.delete(scenariosTable).where(eq(scenariosTable.id, id)).returning();
  if (!result.length) return res.status(404).json({ error: "Not found" });
  return res.status(204).send();
});

router.post("/scenarios/:id/duplicate", async (req, res) => {
  const id = Number(req.params.id);
  const [original] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, id));
  if (!original) return res.status(404).json({ error: "Not found" });
  const { id: _id, createdAt: _c, updatedAt: _u, name, ...rest } = original;
  const [copy] = await db.insert(scenariosTable).values({ ...rest, name: `${name} (Copy)` }).returning();

  // Duplicate all clinicians and staff members
  const [clinicians, staffMembers] = await Promise.all([
    db.select().from(scenarioCliniciansTable).where(eq(scenarioCliniciansTable.scenarioId, id)),
    db.select().from(scenarioStaffMembersTable).where(eq(scenarioStaffMembersTable.scenarioId, id)),
  ]);

  for (const c of clinicians) {
    const { id: _cid, scenarioId: _scid, createdAt: _cc, updatedAt: _cu, ...cRest } = c;
    await db.insert(scenarioCliniciansTable).values({ ...cRest, scenarioId: copy.id });
  }

  for (const s of staffMembers) {
    const { id: _sid, scenarioId: _scid, createdAt: _sc, updatedAt: _su, ...sRest } = s;
    await db.insert(scenarioStaffMembersTable).values({ ...sRest, scenarioId: copy.id });
  }

  return res.status(201).json(await toApiScenarioDetail(copy));
});

// ── Scenario Clinicians ────────────────────────────────────────────────────

router.get("/scenarios/:scenarioId/clinicians", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const clinicians = await db.select().from(scenarioCliniciansTable)
    .where(eq(scenarioCliniciansTable.scenarioId, scenarioId))
    .orderBy(scenarioCliniciansTable.createdAt);
  res.json(clinicians.map(toApiScenarioClinician));
});

router.post("/scenarios/:scenarioId/clinicians", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const body = req.body;
  const classification = body.classification ?? "w2";
  const [sc] = await db.insert(scenarioCliniciansTable).values({
    scenarioId,
    sourceClinicianId: body.sourceClinicianId ?? null,
    label: body.label ?? "New Clinician",
    roleType: body.roleType ?? "associate",
    classification,
    sessionRate: String(body.sessionRate ?? 175),
    sessionsPerWeek: String(body.sessionsPerWeek ?? 20),
    weeksWorkedPerYear: String(body.weeksWorkedPerYear ?? 48),
    preCapClinicianSplit: body.preCapClinicianSplit !== undefined ? String(body.preCapClinicianSplit) : (classification === "1099" ? "60" : "60"),
    preCapPracticeSplit: body.preCapPracticeSplit !== undefined ? String(body.preCapPracticeSplit) : (classification === "1099" ? "40" : "40"),
    capEnabled: body.capEnabled !== undefined ? body.capEnabled : true,
    capAmount: String(body.capAmount ?? 50000),
    postCapClinicianSplit: body.postCapClinicianSplit !== undefined ? String(body.postCapClinicianSplit) : (classification === "1099" ? "95" : "75"),
    postCapPracticeSplit: body.postCapPracticeSplit !== undefined ? String(body.postCapPracticeSplit) : (classification === "1099" ? "5" : "25"),
    w2EmployerFicaPct: String(body.w2EmployerFicaPct ?? 7.65),
    futaSutaPct: String(body.futaSutaPct ?? 1.0),
    workersCompPct: String(body.workersCompPct ?? 0.5),
    otherEmployerBurdenPct: String(body.otherEmployerBurdenPct ?? 0),
    notes: body.notes ?? null,
  }).returning();
  return res.status(201).json(toApiScenarioClinician(sc));
});

router.patch("/scenarios/:scenarioId/clinicians/:id", async (req, res) => {
  const id = Number(req.params.id);
  const scenarioId = Number(req.params.scenarioId);
  const body = req.body;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const numFields = ["sessionRate", "sessionsPerWeek", "weeksWorkedPerYear", "preCapClinicianSplit", "preCapPracticeSplit", "capAmount", "postCapClinicianSplit", "postCapPracticeSplit", "w2EmployerFicaPct", "futaSutaPct", "workersCompPct", "otherEmployerBurdenPct"];
  const strFields = ["label", "roleType", "classification", "notes"];
  const boolFields = ["capEnabled"];
  for (const f of numFields) {
    if (body[f] !== undefined) updates[f] = String(body[f]);
  }
  for (const f of strFields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  for (const f of boolFields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  const [sc] = await db.update(scenarioCliniciansTable).set(updates)
    .where(and(eq(scenarioCliniciansTable.id, id), eq(scenarioCliniciansTable.scenarioId, scenarioId)))
    .returning();
  if (!sc) return res.status(404).json({ error: "Not found" });
  return res.json(toApiScenarioClinician(sc));
});

router.delete("/scenarios/:scenarioId/clinicians/:id", async (req, res) => {
  const id = Number(req.params.id);
  const scenarioId = Number(req.params.scenarioId);
  const result = await db.delete(scenarioCliniciansTable)
    .where(and(eq(scenarioCliniciansTable.id, id), eq(scenarioCliniciansTable.scenarioId, scenarioId)))
    .returning();
  if (!result.length) return res.status(404).json({ error: "Not found" });
  return res.status(204).send();
});

router.post("/scenarios/:scenarioId/clinicians/:id/duplicate", async (req, res) => {
  const id = Number(req.params.id);
  const scenarioId = Number(req.params.scenarioId);
  const [original] = await db.select().from(scenarioCliniciansTable).where(eq(scenarioCliniciansTable.id, id));
  if (!original || original.scenarioId !== scenarioId) return res.status(404).json({ error: "Not found" });
  const { id: _id, createdAt: _c, updatedAt: _u, label, ...rest } = original;
  const [copy] = await db.insert(scenarioCliniciansTable).values({ ...rest, label: `${label} (Copy)` }).returning();
  return res.status(201).json(toApiScenarioClinician(copy));
});

export default router;
