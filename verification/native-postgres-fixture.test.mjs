import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import {
  createNativePostgresFixture,
  sanitizeNativeParentEnvironment,
} from "./native-postgres-fixture.mjs";

// These executable doubles never launch or signal a PostgreSQL server.
async function simulatedFixture(t, mode = "failure") {
  const parent = await fs.mkdtemp("/tmp/native-fixture-regression-");
  const binDirectory = path.join(parent, "bin");
  await fs.mkdir(binDirectory);
  await fs.writeFile(path.join(binDirectory, "sql-mode"), mode);
  const binary = `#!${process.execPath}
import fs from "node:fs";
import path from "node:path";
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
if (command === "postgres") { console.log("simulated PostgreSQL for ownership regression only"); }
if (command === "initdb") fs.writeFileSync(path.join(args[args.indexOf("-D") + 1], "PG_VERSION"), "16");
if (command === "pg_ctl") {
  const data = args[args.indexOf("-D") + 1];
  const root = path.dirname(data);
  const owner = JSON.parse(fs.readFileSync(path.join(root, "native-postgres-owner.json")));
  const action = args.at(-1);
  fs.appendFileSync(path.join(root, "control-actions"), action + "\\n");
  if (action === "start") fs.writeFileSync(path.join(data, "postmaster.pid"), ["700001", data, "1234567890", owner.port, path.join(root, "socket"), "127.0.0.1", "", "ready"].join("\\n"));
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
  const fixture = createNativePostgresFixture({ directory, binDirectory });
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
