import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { isolatedDatabaseBundle, assertIsolatedDatabaseBundle } from "./isolated-database-bundle.mjs";

const { build } = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("esbuild");

test("symlinked dependencies cannot create a second route pool outside the disposable checkout", async () => {
  const root = await fs.mkdtemp("/tmp/practice-bundle-regression-");
  const repo = path.join(root, "checkout");
  const installed = path.join(root, "installed");
  for (const dir of [repo, installed]) {
    await fs.mkdir(path.join(dir, "lib/db/src/schema"), { recursive: true });
    await fs.writeFile(path.join(dir, "lib/db/package.json"), JSON.stringify({ name: "@workspace/db", type: "module", exports: { ".": "./src/index.ts", "./schema": "./src/schema/index.ts" } }));
    await fs.writeFile(path.join(dir, "lib/db/src/index.ts"), "export const pool = { synthetic: true };\n");
    await fs.writeFile(path.join(dir, "lib/db/src/schema/index.ts"), "export const schema = { synthetic: true };\n");
  }
  await fs.mkdir(path.join(repo, "node_modules/@workspace"), { recursive: true });
  await fs.symlink(path.join(installed, "lib/db"), path.join(repo, "node_modules/@workspace/db"));
  await fs.writeFile(path.join(repo, "route.ts"), "export { pool } from '@workspace/db'; export { schema } from '@workspace/db/schema';\n");
  const options = { stdin: { contents: "export { pool as routePool } from './route.ts'; export { pool as cleanupPool } from './lib/db/src/index.ts';", resolveDir: repo, loader: "ts" }, absWorkingDir: repo, bundle: true, write: false, metafile: true, platform: "node", format: "esm", logLevel: "silent" };
  const old = await build(options);
  assert.throws(() => assertIsolatedDatabaseBundle(old.metafile, repo), /exactly one database module/);
  const oldModule = await import("data:text/javascript;base64," + Buffer.from(old.outputFiles[0].text).toString("base64"));
  assert.notEqual(oldModule.routePool, oldModule.cleanupPool);
  const fixed = await build({ ...options, plugins: [isolatedDatabaseBundle(repo)] });
  assertIsolatedDatabaseBundle(fixed.metafile, repo);
  const fixedModule = await import("data:text/javascript;base64," + Buffer.from(fixed.outputFiles[0].text).toString("base64"));
  assert.equal(fixedModule.routePool, fixedModule.cleanupPool);
  assert.ok(Object.keys(fixed.metafile.inputs).filter(name => name.endsWith("schema/index.ts")).every(name => !name.includes("installed")));
});
