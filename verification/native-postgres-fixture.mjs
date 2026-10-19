import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function sanitizeNativeParentEnvironment() {
  const removedKeys = Object.keys(process.env)
    .filter((key) => /^PG/i.test(key) || key.toUpperCase() === "DATABASE_URL")
    .sort();
  for (const key of removedKeys) delete process.env[key];
  return removedKeys;
}

// No ambient database, credential, loader, or PostgreSQL settings reach children.
export function nativeTestEnvironment(binDirectory, directory) {
  return {
    PATH: [
      binDirectory,
      path.dirname(process.execPath),
      "/usr/bin",
      "/bin",
      process.env.PATH ?? "",
    ].join(path.delimiter),
    HOME: directory,
    TMPDIR: directory,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    PSQLRC: "/dev/null",
    PGPASSFILE: "/dev/null",
    PGCONNECT_TIMEOUT: "5",
  };
}

export async function nativeTestPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export function createNativePostgresFixture({
  directory,
  binDirectory = process.env.PRACTICE_NATIVE_POSTGRES_BIN,
} = {}) {
  if (!directory || !path.isAbsolute(directory))
    throw new Error("A fresh absolute temporary directory is required.");
  if (!binDirectory || !path.isAbsolute(binDirectory))
    throw new Error(
      "Set PRACTICE_NATIVE_POSTGRES_BIN to an explicit absolute native PostgreSQL bin directory.",
    );
  directory = path.resolve(directory);
  if (directory.startsWith("/tmp/"))
    directory = path.join(realpathSync("/tmp"), directory.slice(5));
  binDirectory = path.resolve(binDirectory);
  const dataDirectory = path.join(directory, "data");
  const socketDirectory = path.join(directory, "socket");
  const marker = path.join(directory, "native-postgres-owner.json");
  const id = randomUUID();
  let identity,
    port,
    ownedPostmaster,
    initialized = false,
    claimed = false;
  const evidence = {
    fixtureId: id,
    directory,
    dataDirectory,
    socketDirectory,
    binDirectory,
    syntheticOnly: true,
    events: [],
  };
  const env = nativeTestEnvironment(binDirectory, directory);
  const connectionString = () =>
    port ? `postgresql://postgres@127.0.0.1:${port}/postgres` : undefined;

  async function command(name, args) {
    try {
      const result = await execute(path.join(binDirectory, name), args, {
        env,
        cwd: directory,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      });
      await fs.appendFile(
        path.join(directory, `${name}.log`),
        result.stdout + result.stderr,
      );
      return result.stdout.trim();
    } catch (error) {
      // Preserve PostgreSQL's exact diagnostics, including resource exhaustion.
      await fs.appendFile(
        path.join(directory, `${name}.log`),
        (error.stdout ?? "") + (error.stderr ?? ""),
      );
      evidence.events.push({
        command: name,
        code: error.code,
        signal: error.signal,
        stdout: error.stdout,
        stderr: error.stderr,
      });
      throw error;
    }
  }

  async function assertOwned() {
    if (!claimed) throw new Error("Fixture has not claimed this directory.");
    const owner = JSON.parse(await fs.readFile(marker, "utf8"));
    if (
      owner.fixtureId !== id ||
      owner.dataDirectory !== dataDirectory ||
      owner.port !== port
    )
      throw new Error("Ownership marker mismatch; refusing cluster control.");
    const stat = await fs.lstat(dataDirectory);
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      stat.dev !== identity.dev ||
      stat.ino !== identity.ino ||
      (await fs.realpath(dataDirectory)) !== dataDirectory
    )
      throw new Error(
        "Owned data directory changed; refusing cluster control.",
      );
  }

  async function postmaster() {
    try {
      const lines = (
        await fs.readFile(path.join(dataDirectory, "postmaster.pid"), "utf8")
      ).split("\n");
      const pid = Number(lines[0]);
      if (
        !Number.isSafeInteger(pid) ||
        pid <= 1 ||
        !/^\d+$/.test(lines[2] ?? "") ||
        lines[1] !== dataDirectory ||
        Number(lines[3]) !== port ||
        lines[4] !== socketDirectory ||
        lines[5] !== "127.0.0.1"
      )
        throw new Error(
          "Postmaster ownership mismatch; refusing cluster control.",
        );
      const current = {
        pid,
        startedAt: lines[2],
        dataDirectory: lines[1],
        port: Number(lines[3]),
        socketDirectory: lines[4],
        listenAddress: lines[5],
      };
      if (
        ownedPostmaster &&
        JSON.stringify(current) !== JSON.stringify(ownedPostmaster)
      )
        throw new Error(
          "Postmaster identity changed; refusing cluster control.",
        );
      return current;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function settings() {
    const row = JSON.parse(
      await command("psql", [
        "-X",
        "--no-password",
        connectionString(),
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "SELECT json_build_object('version', version(), 'data_directory', current_setting('data_directory'), 'port', current_setting('port'), 'listen_addresses', current_setting('listen_addresses'), 'unix_socket_directories', current_setting('unix_socket_directories'), 'shared_memory_type', current_setting('shared_memory_type'), 'dynamic_shared_memory_type', current_setting('dynamic_shared_memory_type'), 'server_address', inet_server_addr(), 'server_port', inet_server_port(), 'postmaster_start', pg_postmaster_start_time())",
      ]),
    );
    if (
      row.data_directory !== dataDirectory ||
      Number(row.port) !== port ||
      row.server_port !== port ||
      row.server_address !== "127.0.0.1" ||
      row.listen_addresses !== "127.0.0.1" ||
      row.unix_socket_directories !== socketDirectory
    )
      throw new Error("Server settings do not match the owned cluster.");
    evidence.server = row;
    return row;
  }

  return {
    get connectionString() {
      return connectionString();
    },
    dataDirectory,
    get ownershipEvidence() {
      return structuredClone(evidence);
    },
    async start(initialize = false) {
      if (initialize) {
        if (claimed)
          throw new Error(
            "Initialization is allowed only once in a fresh root.",
          );
        const temporaryRoots = await Promise.all(
          [...new Set(["/tmp", os.tmpdir()])].map((root) => fs.realpath(root)),
        );
        const parent = await fs.realpath(path.dirname(directory));
        if (
          parent !== path.dirname(directory) ||
          !temporaryRoots.some(
            (root) => parent === root || parent.startsWith(root + path.sep),
          )
        )
          throw new Error(
            "Fixture parent must be a canonical system temporary directory.",
          );
        await fs.mkdir(directory, { mode: 0o700 });
        const canonical = await fs.realpath(directory);
        if (
          !temporaryRoots.some((root) =>
            canonical.startsWith(root + path.sep),
          ) ||
          (await fs.lstat(directory)).isSymbolicLink()
        )
          throw new Error(
            "Fixture root must be a real directory under the system temporary directory.",
          );
        // Reject aliased paths so every control check uses the same canonical name.
        if (canonical !== evidence.directory)
          throw new Error(
            "Use the canonical temporary directory path (resolve /tmp symlinks first).",
          );
        if ((await fs.readdir(directory)).length)
          throw new Error(
            "Refusing a nonempty fixture root or existing cluster.",
          );
        for (const name of ["initdb", "pg_ctl", "postgres", "psql", "pg_dump"])
          await fs.access(path.join(binDirectory, name), fs.constants.X_OK);
        port = await nativeTestPort();
        evidence.port = port;
        await fs.writeFile(
          marker,
          JSON.stringify({ fixtureId: id, dataDirectory, port }),
          { flag: "wx", mode: 0o600 },
        );
        claimed = true;
        await fs.mkdir(dataDirectory, { mode: 0o700 });
        identity = await fs.lstat(dataDirectory);
        await fs.mkdir(socketDirectory, { mode: 0o700 });
        evidence.binaryVersion = await command("postgres", ["--version"]);
        await command("initdb", [
          "-D",
          dataDirectory,
          "--username=postgres",
          "--auth-local=trust",
          "--auth-host=trust",
          "--encoding=UTF8",
          "--no-locale",
          "--no-instructions",
          "--no-clean",
        ]);
        initialized = true;
      }
      await assertOwned();
      if (!initialized)
        throw new Error(
          "Initialization did not succeed; refusing to start an incomplete cluster.",
        );
      if (await postmaster())
        throw new Error(
          "Owned cluster already has a postmaster; stop it before restart.",
        );
      ownedPostmaster = undefined;
      // Paths are quoted for pg_ctl's command parser, never evaluated by a shell here.
      const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
      const options = `-h 127.0.0.1 -p ${port} -k ${quote(socketDirectory)} -c unix_socket_permissions=0700 -c max_connections=40 -c shared_buffers=16MB`;
      try {
        await command("pg_ctl", [
          "-D",
          dataDirectory,
          "-l",
          path.join(directory, "postgres.log"),
          "-w",
          "-t",
          "30",
          "-o",
          options,
          "start",
        ]);
      } finally {
        // Capture the launched postmaster even when pg_ctl or SQL readiness fails.
        await assertOwned();
        const current = await postmaster();
        if (current) {
          ownedPostmaster = current;
          evidence.postmaster = current;
        }
      }
      if (!ownedPostmaster)
        throw new Error("Started cluster has no verified postmaster identity.");
      await settings();
      evidence.events.push({
        action: "start",
        initialize,
        at: new Date().toISOString(),
      });
    },
    async stop() {
      if (!claimed || !identity) return;
      await assertOwned();
      if (!(await postmaster())) return;
      if (!ownedPostmaster)
        throw new Error(
          "No launched postmaster identity; refusing cluster control.",
        );
      // Cleanup relies on launch identity and filesystem ownership, even if SQL failed.
      await command("pg_ctl", [
        "-D",
        dataDirectory,
        "-m",
        "fast",
        "-w",
        "-t",
        "30",
        "stop",
      ]);
      ownedPostmaster = undefined;
      evidence.events.push({ action: "stop", at: new Date().toISOString() });
    },
  };
}
