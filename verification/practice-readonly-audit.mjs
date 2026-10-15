import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CANDIDATE = "e6856dfa99af13c2a8797116425836ca5492175e";
const TREE = "de4633d189dda618b9c492c90b575477dbed913d";
const root = fileURLToPath(new URL("../", import.meta.url));
export function assertCandidateSource() {
  const options = { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  if (execFileSync("git", ["rev-parse", `${CANDIDATE}^{tree}`], options).trim() !== TREE) throw new Error("candidate_source_mismatch");
  const calculationPaths = ["lib/practice/src", "artifacts/comp-dashboard/src/lib", "artifacts/comp-dashboard/src/pages/practice-workspace.tsx"];
  execFileSync("git", ["diff", "--quiet", CANDIDATE, "--", ...calculationPaths], options);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", ...calculationPaths], options).trim();
  if (untracked) throw new Error("unreviewed_candidate_source");
}
const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
export function auditOptions(env) {
  const { AUDIT_AS_OF: asOf, AUDIT_WINDOW_START: start, AUDIT_WINDOW_END: end } = env;
  if (![asOf, start, end].every(date) || start > end || end > asOf || +asOf.slice(0, 4) < 2000 || +asOf.slice(0, 4) > 2200 || Date.parse(end) - Date.parse(start) > 3660 * 86400000) throw new Error("invalid_explicit_audit_dates");
  const targetLabel = env.AUDIT_CLINICIAN_LABEL?.trim();
  if (!targetLabel) throw new Error("explicit_clinician_label_required");
  const scope = (env.EMC_PRACTICE_ID?.trim() || env.EMC_OWNER_EMAIL?.trim() || "default-practice").toLowerCase();
  return { asOf, start, end, targetLabel, scope };
}

const SELECTS = {
  workspace: "SELECT data FROM hub_workspaces WHERE id = 1",
  clinicians: `SELECT id, goal_id AS "goalId", label, role_type AS "roleType", classification,
    session_rate AS "sessionRate", sessions_per_week AS "sessionsPerWeek", weeks_worked_per_year AS "weeksWorkedPerYear",
    pre_cap_clinician_split AS "preCapClinicianSplit", pre_cap_practice_split AS "preCapPracticeSplit", cap_enabled AS "capEnabled", cap_amount AS "capAmount",
    post_cap_clinician_split AS "postCapClinicianSplit", post_cap_practice_split AS "postCapPracticeSplit", w2_employer_fica_pct AS "w2EmployerFicaPct",
    futa_suta_pct AS "futaSutaPct", workers_comp_pct AS "workersCompPct", other_employer_burden_pct AS "otherEmployerBurdenPct",
    non_clinical_hours_per_week AS "nonClinicalHoursPerWeek", non_clinical_hourly_rate AS "nonClinicalHourlyRate" FROM clinicians ORDER BY id LIMIT 10001`,
  staff: `SELECT id, goal_id AS "goalId", label, role_type AS "roleType", classification, annual_salary AS "annualSalary", hourly_rate AS "hourlyRate",
    hours_per_week AS "hoursPerWeek", weeks_per_year AS "weeksPerYear", w2_employer_fica_pct AS "w2EmployerFicaPct", futa_suta_pct AS "futaSutaPct",
    workers_comp_pct AS "workersCompPct", other_employer_burden_pct AS "otherEmployerBurdenPct" FROM staff_members ORDER BY id LIMIT 10001`,
  sessions: `SELECT id, clinician_id AS "clinicianId", period_start::text AS start, period_end::text AS end, completed, desired,
    cancelled, no_show AS "noShow", scheduled, in_person AS "inPerson", telehealth, source_attachment_id AS "sourceAttachmentId", revision,
    updated_at AS "updatedAt" FROM session_records ORDER BY id LIMIT 200001`,
  goals: `SELECT id, owner_pay_goal AS "ownerPayGoal", second_owner_pay_goal AS "secondOwnerPayGoal", annual_overhead_goal AS "annualOverheadGoal",
    business_profit_goal AS "businessProfitGoal", building_fund_goal AS "buildingFundGoal", emergency_reserve_goal AS "emergencyReserveGoal",
    growth_fund_goal AS "growthFundGoal", desired_clinicians_count AS "desiredCliniciansCount" FROM business_goals ORDER BY created_at, id LIMIT 10001`,
  size: `SELECT count(*)::integer AS snapshots, COALESCE(sum(jsonb_array_length(rows)), 0)::text AS facts
    FROM practice_import_snapshots WHERE practice_id = $1 AND account_id = $2 AND active = 1`,
  snapshots: `SELECT kind, coverage_start::text AS "coverageStart", coverage_end::text AS "coverageEnd", to_jsonb(s) -> 'report_coverage' AS "reportCoverage",
    source_hash AS "sourceHash", rows, created_at AS "createdAt" FROM practice_import_snapshots s
    WHERE practice_id = $1 AND account_id = $2 AND active = 1 ORDER BY created_at, id`,
  packages: `SELECT same_day_visit_overrides AS "overrides" FROM practice_import_packages
    WHERE practice_id = $1 AND account_id = $2 AND active = 1 ORDER BY imported_at, id LIMIT 10001`,
};
const numeric = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" && !["label", "roleType", "classification", "start", "end", "sourceAttachmentId"].includes(key) && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value]));
function reconcileOverrides(packages, snapshots) {
  const stored = {};
  for (const item of packages) for (const [key, value] of Object.entries(item.overrides ?? {})) {
    if (!Number.isInteger(value) || value < 1 || value > 20) throw new Error("invalid_stored_override");
    if (Object.hasOwn(stored, key) && stored[key] !== value) throw new Error("conflicting_package_overrides_require_API_order_review");
    stored[key] = value;
  }
  // Match the existing API's SHA-256 key and per-snapshot source-hash dedup exactly.
  const counts = new Map();
  for (const snapshot of snapshots) if (snapshot.kind === "attendance") {
    const seen = new Set();
    for (const row of snapshot.rows) {
      if (row.status !== "show" || seen.has(row.sourceRowHash)) continue;
      seen.add(row.sourceRowHash);
      const key = createHash("sha256").update(JSON.stringify(["same-day-visit", row.clientId, row.clinician.toLowerCase().replace(/\s+/g, " ").trim(), row.serviceDate])).digest("hex").slice(0, 16);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const effective = Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, Math.min(value, counts.get(key) ?? 0)]).filter(([, value]) => value > 1));
  return { effective, storedCount: Object.keys(stored).length };
}

