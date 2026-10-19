import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { isolatedWorkerEnvironment } from "./native-abrupt-recovery.mjs";
import {
  createNativePostgresFixture,
  sanitizeNativeParentEnvironment,
} from "./native-postgres-fixture.mjs";

// These executable doubles never launch or signal a PostgreSQL server.
async function simulatedFixture(t, mode = "failure", options = {}) {
  const parent = await fs.mkdtemp("/tmp/native-fixture-regression-");
  const binDirectory = path.join(parent, "bin");
  await fs.mkdir(binDirectory);
  t.after(async () => {
    let pids = "";
    try { pids = await fs.readFile(path.join(binDirectory, "stalled-pids"), "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const value of pids.trim().split("\n").filter(Boolean)) {
      try { process.kill(Number(value), "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await fs.rm(parent, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(binDirectory, "sql-mode"), mode);
  const binary = `#!${process.execPath}
import fs from "node:fs";
import path from "node:path";
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
async function stallIfRequested(name) {
  const file = path.join(path.dirname(process.argv[1]), "stall-command");
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === name) {
    console.error("synthetic stalled " + name);
    fs.writeFileSync(path.join(path.dirname(file), "stalled-pid"), String(process.pid));
    fs.appendFileSync(path.join(path.dirname(file), "stalled-pids"), String(process.pid) + "\\n");
    process.on("SIGTERM", () => {});
    await new Promise(() => setInterval(() => {}, 1000));
  }
}
if (command !== "pg_ctl") await stallIfRequested(command);
if (command === "postgres") { console.log("simulated PostgreSQL for ownership regression only"); }
if (command === "initdb") fs.writeFileSync(path.join(args[args.indexOf("-D") + 1], "PG_VERSION"), "16");
if (command === "pg_ctl") {
  const data = args[args.indexOf("-D") + 1];
  const root = path.dirname(data);
  const owner = JSON.parse(fs.readFileSync(path.join(root, "native-postgres-owner.json")));
  const action = args.at(-1);
  fs.appendFileSync(path.join(root, "control-actions"), action + "\\n");
  if (action === "stop") fs.appendFileSync(path.join(root, "stop-modes"), args[args.indexOf("-m") + 1] + "\\n");
  if (action === "start") fs.writeFileSync(path.join(data, "postmaster.pid"), ["700001", data, "1234567890", owner.port, path.join(root, "socket"), "127.0.0.1", "", "ready"].join("\\n"));
  await stallIfRequested("pg_ctl:" + action);
  if (action === "stop") fs.unlinkSync(path.join(data, "postmaster.pid"));
}
if (command === "psql") {
  const mode = fs.readFileSync(path.join(path.dirname(process.argv[1]), "sql-mode"), "utf8");
  if (mode === "failure") { console.error("synthetic SQL connection failure"); process.exit(2); }
  const root = process.cwd();
  const owner = JSON.parse(fs.readFileSync(path.join(root, "native-postgres-owner.json")));
  console.log(JSON.stringify({data_directory: mode === "mismatch" ? "/unowned" : owner.dataDirectory, port: String(owner.port), server_port: owner.port, server_address: "127.0.0.1", listen_addresses: "127.0.0.1", unix_socket_directories: path.join(root, "socket")}));
}
`;
  for (const name of ["postgres", "initdb", "pg_ctl", "psql", "pg_dump"])
    await fs.writeFile(path.join(binDirectory, name), binary, { mode: 0o700 });
  // No loopback listener is needed for command-double ownership checks.
  t.mock.method(net, "createServer", () => {
    const server = new EventEmitter();
    server.listen = (_port, _host, callback) => callback();
    server.address = () => ({ port: 54329 });
    server.close = (callback) => callback();
    return server;
  });
  const directory = path.join(parent, "cluster");
  const fixture = createNativePostgresFixture({ directory, binDirectory, ...options });
  return { directory, fixture, parent, binDirectory };
}

test("every existing root is refused, including an empty directory and symlink", async (t) => {
  const { directory, fixture, parent, binDirectory } =
    await simulatedFixture(t);
  await fs.mkdir(directory);
  await assert.rejects(fixture.start(true), { code: "EEXIST" });
  await fixture.stop();
  assert.deepEqual(await fs.readdir(directory), []);
  await fs.writeFile(path.join(directory, "PG_VERSION"), "existing");
  await assert.rejects(fixture.start(true), { code: "EEXIST" });
  assert.equal(
    await fs.readFile(path.join(directory, "PG_VERSION"), "utf8"),
    "existing",
  );
  const link = path.join(parent, "linked");
  await fs.symlink(directory, link);
  await assert.rejects(
    createNativePostgresFixture({ directory: link, binDirectory }).start(true),
    { code: "EEXIST" },
  );
});

test("parent sanitization removes all PG keys and DATABASE_URL, returning names only", () => {
  const keys = [
    "PGPASSWORD",
    "PGHOST",
    "PGOPTIONS",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGSSLKEY",
    "PGSSLCERT",
    "DATABASE_URL",
  ];
  const before = { ...process.env };
  try {
    for (const key of keys) process.env[key] = "synthetic-value-never-record";
    const removed = sanitizeNativeParentEnvironment();
    for (const key of keys) {
      assert.ok(removed.includes(key));
      assert.equal(process.env[key], undefined);
    }
    assert.ok(
      removed.every((key) => /^PG/i.test(key) || key === "DATABASE_URL"),
    );
    assert.ok(
      !JSON.stringify(removed).includes("synthetic-value-never-record"),
    );
    assert.equal(process.env.PATH, before.PATH);
    assert.deepEqual(sanitizeNativeParentEnvironment(), []);
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
});

test("abrupt acceptance sanitizes its worker before pg loads without mutating ambient environment", () => {
  const ambient = {
    ...process.env,
    DATABASE_URL: "postgresql://synthetic-secret@example.invalid/existing",
    PGHOST: "example.invalid", pgOptions: "synthetic-secret", PGSERVICEFILE: "/unowned",
    NODE_OPTIONS: "--import=/unowned", EMC_TEST_DATABASE_URL: "postgresql://example.invalid/existing",
    PRACTICE_NATIVE_POSTGRES_BIN: "/synthetic/bin",
  };
  const before = { ...ambient }, parentBefore = { ...process.env };
  const { env, removedKeys } = isolatedWorkerEnvironment(ambient, "/tmp/synthetic-only");
  assert.deepEqual(ambient, before);
  assert.deepEqual({ ...process.env }, parentBefore);
  assert.ok(removedKeys.includes("DATABASE_URL"));
  assert.ok(removedKeys.includes("pgOptions"));
  assert.ok(Object.keys(env).every(key => !/^PG/i.test(key) && key.toUpperCase() !== "DATABASE_URL"));
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.EMC_TEST_DATABASE_URL, undefined);
  assert.equal(env.PRACTICE_NATIVE_POSTGRES_BIN, "/synthetic/bin");
  assert.ok(!JSON.stringify({ env, removedKeys }).includes("synthetic-secret"));
});

for (const mode of ["failure", "mismatch"]) {
  test(`simulated SQL ${mode} still permits stopping only the launched postmaster`, async (t) => {
    const { directory, fixture } = await simulatedFixture(t, mode);
    await assert.rejects(
      fixture.start(true),
      mode === "failure"
        ? /synthetic SQL connection failure/
        : /settings do not match/,
    );
    assert.equal(fixture.ownershipEvidence.postmaster.pid, 700001);
    await fixture.stop();
    await fixture.stop();
    assert.equal(
      await fs.readFile(path.join(directory, "control-actions"), "utf8"),
      "start\nstop\n",
    );
  });
}

for (const mutation of [
  "marker",
  "inode",
  "pid",
  "startedAt",
  "dataDirectory",
  "port",
  "socket",
  "listenAddress",
]) {
  test(`simulated cleanup refuses changed ${mutation} ownership evidence`, async (t) => {
    const { directory, fixture } = await simulatedFixture(t);
    await assert.rejects(
      fixture.start(true),
      /synthetic SQL connection failure/,
    );
    if (mutation === "marker") {
      const marker = path.join(directory, "native-postgres-owner.json");
      const owner = JSON.parse(await fs.readFile(marker, "utf8"));
      await fs.writeFile(
        marker,
        JSON.stringify({ ...owner, fixtureId: "another-fixture" }),
      );
    } else if (mutation === "inode") {
      await fs.rename(
        fixture.dataDirectory,
        fixture.dataDirectory + "-original",
      );
      await fs.mkdir(fixture.dataDirectory);
    } else {
      const file = path.join(fixture.dataDirectory, "postmaster.pid");
      const lines = (await fs.readFile(file, "utf8")).split("\n");
      const index = {
        pid: 0,
        dataDirectory: 1,
        startedAt: 2,
        port: 3,
        socket: 4,
        listenAddress: 5,
      }[mutation];
      lines[index] =
        { pid: "700002", startedAt: "1234567891", port: "54330" }[mutation] ??
        "/unowned";
      await fs.writeFile(file, lines.join("\n"));
    }
    await assert.rejects(fixture.stop(), /mismatch|changed/);
    await assert.rejects(fixture.stop("immediate"), /mismatch|changed/);
    assert.equal(
      await fs.readFile(path.join(directory, "control-actions"), "utf8"),
      "start\n",
    );
  });
}

test("simulated verified cluster restarts only within the same fixture instance", async (t) => {
  const { directory, fixture, binDirectory } = await simulatedFixture(
    t,
    "success",
  );
  await fixture.start(true);
  await fixture.stop();
  await fixture.start(false);
  await fixture.stop();
  await assert.rejects(
    createNativePostgresFixture({ directory, binDirectory }).start(false),
    /has not claimed/,
  );
  assert.equal(
    await fs.readFile(path.join(directory, "control-actions"), "utf8"),
    "start\nstop\nstart\nstop\n",
  );
});

test("unsupported and unclaimed immediate stop requests never invoke cluster control", async (t) => {
  const { directory, fixture, binDirectory } = await simulatedFixture(t, "success");
  await assert.rejects(fixture.stop("immediate"), /has not claimed/);
  await assert.rejects(fixture.stop("crash"), /Unsupported stop mode/);
  await fixture.start(true);
  await assert.rejects(fixture.stop("SIGKILL"), /Unsupported stop mode/);
  await assert.rejects(
    createNativePostgresFixture({ directory, binDirectory }).stop("immediate"),
    /has not claimed/,
  );
  assert.equal(await fs.readFile(path.join(directory, "control-actions"), "utf8"), "start\n");
  await fixture.stop("immediate");
  await fixture.start(false);
  await fixture.stop();
  assert.equal(await fs.readFile(path.join(directory, "stop-modes"), "utf8"), "immediate\nfast\n");
  assert.deepEqual(fixture.ownershipEvidence.events.filter(event => event.action === "stop").map(event => event.mode), ["immediate", "fast"]);
});

for (const command of ["postgres", "initdb", "pg_ctl:start", "psql"]) {
  test(`stalled ${command} is killed within the native command budget`, { timeout: 10000 }, async (t) => {
    const { fixture, binDirectory } = await simulatedFixture(t, "success", { commandTimeoutMs: 1000 });
    await fs.writeFile(path.join(binDirectory, "stall-command"), command);
    const started = Date.now();
    await assert.rejects(fixture.start(true), error => error.killed && error.signal === "SIGKILL");
    assert.ok(Date.now() - started < 7000);
    const failure = fixture.ownershipEvidence.events.find(event => event.signal === "SIGKILL");
    assert.equal(failure.timeoutMs, 1000);
    assert.match(failure.stderr, /synthetic stalled/);
    const pid = Number(await fs.readFile(path.join(binDirectory, "stalled-pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    await fixture.stop("fast", { cleanup: true });
  });
}

test("work abort interrupts a stalled command and cleanup uses its own budget", { timeout: 10000 }, async (t) => {
  const controller = new AbortController();
  const { fixture, binDirectory } = await simulatedFixture(t, "success", {
    signal: controller.signal, commandTimeoutMs: 5000, cleanupTimeoutMs: 1000,
  });
  await fixture.start(true);
  await fs.writeFile(path.join(binDirectory, "stall-command"), "psql");
  await fixture.stop();
  const starting = fixture.start(false);
  const timer = setTimeout(() => controller.abort(new Error("synthetic work deadline")), 1000);
  try { await assert.rejects(starting, error => error.killed && error.signal === "SIGKILL" && /synthetic work deadline/.test(error.message)); }
  finally { clearTimeout(timer); }
  assert.ok(fixture.ownershipEvidence.events.some(event => event.command === "psql" && event.aborted));
  await fs.writeFile(path.join(binDirectory, "stall-command"), "pg_ctl:stop");
  const cleanupStarted = Date.now();
  await assert.rejects(fixture.stop("fast", { cleanup: true }), error => error.killed && error.signal === "SIGKILL");
  assert.ok(Date.now() - cleanupStarted < 4000);
  const failure = fixture.ownershipEvidence.events.at(-1);
  assert.equal(failure.timeoutMs, 1000);
  assert.equal(failure.aborted, false);
  await fs.unlink(path.join(binDirectory, "stall-command"));
  await fixture.stop("fast", { cleanup: true });
  assert.equal(fixture.ownershipEvidence.events.at(-1).action, "stop");
  for (const value of (await fs.readFile(path.join(binDirectory, "stalled-pids"), "utf8")).trim().split("\n"))
    assert.throws(() => process.kill(Number(value), 0), { code: "ESRCH" });
});

test("native command budgets cannot disable execution bounds", () => {
  for (const timeout of [0, -1, Infinity, NaN, 1.5]) {
    for (const key of ["commandTimeoutMs", "cleanupTimeoutMs"])
      assert.throws(() => createNativePostgresFixture({ directory: "/tmp/synthetic", binDirectory: "/synthetic/bin", [key]: timeout }), /positive safe integers/);
  }
});

test("stalled immediate stop remains bounded and preserves ownership for cleanup", { timeout: 10000 }, async (t) => {
  const { fixture, binDirectory } = await simulatedFixture(t, "success", { commandTimeoutMs: 1000 });
  await fixture.start(true);
  await fs.writeFile(path.join(binDirectory, "stall-command"), "pg_ctl:stop");
  await assert.rejects(fixture.stop("immediate"), error => error.killed && error.signal === "SIGKILL");
  const pid = Number(await fs.readFile(path.join(binDirectory, "stalled-pid"), "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await fs.unlink(path.join(binDirectory, "stall-command"));
  await fixture.stop("fast", { cleanup: true });
  assert.equal(fixture.ownershipEvidence.events.at(-1).action, "stop");
});
