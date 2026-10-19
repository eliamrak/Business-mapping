// Run only after review, in an isolated native PostgreSQL environment:
// PRACTICE_NATIVE_POSTGRES_BIN=/absolute/bin node verification/native-abrupt-recovery.mjs
// No existing database URL, output directory, browser, or completed suite is used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { spawn, fork, execFileSync } from "node:child_process";
import { syntheticClerkFixture } from "../artifacts/api-server/test/synthetic-clerk.mjs";
import { createNativePostgresFixture, nativeTestEnvironment, nativeTestPort } from "./native-postgres-fixture.mjs";
import { isolatedDatabaseBundle, assertIsolatedDatabaseBundle } from "./isolated-database-bundle.mjs";

const filename = fileURLToPath(import.meta.url);
const repo = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const warning = "This bounded synthetic test stops idle processes after acknowledged commits. It is not exhaustive in-flight transaction, crash, power-loss, concurrency, or load certification.";

export function recoveryWorkspacePlugins(checkout) {
  const entries = {
    "@workspace/practice": "lib/practice/src/index.ts",
    "@workspace/practice/hub": "lib/practice/src/hub/index.ts",
    "@workspace/practice/compensation": "lib/practice/src/compensation.ts",
    "@workspace/api-zod": "lib/api-zod/src/index.ts",
  };
  return [isolatedDatabaseBundle(checkout), {
    name: "recovery-reviewed-workspace",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/(?:practice|api-zod)(?:\/.*)?$/ }, ({ path: name }) => {
        assert.ok(Object.hasOwn(entries, name), `Unreviewed workspace import: ${name}`);
        return { path: realpathSync(path.join(checkout, entries[name])) };
      });
    },
  }];
}

