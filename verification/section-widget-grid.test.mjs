import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(repo, "artifacts/api-server/package.json"));
const { build } = require("esbuild");
const { chromium } = createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE ?? "/tmp/practice-oct20-render-deps/package.json")("playwright");

test("section grid supports keyboard, native drag, reset, stable content and narrow screens", async () => {
  const out = await fs.mkdtemp("/tmp/section-widget-grid-");
  const bundle = await build({
    stdin: { loader: "tsx", resolveDir: path.join(repo, "artifacts/comp-dashboard"), contents: `
      import React, {useEffect, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import SectionWidgetGrid from './src/components/practice/section-widget-grid.tsx';
      window.fixture = {mounts: 0, changes: []};
      function Content({id}) {
        useEffect(() => { window.fixture.mounts++; }, []);
        return <article style={{border: '1px solid #ddd', padding: 16}}><label>{id} note<input aria-label={id + ' note'} defaultValue="" /></label><button type="button">{id} action</button></article>;
      }
      function App() {
        const [layout, setLayout] = useState({version: 1, widgets: [{id: 'hidden', size: 'wide'}]});
        return <SectionWidgetGrid section="summary" className="fixture-grid" layout={layout}
          items={['Alpha', 'Beta', 'Gamma'].map(id => ({id, title: id, content: <Content id={id}/>}))}
          onChange={next => { window.fixture.changes.push(next ?? null); setLayout(next); }} />;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outdir: path.join(out, "bundle"), platform: "browser", format: "esm", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const server = http.createServer((request, response) => {
    const ext = request.url === "/bundle.js" ? ".js" : request.url === "/bundle.css" ? ".css" : null;
    response.setHeader("content-type", ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "text/html");
    response.end(ext ? bundle.outputFiles.find(file => file.path.endsWith(ext)).contents : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true, ...(process.env.PRACTICE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRACTICE_BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Edit layout" }).waitFor();
    const order = () => page.locator(".pw-section-widget").evaluateAll(nodes => nodes.map(node => node.dataset.widgetId));
    assert.equal(await page.locator(".pw-section-widget--card").count(), 0);
    assert.equal(await page.getByRole("combobox").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Alpha action" }).evaluate(node => getComputedStyle(node).display), "inline-block", "layout CSS must not style content buttons");
    await page.getByRole("textbox", { name: "Alpha note" }).fill("kept draft");
    await page.getByRole("button", { name: "Edit layout" }).click();
    await page.getByRole("button", { name: "Move Alpha down", exact: true }).click();
    assert.deepEqual(await order(), ["Beta", "Alpha", "Gamma"]);
    const handle = page.getByRole("button", { name: "Move Alpha", exact: true });
    await handle.focus();
    await page.keyboard.press("Alt+ArrowDown");
    assert.deepEqual(await order(), ["Beta", "Gamma", "Alpha"]);
    assert.equal(await handle.evaluate(node => node === document.activeElement), true);
    await page.getByRole("combobox", { name: "Alpha size" }).selectOption("wide");
    assert.equal(await page.getByRole("group", { name: "Alpha", exact: true }).evaluate(node => node.classList.contains("pw-section-widget--wide")), true);
    assert.equal(await page.getByRole("group", { name: "Alpha", exact: true }).getAttribute("data-widget-size"), "wide");
    await handle.dragTo(page.getByRole("group", { name: "Beta", exact: true }));
    assert.deepEqual(await order(), ["Alpha", "Beta", "Gamma"]);
    assert.match(await page.getByRole("status").innerText(), /Alpha moved to position 1 of 3/);
    assert.equal(await page.evaluate(() => window.fixture.changes.at(-1).widgets.at(-1).id), "hidden");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Alpha note" }).inputValue(), "kept draft");
    assert.equal(await page.evaluate(() => window.fixture.mounts), 3);
    await page.screenshot({ path: path.join(out, "desktop.png"), fullPage: true });
    await page.getByRole("button", { name: "Edit layout" }).click();
    await page.getByRole("button", { name: "Reset layout", exact: true }).click();
    assert.deepEqual(await order(), ["Alpha", "Beta", "Gamma"]);
    assert.equal(await page.evaluate(() => window.fixture.changes.at(-1)), null);
    assert.equal(await page.evaluate(() => window.fixture.mounts), 3);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.locator(".pw-section-widget").evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); return { x: rect.x, width: rect.width }; }));
      assert.ok(bounds.every(rect => rect.x === bounds[0].x && rect.width === bounds[0].width));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(out, `mobile-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    assert.equal(await page.getByRole("region", { name: "Overview widgets", exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const zoomControls = await page.locator(".pw-section-widget-controls > button, .pw-section-widget-controls > select").evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    }));
    assert.ok(zoomControls.every(rect => rect.left >= 0 && rect.right <= 1280 && rect.width >= 88 && rect.height >= 88));
    await handle.focus();
    await page.keyboard.press("Alt+ArrowDown");
    assert.deepEqual(await order(), ["Beta", "Alpha", "Gamma"]);
    assert.equal(await handle.evaluate(node => node === document.activeElement), true);
    await page.screenshot({ path: path.join(out, "zoom-200-percent.png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`Synthetic fixture screenshots: ${out}`);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
