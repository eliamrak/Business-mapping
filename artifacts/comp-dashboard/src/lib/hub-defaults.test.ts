import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, periodSchema } from "@workspace/practice/hub";
import { newRecord } from "../components/hub/config.ts";

test("new financial records do not invent optional clinician or campaign links", () => {
  const workspace = emptyWorkspace("2026-09-01");
  const budget = newRecord("budgets", workspace, "2026-09-01");
  assert.equal(budget.clinicianId, null);
  assert.equal(budget.campaignId, null);
  assert.equal(
    newRecord("transactions", workspace, "2026-09-01").campaignId,
    null,
  );
});
test("new entries select an open reporting period rather than a finalized one", () => {
  const workspace = emptyWorkspace("2026-09-01");
  workspace.periods = [
    periodSchema.parse({
      id: crypto.randomUUID(),
      name: "Final",
      start: "2026-09-01",
      end: "2026-09-14",
      status: "finalized",
    }),
    periodSchema.parse({
      id: crypto.randomUUID(),
      name: "Draft",
      start: "2026-09-15",
      end: "2026-09-28",
    }),
  ];
  assert.equal(
    newRecord("transactions", workspace, "2026-09-15").periodId,
    workspace.periods[1].id,
  );
});
