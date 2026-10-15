import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const paths = ["artifacts/comp-dashboard/src/lib/complete-report-coverage.ts", "artifacts/comp-dashboard/src/lib/import-derived-sessions.ts", "artifacts/comp-dashboard/src/lib/retention-local.ts", "artifacts/comp-dashboard/src/lib/practice-financial-range.ts"];

export async function loadScaleModel(frozen = false) {
  const bundle = await require("esbuild").build({ stdin: { contents: paths.map((path) => `export * from ${JSON.stringify("./" + path)};`).join("\n"), loader: "ts", resolveDir: root },
    bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
    plugins: frozen ? [{ name: "deployed-source-only", setup(builder) {
      builder.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
        const relative = args.path.slice(root.length);
        if (!paths.includes(relative)) return;
        return { contents: execFileSync("git", ["show", `254c21cbd9559b54bae295831ef2a380e81fbbf8:${relative}`], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }), loader: "ts", resolveDir: fileURLToPath(new URL("../" + relative.slice(0, relative.lastIndexOf("/") + 1), import.meta.url)) };
      });
    } }] : [] });
  return import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
}
