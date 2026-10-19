import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { recoveryWorkspacePlugins, assertRecoveryWorkspaceSources } from "./native-abrupt-recovery.mjs";

const { build } = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("esbuild");

async function workspace(t) {
  const root = await fs.mkdtemp("/tmp/native-recovery-bundle-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, "checkout");
  const installed = path.join(root, "installed");
  for (const [directory, value] of [[checkout, "reviewed"], [installed, "foreign"]]) {
    const packages = {
      db: { ".": "./src/index.ts", "./schema": "./src/schema/index.ts" },
      practice: { ".": "./src/index.ts", "./hub": "./src/hub/index.ts", "./compensation": "./src/compensation.ts" },
      "api-zod": { ".": "./src/index.ts" },
    };
    for (const [name, exports] of Object.entries(packages)) {
      const pkg = path.join(directory, "lib", name);
      await fs.mkdir(pkg, { recursive: true });
      await fs.writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: `@workspace/${name}`, type: "module", exports }));
      for (const entry of Object.values(exports)) {
        const filename = path.join(pkg, entry);
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, `export const marker = ${JSON.stringify(value)}; export const pool = {};\n`);
      }
    }
  }
  await fs.mkdir(path.join(installed, "node_modules/@workspace"), { recursive: true });
  for (const name of ["db", "practice", "api-zod"])
    await fs.symlink(path.join(installed, "lib", name), path.join(installed, "node_modules/@workspace", name));
  await fs.symlink(path.join(installed, "node_modules"), path.join(checkout, "node_modules"));
  const options = { absWorkingDir: checkout, bundle: true, write: false, metafile: true, platform: "node", format: "esm", logLevel: "silent" };
  const compile = (contents, plugins = []) => build({ ...options, stdin: { contents, resolveDir: checkout, loader: "ts" }, plugins });
  return { checkout, installed, compile };
}

test("recovery aliases bind DB and every practice export to the reviewed checkout through symlinked dependencies", async (t) => {
  const { checkout, compile } = await workspace(t);
  const contents = `
    export { pool as routePool } from '@workspace/db';
    export { pool as localPool } from './lib/db/src/index.ts';
    export { marker as schema } from '@workspace/db/schema';
    export { marker as practice } from '@workspace/practice';
    export { marker as hub } from '@workspace/practice/hub';
    export { marker as compensation } from '@workspace/practice/compensation';
    export { marker as apiSchema } from '@workspace/api-zod';
  `;
  const previous = await compile(contents);
  assert.throws(() => assertRecoveryWorkspaceSources(previous.metafile, checkout), /outside the reviewed checkout/);
  const built = await compile(contents, recoveryWorkspacePlugins(checkout));
  assertRecoveryWorkspaceSources(built.metafile, checkout, { databasePool: true });
  const module = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
  assert.equal(module.routePool, module.localPool);
  for (const name of ["schema", "practice", "hub", "compensation", "apiSchema"])
    assert.equal(module[name], "reviewed");
});

test("metafile guard rejects foreign runtime sources that bypass package aliases", async (t) => {
  const { checkout, installed, compile } = await workspace(t);
  const source = path.join(installed, "lib/practice/src/hub/index.ts");
  const built = await compile(`export * from ${JSON.stringify(source)};`, recoveryWorkspacePlugins(checkout));
  assert.throws(() => assertRecoveryWorkspaceSources(built.metafile, checkout), /outside the reviewed checkout/);
});

test("metafile guard checks real source paths and rejects workspace imports left external", async (t) => {
  const { checkout, installed, compile } = await workspace(t);
  const local = path.join(checkout, "lib/practice/src/hub/index.ts");
  await fs.unlink(local);
  await fs.symlink(path.join(installed, "lib/practice/src/hub/index.ts"), local);
  const built = await compile("export * from '@workspace/practice/hub';", recoveryWorkspacePlugins(checkout));
  assert.throws(() => assertRecoveryWorkspaceSources(built.metafile, checkout), /outside the reviewed checkout/);
  const external = await compile("export * from '@workspace/practice';", [{ name: "synthetic-external", setup(builder) {
    builder.onResolve({ filter: /^@workspace\// }, ({ path }) => ({ path, external: true }));
  } }]);
  assert.throws(() => assertRecoveryWorkspaceSources(external.metafile, checkout), /must be bundled/);
});

test("metafile guard permits external dependencies but rejects foreign workspace sources beneath node_modules", async (t) => {
  const { checkout, installed, compile } = await workspace(t);
  const dependency = path.join(installed, "node_modules/synthetic-dependency/index.js");
  await fs.mkdir(path.dirname(dependency), { recursive: true });
  await fs.writeFile(dependency, "export const marker = 'dependency';\n");
  const built = await compile(`export * from ${JSON.stringify(dependency)};`);
  assertRecoveryWorkspaceSources(built.metafile, checkout);
  const foreign = path.join(installed, "node_modules/@workspace/foreign/index.js");
  await fs.mkdir(path.dirname(foreign), { recursive: true });
  await fs.writeFile(foreign, "export const marker = 'foreign';\n");
  const unreviewed = await compile(`export * from ${JSON.stringify(foreign)};`);
  assert.throws(() => assertRecoveryWorkspaceSources(unreviewed.metafile, checkout), /outside the reviewed checkout/);
});
