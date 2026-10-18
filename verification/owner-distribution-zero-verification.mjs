import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repo = fileURLToPath(new URL("../", import.meta.url));
const base = "02591d43e90ab3514ea093514389a91aaf058094";
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const { build } = createRequire(path.join(repo, "artifacts/api-server/package.json"))("esbuild");
async function load(previous = false) {
  const bundled = await build({
    stdin: { contents: 'export * from "./lib/practice/src/hub/index.ts";export {financialEstimateDisplay} from "./artifacts/comp-dashboard/src/lib/financial-estimate-display.ts";export {practiceFinancialRange} from "./artifacts/comp-dashboard/src/lib/practice-financial-range.ts";', resolveDir: repo, loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
    // The only runtime source changed in this candidate is engine.ts.
    plugins: previous ? [{ name: "base-engine", setup(builder) {
      builder.onLoad({ filter: /\/hub\/engine\.ts$/ }, args => ({ contents: git("show", base + ":lib/practice/src/hub/engine.ts"), loader: "ts", resolveDir: path.dirname(args.path) }));
    } }] : [],
  });
  return import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
}
const previous = await load(true);
const candidate = await load();
function fixture(model, mode) {
  const workspace = model.emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { baselineMode: "manual", baselineWeeklySessions: 70 / 31, baselineRetentionPct: 100, defaultInPersonPct: 0, collectionPct: 100, collectionDelayMonths: 0, overheadFloorMonthly: 0, ownerPayrollMonthly: 0, horizonMonths: 1, taxPct: 0, reservePct: 0, distributionPct: mode === "positive-fallback" ? 25 : 0 });
  const context = { clinicians: [{ id: 1, label: "Synthetic", goalId: null, classification: "other", sessionRate: 100, sessionsPerWeek: 20, weeksWorkedPerYear: 52.1786, capEnabled: false, capAmount: 0, preCapClinicianSplit: 60, preCapPracticeSplit: 40, postCapClinicianSplit: 60, postCapPracticeSplit: 40, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 }], staff: [], sessions: [] };
  if (["reserve-only", "household-zero", "other-owner-zero", "positive-other-owner", "positive-household"].includes(mode)) workspace.allocations.push(model.allocationSchema.parse({ id: "00000000-0000-4000-8000-000000000001", name: "Synthetic allocation", kind: mode === "reserve-only" ? "reserve" : "distribution", household: mode === "household-zero" || mode === "positive-household", percent: mode === "reserve-only" ? 100 : mode.startsWith("positive-") ? 25 : 0, start: "2026-10-01" }));
  if (mode === "unknown-staff") context.staff.push({ id: 1, goalId: null, label: "Synthetic unknown staff", classification: "w2", annualSalary: null, hourlyRate: null, hoursPerWeek: null, weeksPerYear: 48, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 });
  const options = mode === "unknown-prior-receipts" ? { workingForecast: true, workingRange: { start: "2026-10-08", end: "2026-10-31" }, baselineWeeklyByClinician: { 1: 7 }, useImportedBillingActuals: false } : {};
  if (mode === "unknown-prior-receipts") workspace.settings.collectionDelayMonths = 1;
  return { workspace, context, month: model.forecast(workspace, context, [], 1, false, options)[0] };
}
const cases = ["zero-fallback", "reserve-only", "household-zero", "other-owner-zero", "positive-fallback", "positive-other-owner", "positive-household", "unknown-staff", "unknown-prior-receipts"];
const rows = [];
for (const mode of cases) {
  const before = fixture(previous, mode).month.values;
  const after = fixture(candidate, mode).month.values;
  const { ownerDistributionsPretax: beforeOwner, ...beforeOthers } = before;
  const { ownerDistributionsPretax: afterOwner, ...afterOthers } = after;
  assert.deepEqual(afterOthers, beforeOthers, mode + ": all other registered financial outputs unchanged");
  if (mode.startsWith("zero-") || mode.endsWith("-zero") || mode === "reserve-only") { assert.equal(after.distributions, 0); assert.equal(afterOwner, 0); }
  if (mode === "positive-household") { assert.ok(after.distributions > 0); assert.equal(afterOwner, after.distributions); }
  if (mode === "positive-fallback" || mode === "positive-other-owner") { assert.ok(after.distributions > 0); assert.equal(afterOwner, null); }
  if (mode.startsWith("unknown-")) { assert.equal(after.distributions, null); assert.equal(afterOwner, null); }
  rows.push({ mode, aggregate: after.distributions, ownerBefore: beforeOwner, ownerAfter: afterOwner, allOtherValuesUnchanged: true });
}
const { workspace, context, month } = fixture(candidate, "zero-fallback");
const missing = candidate.practiceFinancialRange(workspace, context, [], "2026-10-18", { start: "2026-10-01", end: "2026-10-31" });
assert.equal(missing.dataThrough, null);
assert.equal(candidate.financialEstimateDisplay(missing, null).values.ownerDistributionsPretax, null);
const historicRange = { start: "2026-10-01", end: "2026-10-07" };
const report = { actual: { range: historicRange }, forward: { range: { start: "2026-10-08", end: "2026-10-31" }, values: month.values }, values: month.values, forecastWarnings: [] };
// Synthetic segment values test composition, not real October source completeness.
for (const amount of [0, 50, null]) {
  const historic = { range: historicRange, values: { ownerDistributionsPretax: amount }, unavailableReasons: [] };
  assert.equal(candidate.financialEstimateDisplay(report, historic).values.ownerDistributionsPretax, amount);
}
assert.equal(candidate.financialEstimateDisplay(report, null).values.ownerDistributionsPretax, null);
const result = { candidate: git("rev-parse", "HEAD"), candidateTree: git("rev-parse", "HEAD^{tree}"), base, syntheticOnly: true, productionAccess: false, writes: 0, comparison: "base engine versus candidate engine; other runtime sources identical", rows, missingCoverageRemainsUnknown: true, mixedHistoryZeroPositiveUnknown: true };
if (process.env.PRACTICE_ZERO_OUTPUT) await fs.writeFile(process.env.PRACTICE_ZERO_OUTPUT, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
