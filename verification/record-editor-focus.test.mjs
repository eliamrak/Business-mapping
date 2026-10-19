import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { after, afterEach, before, beforeEach, test as nodeTest } from "node:test";

const repo = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(repo, "artifacts/api-server/package.json"));
const { build } = require("esbuild");
const { chromium } = createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE ?? "/tmp/forge-reviewed-da6f1d2c-stage/package.json")("playwright");
const out = await fs.mkdtemp(path.join(await fs.realpath("/tmp"), "record-editor-focus-"));
const browserErrors = [], requests = [], results = [];
const runs = [];
const setup = { status: "not-started", stage: "Not started." };
let activeRun;
let browser, server, page, settingsPage, base;

function stage(message) {
  activeRun.stage = message;
  activeRun.stages.push({ message, at: new Date().toISOString() });
  console.log(`${activeRun.name}: ${message}`);
}

function test(name, options, body) {
  return nodeTest(name, options, async (context) => {
    try { await body(context); activeRun.status = "pass"; }
    catch (error) {
      activeRun.status = "fail";
      activeRun.error = error.message;
      throw error;
    }
  });
}

async function diagnostics() {
  return page.evaluate(() => ({
    focus: document.activeElement?.outerHTML,
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => ({
      title: document.getElementById(node.getAttribute("aria-labelledby"))?.textContent,
      text: node.textContent,
    })),
    invalid: [...document.querySelectorAll("input, select, textarea")].filter(node => !node.validity.valid).map(node => ({
      labels: [...node.labels].map(label => label.textContent), type: node.type,
      value: node.value, required: node.required, message: node.validationMessage,
    })),
    errors: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
    callbacks: { closes: window.fixture?.closes, saves: window.fixture?.saves },
    nativeZoom: devicePixelRatio,
  }));
}

before(async () => {
  setup.status = "running";
  setup.stage = "Bundle the actual RecordEditor with synthetic data.";
  console.log("Focused fixture setup: bundle the actual RecordEditor with synthetic data.");
  const bundled = await build({
    stdin: { loader: "tsx", resolveDir: path.join(repo, "artifacts/comp-dashboard"), contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import RecordEditor from '@/components/hub/record-editor';
      import {emptyWorkspace, categorySchema, periodSchema} from '@workspace/practice/hub';
      import {newRecord} from '@/components/hub/config';
      const workspace = emptyWorkspace('2026-10-01');
      const category = categorySchema.parse({id: crypto.randomUUID(), name: 'Synthetic category', kind: 'expense', tags: ['synthetic']});
      const period = periodSchema.parse({id: crypto.randomUUID(), name: 'Synthetic finalized period', start: '2026-10-01', end: '2026-10-31', status: 'finalized', correctionReason: 'Synthetic original correction'});
      workspace.categories.push(category); workspace.periods.push(period);
      window.fixture = {closes: 0, saves: [], failSave: false, holdSave: false};
      function App() {
        const [editing, setEditing] = useState(null);
        const open = (collection, record) => { window.fixture.closes = 0; window.fixture.saves = []; setEditing({collection, record}); };
        return <>
          <button onClick={() => open('rules', newRecord('rules', workspace, '2026-10-01'))}>New decision rule</button>
          <button onClick={() => open('categories', category)}>Edit category</button>
          <button onClick={() => open('periods', period)}>Edit finalized period</button>
          {editing && <RecordEditor {...editing} workspace={workspace} context={{clinicians: [], staff: [], sessions: []}} theme="light"
            onClose={() => { window.fixture.closes++; setEditing(null); }}
            onSave={async (record, corrections) => {
              window.fixture.saves.push({record, corrections});
              if (window.fixture.holdSave) await new Promise(resolve => { window.fixture.finishSave = resolve; });
              if (window.fixture.failSave) throw new Error('Synthetic save failure; draft retained.');
            }} />}
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic",
    alias: { "@": path.join(repo, "artifacts/comp-dashboard/src") }, define: { "process.env.NODE_ENV": '"test"' },
  });
  console.log("Focused fixture setup: bundle ready; load existing CSS and bind disposable loopback server.");
  setup.stage = "Load existing CSS and bind the disposable loopback server.";
  const assets = path.join(repo, "artifacts/comp-dashboard/dist/public/assets");
  const css = await fs.readFile(path.join(assets, (await fs.readdir(assets)).find(file => /^index-.*\.css$/.test(file))));
  server = http.createServer((request, response) => {
    const isBundle = request.url === "/bundle.js", isCss = request.url === "/styles.css";
    response.setHeader("content-type", isBundle ? "text/javascript" : isCss ? "text/css" : "text/html");
    response.end(isBundle ? bundled.outputFiles[0].contents : isCss ? css : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  base = `http://127.0.0.1:${server.address().port}`;
  console.log("Focused fixture setup: loopback server ready; launch one owned Chrome profile.");
  setup.stage = "Launch one owned Chrome profile and prepare native zoom settings.";
  const profile = path.join(out, "owned-chrome-profile");
  browser = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.PRACTICE_FULL_CHROME ?? "/Users/eliam/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1,
  });
  settingsPage = browser.pages()[0];
  await settingsPage.goto("chrome://settings/appearance");
  await settingsPage.locator("#zoomLevel").waitFor();
  setup.status = "pass";
}, { timeout: 60000 });

beforeEach(async (context) => {
  activeRun = { name: context.name, status: "running", stages: [] };
  runs.push(activeRun);
  stage("Create a fresh synthetic page and reset native zoom to 100%.");
  await settingsPage.locator("#zoomLevel").selectOption("1");
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(10000);
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.route("**/*", route => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url() });
    return request.method() === "GET" && new URL(request.url()).origin === base ? route.continue() : route.abort();
  });
  await page.goto(base);
  await page.waitForFunction(() => window.fixture && devicePixelRatio === 1);
  stage("Fresh page ready; callback spies and form state are isolated.");
}, { timeout: 15000 });

