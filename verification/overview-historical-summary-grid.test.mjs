import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "..");
const { build } = createRequire(path.join(repo, "artifacts/api-server/package.json"))("esbuild");
const { chromium } = createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE ?? "/tmp/practice-oct20-render-deps/package.json")("playwright");

test("Overview KPI layout preserves cards, stages changes, resets, and fits desktop and mobile", async () => {
  const out = await fs.mkdtemp("/tmp/overview-summary-grid-");
  const bundle = await build({
    stdin: { loader: "tsx", resolveDir: path.join(repo, "artifacts/comp-dashboard"), contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {OverviewHistoricalSummary} from './src/components/practice/overview-historical-summary.tsx';
      import {historicalPerformancePeriods} from './src/lib/historical-performance-periods.ts';
      const reports = historicalPerformancePeriods({today: '2026-10-19', snapshots: []});
      const capacity = Object.fromEntries(['3mo', 'year'].map(period => [period, {
        range: reports[period].window.cohort, weekly: 1.6, desiredWeekly: 5, utilizationPct: 32,
        desiredBasis: 'current-card-assumptions', reasons: ['Current desired-caseload assumption.'],
      }]));
      window.fixture = {changes: [], sessions: 0};
      function App() {
        const [layout, setLayout] = useState();
        return <main className="pw-app" style={{padding: 16}}><OverviewHistoricalSummary
          reports={reports} capacity={capacity} layout={layout}
          onLayoutChange={next => {window.fixture.changes.push(next ?? null); setLayout(next);}}
          onSessions={() => window.fixture.sessions++}/></main>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outdir: path.join(out, "bundle"), platform: "browser", format: "esm", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const server = http.createServer((request, response) => {
    const ext = request.url === "/bundle.js" ? ".js" : request.url === "/bundle.css" ? ".css" : null;
    response.setHeader("content-type", ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "text/html");
    response.end(ext ? bundle.outputFiles.find(file => file.path.endsWith(ext)).contents : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"></head><body style="margin:0;background:#141a1f;color:#eee;font:14px sans-serif"><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true, ...(process.env.PRACTICE_BROWSER_EXECUTABLE ? { executablePath: process.env.PRACTICE_BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Edit layout" }).waitFor();
    const bounds = () => page.locator(".pw-section-widget").evaluateAll(nodes => nodes.map(node => {
      const { x, y, width } = node.getBoundingClientRect(); return { x, y, width };
    }));
    assert.equal(await page.locator(".pw-percentage-kpi-ring").count(), 8);
    assert.equal(await page.locator(".pw-section-widget--card").count(), 0);
    assert.equal(await page.locator(".pw-section-widget-layout").evaluate(node => getComputedStyle(node).borderTopWidth), "0px");
    assert.equal(await page.locator(".sw-content > section").first().evaluate(node => getComputedStyle(node).backgroundColor), "rgb(32, 39, 44)");
    let rects = await bounds();
    assert.equal(rects[0].y, rects[1].y);
    assert.ok(rects[2].y > rects[0].y);
    await page.screenshot({ path: path.join(out, "desktop-medium.png"), fullPage: true });
    await page.getByRole("button", { name: "Edit layout" }).click();
    for (const title of ["Caseload", "Retention", "Close rate", "Attrition"]) {
      await page.getByRole("combobox", { name: title + " size" }).selectOption("small");
    }
    rects = await bounds();
    assert.equal(rects[0].y, rects[2].y);
    assert.ok(rects[3].y > rects[0].y);
    await page.getByRole("combobox", { name: "Caseload size" }).selectOption("wide");
    rects = await bounds();
    assert.ok(rects[0].width > rects[1].width * 2);
    await page.getByRole("button", { name: "Move Caseload down", exact: true }).click();
    assert.equal(await page.locator(".pw-section-widget").first().getAttribute("data-widget-id"), "retention");
    assert.equal(await page.evaluate(() => window.fixture.changes.at(-1).widgets[1].size), "wide");
    await page.getByRole("button", { name: "Reset layout", exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixture.changes.at(-1)), null);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const sessions = page.getByRole("button", { name: "Sessions", exact: true });
    assert.equal(await sessions.evaluate(node => node.closest(".pw-section-widget-layout")), null);
    await sessions.click();
    assert.equal(await page.evaluate(() => window.fixture.sessions), 1);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      rects = await bounds();
      assert.ok(rects.every(rect => rect.x === rects[0].x && rect.width === rects[0].width));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(out, 'mobile-' + width + '.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('Overview screenshots: ' + out);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
