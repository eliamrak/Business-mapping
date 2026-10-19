import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { syntheticClerkFixture } from "../artifacts/api-server/test/synthetic-clerk.mjs";
import {
  createNativePostgresFixture,
  nativeTestEnvironment,
  nativeTestPort,
  sanitizeNativeParentEnvironment,
} from "./native-postgres-fixture.mjs";

const removedParentEnvironmentKeys = sanitizeNativeParentEnvironment();

// Usage: PRACTICE_NATIVE_POSTGRES_BIN=/absolute/bin node verification/native-postgres-gated-suites.mjs [--preflight]
// No database URL or credential environment variables are accepted as inputs.
const repo = fileURLToPath(new URL("../", import.meta.url));
const suites = [
  "hub.integration.test.mjs",
  "practice-imports.integration.test.mjs",
  "session-goals.persistence.test.mjs",
  "sessions.integration.test.mjs",
];
const out = await fs.mkdtemp(
  path.join(await fs.realpath("/tmp"), "practice-native-gated-"),
);
const reportFile = path.join(out, "report.json");
const report = {
  startedAt: new Date().toISOString(),
  outputDirectory: out,
  mode: process.argv.includes("--preflight")
    ? "preflight"
    : "four-gated-suites",
  syntheticOnly: true,
  removedParentEnvironmentKeys,
  suites: suites.map((name) => ({ name, status: "not-run" })),
};
let native, api;
const secrets = [];
const redact = (value) =>
  secrets.reduce(
    (text, secret) => text.replaceAll(secret, "[synthetic-secret-redacted]"),
    String(value),
  );
const errorDetails = (error) => ({
  message: redact(error.message),
  code: error.code,
  signal: error.signal,
  stdout: redact(error.stdout ?? ""),
  stderr: redact(error.stderr ?? ""),
});
const git = (...args) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: out, TMPDIR: out },
  }).trim();
const sha256 = (contents) =>
  createHash("sha256").update(contents).digest("hex");
const saveReport = async () => {
  if (native) report.postgres = native.ownershipEvidence;
  await fs.writeFile(
    reportFile,
    redact(JSON.stringify(report, null, 2)) + "\n",
    { mode: 0o600 },
  );
};

