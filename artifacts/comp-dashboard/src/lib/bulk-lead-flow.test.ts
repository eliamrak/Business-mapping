import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, funnelSchema, periodSchema, workspaceSchema } from "@workspace/practice/hub";
import { applyBulkLeads, leadMonthState, planBulkLeads } from "./bulk-lead-flow.ts";

test("bulk lead save creates months, preserves other data, and edits existing totals", () => {
  const workspace = emptyWorkspace("2026-01-01");
  const changes = [
    { month: "2026-01", leads: 32, attended: 16, clients: 12 },
    { month: "2026-02", leads: 0, attended: 0, clients: 0 },
  ];
  const saved = applyBulkLeads(workspace, changes);
  assert.equal(saved.periods.length, 2);
  assert.equal(saved.funnels.length, 2);
  assert.ok(saved.periods.every((period) => period.funnelComplete));
  const edited = applyBulkLeads(saved, [{ month: "2026-01", leads: 34, attended: 16, clients: 12 }]);
  assert.equal(workspaceSchema.safeParse(edited).success, true);
  assert.equal(edited.funnels.length, 2);
  assert.equal(leadMonthState(edited, "2026-01").practice?.leads, 34);
  assert.equal(leadMonthState(edited, "2026-02").practice?.leads, 0);
});

test("bulk lead plan keeps missing counts unknown and protects detailed and finalized months", () => {
  const workspace = emptyWorkspace("2026-01-01");
  const period = periodSchema.parse({
    id: crypto.randomUUID(), name: "March", start: "2026-03-01", end: "2026-03-31",
  });
  workspace.periods.push(period);
  workspace.funnels.push(funnelSchema.parse({
    id: crypto.randomUUID(), periodId: period.id, scope: "source", sourceName: "Referrals",
    campaignId: null, clinicianId: null, spend: null, scheduled: null,
    firstSessions: null, leads: 10, attended: 5, clients: 4,
  }));
  const partial = planBulkLeads(workspace, { "2026-01:leads": "12", "2026-01:clients": "5" });
  assert.deepEqual(partial.changes, [{ month: "2026-01", leads: 12, attended: null, clients: 5 }]);
  const partialSaved = applyBulkLeads(workspace, partial.changes);
  assert.equal(workspaceSchema.safeParse(partialSaved).success, true);
  assert.equal(partialSaved.periods[1].funnelComplete, false);
  assert.equal(leadMonthState(partialSaved, "2026-01").practice?.attended, null);
  const detailed = planBulkLeads(workspace, {
    "2026-03:leads": "12", "2026-03:attended": "6", "2026-03:clients": "4",
  });
  assert.equal(detailed.changes.length, 0);
  assert.match(detailed.issues[0].message, /Source or clinician detail/);
  workspace.periods[0].status = "finalized";
  assert.match(leadMonthState(workspace, "2026-03").locked, /Finalized/);
});
