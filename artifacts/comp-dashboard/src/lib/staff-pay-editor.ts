import { staffMemberAt, type Context, type Workspace } from "@workspace/practice/hub";

/** Resolve the same annual/default or dated scope that the editor will save. */
export function staffPayAtEditScope(
  workspace: Workspace,
  member: Context["staff"][number],
  options: { year: number; effectiveDate: string | null },
) {
  if (options.effectiveDate) return staffMemberAt(workspace, member, options.effectiveDate);
  const start = `${options.year}-01-01`;
  const end = `${options.year}-12-31`;
  const annual = {
    ...workspace,
    staffTerms: workspace.staffTerms.filter(term => term.staffMemberId !== member.id
      || term.effectiveDate < start
      || (term.effectiveDate === start && term.end === end)),
  };
  return staffMemberAt(annual, member, start);
}