export function assertRecoveryWorkspaceSources(metafile, checkout, { databasePool = false } = {}) {
  const root = realpathSync(checkout);
  for (const input of Object.keys(metafile.inputs)) {
    if (input === "<stdin>") continue;
    const source = realpathSync(path.resolve(checkout, input));
    const workspaceSource = /\/(?:lib|artifacts)\/[^/]+\/src\//.test(source) || /\/node_modules\/@workspace\//.test(source);
    const dependency = source.includes(`${path.sep}node_modules${path.sep}`) && !workspaceSource;
    assert.ok(source.startsWith(root + path.sep) || dependency,
      `Runtime workspace source is outside the reviewed checkout: ${source}`);
  }
  for (const file of [...Object.values(metafile.inputs), ...Object.values(metafile.outputs)]) {
    assert.ok(!(file.imports ?? []).some(entry => entry.external && /^@workspace\//.test(entry.path)),
      "Runtime workspace imports must be bundled from the reviewed checkout.");
  }
  if (databasePool) assertIsolatedDatabaseBundle(metafile, checkout);
}

// Re-exec before loading pg. Never mutate the caller's environment or accept its DB URL.
export function isolatedWorkerEnvironment(ambient, directory) {
  const removedKeys = Object.keys(ambient).filter(key => /^PG/i.test(key) || key.toUpperCase() === "DATABASE_URL").sort();
  const env = Object.fromEntries(Object.entries(nativeTestEnvironment(ambient.PRACTICE_NATIVE_POSTGRES_BIN ?? "", directory)).filter(([key]) => !/^PG/i.test(key)));
  env.PRACTICE_NATIVE_POSTGRES_BIN = ambient.PRACTICE_NATIVE_POSTGRES_BIN ?? "";
  return { env, removedKeys };
}

async function run(out, removedKeys) {
  const report = {
    status: "running", startedAt: new Date().toISOString(), outputDirectory: out,
    syntheticOnly: true, productionAccess: false, warning,
    removedParentEnvironmentKeys: removedKeys, checks: [], processExits: [], requests: [],
  };
  const nativeBin = process.env.PRACTICE_NATIVE_POSTGRES_BIN;
  const env = nativeTestEnvironment(nativeBin ?? "", out);
  const apis = [];
  let native, Client, statements, apiBundle, clerk, token;
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error("Synthetic acceptance interrupted; cleaning up owned processes."));
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const deadline = setTimeout(() => abort.abort(new Error("Synthetic acceptance exceeded its four-minute work budget.")), 240000);
  const secrets = [];
  const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, "[synthetic-secret-redacted]"), String(value));
  const write = (name, value) => fs.writeFile(path.join(out, name), redact(JSON.stringify(value, null, 2)) + "\n", { mode: 0o600 });
  const check = message => { report.checks.push(message); console.log(message); };
  function assertActive() { abort.signal.throwIfAborted(); }
  const git = (...args) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", timeout: 10000, killSignal: "SIGKILL" }).trim();

  async function connect(url, work) {
    assertActive();
    // URLs are derived only from this freshly claimed fixture, including the restore DB.
    const restore = new URL(native.connectionString);
    restore.pathname = "/synthetic_abrupt_restore";
    assert.ok([native.connectionString, restore.toString()].includes(url), "Database URL must belong to this run's freshly owned cluster.");
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 35000, statement_timeout: 30000 });
    client.on("error", error => { report.databaseClientError = redact(error.message); });
    try { await client.connect(); return await work(client); }
    finally { await client.end(); }
  }

  async function call(api, endpoint, body, expected = 200) {
    assertActive();
    const response = await fetch(api.base + "/api" + endpoint, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, origin: api.base, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(40000)]),
    });
    const data = await response.json();
    report.requests.push({ api: api.name, endpoint, method: body === undefined ? "GET" : "POST", status: response.status });
    assert.equal(response.status, expected, `${api.name} ${endpoint}: ${JSON.stringify(data)}`);
    return data;
  }

  async function startApi(name, url) {
    assertActive();
    const base = `http://127.0.0.1:${await nativeTestPort()}`;
    const child = spawn(process.execPath, [apiBundle], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"],
      env: { ...env, ...clerk.env, DATABASE_URL: url, NODE_ENV: "production", HOST: "127.0.0.1", PORT: new URL(base).port,
        LOCAL_PREVIEW: "false", SEED_DEMO_DATA: "false", EMC_OWNER_EMAIL: "owner@example.test", EMC_PRACTICE_ID: "synthetic-abrupt-recovery", APP_ORIGIN: base },
    });
    const chunks = [];
    let bytes = 0;
    const log = data => { if (bytes < 2 * 1024 * 1024) chunks.push(Buffer.from(data)); bytes += data.length; };
    child.stdout.on("data", log);
    child.stderr.on("data", log);
    const api = { name, base, child, closed: false };
    apis.push(api);
    api.done = new Promise(resolve => {
      child.once("error", error => { api.spawnError = redact(error.message); });
      child.once("close", (code, signal) => {
        api.closed = true;
        resolve({ name, pid: child.pid, code, signal, error: api.spawnError, requestedSignal: api.requestedSignal });
      });
    }).then(async result => {
      report.processExits.push(result);
      await fs.writeFile(path.join(out, name + ".log"), redact(Buffer.concat(chunks).toString("utf8")), { mode: 0o600 });
      return result;
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      assertActive();
      if (api.closed) throw new Error(`${name} exited during startup; inspect ${name}.log.`);
      let ready = false;
      try {
        const response = await fetch(base + "/api/healthz", { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]) });
        await response.arrayBuffer();
        ready = response.status === 200;
      } catch (error) { if (abort.signal.aborted) throw error; }
      if (ready) {
        assert.deepEqual(await call(api, "/auth/me"), { actor: "owner@example.test", role: "owner" });
        return api;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`${name} readiness timed out; inspect ${name}.log.`);
  }

  async function stopApi(api, signal = "SIGTERM") {
    assert.ok(apis.includes(api), "Refusing to signal an API child not launched by this run.");
    assert.ok(["SIGTERM", "SIGKILL"].includes(signal), "Unsupported API stop signal.");
    if (!api.closed && api.child.exitCode === null && api.child.signalCode === null) {
      api.requestedSignal = signal;
      assert.ok(api.child.kill(signal), `${api.name} signal could not be delivered.`);
    }
    let timer;
    try {
      return await Promise.race([api.done, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${api.name} did not exit within ten seconds.`)), 10000);
      })]);
    } finally { clearTimeout(timer); }
  }

  async function sqlTables(url, names) {
    return connect(url, async client => {
      const tables = {};
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      for (const name of names) {
        assertActive();
        assert.match(name, /^[a-z_]+$/);
        tables[name] = (await client.query(`SELECT row_to_json(t) AS record FROM "${name}" t ORDER BY ${name === "practice_import_declarations" ? "practice_id, account_id" : "id"}`)).rows.map(row => row.record);
      }
      await client.query("COMMIT");
      return tables;
    });
  }

  async function apiState(api, teamId) {
    const hub = await call(api, "/hub");
    const history = await call(api, "/hub/history");
    assert.equal(history.length, hub.revision);
    const revisions = [];
    for (let revision = 1; revision <= hub.revision; revision++) revisions.push(await call(api, `/hub/history/${revision}`));
    const exported = await call(api, "/hub/export");
    const { exportedAt, ...fullHistory } = exported;
    assert.ok(exportedAt);
    return { hub, history, revisions, fullHistory, team: await call(api, `/business-goals/${teamId}`), staff: await call(api, "/staff"), clinicians: await call(api, "/clinicians") };
  }

  try {
    assert.equal(Object.keys(process.env).filter(key => /^PG/i.test(key) || key.toUpperCase() === "DATABASE_URL").length, 0, "Worker must be sanitized before pg loads.");
    const hashes = {};
    const files = new Set(git("ls-files", "-z").split("\0").filter(Boolean));
    files.add("verification/native-abrupt-recovery.mjs");
    files.add("verification/native-postgres-fixture.mjs");
    for (const file of files) hashes[file] = sha256(await fs.readFile(path.join(repo, file)));
    report.source = { commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"), trackedStatus: git("status", "--short", "--untracked-files=no"), sha256: hashes };
    native = createNativePostgresFixture({ directory: path.join(out, "cluster"), binDirectory: nativeBin, signal: abort.signal });
    // Native resource errors remain exact diagnostics and are reported as blockers.
    report.phase = "native initialization";
    await native.start(true);
    check("Fresh owned loopback native cluster initialized and its identity verified.");

    report.phase = "dependency loading";
    const require = createRequire(path.join(repo, "artifacts/api-server/package.json"));
    const dbRequire = createRequire(path.join(repo, "lib/db/package.json"));
    ({ Client } = dbRequire("pg"));
    const { build } = require("esbuild");
    const { generateDrizzleJson, generateMigration } = dbRequire("drizzle-kit/api");
    async function moduleFrom(contents) {
      const built = await build({ absWorkingDir: repo, stdin: { contents, resolveDir: repo, loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm", metafile: true, logLevel: "silent", plugins: recoveryWorkspacePlugins(repo) });
      assertRecoveryWorkspaceSources(built.metafile, repo);
      return import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
    }
    report.phase = "schema and API build";
    const schema = await moduleFrom('export * from "./lib/db/src/schema/index.ts";');
    const model = await moduleFrom('export * from "./lib/practice/src/hub/index.ts";');
    statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
    await fs.writeFile(path.join(out, "generated-schema.sql"), statements.join(";\n"), { mode: 0o600 });
    report.schemaSha256 = sha256(statements.join(";\n"));
    await connect(native.connectionString, async client => { for (const statement of statements) await client.query(statement); });
    apiBundle = path.join(out, "api.mjs");
    // Keep pino's own module resolution intact; production logging needs no transport worker.
    // Build into this run's directory without touching the shared dist directory.
    const built = await build({
      absWorkingDir: repo, entryPoints: [path.join(repo, "artifacts/api-server/src/index.ts")], outfile: apiBundle,
      bundle: true, platform: "node", format: "esm", metafile: true, logLevel: "silent", external: ["pg-native"],
      plugins: [...recoveryWorkspacePlugins(repo), { name: "native-pino-module", setup(builder) {
        builder.onResolve({ filter: /^pino$/ }, () => ({ path: require.resolve("pino"), external: true }));
      } }],
      banner: { js: `import { createRequire as __createRequire } from 'node:module'; import { fileURLToPath as __fileURLToPath } from 'node:url'; import { dirname as __dirnameOf } from 'node:path'; globalThis.require = __createRequire(${JSON.stringify(path.join(repo, "artifacts/api-server/package.json"))}); globalThis.__filename = __fileURLToPath(import.meta.url); globalThis.__dirname = __dirnameOf(globalThis.__filename);` },
    });
    assertRecoveryWorkspaceSources(built.metafile, repo, { databasePool: true });
    report.apiBundleSha256 = sha256(await fs.readFile(apiBundle));
    await write("api-build-metafile.json", built.metafile);
    clerk = syntheticClerkFixture();
    token = clerk.token("owner@example.test");
    secrets.push(token, clerk.env.CLERK_JWT_KEY, clerk.env.CLERK_SECRET_KEY);
    report.phase = "synthetic setup";
    const source = await startApi("source-api", native.connectionString);
    const team = await call(source, "/business-goals", { name: "Synthetic abrupt recovery practice", ownerPayGoal: 0, secondOwnerPayGoal: 0, desiredCliniciansCount: 1 }, 201);
    const staff = await call(source, "/staff", { goalId: team.id, label: "Synthetic Coordinator", hourlyRate: 18, hoursPerWeek: 10, weeksPerYear: 48 }, 201);
    const clinician = await call(source, "/clinicians", { goalId: team.id, label: "Synthetic Clinician" }, 201);
    let state = await call(source, "/hub");
    assert.equal(state.revision, 0);
    const workspace = model.emptyWorkspace("2026-10-01");
    workspace.settings.practiceName = "Synthetic abrupt recovery practice";
    workspace.settings.teamId = team.id;
    workspace.goals.push(model.goalSchema.parse({ id: randomUUID(), name: "Synthetic annual owner pay", metric: "ownerDistributionsPretax", amount: 12000, basis: "annual" }));
    workspace.staffTerms.push(model.staffTermSchema.parse({ id: randomUUID(), staffMemberId: staff.id, effectiveDate: "2026-01-01", end: "2026-09-30", hourlyRate: 18, hoursPerWeek: 10, weeksPerYear: 48, notes: "Synthetic earlier dated terms" }));
    const period = model.periodSchema.parse({ id: randomUUID(), name: "Synthetic October", start: "2026-10-01", end: "2026-10-31" });
    workspace.periods.push(period);
    async function save(data, action) {
      state = await call(source, "/hub", { requestId: randomUUID(), expectedRevision: state.revision, action, data });
    }
    await save(workspace, "Synthetic annual goal and earlier staff terms");
    const next = structuredClone(state.data);
    next.goals[0].amount = 14400;
    next.staffTerms.push(model.staffTermSchema.parse({ id: randomUUID(), staffMemberId: staff.id, effectiveDate: "2026-10-01", end: "2026-12-31", hourlyRate: 22, hoursPerWeek: 12, weeksPerYear: 48, notes: "Synthetic later dated terms" }));
    await save(next, "Synthetic annual goal revision and later staff terms");
    const attachmentId = randomUUID();
    const attachmentData = Buffer.from("synthetic,completed\nfixture,3\n").toString("base64");
    await call(source, "/hub/attachments", { id: attachmentId, periodId: period.id, name: "synthetic-recovery.csv", data: attachmentData }, 201);
    const entry = { clinicianId: clinician.id, start: period.start, end: period.end, completed: 3, desired: 5, cancelled: null, noShow: null, sourceAttachmentId: attachmentId };
    await call(source, "/session-records", { requestId: randomUUID(), expectedRevision: null, entry });
    await call(source, "/session-records", { requestId: randomUUID(), expectedRevision: 1, entry: { ...entry, completed: 4 } });

    report.phase = "committed baseline and actual backup";
    const before = await apiState(source, team.id);
    assert.equal(before.hub.revision, 2);
    assert.equal(before.hub.data.goals[0].basis, "annual");
    assert.equal(before.hub.data.goals[0].amount, 14400);
    assert.equal(before.hub.data.staffTerms.length, 2);
    assert.deepEqual(before.hub.data.staffTerms.map(term => [term.effectiveDate, term.end, term.hourlyRate, term.hoursPerWeek]), [
      ["2026-01-01", "2026-09-30", 18, 10], ["2026-10-01", "2026-12-31", 22, 12],
    ]);
    assert.ok(before.history.every(row => row.actor === "owner@example.test"));
    assert.deepEqual(before.revisions[1].data, before.hub.data);
    const backup = await call(source, "/hub/backup");
    assert.equal(backup.format, "emc-business-data-v2");
    const tableNames = Object.keys(backup.tables).sort();
    assert.deepEqual(tableNames, [
      "business_goals", "current_reality", "clinicians", "staff_members", "scenarios", "scenario_clinicians", "scenario_staff_members",
      "hub_workspaces", "hub_attachments", "session_records", "session_goal_years", "session_record_history", "hub_history",
      "practice_import_packages", "practice_import_snapshots", "practice_import_declarations", "practice_import_audit",
    ].sort(), "The actual backup must contain exactly the reviewed 17 business tables.");
    assert.ok(!tableNames.includes("hub_users") && !tableNames.includes("hub_auth_sessions"));
    const expectedCounts = { business_goals: 1, staff_members: 1, clinicians: 1, hub_workspaces: 1, hub_history: 2, hub_attachments: 1, session_records: 1, session_record_history: 2 };
    for (const [name, count] of Object.entries(expectedCounts)) assert.equal(backup.tables[name].length, count, name);
    assert.equal(backup.tables.hub_attachments[0].data, attachmentData);
    assert.ok(Buffer.byteLength(JSON.stringify(backup)) < 1024 * 1024, "Synthetic backup must remain below one MiB.");
    assert.ok(Object.values(backup.tables).reduce((total, rows) => total + rows.length, 0) <= 32, "Synthetic backup must remain bounded to at most 32 rows.");
    const sqlBefore = await sqlTables(native.connectionString, tableNames);
    assert.deepEqual(sqlBefore, backup.tables, "Actual backup must match every committed SQL business row.");
    assert.deepEqual(before.fullHistory.history, sqlBefore.hub_history.map(row => ({ id: row.id, workspaceId: row.workspace_id, revision: row.revision, requestId: row.request_id, actor: row.actor, action: row.action, command: row.command, snapshot: row.snapshot, createdAt: new Date(row.created_at).toISOString() })));
    await write("before.json", { api: before, sql: sqlBefore });
    await write("backup.json", backup);
    report.backup = { file: "backup.json", sha256: sha256(JSON.stringify(backup)), counts: Object.fromEntries(tableNames.map(name => [name, backup.tables[name].length])) };
    check("Two acknowledged hub revisions, dated staff terms, attachment bytes, session corrections, full audit rows, and actual 17-table backup match committed SQL.");

    report.phase = "idle abrupt stop and same-directory restart";
    report.nativeBeforeCrash = native.ownershipEvidence;
    // All requests and SQL clients above have completed. No workload is in flight.
    await connect(native.connectionString, async client => {
      const active = (await client.query("SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND (state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL)")).rows;
      assert.deepEqual(active, [], "Abrupt stop must occur at an idle database boundary.");
      report.idleBoundary = { verifiedAt: new Date().toISOString(), activeOtherTransactions: active.length, revision: before.hub.revision };
    });
    const crashExit = await stopApi(source, "SIGKILL");
    assert.equal(crashExit.signal, "SIGKILL");
    assert.equal(crashExit.code, null);
    await native.stop("immediate");
    await native.start(false);
    report.nativeAfterRestart = native.ownershipEvidence;
    const restarted = await startApi("restarted-api", native.connectionString);
    const after = await apiState(restarted, team.id);
    const sqlAfter = await sqlTables(native.connectionString, tableNames);
    assert.deepEqual(after, before, "Goal, staff, revisions, and complete API history must survive unchanged.");
    assert.deepEqual(sqlAfter, sqlBefore, "Every exported SQL row, including complete audit commands and snapshots, must survive unchanged.");
    assert.deepEqual((await call(restarted, "/hub/backup")).tables, backup.tables);
    await write("after-restart.json", { api: after, sql: sqlAfter });
    check("Owned API exited by SIGKILL; owned PostgreSQL stopped immediately and restarted in the same data directory; all API and SQL state is unchanged.");
    await stopApi(restarted);

    report.phase = "reviewed restore into separate fresh owned database";
    await connect(native.connectionString, client => client.query("CREATE DATABASE synthetic_abrupt_restore"));
    const restoreUrl = new URL(native.connectionString);
    restoreUrl.pathname = "/synthetic_abrupt_restore";
    await connect(restoreUrl.toString(), async client => { for (const statement of statements) await client.query(statement); });
    const restored = await startApi("restore-api", restoreUrl.toString());
    const empty = await sqlTables(restoreUrl.toString(), tableNames);
    assert.ok(Object.values(empty).every(rows => rows.length === 0));
    const preview = await call(restored, "/hub/backup/preview", backup);
    assert.equal(preview.canRestore, true);
    assert.ok(Object.values(preview.existing).every(count => count === 0));
    assert.deepEqual(preview.counts, report.backup.counts);
    assert.equal(preview.digest, sha256(JSON.stringify(backup)));
    const restore = await call(restored, "/hub/backup/restore", { token: preview.token, digest: preview.digest, confirmation: "RESTORE EMPTY APP" });
    assert.deepEqual(restore, { ok: true });
    const restoredState = await apiState(restored, team.id);
    const restoredSql = await sqlTables(restoreUrl.toString(), tableNames);
    assert.deepEqual(restoredState, before);
    assert.deepEqual(restoredSql, backup.tables);
    assert.deepEqual((await call(restored, "/hub/backup")).tables, backup.tables);
    assert.deepEqual(await sqlTables(native.connectionString, tableNames), sqlBefore, "Restore must leave the original database unchanged.");
    await write("restore.json", { preview, result: restore, api: restoredState, sql: restoredSql });
    check("Reviewed preview/digest/confirmation restore into a separate freshly created database reproduces every exported row and complete audit state; source database is unchanged.");
    report.status = "pass";
  } catch (error) {
    report.status = report.phase === "native initialization" ? "blocked" : "fail";
    report.error = { message: redact(error.message?.split("data:text/javascript")[0]), code: error.code, signal: error.signal, stdout: redact(error.stdout ?? ""), stderr: redact(error.stderr ?? "") };
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    report.statusBeforeCleanup = report.status;
    report.cleanupErrors = [];
    for (const api of apis) {
      try { await stopApi(api); }
      catch (error) {
        report.cleanupErrors.push({ resource: api.name, message: redact(error.message) });
        try { await stopApi(api, "SIGKILL"); }
        catch (fallback) { report.cleanupErrors.push({ resource: api.name, message: redact(fallback.message) }); }
      }
    }
    try { await native?.stop("fast", { cleanup: true }); }
    catch (error) { report.cleanupErrors.push({ resource: "owned native cluster", message: redact(error.message) }); }
    if (native) report.postgres = native.ownershipEvidence;
    if (report.cleanupErrors.length) { report.status = "cleanup-failed"; process.exitCode = 1; }
    report.cleanup = "Only this run's API children and owned cluster were stopped. Synthetic files and diagnostics are retained; no database, directory, or other work was deleted.";
    report.finishedAt = new Date().toISOString();
    await write("report.json", report);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    console.log(`${report.status}: ${path.join(out, "report.json")}\n${warning}`);
  }
}

async function main() {
  if (process.argv[2] === "--worker" && process.send && process.argv.length === 3) {
    const { out, removedKeys } = await new Promise(resolve => process.once("message", resolve));
    process.disconnect();
    await run(out, removedKeys);
    return;
  }
  if (process.argv.length !== 2) throw new Error("No arguments are accepted; all database locations are generated freshly by this script.");
  const out = await fs.mkdtemp(path.join(await fs.realpath("/tmp"), "practice-native-abrupt-"));
  const { env, removedKeys } = isolatedWorkerEnvironment(process.env, out);
  const child = fork(filename, ["--worker"], { cwd: repo, env, execArgv: [], stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const forward = signal => child.kill(signal);
  const onInt = () => forward("SIGINT"), onTerm = () => forward("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  child.once("spawn", () => child.send({ out, removedKeys }));
  const exit = await new Promise(resolve => {
    child.once("error", error => resolve({ code: 1, error: error.message }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  await fs.writeFile(path.join(out, "worker-exit.json"), JSON.stringify(exit, null, 2) + "\n", { mode: 0o600 });
  process.off("SIGINT", onInt);
  process.off("SIGTERM", onTerm);
  process.exitCode = exit.code === 0 && !exit.signal ? 0 : 1;
  console.log(`Synthetic worker exit: ${JSON.stringify(exit)}. Evidence: ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
