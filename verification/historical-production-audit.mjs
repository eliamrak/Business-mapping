import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertCandidateSource, auditOptions, readOnlyInput } from "./practice-readonly-audit.mjs";
export async function loadHistoricalAudit() {
  const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
  const { outputFiles } = await require("esbuild").build({ entryPoints: [fileURLToPath(new URL("./historical-production-audit-model.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64"));
}
async function main() {
  let pool, client;
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--ack-existing-db-read-only") throw Error();
    assertCandidateSource();
    const options = auditOptions({ ...process.env, AUDIT_CLINICIAN_LABEL: "aggregate-only" });
    if (!process.env.DATABASE_URL || !process.env.EMC_PRACTICE_ID) throw Error();
    const { historicalProductionAudit } = await loadHistoricalAudit();
    const { Pool } = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000,
      options: "-c default_transaction_read_only=on", application_name: "historical-readonly-aggregate-audit" });
    pool.on("error", () => {}); client = await pool.connect();
    const input = await readOnlyInput(client, options.scope); client.release(); client = null;
    process.stdout.write(JSON.stringify({ runtime: "046a8e7440474abbcd3b56aa29daa49f8cf8ea2b", readOnlyTransactionVerified: true, alwaysRolledBack: true,
      ...historicalProductionAudit(input, options) }, null, 2) + "\n");
  } catch {
    process.stderr.write('{"status":"historical_audit_failed_no_report","detailsWithheld":true}\n'); process.exitCode = 1;
  } finally { if (client) client.release(true); if (pool) await pool.end().catch(() => {}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
