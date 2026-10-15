import { performance } from "node:perf_hooks";
import { practiceScaleFixture } from "./practice-scale-fixture.ts";
import { completeReportCoverage } from "../artifacts/comp-dashboard/src/lib/complete-report-coverage.ts";
import { buildImportedSessionOverlay } from "../artifacts/comp-dashboard/src/lib/import-derived-sessions.ts";
import { buildLocalRetentionMetrics, summarizeConsultConversions } from "../artifacts/comp-dashboard/src/lib/retention-local.ts";
import { practiceFinancialRange } from "../artifacts/comp-dashboard/src/lib/practice-financial-range.ts";

const fixture = practiceScaleFixture({ distinctClients: process.env.PRACTICE_SCALE_DISTINCT_CLIENTS === "1" });
const { context, workspace, snapshots, declarations, asOf } = fixture;
function time<T>(stage: string, run: () => T): T {
  const start = performance.now();
  const result = run();
  console.log(JSON.stringify({ syntheticOnly: true, stage, elapsedMs: Math.round(performance.now() - start), heapMb: Math.round(process.memoryUsage().heapUsed / 1048576) }));
  return result;
}
const roster = context.clinicians.filter((row) => row.goalId === 1);
const coverage = time("completeReportCoverage", () => completeReportCoverage(snapshots, roster, asOf, context.clinicians, { declarations, teamId: 1 }));
console.log(JSON.stringify({ stage: "admission", attendanceRows: snapshots.filter((row) => row.kind === "attendance").reduce((n, row) => n + row.rows.length, 0), billingRows: snapshots.filter((row) => row.kind === "billing").reduce((n, row) => n + row.rows.length, 0), derivedSnapshots: coverage.eligibleSnapshots.length, through: coverage.dataThrough }));
const overlay = time("buildImportedSessionOverlay", () => buildImportedSessionOverlay(context, coverage.eligibleSnapshots, 1, {}, { declarations }));
time("buildLocalRetentionMetrics", () => buildLocalRetentionMetrics(coverage.eligibleSnapshots, {}, {}, 28, asOf, 90, "2026-01-01", asOf));
time("summarizeConsultConversions", () => summarizeConsultConversions(coverage.eligibleSnapshots, {}, "2026-01-01", asOf, asOf));
time("practiceFinancialRange", () => practiceFinancialRange(workspace, overlay.context, snapshots, asOf, { start: "2026-01-01", end: "2026-12-31" }, coverage.completeAttendanceCoverage, declarations));
