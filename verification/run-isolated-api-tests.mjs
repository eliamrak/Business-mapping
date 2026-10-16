import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { syntheticClerkFixture } from "../artifacts/api-server/test/synthetic-clerk.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const clerk = syntheticClerkFixture();
const dir = mkdtempSync(path.join(tmpdir(), "practice-isolated-api-"));
const results = { isolation: "fresh loopback-only cluster; synthetic fixtures; no inherited credentials", suites: [] };
const env = {
  PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: userInfo().homedir,
  LC_ALL: "C",
  TMPDIR: dir,
  NODE_ENV: "development",
  SEED_DEMO_DATA: "false",
  EMC_OWNER_EMAIL: "owner@example.test",
  EMC_PRACTICE_ID: "isolated-service-test",
  ...clerk.env,
};
let started = false;
let child;
const processGroups = new Set();
function terminateGroup(pid) {
  try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  processGroups.delete(pid);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 180000, killSignal: "SIGKILL", detached: true, maxBuffer: 25 * 1024 * 1024 });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${output.slice(-6000)}`);
  }
  return result;
}
async function runSuite(command, args, extraEnv, name) {
  let output = "", failure;
  const suite = spawn(command, args, { cwd: root, env: { ...env, ...extraEnv }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  if (suite.pid) processGroups.add(suite.pid);
  const capture = data => {
    output += data;
    if (output.length > 25 * 1024 * 1024) { failure = "Output limit exceeded"; terminateGroup(suite.pid); }
  };
  suite.stdout.on("data", capture); suite.stderr.on("data", capture);
  const timer = setTimeout(() => { failure = "Suite timeout"; terminateGroup(suite.pid); }, 180000);
  const exitCode = await new Promise(resolve => {
    suite.once("error", error => { failure = error.message; resolve(null); });
    suite.once("close", resolve);
  });
  clearTimeout(timer);
  if (suite.pid) terminateGroup(suite.pid);
  writeFileSync(path.join(dir, `${name}.log`), output);
  results.suites.push({ name, exitCode, error: failure, summary: output.split("\n").filter(line => /^# (tests|pass|fail|cancelled|skipped|duration)/.test(line)) });
  console.log(name, exitCode, results.suites.at(-1).summary.join("; "));
}
async function stopApi() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  await new Promise(resolve => {
    current.once("exit", resolve);
    current.kill("SIGTERM");
    const timer = setTimeout(() => current.kill("SIGKILL"), 3000);
    timer.unref();
  });
  child = undefined;
}
let cleanupPromise;
function cleanup() {
  return cleanupPromise ??= (async () => {
  await stopApi();
  for (const pid of processGroups) terminateGroup(pid);
  if (started) {
    const stopped = run("pg_ctl", ["-D", path.join(dir, "data"), "-m", "immediate", "-w", "stop"]);
    results.clusterStopped = stopped.status === 0;
    started = false;
    if (results.clusterStopped) { rmSync(path.join(dir, "data"), { recursive: true, force: true }); results.syntheticDatabaseDeleted = true; }
  }
  writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 2));
  })();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  results.interrupted = signal;
  try { await cleanup(); } finally { process.exit(130); }
});
async function startApi(file, databaseUrl, extraEnv = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let log = "";
  child = spawn(process.execPath, [file], { cwd: root, env: { ...env, DATABASE_URL: databaseUrl, HOST: "127.0.0.1", PORT: String(port), APP_ORIGIN: base, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${base}/api/healthz`)).ok) return base; } catch {}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Isolated API did not start: ${log}`);
}
try {
  results.candidate = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const port = await freePort();
  const data = path.join(dir, "data");
  run("initdb", ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"]);
  run("pg_ctl", ["-D", data, "-l", path.join(dir, "postgres.log"), "-o", `-h 127.0.0.1 -k ${dir} -p ${port}`, "-w", "start"]);
  started = true;
  const url = `postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:${port}/isolated_schema`;
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  run("psql", [adminUrl.href, "-v", "ON_ERROR_STOP=1", "-c", "CREATE DATABASE isolated_schema"]);
  run("corepack", ["pnpm", "--filter", "@workspace/db", "push"], { DATABASE_URL: url });
  run("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", path.join(root, "verification/paired-repair-preservation.sql")]);
  results.preservationSql = "parsed-and-executed-on-empty-synthetic-schema";
  run("corepack", ["pnpm", "--filter", "@workspace/api-server", "build"]);
  await runSuite(process.execPath, ["--test", "--test-reporter=tap", "artifacts/api-server/test/hub.integration.test.mjs"], { EMC_TEST_DATABASE_URL: url }, "hub-clerk-auth");
  await runSuite(process.execPath, ["--test", "--test-reporter=tap", "artifacts/api-server/test/practice-imports.integration.test.mjs"], { EMC_TEST_DATABASE_URL: url }, "practice-imports-original");
  await runSuite(process.execPath, ["--test", "--test-reporter=tap", "artifacts/api-server/test/session-goals.persistence.test.mjs"], { DATABASE_URL: url }, "session-goals-original");
  const base = await startApi("artifacts/api-server/dist/index.mjs", url);
  await runSuite(process.execPath, ["--test", "--test-reporter=tap", "artifacts/api-server/test/sessions.integration.test.mjs"], { EMC_TEST_API_URL: `${base}/api`, EMC_TEST_SESSION_TOKEN: clerk.token("owner@example.test") }, "sessions-clerk-auth");
} catch (error) {
  results.setupError = error.stack;
  console.error(error);
} finally {
  await cleanup();
  console.log(`Evidence: ${dir}`);
}
process.exitCode = results.setupError || results.suites.some(item => item.exitCode !== 0) ? 1 : 0;