function launch(args, env, logName) {
  const child = spawn(process.execPath, args, {
    cwd: repo,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  child.stdout.on("data", (data) => chunks.push(Buffer.from(data)));
  child.stderr.on("data", (data) => chunks.push(Buffer.from(data)));
  // Install exit/error listeners immediately, including for API startup failures.
  const done = new Promise((resolve) => {
    child.once("error", (error) =>
      resolve({ code: null, signal: null, error: errorDetails(error) }),
    );
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).then(async (result) => {
    await fs.writeFile(
      path.join(out, logName),
      redact(Buffer.concat(chunks).toString("utf8")),
      { mode: 0o600 },
    );
    return result;
  });
  return { child, done };
}

async function stopApi() {
  if (!api) return;
  if (api.child.exitCode === null && api.child.signalCode === null)
    api.child.kill("SIGTERM");
  const timer = setTimeout(() => api.child.kill("SIGKILL"), 10000);
  try {
    report.apiExit = await api.done;
  } finally {
    clearTimeout(timer);
    api = null;
  }
}

async function runSuite(name, env) {
  const result = report.suites.find((suite) => suite.name === name);
  result.startedAt = new Date().toISOString();
  result.log = `${name}.log`;
  console.log(`Running ${name}`);
  const run = launch(
    ["--test", "--test-reporter=tap", `artifacts/api-server/test/${name}`],
    env,
    result.log,
  );
  // Suite hooks own their API children. Let the test process finish and await close.
  const exit = await run.done;
  Object.assign(result, {
    status: exit.code === 0 ? "pass" : "fail",
    ...exit,
    finishedAt: new Date().toISOString(),
  });
  await saveReport();
}

try {
  if (process.argv.slice(2).some((arg) => arg !== "--preflight"))
    throw new Error(
      "Only --preflight is supported; fixture roots and database URLs are generated internally.",
    );
  const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
  const hashes = {};
  for (const file of tracked)
    hashes[file] = sha256(await fs.readFile(path.join(repo, file)));
  for (const file of [
    "verification/native-postgres-fixture.mjs",
    "verification/native-postgres-gated-suites.mjs",
  ])
    hashes[file] = sha256(await fs.readFile(path.join(repo, file)));
  report.source = {
    commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    trackedStatus: git("status", "--short", "--untracked-files=no"),
    sha256: hashes,
  };
  native = createNativePostgresFixture({
    directory: path.join(out, "cluster"),
    binDirectory: process.env.PRACTICE_NATIVE_POSTGRES_BIN,
  });
  await native.start(true);
  await saveReport();
  // Exercise the same owned-cluster restart needed by the acceptance harness.
  await native.stop();
  await native.start(false);
  report.restart = "pass";

  if (report.mode !== "preflight") {
    const apiRequire = createRequire(
      path.join(repo, "artifacts/api-server/package.json"),
    );
    const dbRequire = createRequire(path.join(repo, "lib/db/package.json"));
    const { build } = apiRequire("esbuild");
    const { Client } = dbRequire("pg");
    const { generateDrizzleJson, generateMigration } =
      dbRequire("drizzle-kit/api");
    const env = nativeTestEnvironment(
      process.env.PRACTICE_NATIVE_POSTGRES_BIN,
      out,
    );
    // Match the repository's esbuild/moduleFrom schema-generation approach.
    const bundled = await build({
      stdin: {
        contents: 'export * from "./lib/db/src/schema/index.ts";',
        resolveDir: repo,
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
    const schemaModule = await import(
      "data:text/javascript;base64," +
        Buffer.from(bundled.outputFiles[0].text).toString("base64")
    );
    const statements = await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schemaModule),
    );
    const schema = statements.join(";\n");
    await fs.writeFile(path.join(out, "generated-schema.sql"), schema);
    report.schemaSha256 = sha256(schema);
    const client = new Client({
      connectionString: native.connectionString,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    try {
      for (const statement of statements) await client.query(statement);
    } finally {
      await client.end();
    }

    const buildRun = launch(
      ["artifacts/api-server/build.mjs"],
      env,
      "api-build.log",
    );
    report.apiBuild = await buildRun.done;
    if (report.apiBuild.code !== 0)
      throw new Error("Isolated API build failed; see api-build.log.");
    report.apiBundleSha256 = sha256(
      await fs.readFile(path.join(repo, "artifacts/api-server/dist/index.mjs")),
    );
    await runSuite(suites[0], {
      ...env,
      EMC_TEST_DATABASE_URL: native.connectionString,
    });
    await runSuite(suites[1], {
      ...env,
      EMC_TEST_DATABASE_URL: native.connectionString,
    });
    await runSuite(suites[2], {
      ...env,
      DATABASE_URL: native.connectionString,
    });

    // Persistence writes to the schema source. Give the API a separate fresh DB.
    const sessionsUrl = new URL(native.connectionString);
    sessionsUrl.pathname = "/synthetic_sessions";
    const admin = new Client({ connectionString: native.connectionString });
    await admin.connect();
    try {
      await admin.query("CREATE DATABASE synthetic_sessions");
    } finally {
      await admin.end();
    }
    const sessionsClient = new Client({
      connectionString: sessionsUrl.toString(),
    });
    await sessionsClient.connect();
    try {
      for (const statement of statements) await sessionsClient.query(statement);
    } finally {
      await sessionsClient.end();
    }
    const clerk = syntheticClerkFixture();
    const token = clerk.token("owner@example.test");
    secrets.push(token, clerk.env.CLERK_JWT_KEY, clerk.env.CLERK_SECRET_KEY);
    const base = `http://127.0.0.1:${await nativeTestPort()}`;
    api = launch(
      ["artifacts/api-server/dist/index.mjs"],
      {
        ...env,
        ...clerk.env,
        DATABASE_URL: sessionsUrl.toString(),
        NODE_ENV: "development",
        HOST: "127.0.0.1",
        PORT: new URL(base).port,
        LOCAL_PREVIEW: "false",
        SEED_DEMO_DATA: "false",
        EMC_OWNER_EMAIL: "owner@example.test",
        EMC_PRACTICE_ID: "synthetic-native-sessions",
        APP_ORIGIN: base,
      },
      "sessions-api.log",
    );
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (api.child.exitCode !== null || api.child.signalCode !== null)
        throw new Error(
          "Sessions API exited during startup; see sessions-api.log.",
        );
      try {
        ready =
          (
            await fetch(base + "/api/healthz", {
              signal: AbortSignal.timeout(1000),
            })
          ).status === 200;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Sessions API readiness timed out.");
    const auth = await fetch(base + "/api/auth/me", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (auth.status !== 200)
      throw new Error(`Synthetic owner authentication failed: ${auth.status}`);
    await runSuite(suites[3], {
      ...env,
      EMC_TEST_API_URL: base + "/api",
      EMC_TEST_SESSION_TOKEN: token,
    });
  }
  report.status = report.suites.some((suite) => suite.status === "fail")
    ? "fail"
    : report.mode === "preflight"
      ? "preflight-pass"
      : "pass";
} catch (error) {
  report.status = "blocked";
  report.error = errorDetails(error);
  for (const suite of report.suites)
    if (suite.status === "not-run") {
      suite.status = "blocked";
      suite.reason = report.error.message;
    }
  process.exitCode = 1;
} finally {
  report.statusBeforeCleanup = report.status;
  try {
    await stopApi();
    report.apiCleanup = "stopped-or-never-started";
  } catch (error) {
    report.apiCleanup = "failed";
    report.apiCleanupError = errorDetails(error);
    process.exitCode = 1;
  }
  try {
    await native?.stop();
    report.clusterCleanup = "stopped-or-never-started";
  } catch (error) {
    report.clusterCleanup = "failed";
    report.clusterCleanupError = errorDetails(error);
    process.exitCode = 1;
  }
  if (report.apiCleanupError || report.clusterCleanupError) {
    report.status = "cleanup-failed";
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await saveReport();
  console.log(`${report.status}: ${reportFile}`);
  if (report.status === "fail") process.exitCode = 1;
}
