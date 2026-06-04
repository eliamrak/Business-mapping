import { Router } from "express";
import { db } from "@workspace/db";
import { staffMembersTable, scenarioStaffMembersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const router = Router();

function toApiStaffMember(row: typeof staffMembersTable.$inferSelect) {
  return {
    id: row.id,
    goalId: row.goalId ?? null,
    label: row.label,
    roleType: row.roleType,
    classification: row.classification,
    annualSalary: row.annualSalary !== null ? Number(row.annualSalary) : null,
    hourlyRate: row.hourlyRate !== null ? Number(row.hourlyRate) : null,
    hoursPerWeek: row.hoursPerWeek !== null ? Number(row.hoursPerWeek) : null,
    weeksPerYear: Number(row.weeksPerYear),
    w2EmployerFicaPct: Number(row.w2EmployerFicaPct),
    futaSutaPct: Number(row.futaSutaPct),
    workersCompPct: Number(row.workersCompPct),
    otherEmployerBurdenPct: Number(row.otherEmployerBurdenPct),
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toApiScenarioStaffMember(row: typeof scenarioStaffMembersTable.$inferSelect) {
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    sourceStaffMemberId: row.sourceStaffMemberId ?? null,
    label: row.label,
    roleType: row.roleType,
    classification: row.classification,
    annualSalary: row.annualSalary !== null ? Number(row.annualSalary) : null,
    hourlyRate: row.hourlyRate !== null ? Number(row.hourlyRate) : null,
    hoursPerWeek: row.hoursPerWeek !== null ? Number(row.hoursPerWeek) : null,
    weeksPerYear: Number(row.weeksPerYear),
    w2EmployerFicaPct: Number(row.w2EmployerFicaPct),
    futaSutaPct: Number(row.futaSutaPct),
    workersCompPct: Number(row.workersCompPct),
    otherEmployerBurdenPct: Number(row.otherEmployerBurdenPct),
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function staffUpdatesFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const strFields = ["label", "roleType", "classification", "notes"];
  const numOrNullFields = ["annualSalary", "hourlyRate", "hoursPerWeek"];
  const numFields = ["weeksPerYear", "w2EmployerFicaPct", "futaSutaPct", "workersCompPct", "otherEmployerBurdenPct"];

  for (const f of strFields) {
    if (body[f] !== undefined) updates[f] = body[f];
  }
  for (const f of numOrNullFields) {
    if (body[f] !== undefined) updates[f] = body[f] === null ? null : String(body[f]);
  }
  for (const f of numFields) {
    if (body[f] !== undefined) updates[f] = String(body[f]);
  }
  return updates;
}

// ── Staff Members ───────────────────────────────────────────────────────────

router.get("/staff", async (req, res) => {
  const rawGoalId = req.query.goalId;
  const goalId = rawGoalId !== undefined ? Number(rawGoalId) : undefined;
  const members = goalId !== undefined && !isNaN(goalId)
    ? await db.select().from(staffMembersTable).where(eq(staffMembersTable.goalId, goalId)).orderBy(staffMembersTable.createdAt)
    : await db.select().from(staffMembersTable).orderBy(staffMembersTable.createdAt);
  res.json(members.map(toApiStaffMember));
});

router.post("/staff", async (req, res) => {
  const body = req.body;
  const [member] = await db.insert(staffMembersTable).values({
    goalId: body.goalId !== undefined ? Number(body.goalId) : null,
    label: body.label ?? "New Staff Member",
    roleType: body.roleType ?? "admin",
    classification: body.classification ?? "w2",
    annualSalary: body.annualSalary !== undefined && body.annualSalary !== null ? String(body.annualSalary) : null,
    hourlyRate: body.hourlyRate !== undefined && body.hourlyRate !== null ? String(body.hourlyRate) : null,
    hoursPerWeek: body.hoursPerWeek !== undefined && body.hoursPerWeek !== null ? String(body.hoursPerWeek) : null,
    weeksPerYear: String(body.weeksPerYear ?? 52),
    w2EmployerFicaPct: String(body.w2EmployerFicaPct ?? 7.65),
    futaSutaPct: String(body.futaSutaPct ?? 1.0),
    workersCompPct: String(body.workersCompPct ?? 0.5),
    otherEmployerBurdenPct: String(body.otherEmployerBurdenPct ?? 0),
    notes: body.notes ?? null,
  }).returning();
  res.status(201).json(toApiStaffMember(member));
});

router.get("/staff/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [member] = await db.select().from(staffMembersTable).where(eq(staffMembersTable.id, id));
  if (!member) return res.status(404).json({ error: "Not found" });
  return res.json(toApiStaffMember(member));
});

router.patch("/staff/:id", async (req, res) => {
  const id = Number(req.params.id);
  const updates = staffUpdatesFromBody(req.body);
  const [member] = await db.update(staffMembersTable).set(updates).where(eq(staffMembersTable.id, id)).returning();
  if (!member) return res.status(404).json({ error: "Not found" });
  return res.json(toApiStaffMember(member));
});

router.delete("/staff/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.delete(staffMembersTable).where(eq(staffMembersTable.id, id)).returning();
  if (!result.length) return res.status(404).json({ error: "Not found" });
  return res.status(204).send();
});

// ── Scenario Staff Members ──────────────────────────────────────────────────

router.get("/scenarios/:scenarioId/staff", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const members = await db.select().from(scenarioStaffMembersTable)
    .where(eq(scenarioStaffMembersTable.scenarioId, scenarioId))
    .orderBy(scenarioStaffMembersTable.createdAt);
  res.json(members.map(toApiScenarioStaffMember));
});

