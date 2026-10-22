import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import * as current from "../lib/practice/src/hub/index.ts";

const root = path.resolve(import.meta.dirname, "..");
const base = "46bffcf3dffd39733f62625a26896d65201533b8";
const out = fs.mkdtempSync(path.join(os.tmpdir(), "practice-quarterly-parity-"));
const frozen = path.join(out, "base");
fs.mkdirSync(frozen);
const archive = spawnSync("git", ["archive", base, "lib/practice"], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
assert.equal(archive.status, 0, archive.stderr.toString());
const extract = spawnSync("tar", ["-x", "-C", frozen], { input: archive.stdout });
assert.equal(extract.status, 0, extract.stderr.toString());
fs.symlinkSync(path.join(root, "lib/practice/node_modules"), path.join(frozen, "lib/practice/node_modules"));
const original = await import(pathToFileURL(path.join(frozen, "lib/practice/src/hub/index.ts")).href);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cadences = ["monthly", "weekly", "biweekly", "annual", "once", "per_session", "percent_revenue"];
const periods = [
  ["2024-02-01", "2024-02-29"], ["2025-12-31", "2026-01-01"],
  ["2026-01-01", "2026-01-31"], ["2026-01-15", "2026-03-31"],
  ["2026-03-31", "2026-04-01"], ["2026-01-01", "2026-12-31"],
  ["2027-01-01", "2027-01-01"],
];
let directComparisons = 0, rangeComparisons = 0, schemaComparisons = 0;
let forecastComparisons = 0, reportComparisons = 0, observedComparisons = 0;
for (const cadence of cadences) for (const amount of [0, 1, 1234.56]) {
  for (const dates of [
    { start: "2023-01-01", end: null },
    { start: "2026-01-16", end: "2026-04-15" },
    { start: "2027-01-01", end: null },
  ]) for (const reference of [null, "2025-01-31", "2027-12-31"]) {
    const input = { id: id(1), name: "Synthetic preserved budget", categoryId: id(2), cadence, amount, ...dates, billingReferenceStart: reference, billingDay: reference ? 31 : 5 };
    const oldBudget = original.budgetSchema.parse(input);
    const newBudget = current.budgetSchema.parse(input);
    assert.deepEqual(newBudget, oldBudget);
    schemaComparisons++;
    const before = JSON.stringify(newBudget);
    for (const [start, end] of periods) for (const archived of [false, true]) {
      const oldInput = { ...oldBudget, archived }, newInput = { ...newBudget, archived };
      assert.equal(current.budgetAmount(newInput, start, end, 17, 12345.67), original.budgetAmount(oldInput, start, end, 17, 12345.67), `${cadence} direct ${start}..${end}`);
      directComparisons++;
      assert.equal(current.budgetForRange(newInput, start, end, 17, 12345.67), original.budgetForRange(oldInput, start, end, 17, 12345.67), `${cadence} range ${start}..${end}`);
      rangeComparisons++;
    }
    assert.equal(JSON.stringify(newBudget), before);
  }
}
for (const cadence of cadences) for (const datedChange of [false, true]) {
  const workspace = original.emptyWorkspace("2026-01-01");
  Object.assign(workspace.settings, { horizonMonths: 12, baselineMode: "manual", baselineWeeklySessions: 20, defaultInPersonPct: 0 });
  workspace.categories.push(original.categorySchema.parse({ id: id(2), name: "Synthetic preserved expense", kind: "expense" }));
  workspace.budgets.push(original.budgetSchema.parse({ id: id(1), name: "Synthetic preserved budget", categoryId: id(2), cadence, amount: cadence === "percent_revenue" ? 5 : 1234.56, start: "2025-02-28", billingReferenceStart: "2025-01-31", billingDay: 31 }));
  if (datedChange) workspace.events.push(original.eventSchema.parse({ id: id(3), name: "Synthetic dated amount", date: "2026-01-16", end: "2026-03-15", field: "budget.amount", targetId: id(1), value: cadence === "percent_revenue" ? 7 : 1500 }));
  const context = { clinicians: [{ id: 1, label: "Synthetic preserved clinician", goalId: null, sessionRate: 120, sessionsPerWeek: 20, weeksWorkedPerYear: 52, capEnabled: false, capAmount: 50000, preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 75, postCapPracticeSplit: 25, classification: "1099", w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
  const newWorkspace = current.workspaceSchema.parse(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(newWorkspace, workspace);
  const before = JSON.stringify({ workspace: newWorkspace, context });
  const oldMonths = original.forecast(workspace, context);
  const newMonths = current.forecast(newWorkspace, context);
  assert.deepEqual(newMonths, oldMonths, `${cadence}: entire forecast differs`);
  forecastComparisons++;
  const range = { start: "2026-01-01", end: "2026-06-30" };
  assert.deepEqual(current.categoryReport(newWorkspace, newMonths, range), original.categoryReport(workspace, oldMonths, range));
  reportComparisons++;
  assert.deepEqual(current.observed(newWorkspace, context, range.start, range.end), original.observed(workspace, context, range.start, range.end));
  observedComparisons++;
  assert.equal(JSON.stringify({ workspace: newWorkspace, context }), before);
}
const result = { base, allExact: true, legacyCadences: cadences, schemaComparisons, directComparisons, rangeComparisons, forecastComparisons, reportComparisons, observedComparisons, preservedInputs: true, syntheticOnly: true, productionReads: false, productionWrites: false };
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ out, ...result }, null, 2));
