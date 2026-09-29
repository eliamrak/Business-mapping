import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, type Context, type Workspace } from "@workspace/practice/hub";
import { estimatePracticeAttrition, inferMonthlyAttrition } from "./session-attrition.ts";

const samples = ["2026-05", "2026-06", "2026-07", "2026-08"].map((month) => ({
  month, sessions: 80, newClients: 4,
}));

test("implied attrition fits sessions and actual new client starts", () => {
  const result = inferMonthlyAttrition(samples, 4);
  assert.ok(result);
  assert.ok(Math.abs(result.attritionPct - 10) < 0.001);
  assert.equal(result.months, 4);
  assert.equal(result.through, "2026-08");
  assert.equal(inferMonthlyAttrition(samples, 0), null);
});

test("missing months and implausible retention do not invent an attrition rate", () => {
  assert.equal(inferMonthlyAttrition(samples.slice(1), 4), null);
  assert.equal(inferMonthlyAttrition([
    samples[0], samples[1], { ...samples[2], month: "2026-09" },
    { ...samples[3], month: "2026-10" },
  ], 4), null);
  assert.equal(inferMonthlyAttrition(samples.map((sample, index) => ({
    ...sample, sessions: 80 + index * 80, newClients: 0,
  })), 4), null);
});

test("practice inference requires complete monthly closes and session coverage", () => {
  const workspace = emptyWorkspace("2026-09-01");
  workspace.settings.teamId = 7;
  workspace.settings.sessionsPerClientMonth = 4;
  const clinician = {
    id: 1, goalId: 7, sessionsPerWeek: 20,
  } as Context["clinicians"][number];
  const context = { clinicians: [clinician], sessions: [], staff: [] } as Context;
  for (const [index, sample] of samples.entries()) {
    const [year, month] = sample.month.split("-").map(Number);
    const end = `${sample.month}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
    const periodId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    workspace.periods.push({
      id: periodId, start: `${sample.month}-01`, end,
      funnelComplete: true, archived: false,
    } as Workspace["periods"][number]);
    workspace.funnels.push({
      id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
      periodId, clients: sample.newClients,
    } as Workspace["funnels"][number]);
    context.sessions.push({
      clinicianId: 1, start: `${sample.month}-01`, end,
      completed: sample.sessions,
    } as Context["sessions"][number]);
  }
  assert.ok(Math.abs(estimatePracticeAttrition(context, workspace, 7, "2026-09-28")!.attritionPct - 10) < 0.001);
  assert.equal(estimatePracticeAttrition(context, workspace, 7, "2027-01-02"), null);
  context.sessions.pop();
  assert.equal(estimatePracticeAttrition(context, workspace, 7, "2026-09-28"), null);
  context.sessions.push({
    clinicianId: 1, start: "2026-08-01", end: "2026-08-31", completed: 80,
  } as Context["sessions"][number]);
  workspace.periods[0].funnelComplete = false;
  assert.equal(estimatePracticeAttrition(context, workspace, 7, "2026-09-28"), null);
});
