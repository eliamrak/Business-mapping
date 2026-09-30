import type { Workspace } from "./model.ts";

export function clinicianTermsAt(
  workspace: Workspace,
  clinicianId: number,
  date: string,
) {
  const terms = workspace.terms
    .filter((term) => term.clinicianId === clinicianId && term.effectiveDate <= date)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  return {
    sessionRate: terms.find((term) => term.sessionRate !== null)?.sessionRate ?? null,
    clinicianSplit: terms.find((term) => term.clinicianSplit !== null)?.clinicianSplit ?? null,
    capacity: terms.find((term) => term.capacity !== null)?.capacity ?? null,
    payMode: terms.find((term) => term.payMode !== null)?.payMode ?? null,
    payAmount: terms.find((term) => term.payAmount !== null)?.payAmount ?? null,
    paidHoursPerWeek:
      terms.find((term) => term.paidHoursPerWeek !== null)?.paidHoursPerWeek ?? null,
    expectedSessionRevenue:
      terms.find((term) => term.expectedSessionRevenue !== null)?.expectedSessionRevenue ?? null,
  };
}

export function clinicianModelAt(
  workspace: Workspace,
  clinicianId: number,
  date: string,
) {
  const profile = workspace.clinicians.find(
    (row) =>
      row.clinicianId === clinicianId &&
      row.status !== "archived" &&
      row.start <= date &&
      (!row.end || row.end >= date),
  );
  if (!profile) return null;
  const term = clinicianTermsAt(workspace, clinicianId, date);
  return {
    ...profile,
    payMode: term.payMode ?? profile.payMode,
    payAmount: term.payAmount ?? profile.payAmount,
    paidHoursPerWeek: term.paidHoursPerWeek ?? profile.paidHoursPerWeek,
    expectedSessionRevenue:
      term.expectedSessionRevenue ?? profile.expectedSessionRevenue,
  };
}
