import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL)
  throw new Error(
    "Set DATABASE_URL to an isolated local development database.",
  );
const database = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname))
  throw new Error("Local development must use an isolated local database.");
const apiPort = Number(process.env.LOCAL_API_PORT ?? 4318);
const webPort = Number(process.env.LOCAL_WEB_PORT ?? 4317);
const logs = path.join(root, ".local/dev");
mkdirSync(logs, { recursive: true });
for (const port of [apiPort, webPort]) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}
const children = [];
function start(name, args, env) {
  const output = openSync(path.join(logs, `${name}.log`), "a");
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", output, output],
  });
  children.push(child);
  closeSync(output);
  child.unref();
  return child.pid;
}
async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* The child is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready: ${url}. See ${logs}.`);
}
try {
  const apiPid = start("api", ["artifacts/api-server/dist/index.mjs"], {
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    LOCAL_PREVIEW: "true",
    PORT: String(apiPort),
    DATABASE_URL: database.toString(),
    SEED_DEMO_DATA: "false",
  });
  const webPid = start(
    "web",
    [
      "artifacts/comp-dashboard/node_modules/vite/bin/vite.js",
      "--config",
      "artifacts/comp-dashboard/vite.config.ts",
      "--host",
      "127.0.0.1",
      "--strictPort",
    ],
    {
      NODE_ENV: "development",
      PORT: String(webPort),
      BASE_PATH: "/",
      API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      VITE_LOCAL_PREVIEW: "true",
    },
  );
  await waitFor(`http://127.0.0.1:${apiPort}/api/healthz`);
  await waitFor(`http://127.0.0.1:${webPort}/practice`);
  writeFileSync(
    path.join(logs, "processes.json"),
    JSON.stringify({ apiPid, webPid, apiPort, webPort }, null, 2),
  );
  console.log(
    JSON.stringify(
      { url: `http://127.0.0.1:${webPort}/practice`, apiPid, webPid, logs },
      null,
      2,
    ),
  );
} catch (error) {
  for (const child of children) child.kill();
  throw error;
}