afterEach(async () => {
  if (!activeRun) return;
  if (activeRun.status === "running") activeRun.status = "interrupted";
  try {
    if (page && !page.isClosed()) {
      activeRun.finalState = await diagnostics();
      if (activeRun.status !== "pass") {
        const screenshot = `failure-${runs.length}.png`;
        await page.screenshot({ path: path.join(out, screenshot), timeout: 3000 });
        activeRun.screenshot = screenshot;
      }
    }
  } catch (error) { activeRun.diagnosticsError = error.message; }
  finally {
    // Closing this test's page cancels pending actions and cannot discard another test's draft.
    if (page && !page.isClosed()) await page.close({ runBeforeUnload: false });
    page = null;
    await fs.writeFile(path.join(out, "stages.json"), JSON.stringify(runs, null, 2));
  }
}, { timeout: 10000 });

after(async () => {
  if (setup.status === "running") setup.status = "failed";
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  const source = await fs.readFile(path.join(repo, "artifacts/comp-dashboard/src/components/hub/record-editor.tsx"));
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify({
    syntheticOnly: true, productionAccess: false, actualScreenReader: false,
    mechanism: "Isolated actual RecordEditor and unchanged shared Dialog in Chrome for Testing, using native page zoom; synthetic callback spies, no database or API.",
    sourceSha256: createHash("sha256").update(source).digest("hex"), setup, results, runs, browserErrors, requests,
  }, null, 2));
  console.log(`RecordEditor focus evidence: ${out}`);
});

