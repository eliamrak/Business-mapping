import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, forecast } from "@workspace/practice/hub";
import { managementReport } from "./management-report.ts";
test("management PDF renders selected sections without mutating business records", async () => {
  const workspace = emptyWorkspace("2026-01-01"),
    context = { clinicians: [], staff: [], sessions: [] };
  workspace.settings.horizonMonths = 2;
  const before = JSON.stringify(workspace);
  const document = await managementReport(
    workspace,
    context,
    forecast(workspace, context),
    { start: "2026-01-01", end: "2026-01-31" },
    ["categories", "forecast", "decisions"],
  );
  assert.equal(document.getNumberOfPages(), 3);
  assert.ok(document.output().startsWith("%PDF-"));
  assert.ok(document.output().includes("Active forecast"));
  assert.equal(JSON.stringify(workspace), before);
});