router.post("/scenarios/:scenarioId/staff", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const body = req.body;
  const [member] = await db.insert(scenarioStaffMembersTable).values({
    scenarioId,
    sourceStaffMemberId: body.sourceStaffMemberId ?? null,
    label: body.label ?? "New Staff Member",
    roleType: body.roleType ?? "admin",
    classification: body.classification ?? "w2",
    annualSalary: body.annualSalary !== undefined && body.annualSalary !== null ? String(body.annualSalary) : null,
    hourlyRate: body.hourlyRate !== undefined && body.hourlyRate !== null ? String(body.hourlyRate) : null,
    hoursPerWeek: body.hoursPerWeek !== undefined && body.hoursPerWeek !== null ? String(body.hoursPerWeek) : null,
    weeksPerYear: String(body.weeksPerYear ?? 52),
    w2EmployerFicaPct: String(body.w2EmployerFicaPct ?? 7.65),
    futaSutaPct: String(body.futaSutaPct ?? 1.0),
    workersCompPct: String(body.workersCompPct ?? 0.5),
    otherEmployerBurdenPct: String(body.otherEmployerBurdenPct ?? 0),
    notes: body.notes ?? null,
  }).returning();
  return res.status(201).json(toApiScenarioStaffMember(member));
});

router.patch("/scenarios/:scenarioId/staff/:id", async (req, res) => {
  const id = Number(req.params.id);
  const scenarioId = Number(req.params.scenarioId);
  const updates = staffUpdatesFromBody(req.body);
  const [member] = await db.update(scenarioStaffMembersTable).set(updates)
    .where(and(eq(scenarioStaffMembersTable.id, id), eq(scenarioStaffMembersTable.scenarioId, scenarioId)))
    .returning();
  if (!member) return res.status(404).json({ error: "Not found" });
  return res.json(toApiScenarioStaffMember(member));
});

router.delete("/scenarios/:scenarioId/staff/:id", async (req, res) => {
  const id = Number(req.params.id);
  const scenarioId = Number(req.params.scenarioId);
  const result = await db.delete(scenarioStaffMembersTable)
    .where(and(eq(scenarioStaffMembersTable.id, id), eq(scenarioStaffMembersTable.scenarioId, scenarioId)))
    .returning();
  if (!result.length) return res.status(404).json({ error: "Not found" });
  return res.status(204).send();
});

export { toApiScenarioStaffMember };
export default router;