async function focused(locator) {
  await locator.waitFor({ state: "visible" });
  const element = await locator.elementHandle();
  try { await page.waitForFunction(node => node === document.activeElement, element); }
  finally { await element.dispose(); }
  assert.ok(await locator.evaluate(node => node === document.activeElement), "Expected control must have keyboard focus.");
}
async function open(name) {
  stage(`Open ${name} with the keyboard.`);
  const opener = page.getByRole("button", { name, exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  return opener;
}
async function calls(closes, saves) {
  assert.deepEqual(await page.evaluate(() => [window.fixture.closes, window.fixture.saves.length]), [closes, saves]);
}
async function keep() {
  stage("Verify Keep editing receives focus, then resume editing.");
  await focused(page.getByRole("button", { name: "Keep editing", exact: true }));
  await page.keyboard.press("Enter");
}

for (const factor of [1, 2, 4]) {
  test(`dirty decision rule confirmation and final opener restoration at native ${factor * 100}% zoom`, { timeout: 30000 }, async () => {
    await settingsPage.locator("#zoomLevel").selectOption(String(factor));
    await page.waitForFunction(value => Math.abs(devicePixelRatio - value) < 0.01, factor);
    assert.deepEqual(page.viewportSize(), { width: 1280, height: 900 });
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight, visualViewport.scale, getComputedStyle(document.body).zoom]), [1280 / factor, 900 / factor, 1, "1"]);
    const opener = await open("New decision rule");
    const dialog = page.getByRole("dialog");
    const name = dialog.getByLabel("Name", { exact: true });
    await name.fill("Synthetic unsaved rule");
    await name.evaluate(node => { window.originalField = node; node.setSelectionRange(2, 8); });
    await page.keyboard.press("Escape");
    const confirmation = page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true });
    await confirmation.waitFor();
    await focused(confirmation.getByRole("button", { name: "Keep editing", exact: true }));
    const description = await confirmation.evaluate(node => document.getElementById(node.getAttribute("aria-describedby"))?.textContent);
    assert.equal(description, "Your changes have not been saved. Keep editing to continue, or discard them to close this record.");
    assert.equal(await confirmation.getByRole("textbox", { name: "Name", exact: true }).count(), 0);
    assert.ok(await page.evaluate(() => window.originalField.isConnected && window.originalField.closest("form").hidden));
    for (const command of ["Discard changes", "Close", "Keep editing"]) {
      await page.keyboard.press("Tab");
      await focused(confirmation.getByRole("button", { name: command, exact: true }));
    }
    const ax = await page.context().newCDPSession(page);
    const { nodes } = await ax.send("Accessibility.getFullAXTree");
    await ax.detach();
    const accessible = nodes.filter(node => !node.ignored && node.role?.value === "dialog");
    assert.equal(accessible.length, 1);
    assert.equal(accessible[0].name.value, "Discard unsaved changes?");
    assert.equal(accessible[0].description.value, description);
    await page.screenshot({ path: path.join(out, `confirmation-${factor}.png`) });
    await calls(0, 0);
    await keep();
    await focused(name);
    assert.equal(await name.inputValue(), "Synthetic unsaved rule");
    assert.deepEqual(await name.evaluate(node => [node === window.originalField, node.selectionStart, node.selectionEnd]), [true, 2, 8]);
    await page.getByRole("dialog", { name: "Decision rules", exact: true }).waitFor();
    await calls(0, 0);
    // Clicking the shared close control must remember the last editing field too.
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await keep();
    await focused(name);
    assert.ok(await name.evaluate(node => node === window.originalField));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await focused(opener);
    await calls(1, 0);
    results.push({ name: "dirty confirmation", nativeZoom: factor, status: "pass", accessibleName: accessible[0].name.value, description });
  });
}

