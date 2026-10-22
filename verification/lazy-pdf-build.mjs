import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "artifacts/comp-dashboard/package.json"));
const out = path.resolve(root, "../lazy-pdf-export-evidence/production");
const baseline = "/tmp/practice-tidal-public-repro-fKvp4n/artifacts/comp-dashboard/dist/public";
const previous = await fs.readFile(path.join(baseline, "assets/index-C-H583OO.js"));
const keys = [...new Set([...previous.toString().matchAll(/pk_live_[A-Za-z0-9]+/g)].map(m => m[0]))];
if (keys.length !== 1) throw Error("Expected one verified public bootstrap key");
for (const key of Object.keys(process.env)) if (key.startsWith("VITE_")) delete process.env[key];
Object.assign(process.env, { PORT: "23894", BASE_PATH: "/", NODE_ENV: "production", VITE_CLERK_PUBLISHABLE_KEY: keys[0], VITE_CLERK_PROXY_URL: "/api/__clerk" });
const { build } = await import(require.resolve("vite"));
const graph = [];
await build({ configFile: path.join(root, "artifacts/comp-dashboard/vite.config.ts"), build: { outDir: out, manifest: true, rollupOptions: { plugins: [{ name: "pdf-split-evidence", generateBundle(_options, bundle) {
  for (const [file, value] of Object.entries(bundle)) if (value.type === "chunk") graph.push({ file, entry: value.isEntry, imports: value.imports, dynamicImports: value.dynamicImports, pdfModules: Object.keys(value.modules).filter(id => /\/node_modules\/.*\/(jspdf|jspdf-autotable)\//.test(id)).map(id => id.slice(id.indexOf("node_modules/"))) });
} }] } } });
const initial = new Set();
function visit(file) { if (initial.has(file)) return; initial.add(file); for (const dependency of graph.find(g => g.file === file)?.imports ?? []) visit(dependency); }
// Rollup also reports worker entry chunks; only HTML module roots and their
// static imports belong to page startup, not a worker created by a later action.
const html = await fs.readFile(path.join(out, "index.html"), "utf8");
const htmlRoots = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1].replace(/^\//, "")).filter(file => graph.some(g => g.file === file));
if (!htmlRoots.length) throw Error("No initial HTML module graph found");
for (const file of htmlRoots) visit(file);
const files = await Promise.all([...initial].map(async file => { const bytes = await fs.readFile(path.join(out, file)); return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: createHash("sha256").update(bytes).digest("hex") }; }));
const result = { publicInputsOnly: true, htmlRoots, baseline: { file: "index-C-H583OO.js", bytes: previous.length, gzipBytes: gzipSync(previous).length, sha256: createHash("sha256").update(previous).digest("hex") }, initial: files, initialBytes: files.reduce((n,f) => n + f.bytes, 0), initialGzipBytes: files.reduce((n,f) => n + f.gzipBytes, 0), initialPdfModules: graph.filter(g => initial.has(g.file)).flatMap(g => g.pdfModules), graph };
if (result.initialPdfModules.length) throw Error("PDF runtime still occurs in initial dependency graph");
await fs.writeFile(path.resolve(root, "../lazy-pdf-export-evidence/build.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, graph: undefined }, null, 2));