/** The only DB entry point. It never commits, even after a successful read. */
export async function readOnlyInput(client, scope) {
  let began = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); began = true;
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
    const mode = (await client.query("SELECT current_setting('transaction_read_only') AS mode")).rows[0]?.mode;
    if (mode !== "on") throw new Error("database_read_only_not_confirmed");
    const size = (await client.query(SELECTS.size, [scope, scope])).rows[0];
    if (!size || Number(size.snapshots) > 5000 || Number(size.facts) > 1000000) throw new Error("audit_memory_safety_limit_no_truncation");
    const results = {};
    for (const key of ["workspace", "clinicians", "staff", "sessions", "goals", "snapshots", "packages"])
      results[key] = (await client.query(SELECTS[key], ["snapshots", "packages"].includes(key) ? [scope, scope] : undefined)).rows;
    for (const key of ["clinicians", "staff", "goals", "packages"]) if (results[key].length > 10000) throw new Error("audit_memory_safety_limit_no_truncation");
    if (results.sessions.length > 200000 || results.workspace.length !== 1) throw new Error("missing_workspace_or_audit_limit");
    const snapshots = results.snapshots.map((row) => ({ id: `${row.kind}-${row.sourceHash}`, kind: row.kind,
      importedAt: new Date(row.createdAt).toISOString(), coverageStart: row.coverageStart, coverageEnd: row.coverageEnd,
      reportCoverage: row.reportCoverage ?? null, sourceHash: row.sourceHash, rows: row.rows }));
    const overrides = reconcileOverrides(results.packages, snapshots);
    const declarationTable = (await client.query("SELECT to_regclass('practice_import_declarations') IS NOT NULL AS available")).rows[0]?.available === true;
    const declarations = declarationTable ? (await client.query("SELECT data FROM practice_import_declarations WHERE practice_id = $1 AND account_id = $2", [scope, scope])).rows[0]?.data ?? null : null;
    return { workspace: results.workspace[0].data, context: { clinicians: results.clinicians.map(numeric), staff: results.staff.map(numeric), sessions: results.sessions.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString() })) },
      goals: results.goals.map(numeric), snapshots, declarations, overrides: overrides.effective, storedOverrideCount: overrides.storedCount };
  } finally {
    if (began) await client.query("ROLLBACK");
  }
}

export async function loadAuditModel() {
  const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
  const { outputFiles } = await require("esbuild").build({ entryPoints: [fileURLToPath(new URL("./practice-readonly-audit-model.ts", import.meta.url))],
    bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64"));
}
const safeReasons = new Set(["explicit_ack_required", "invalid_explicit_audit_dates", "candidate_source_mismatch", "unreviewed_candidate_source",
  "existing_database_url_required", "database_read_only_not_confirmed", "audit_memory_safety_limit_no_truncation", "missing_workspace_or_audit_limit",
  "invalid_stored_override", "conflicting_package_overrides_require_API_order_review", "unsupported_snapshot_kind"]);
async function main() {
  let phase = "preflight", pool, client;
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--ack-existing-db-read-only") throw new Error("explicit_ack_required");
    const options = auditOptions(process.env);
    assertCandidateSource();
    const { aggregateAudit } = await loadAuditModel();
    if (!process.env.DATABASE_URL) throw new Error("existing_database_url_required");
    phase = "read_only_database_snapshot";
    const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000,
      options: "-c default_transaction_read_only=on", application_name: "practice-readonly-aggregate-audit" });
    pool.on("error", () => {});
    client = await pool.connect();
    const input = await readOnlyInput(client, options.scope);
    client.release(); client = null;
    phase = "candidate_aggregate_calculation";
    const aggregate = aggregateAudit(input, options);
    const report = { candidate: CANDIDATE, candidateTree: TREE, readOnlyTransactionVerified: true, alwaysRolledBack: true,
      storedOverrideCount: input.storedOverrideCount, effectiveOverrideCount: Object.keys(input.overrides).length, ...aggregate };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) {
    // Never print database errors, source validation errors, stack traces, URLs or input values.
    const reason = safeReasons.has(error?.message) ? error.message : error?.code === "42P01" || error?.code === "42703" ? "required_schema_unavailable"
      : error?.code === "42501" ? "database_read_permission_unavailable" : "details_withheld_to_protect_source_data";
    process.stderr.write(JSON.stringify({ status: "audit_failed_no_report", phase, reason, patientDataPrinted: false }) + "\n");
    process.exitCode = 1;
  } finally {
    if (client) client.release(true);
    if (pool) await pool.end().catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