test("Keep editing preserves tags, open advanced fields, errors, and save callbacks", { timeout: 30000 }, async () => {
  await settingsPage.locator("#zoomLevel").selectOption("1");
  await page.waitForFunction(() => devicePixelRatio === 1);
  const opener = await open("Edit category");
  const dialog = page.getByRole("dialog", { name: "Categories", exact: true });
  await dialog.getByText("Additional settings", { exact: true }).click();
  await dialog.getByLabel("Notes", { exact: false }).fill("Synthetic retained advanced notes");
  const tags = dialog.getByLabel("Tags", { exact: true });
  await tags.fill("synthetic, later, ");
  await tags.evaluate(node => { window.originalField = node; });
  await page.keyboard.press("Escape");
  await keep();
  await focused(tags);
  assert.ok(await tags.evaluate(node => node === window.originalField));
  assert.equal(await tags.inputValue(), "synthetic, later, ");
  assert.ok(await dialog.locator("details").evaluate(node => node.open));
  assert.equal(await dialog.getByLabel("Notes", { exact: false }).inputValue(), "Synthetic retained advanced notes");
  await page.evaluate(() => { window.fixture.failSave = true; });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await dialog.getByRole("alert").innerText(), "Synthetic save failure; draft retained.");
  await tags.focus();
  await page.keyboard.press("Escape");
  await keep();
  await focused(tags);
  assert.equal(await dialog.getByRole("alert").innerText(), "Synthetic save failure; draft retained.");
  await calls(0, 1);
  await page.evaluate(() => { window.fixture.failSave = false; window.fixture.holdSave = true; });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const saving = dialog.getByRole("button", { name: "Saving...", exact: true });
  await saving.waitFor();
  assert.equal(await saving.isDisabled(), true);
  await page.keyboard.press("Escape");
  await calls(0, 2);
  assert.equal(await page.getByRole("button", { name: "Keep editing", exact: true }).count(), 0);
  await page.evaluate(() => window.fixture.finishSave());
  await dialog.waitFor({ state: "hidden" });
  await focused(opener);
  await calls(1, 2);
  const saves = await page.evaluate(() => window.fixture.saves);
  assert.deepEqual(saves[0], saves[1]);
  assert.deepEqual(saves[1].record.tags, ["synthetic", "later"]);
  assert.equal(saves[1].record.notes, "Synthetic retained advanced notes");
  assert.deepEqual(saves[1].corrections, {});
  await page.evaluate(() => { window.fixture.holdSave = false; });
  results.push({ name: "draft and save callback preservation", status: "pass" });
});

test("correction-only dirty edits restore the same correction field and preserve correction callbacks", { timeout: 30000 }, async () => {
  const opener = await open("Edit finalized period");
  const dialog = page.getByRole("dialog");
  // Controlled textarea text becomes part of its wrapping label after input.
  const correction = dialog.getByLabel(/^Correction reason: Synthetic finalized period/);
  stage("Locate and fill the finalized-period correction field.");
  assert.equal(await correction.count(), 1);
  await correction.fill("Synthetic corrected cost evidence");
  await correction.evaluate(node => { window.originalField = node; });
  await page.keyboard.press("Escape");
  await keep();
  stage("Verify correction-field focus, node identity, and retained text.");
  await focused(correction);
  assert.ok(await correction.evaluate(node => node === window.originalField));
  assert.equal(await correction.inputValue(), "Synthetic corrected cost evidence");
  activeRun.beforeSave = await diagnostics();
  assert.deepEqual(activeRun.beforeSave.invalid, [], "Synthetic correction fixture must satisfy native form validation before Save.");
  assert.deepEqual(activeRun.beforeSave.errors, [], "Correction focus restoration must not introduce validation errors.");
  stage("Submit the correction-only change and wait for the dialog to close.");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  activeRun.afterSave = await diagnostics();
  await dialog.waitFor({ state: "hidden" });
  stage("Verify final opener focus and the correction callback payload.");
  await focused(opener);
  await calls(1, 1);
  const saved = await page.evaluate(() => window.fixture.saves[0]);
  assert.deepEqual(saved.corrections, { [saved.record.id]: "Synthetic corrected cost evidence" });
  results.push({ name: "correction callback preservation", status: "pass" });
});

test("clean Escape and close control restore the opener without a save or confirmation", { timeout: 30000 }, async () => {
  for (const method of ["Escape", "Close"]) {
    const opener = await open("Edit category");
    if (method === "Escape") await page.keyboard.press("Escape");
    else await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await focused(opener);
    await calls(1, 0);
  }
  assert.deepEqual(browserErrors, []);
  assert.ok(requests.every(request => request.method === "GET" && new URL(request.url).origin === base));
  results.push({ name: "clean closure and no external requests", status: "pass" });
});
