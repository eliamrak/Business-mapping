import type { Workspace, Condition, PlanEvent } from "./model.ts";

export function referencedClinicianIds(workspace: Workspace): Set<number> {
  const ids = new Set<number>();
  const add = (id: number | null) => {
    if (id !== null) ids.add(id);
  };
  const event = (value: PlanEvent) => {
    if (value.field.startsWith("clinician.")) add(Number(value.targetId));
  };
  const condition = (value: Condition): void => {
    if (value.type === "group") value.children.forEach(condition);
    else value.clinicianIds.forEach(add);
  };
  workspace.clinicians.forEach((c) => add(c.clinicianId));
  workspace.terms.forEach((c) => add(c.clinicianId));
  workspace.budgets.forEach((b) => add(b.clinicianId));
  workspace.hiring.forEach((h) => add(h.templateClinicianId));
  workspace.events.forEach(event);
  workspace.proposals.forEach((p) => p.changes.forEach(event));
  workspace.rules.forEach((r) => {
    condition(r.condition);
    if (r.event) event(r.event);
  });
  return ids;
}
