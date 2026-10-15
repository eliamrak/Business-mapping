import { staffMemberAt, type Context, type Workspace } from "@workspace/practice/hub";
import { staffCompensationKnown } from "@workspace/practice/compensation";

/** Validate every selected service date, not just the latest dated pay terms. */
export function staffCostCoverageReasons(
  workspace: Workspace,
  context: Pick<Context, "staff">,
  ranges: readonly { start: string; end: string }[],
): string[] {
  const reasons: string[] = [];
  for (const member of context.staff.filter((row) => (row.goalId ?? null) === workspace.settings.teamId)) {
    let missingDate: string | undefined;
    for (const range of ranges) {
      for (let date = range.start; date <= range.end;) {
        if (!staffCompensationKnown(staffMemberAt(workspace, member, date))) {
          missingDate = date;
          break;
        }
        date = new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
      }
      if (missingDate) break;
    }
    if (missingDate)
      reasons.push(`${member.label ?? `Staff ${member.id ?? "member"}`}: pay or employer burden is unavailable on ${missingDate}; complete the dated staff pay setup before certifying financial feasibility.`);
  }
  return reasons;
}
