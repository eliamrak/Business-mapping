import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, workspaceSchema } from "../src/hub/index.ts";

test("performance targets are optional and never invent saved values", () => {
  const workspace = emptyWorkspace("2026-10-01");
  assert.equal(workspaceSchema.parse(workspace).settings.performanceTargets, undefined);
});

test("performance targets survive workspace save/reopen and allow explicit clearing", () => {
  const workspace = emptyWorkspace("2026-10-01");
  workspace.settings.performanceTargets = { retentionPct: 80, closeRatePct: 65, attritionPct: 5 };
  const reopened = workspaceSchema.parse(JSON.parse(JSON.stringify(workspaceSchema.parse(workspace))));
  assert.deepEqual(reopened.settings.performanceTargets, workspace.settings.performanceTargets);
  reopened.settings.performanceTargets.retentionPct = null;
  assert.equal(workspaceSchema.parse(reopened).settings.performanceTargets?.retentionPct, null);
  assert.deepEqual(workspace.goals, []);
});

test("performance target percentages reject unsupported input instead of clamping", () => {
  for (const value of [-1, 101, Infinity, NaN]) {
    const workspace = emptyWorkspace("2026-10-01");
    workspace.settings.performanceTargets = { closeRatePct: value };
    assert.equal(workspaceSchema.safeParse(workspace).success, false);
  }
});
