import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "..");
const out = path.resolve(root, "../tidal-preview/integrated");
await fs.mkdir(out, { recursive: true });
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const fixture = JSON.parse(await fs.readFile(path.join(root, "verification/fixtures/tidal-workspace.json"), "utf8"));
const { workspace, context, snapshots, packages, goals } = fixture;
let revision = 1;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{TooltipProvider}from'@/components/ui/tooltip';import PracticeWorkspace from '@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><PracticeWorkspace/></TooltipProvider></QueryClientProvider>);`;
const build = source => require("esbuild").build({ stdin: { contents: entry, loader: "tsx", resolveDir: path.join(source, "artifacts/comp-dashboard") }, bundle: true, write: false, minify: true, platform: "browser", format: "esm", jsx: "automatic", loader: { ".png": "file", ".jpg": "file" }, alias: { "@": path.join(source, "artifacts/comp-dashboard/src") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"BASE_URL":"/"}' }, outdir: out });
const bundle = await build(root);
const baselineRoot = path.resolve(root, "../practice-app-durable-history");
const baseline = await build(baselineRoot);
const builtIndex = await fs.readFile(path.join(root, "artifacts/comp-dashboard/dist/public/index.html"), "utf8");
const cssName = builtIndex.match(/href="\/assets\/(index-[^"]+\.css)"/)[1];
const css = (await fs.readFile(path.join(root, "artifacts/comp-dashboard/dist/public/assets", cssName), "utf8")) + bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).contents;
const oldIndex = await fs.readFile(path.join(baselineRoot, "artifacts/comp-dashboard/dist/public/index.html"), "utf8");
const oldCss = oldIndex.match(/href="\/assets\/(index-[^"]+\.css)"/)[1];
const baselineCss = (await fs.readFile(path.join(baselineRoot, "artifacts/comp-dashboard/dist/public/assets", oldCss), "utf8")) + baseline.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n");
const assets = new Map(bundle.outputFiles.filter(file => /\.(jpg|png)$/.test(file.path)).map(file => ["/" + path.basename(file.path), file.contents]));
const textAssets = new Map([
  ["/app.js", [gzipSync(js), "text/javascript"]],
  ["/baseline.js", [gzipSync(baseline.outputFiles.find(file => file.path.endsWith(".js")).contents), "text/javascript"]],
  ["/base.css", [gzipSync(css), "text/css"]],
  ["/baseline.css", [gzipSync(baselineCss), "text/css"]],
]);
await fs.writeFile(path.join(out, "app.js"), js);
await fs.writeFile(path.join(out, "base.css"), css);
await fs.writeFile(path.join(out, "fixture.json"), JSON.stringify(fixture));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Practice Tidal — owned source preview</title><link rel="stylesheet" href="/base.css"><style>body{margin:0}.preview-label{background:#082d42;color:#e1f0f5;text-align:center;font:600 10px/24px sans-serif}</style></head><body><aside class="preview-label">DESIGN PREVIEW · SYNTHETIC DATA · NOT LIVE</aside><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(req.method)) {
        if (url.pathname !== "/api/hub" || !["POST", "PUT"].includes(req.method)) { res.writeHead(405); return res.end(); }
        let text = ""; for await (const chunk of req) text += chunk;
        Object.assign(workspace, JSON.parse(text).data); revision++;
      }
      const data = url.pathname === "/api/hub" ? { revision, data: workspace, updatedAt: "2026-10-14T00:00:00Z" } : url.pathname === "/api/hub/context" ? context : url.pathname === "/api/practice-imports" ? { snapshots, packages, billingCodeMinutes: {}, sameDayVisitOverrides: {}, declarations: null } : url.pathname === "/api/practice-imports/billing-resolution-candidates" ? { revision: 0, candidates: [] } : url.pathname === "/api/business-goals" ? goals : ["/api/scenarios", "/api/session-goals"].includes(url.pathname) ? [] : { ok: true };
      res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); return res.end(JSON.stringify(data));
    }
    if (textAssets.has(url.pathname)) { const [bytes, type] = textAssets.get(url.pathname); res.setHeader("Content-Type", type); res.setHeader("Content-Encoding", "gzip"); res.setHeader("Cache-Control", "public,max-age=3600"); return res.end(bytes); }
    if (assets.has(url.pathname)) { res.setHeader("Content-Type", url.pathname.endsWith(".jpg") ? "image/jpeg" : "image/png"); res.setHeader("Cache-Control", "public,max-age=3600"); return res.end(assets.get(url.pathname)); }
    if (url.pathname.startsWith("/assets/") && /^\/assets\/[\w.-]+$/.test(url.pathname)) {
      res.setHeader("Content-Type", url.pathname.endsWith(".jpg") ? "image/jpeg" : "image/png"); return res.end(await fs.readFile(path.join(root, "artifacts/comp-dashboard/dist/public", url.pathname)));
    }
    res.setHeader("Content-Type", "text/html"); res.end(url.pathname === "/baseline" ? html.replace("/base.css", "/baseline.css").replace("/app.js", "/baseline.js") : html);
  } catch (error) { res.writeHead(500); res.end(String(error.message)); }
});
server.listen(4183, "127.0.0.1", () => console.log("Owned-source preview http://127.0.0.1:4183"));
