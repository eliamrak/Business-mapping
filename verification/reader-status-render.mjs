import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const { build } = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url))("esbuild");
const { chromium } = createRequire("/tmp/local-retention-browser-harness/package.json")("playwright");
const out = mkdtempSync(path.join(tmpdir(), "reader-status-render-"));
const component = path.join(root, "artifacts/comp-dashboard/src/components/practice/reader-status.tsx");
const bundled = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReaderStatus} from ${JSON.stringify(component)};createRoot(document.getElementById('root')).render(<ReaderStatus/>);`, resolveDir: path.join(root, "artifacts/comp-dashboard"), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic", alias: { "@": path.join(root, "artifacts/comp-dashboard/src") }, define: { "process.env.NODE_ENV": '"test"' } });
const assets = path.join(root, "artifacts/comp-dashboard/dist/public/assets");
const css = readFileSync(path.join(assets, readdirSync(assets).find(file => /^index-.*\.css$/.test(file))));
const valid = { readerProtocol: "legacy-codes-late-cancellation-v1", packageFormat: "emc-practice-local-import-package", packageVersion: 1, cancellationSubtypes: ["late_cancelled"], billingCodeEncoding: "string-or-null", unclassifiedZero: { storedCode: "0", defaultMinutes: null, equivalentToFiveZeros: false }, serviceCodes: { "1": { kind: "treatment", minutes: 75 }, "2": { kind: "documentation", minutes: 0 }, "4": { kind: "treatment", minutes: 30 }, "30001": { kind: "treatment", minutes: 60 }, "30002": { kind: "treatment", minutes: 90 }, "30003": { kind: "consultation", minutes: 25 } } };
let mode = "valid", releasePending;
const requests = [], errors = [];
const server = http.createServer(async (req, res) => {
  requests.push({ method: req.method, url: req.url });
  if (req.url === "/api/practice-imports/capabilities") {
    if (mode === "pending") await new Promise(resolve => { releasePending = resolve; });
    res.setHeader("Content-Type", "application/json");
    if (mode === "denied") { res.statusCode = 403; return res.end('{"error":"synthetic denied"}'); }
    return res.end(JSON.stringify(mode === "invalid" ? {} : valid));
  }
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundled.outputFiles[0].contents); }
  if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body style="background:#0b1015;color:#edf2f7;padding:24px"><main class="pw-app"><section class="pw-local-retention" id="root"></section></main><script type="module" src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell", headless: true });
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  mode = "pending";
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const detail = page.getByLabel("Reader status", { exact: true });
  await page.getByText("Checking", { exact: true }).waitFor();
  await detail.locator("summary").click();
  assert.equal(await page.getByRole("button", { name: "Refresh reader status" }).isDisabled(), true);
  mode = "valid"; releasePending();
  await page.getByText("Compatible", { exact: true }).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 700 });
    assert.equal(await page.getByText("legacy-codes-late-cancellation-v1", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("Unconfigured", { exact: true }).isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: path.join(out, `reader-status-${width}.png`) });
  }
  for (const [next, expected] of [["invalid", "Unverified"], ["denied", "Unavailable"], ["valid", "Compatible"]]) {
    mode = next;
    await page.getByRole("button", { name: "Refresh reader status" }).click();
    await page.getByText(expected, { exact: true }).waitFor();
    if (next !== "valid") assert.equal(await page.getByText("legacy-codes-late-cancellation-v1", { exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  assert.ok(requests.every(req => req.method === "GET"));
  writeFileSync(path.join(out, "results.json"), JSON.stringify({ syntheticOnly: true, states: ["Checking", "Compatible", "Unverified", "Unavailable", "Compatible after retry"], viewports: [1280, 390], automaticWrites: 0, browserErrors: errors, requests }, null, 2));
  console.log(JSON.stringify({ out, automaticWrites: 0, browserErrors: errors, states: 5, screenshots: 2 }));
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
