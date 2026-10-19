import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import path from "node:path";

export function isolatedDatabaseBundle(repo) {
  return {
    name: "isolated-test-database",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db(?:\/schema)?$/ }, ({ path: name }) => ({
        path: realpathSync(path.join(repo, "lib/db/src", name.endsWith("/schema") ? "schema/index.ts" : "index.ts")),
      }));
    },
  };
}

export function assertIsolatedDatabaseBundle(metafile, repo) {
  const inputs = Object.keys(metafile.inputs).filter(name => /(?:^|\/)lib\/db\/src\/index\.ts$/.test(name));
  assert.equal(inputs.length, 1, "Route and cleanup must share exactly one database module/pool.");
  assert.equal(realpathSync(path.resolve(repo, inputs[0])), realpathSync(path.join(repo, "lib/db/src/index.ts")), "The shared pool must belong to the disposable checkout.");
}
