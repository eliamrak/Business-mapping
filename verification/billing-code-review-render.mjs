import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// Bundle the real component and fetch client; all API traffic is synthetic and intercepted.
const root = fileURLToPath(new URL("../", import.meta.url));
const dashboard = path.join(root, "artifacts/comp-dashboard");
const appRequire = createRequire(path.join(dashboard, "package.json"));
const viteRequire = createRequire(appRequire.resolve("vite/package.json"));
const { build } = viteRequire("esbuild");
let playwright;
for (const location of [process.env.PRACTICE_PLAYWRIGHT_PACKAGE, "/tmp/local-retention-browser-harness/package.json", "/Users/eliam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json"].filter(Boolean)) {
  try { playwright = createRequire(location)("playwright"); break; } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
}
if (!playwright) throw new Error("Set PRACTICE_PLAYWRIGHT_PACKAGE to a package.json with a local Playwright installation.");
const { chromium } = playwright;
const outDir = process.env.PRACTICE_RENDER_OUTPUT ?? "/tmp/billing-code-review-render";
await fs.mkdir(outDir, { recursive: true });
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BillingCodeReview} from './src/components/practice/billing-code-review';
    window.saved=[]; window.renderReview=(revision=0,sourceKey='synthetic')=>root.render(React.createElement(BillingCodeReview,{revision,sourceKey,onSaved:(rows,revision)=>window.saved.push({rows,revision})}));
    const root=createRoot(document.getElementById('root')); window.renderReview();`, resolveDir: dashboard, loader: "tsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: { "@workspace/api-client-react": path.join(root, "lib/api-client-react/src/custom-fetch.ts") },
});
const css = (await Promise.all(["practice-tokens.css", "practice-workspace.css"].map(name => fs.readFile(path.join(dashboard, "src/pages", name), "utf8")))).join("\n");
const html = `<!doctype html><html data-practice-material="tidal"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
body{margin:0;padding:16px;box-sizing:border-box;background:var(--pw-tone-canvas);color:var(--pw-tone-text);font:14px/1.5 system-ui}#root{max-width:920px;margin:auto;min-width:0}.pw-button{max-width:100%;min-height:36px}summary:focus-visible,input:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--pw-tone-positive);outline-offset:2px}</style></head><body><main id="root"></main><script src="/bundle.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].text : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PRACTICE_CHROMIUM_PATH ?? "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  const errors = [], writes = [], captures = [];
  page.on("pageerror", error => errors.push(error.message));
  let revision = 7, rejectNext = false, denyRead = false, malformedRead = false, equivalentConsultations = false, gets = 0;
  const candidate = {
    caseToken: "synthetic-case-token", clientReference: "Synthetic private client A", clinicianLabel: "Synthetic Clinician", serviceDate: "2026-09-12", totalFeeCharged: 175,
    sources: [
      { choiceToken: "synthetic-choice-a", snapshotId: "billing-synthetic-first-source-with-a-long-identifier", sourceHash: "a".repeat(64), importedAt: "2026-10-01T12:00:00Z", billingCode: "90837" },
      { choiceToken: "synthetic-choice-b", snapshotId: "billing-synthetic-second-source", sourceHash: "b".repeat(64), importedAt: "2026-10-02T12:00:00Z", billingCode: "90834" },
    ], canResolve: true, reason: null, resolutionId: null, selectedChoiceToken: null, stale: false,
  };
  const originalSources = structuredClone(candidate.sources);
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, origin, "no external network access");
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const respond = (value, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(value) });
    if (url.pathname === "/api/practice-imports/billing-code-candidates") {
      assert.equal(request.method(), "GET"); gets++;
      if (denyRead) return respond({ error: "Synthetic owner access required" }, 403);
      if (malformedRead) return respond([]);
      return respond({ revision, candidates: equivalentConsultations ? [] : [candidate] });
    }
    assert.equal(request.method(), "POST");
    const payload = request.postDataJSON(); writes.push({ path: url.pathname, payload });
    assert.equal(payload.expectedRevision, revision);
    assert.equal(payload.confirmed, true); assert.ok(payload.approvalNote.trim());
    if (rejectNext) { rejectNext = false; revision++; return respond({ error: "Synthetic stale journal" }, 409); }
    if (url.pathname.endsWith("/revoke")) {
      assert.equal(url.pathname, "/api/practice-imports/billing-code-resolutions/synthetic-resolution/revoke");
      assert.deepEqual(Object.keys(payload).sort(), ["approvalNote", "confirmed", "expectedRevision"]);
      Object.assign(candidate, { resolutionId: null, selectedChoiceToken: null, canResolve: true, stale: false });
    } else {
      assert.equal(url.pathname, "/api/practice-imports/billing-code-resolutions");
      assert.deepEqual(Object.keys(payload).sort(), ["approvalNote", "caseToken", "choiceToken", "confirmed", "expectedRevision"]);
      assert.equal(payload.caseToken, candidate.caseToken);
      assert.ok(candidate.sources.some(source => source.choiceToken === payload.choiceToken));
      Object.assign(candidate, { resolutionId: "synthetic-resolution", selectedChoiceToken: payload.choiceToken, canResolve: false });
    }
    revision++;
    return respond({ billingResolutions: [], billingResolutionRevision: revision });
  });
  const panel = page.locator(".pw-billing-code-review");
  const item = panel.locator("details").first();
  async function open() {
    await panel.locator(":scope > summary").click();
    await item.locator(":scope > summary").click();
  }
  async function chooseAndPreview() {
    assert.equal(await item.locator('input[type="radio"]:checked').count(), 0);
    await item.getByRole("radio").first().focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(await item.getByRole("radio").nth(1).isChecked(), true, "native radio keyboard navigation");
    await item.getByRole("button", { name: "Preview impact", exact: true }).click();
    await item.getByText("One billed charge of $175.00 using 90834.", { exact: true }).waitFor();
    assert.match(await item.innerText(), /does not certify attendance or report coverage/);
    assert.match(await item.innerText(), /Raw sources are retained/);
  }
  async function approve(button) {
    assert.equal(await item.getByRole("button", { name: button, exact: true }).isDisabled(), true);
    await item.getByLabel("Owner approval note", { exact: true }).fill("Synthetic owner reviewed source codes");
    assert.equal(await item.getByRole("button", { name: button, exact: true }).isDisabled(), true);
    await item.getByRole("checkbox").check();
    await item.getByRole("button", { name: button, exact: true }).click();
  }
  async function capture(name, width, zoom = 1) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, zoom);
    const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, width: innerWidth }));
    assert.ok(sizes.scroll <= sizes.client + 1 && sizes.body <= sizes.width + 1, `${name}: no horizontal overflow ${JSON.stringify(sizes)}`);
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
    captures.push({ name, width, zoom, ...sizes });
  }
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector("summary")?.textContent.includes("(1)"));
  assert.equal(await panel.getAttribute("open"), null);
  assert.equal(await item.getAttribute("open"), null);
  assert.equal(writes.length, 0);
  assert.equal(await item.getByText(/Private client reference/).isVisible(), false);
  await open();
  assert.equal(await item.locator("details").getAttribute("open"), null, "provenance starts collapsed on initial load");
  assert.equal(await item.getByText(/Snapshot:/).first().isVisible(), false);
  assert.equal(await item.getByRole("button", { name: "Preview impact", exact: true }).isDisabled(), true);
  assert.equal(await item.getByRole("button", { name: "Apply code choice", exact: true }).count(), 0);
  await chooseAndPreview();
  assert.equal(writes.length, 0, "choosing and previewing never write");
  for (const width of [320, 390, 1440]) await capture(`preview-${width}`, width);
  await capture("preview-200-percent", 1440, 2);
  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  await approve("Apply code choice");
  await panel.getByText("Owner review · Journal revision 8", { exact: true }).waitFor();
  assert.equal(writes.length, 1); assert.equal(writes[0].payload.choiceToken, "synthetic-choice-b");
  assert.deepEqual(await page.evaluate(() => window.saved), [{ rows: [], revision: 8 }]);
  await page.reload(); await open();
  await item.getByRole("button", { name: "Undo code choice", exact: true }).waitFor();
  assert.equal(writes.length, 1, "reload never writes");
  await item.getByRole("button", { name: "Undo code choice", exact: true }).click();
  assert.match(await item.innerText(), /returns this case to an unresolved billing code conflict/);
  assert.match(await item.innerText(), /does not delete any source records/);
  await capture("undo-320", 320);
  await approve("Confirm undo");
  await panel.getByText("Owner review · Journal revision 9", { exact: true }).waitFor();
  await item.locator(":scope > summary").click();
  await chooseAndPreview(); rejectNext = true;
  await approve("Apply code choice");
  await panel.getByRole("alert").waitFor();
  assert.match(await panel.getByRole("alert").innerText(), /old preview is no longer valid/);
  assert.equal(await panel.getByRole("button", { name: "Apply code choice", exact: true }).count(), 0);
  await capture("stale-390", 390);
  await panel.getByRole("button", { name: "Reload billing code conflicts", exact: true }).click();
  await item.locator(":scope > summary").click();
  assert.equal(await item.locator('input[type="radio"]:checked').count(), 0);
  await chooseAndPreview();
  await item.getByRole("radio").first().check();
  assert.equal(await item.getByRole("button", { name: "Apply code choice", exact: true }).count(), 0, "changing code invalidates preview");
  await chooseAgain();
  async function chooseAgain() {
    await item.getByRole("radio").nth(1).check();
    await item.getByRole("button", { name: "Preview impact", exact: true }).click();
    await approve("Apply code choice");
  }
  await panel.getByText("Owner review · Journal revision 11", { exact: true }).waitFor();
  candidate.stale = true;
  await panel.getByRole("button", { name: "Reload billing code conflicts", exact: true }).click();
  await item.locator(":scope > summary").click();
  await item.getByText("Source evidence changed. The previous choice no longer resolves this conflict.", { exact: true }).waitFor();
  await item.getByRole("button", { name: "Undo code choice", exact: true }).click();
  await approve("Confirm undo");
  await panel.getByText("Owner review · Journal revision 12", { exact: true }).waitFor();
  candidate.canResolve = false; candidate.reason = "Synthetic provider mapping requires owner review.";
  await panel.getByRole("button", { name: "Reload billing code conflicts", exact: true }).click();
  await item.locator(":scope > summary").click();
  assert.equal(await item.getByRole("radio").count(), 0);
  assert.equal(await item.getByRole("button", { name: "Preview impact", exact: true }).count(), 0);
  candidate.canResolve = true; candidate.reason = null;
  await panel.getByRole("button", { name: "Reload billing code conflicts", exact: true }).click();
  await item.locator(":scope > summary").click();
  await chooseAndPreview();
  await page.evaluate(() => window.renderReview(12, "changed-synthetic-source"));
  await page.waitForFunction(() => !document.querySelector(".pw-billing-code-review").open);
  await open();
  const provenance = item.locator("details");
  const provenanceSummary = provenance.locator("summary");
  assert.equal(await provenance.getAttribute("open"), null);
  assert.equal(await provenance.getByText(/Snapshot:/).first().isVisible(), false);
  assert.equal(await provenanceSummary.evaluate(node => !!node.closest("fieldset, label")), false);
  for (const [index, source] of candidate.sources.entries()) {
    assert.ok(await item.getByRole("radio").nth(index).isVisible());
    assert.ok((await item.locator("fieldset label").nth(index).innerText()).includes(`Source ${index + 1} · Imported ${source.importedAt.slice(0, 10)}`));
    assert.ok(await item.locator("fieldset").getByText(source.billingCode, { exact: true }).isVisible());
  }
  await provenanceSummary.focus(); await page.keyboard.press("Enter");
  for (const source of candidate.sources) {
    const sourceDetails = provenance.getByText(new RegExp(source.snapshotId));
    assert.ok(await sourceDetails.isVisible());
    assert.ok((await sourceDetails.innerText()).includes(source.importedAt));
    assert.ok((await sourceDetails.innerText()).includes(source.sourceHash));
  }
  assert.equal(await item.locator('input[type="radio"]:checked').count(), 0);
  await capture("provenance-390", 390);
  await provenanceSummary.focus(); await page.keyboard.press("Space");
  assert.equal(await provenance.getAttribute("open"), null);
  await provenanceSummary.tap();
  for (const source of candidate.sources) assert.ok(await provenance.getByText(new RegExp(source.sourceHash)).isVisible());
  assert.equal(await item.locator('input[type="radio"]:checked').count(), 0);
  await capture("provenance-320", 320);
  await capture("provenance-200-percent", 1440, 2);
  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  await provenanceSummary.tap();
  assert.equal(await provenance.getAttribute("open"), null);
  assert.equal(await item.locator('input[type="radio"]:checked').count(), 0, "source changes discard old selection");
  assert.equal(await item.getByRole("button", { name: "Apply code choice", exact: true }).count(), 0);
  const writesBeforeDeniedRead = writes.length;
  denyRead = true;
  await panel.getByRole("button", { name: "Reload billing code conflicts", exact: true }).click();
  await panel.getByRole("alert").waitFor();
  assert.match(await panel.getByRole("alert").innerText(), /Owner access is required/);
  assert.equal(await panel.getByRole("radio").count(), 0);
  assert.equal(writes.length, writesBeforeDeniedRead);
  denyRead = false; malformedRead = true;
  await panel.getByRole("button", { name: "Reload billing code conflicts", exact: true }).click();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getByRole("radio").count(), 0);
  assert.equal(await panel.isVisible(), true, "malformed response leaves the review card mounted");
  assert.equal(writes.length, writesBeforeDeniedRead);
  malformedRead = false;
  await panel.getByRole("button", { name: "Reload billing code conflicts", exact: true }).click();
  await panel.getByText("Owner review · Journal revision 12", { exact: true }).waitFor();
  await item.locator(":scope > summary").click();
  assert.equal(await item.getByRole("radio").count(), 2, "reload recovers from malformed response");
  assert.equal(await item.locator('input[type="radio"]:checked').count(), 0);
  assert.deepEqual(candidate.sources, originalSources);
  assert.doesNotMatch(await panel.innerText(), /sourceRowHash|synthetic-choice|synthetic-case-token/);
  candidate.serviceDate = "2026-10-08";
  candidate.totalFeeCharged = 0;
  candidate.sources.splice(0, candidate.sources.length, ...["PHONE", "0", "0"].map((billingCode, index) => ({
    choiceToken: `synthetic-free-choice-${index}`, snapshotId: `billing-synthetic-free-${index}`,
    sourceHash: String(index + 1).repeat(64), importedAt: ["2026-10-13", "2026-10-16", "2026-10-22"][index] + "T12:00:00Z", billingCode,
  })));
  const freeSources = structuredClone(candidate.sources), writesBeforeFreePreview = writes.length;
  equivalentConsultations = true;
  await panel.getByRole("button", { name: "Reload billing code conflicts", exact: true }).click();
  await panel.getByText("No billing code conflicts require review.", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("radio").count(), 0);
  assert.equal(await panel.getByRole("button", { name: "Apply code choice", exact: true }).count(), 0);
  for (const width of [320, 390, 1440]) {
    await capture(`equivalent-consultations-no-choice-${width}`, width);
  }
  assert.equal(writes.length, writesBeforeFreePreview);
  assert.deepEqual(candidate.sources, freeSources);
  assert.deepEqual(errors, []);
  const results = { syntheticOnly: true, externalAccess: false, actualMountedComponent: true, automaticWrites: 0, explicitWrites: writes.length, candidateReads: gets, callbacks: await page.evaluate(() => window.saved), sourceFactsUnchanged: true, captures, browserErrors: errors };
  await fs.writeFile(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ...results, outDir }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
