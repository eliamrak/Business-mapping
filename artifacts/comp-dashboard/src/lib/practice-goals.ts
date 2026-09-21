import { z } from "zod/v4";
import {
  workspaceSchema,
  proposalSchema,
  type Workspace,
  type Context,
  type Proposal,
} from "@workspace/practice/hub";
import { sessionInputSchema } from "@workspace/practice";

// Snapshots contain calculation inputs, never presenter tokens or account metadata.
const nonnegative = z.number().finite().min(0);
const clinicianSchema = z.object({
  id: z.number().int().positive(),
  label: z.string(),
  goalId: z.number().int().positive().nullable().optional(),
  sessionRate: nonnegative,
  sessionsPerWeek: nonnegative,
  weeksWorkedPerYear: nonnegative,
  classification: z.union([z.string(), z.number()]),
  capEnabled: z.boolean(),
  capAmount: nonnegative,
  preCapClinicianSplit: nonnegative,
  preCapPracticeSplit: nonnegative,
  postCapClinicianSplit: nonnegative,
  postCapPracticeSplit: nonnegative,
  w2EmployerFicaPct: nonnegative,
  futaSutaPct: nonnegative,
  workersCompPct: nonnegative,
  otherEmployerBurdenPct: nonnegative,
  nonClinicalHoursPerWeek: nonnegative.optional(),
  nonClinicalHourlyRate: nonnegative.optional(),
});
const contextSchema = z.object({
  clinicians: z.array(clinicianSchema),
  staff: z.array(
    z.object({
      goalId: z.number().int().positive().nullable().optional(),
      annualSalary: nonnegative.nullable().optional(),
      hourlyRate: nonnegative.nullable().optional(),
      hoursPerWeek: nonnegative.nullable().optional(),
      weeksPerYear: nonnegative,
      classification: z.string(),
      w2EmployerFicaPct: nonnegative,
      futaSutaPct: nonnegative,
      workersCompPct: nonnegative,
      otherEmployerBurdenPct: nonnegative,
    }),
  ),
  sessions: z.array(
    z.object({
      ...sessionInputSchema.shape,
      id: z.number().int().positive(),
      revision: z.number().int().positive(),
      updatedAt: z.string(),
    }),
  ),
});
const snapshotSchema = z.object({
  kind: z.literal("practice-goal-v1"),
  savedAt: z.string().datetime(),
  sourceRevision: z.number().int().min(0),
  workspace: workspaceSchema,
  context: contextSchema,
});
export type PracticeCopy = { workspace: Workspace; context: Context };
export function copyPractice(
  workspace: Workspace,
  context: Context,
): PracticeCopy {
  // Do not recursively nest every previously saved goal in the next goal.
  return structuredClone({
    workspace: { ...workspace, proposals: [] },
    context,
  });
}
export function makePracticeGoal(
  name: string,
  copy: PracticeCopy,
  sourceRevision: number,
): Proposal {
  const parsedContext = contextSchema.parse(copy.context);
  const baseline = snapshotSchema.parse({
    kind: "practice-goal-v1",
    savedAt: new Date().toISOString(),
    sourceRevision,
    workspace: { ...copy.workspace, proposals: [] },
    context: parsedContext,
  });
  return proposalSchema.parse({
    id: crypto.randomUUID(),
    name: name.trim(),
    baseline,
    changes: [],
    status: "draft",
  });
}
export function readPracticeGoal(
  goal: Proposal,
): (PracticeCopy & { savedAt: string; sourceRevision: number }) | null {
  const result = snapshotSchema.safeParse(goal.baseline);
  if (!result.success) return null;
  const { workspace, context, savedAt, sourceRevision } = result.data;
  return structuredClone({
    workspace,
    context: context as Context,
    savedAt,
    sourceRevision,
  });
}
export function practiceChanges(
  base: PracticeCopy,
  draft: PracticeCopy,
): { label: string; before: unknown; after: unknown }[] {
  const changes: { label: string; before: unknown; after: unknown }[] = [];
  const labels: Record<string, string> = {
    sessionRate: "session fee",
    sessionsPerWeek: "sessions / week",
    preCapClinicianSplit: "clinician share",
    monthlySpend: "monthly ad spend",
    amount: "budget",
    weeklyHours: "weekly hours",
    horizonMonths: "forecast months",
    forecastStart: "forecast start",
  };
  const compare = (
    name: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) => {
    for (const key of Object.keys(after)) {
      if (
        [
          "id",
          "updatedAt",
          "createdAt",
          "shareToken",
          "sourceAttachmentId",
        ].includes(key)
      )
        continue;
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        changes.push({
          label: `${name}: ${labels[key] ?? key.replace(/([A-Z])/g, " $1").toLowerCase()}`,
          before: before[key],
          after: after[key],
        });
    }
  };
  compare("Practice", base.workspace.settings, draft.workspace.settings);
  for (const key of Object.keys(draft.workspace) as (keyof Workspace)[]) {
    if (key === "settings" || key === "proposals") continue;
    for (const record of draft.workspace[key]) {
      const old = base.workspace[key].find((r) => r.id === record.id);
      const name = "name" in record ? String(record.name) : key;
      if (!old)
        changes.push({ label: `Added ${name}`, before: null, after: "New" });
      else compare(name, old, record);
    }
  }
  for (const person of draft.context.clinicians) {
    const old = base.context.clinicians.find((c) => c.id === person.id);
    if (old) compare(person.label, { ...old }, { ...person });
  }
  return changes;
}
