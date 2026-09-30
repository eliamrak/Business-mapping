import { funnelSchema, periodSchema, type Workspace } from "@workspace/practice/hub";

export type LeadCountKey = "leads" | "scheduled" | "attended" | "clients";
export type LeadBulkChange = {
  month: string;
  leads: number | null;
  scheduled: number | null;
  attended: number | null;
  clients: number | null;
};
export type LeadBulkIssue = { month: string; message: string };

export const leadMonth = (year: number, index: number) => `${year}-${String(index + 1).padStart(2, "0")}`;
export const leadMonthBounds = (month: string) => ({
  start: `${month}-01`,
  end: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10),
});
export const leadCellKey = (month: string, field: LeadCountKey) => `${month}:${field}`;

export function leadMonthState(workspace: Workspace, month: string) {
  const { start, end } = leadMonthBounds(month);
  const periods = workspace.periods.filter((period) => !period.archived);
  const period = periods.find((item) => item.start === start && item.end === end);
  const rows = workspace.funnels.filter((row) => row.periodId === period?.id);
  return {
    period,
    practice: rows.find((row) => row.scope === "practice"),
    locked: !period && periods.some((item) => item.start <= end && start <= item.end)
      ? "Overlapping reporting dates"
      : period?.status === "finalized" ? "Finalized month"
      : rows.some((row) => row.scope === "source") ? "Source or clinician detail"
      : "",
  };
}

export function planBulkLeads(workspace: Workspace, overrides: Record<string, string>) {
  const changes: LeadBulkChange[] = [];
  const issues: LeadBulkIssue[] = [];
  const months = [...new Set(Object.keys(overrides).map((key) => key.slice(0, 7)))].sort();
  for (const month of months) {
    const state = leadMonthState(workspace, month);
    if (state.locked) {
      issues.push({ month, message: `${month}: ${state.locked}. Open month details to edit it.` });
      continue;
    }
    const fields = {} as Record<LeadCountKey, number | null>;
    let invalid = false;
    for (const field of ["leads", "scheduled", "attended", "clients"] as const) {
      const raw = overrides[leadCellKey(month, field)] ?? String(state.practice?.[field] ?? "");
      if (raw.trim() !== "" && (!/^\d+$/.test(raw.trim()) || Number(raw) > 10_000_000)) {
        issues.push({ month, message: `${month}: enter a whole number from 0 to 10,000,000, or leave a missing count blank.` });
        invalid = true;
        break;
      }
      fields[field] = raw.trim() === "" ? null : Number(raw);
    }
    if (!invalid) changes.push({ month, ...fields });
  }
  return { changes, issues };
}

export function applyBulkLeads(workspace: Workspace, changes: LeadBulkChange[]): Workspace {
  let periods = [...workspace.periods];
  let funnels = [...workspace.funnels];
  for (const change of changes) {
    const { start, end } = leadMonthBounds(change.month);
    let period = periods.find((item) => !item.archived && item.start === start && item.end === end);
    if (!period) {
      period = periodSchema.parse({
        id: crypto.randomUUID(),
        name: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
          .format(new Date(`${start}T12:00:00Z`)),
        start, end,
      });
      periods.push(period);
    }
    const complete = change.leads !== null && change.scheduled !== null && change.attended !== null && change.clients !== null;
    periods = periods.map((item) => item.id === period!.id ? { ...item, funnelComplete: complete } : item);
    const practice = funnels.find((row) => row.periodId === period!.id && row.scope === "practice");
    if (practice) {
      funnels = funnels.map((row) => row.id === practice.id ? {
        ...row, leads: change.leads, scheduled: change.scheduled, attended: change.attended, clients: change.clients,
      } : row);
    } else {
      funnels.push(funnelSchema.parse({
        id: crypto.randomUUID(), periodId: period.id, scope: "practice",
        campaignId: null, sourceName: "", clinicianId: null,
        spend: null, scheduled: change.scheduled, firstSessions: null,
        leads: change.leads, attended: change.attended, clients: change.clients,
      }));
    }
  }
  return { ...workspace, periods, funnels };
}
