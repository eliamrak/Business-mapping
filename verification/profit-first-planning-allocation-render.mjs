import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const { build } = createRequire(path.join(repo, "artifacts/api-server/package.json"))("esbuild");
const args = process.argv.slice(2);
assert.ok(args.every(arg => ["--run", "--build-only"].includes(arg)) && args.length <= 1, "Choose --build-only (default) or --run");
const result = await build({
  stdin: { loader: "tsx", resolveDir: path.join(repo, "artifacts/comp-dashboard"), contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import ProfitFirstPlanning from '@/components/practice/profit-first-planning';
    import {emptyWorkspace, workspaceSchema} from '@workspace/practice/hub';
    const seed = emptyWorkspace('2026-01-01');
    seed.moneyPlanning = {estimatedMonthlyValues: {revenue: 10000, overhead: 1200, otherIncome: 0, taxObligations: 100}};
    window.fixture = {saved: [], reset: null};
    function App() {
      const [workspace, setWorkspace] = useState(seed);
      const [epoch, setEpoch] = useState(0);
      window.fixture.reset = () => {window.fixture.saved = []; setWorkspace(structuredClone(seed)); setEpoch(n => n + 1);};
      return <main style={{maxWidth: 1100, margin: '0 auto', padding: 16}}>
        <ProfitFirstPlanning key={epoch} workspace={workspace} context={{clinicians: [], staff: [], sessions: []}}
          asOf="2026-01-15" estimateSourcePeriod="Synthetic January planning"
          estimatedMonthlyValues={{clinicianPay: 0, employerBurden: 0, staffCost: 0, fees: 0, marketing: 0}}
          onPlanningChange={moneyPlanning => {
            const next = workspaceSchema.parse({...workspace, moneyPlanning});
            window.fixture.saved.push(next.moneyPlanning); setWorkspace(next);
          }} />
        <button type="button" id="blur">Fixture blur</button>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` },
  alias: { "@": path.join(repo, "artifacts/comp-dashboard/src") },
  bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic", outdir: "/tmp/money-allocation-build",
  define: { "process.env.NODE_ENV": '"test"' },
});
const js = result.outputFiles.find(file => file.path.endsWith(".js")).contents;
const css = result.outputFiles.find(file => file.path.endsWith(".css")).contents;
if (!args.includes("--run")) {
  console.log(JSON.stringify({status: "prepared-not-run", bundleBytes: js.length, cssBytes: css.length, browserLaunched: false}));
  process.exit(0);
}
const out = await fs.mkdtemp("/tmp/profit-first-allocation-render-");
let server, browser;
const errors = [], cases = [], requests = [];
try {
  const { chromium } = createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE ?? "/tmp/forge-reviewed-da6f1d2c-stage/package.json")("playwright");
  server = http.createServer((req, res) => {
    if (req.method !== "GET" || !["/", "/bundle.js", "/bundle.css", "/favicon.ico"].includes(req.url)) { res.writeHead(405); res.end(); return; }
    res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : req.url === "/bundle.css" ? "text/css" : "text/html");
    res.end(req.url === "/bundle.js" ? js : req.url === "/bundle.css" ? css : req.url === "/favicon.ico" ? "" : '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>body{margin:0;font-family:Arial,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: true, executablePath: process.env.PRACTICE_FULL_CHROME ?? "/Users/eliam/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"});
  const context = await browser.newContext({serviceWorkers: "block"});
  await context.route("**/*", route => {
    const req = route.request(), url = new URL(req.url());
    const allowed = req.method() === "GET" && url.origin === base && ["/", "/bundle.js", "/bundle.css", "/favicon.ico"].includes(url.pathname);
    requests.push({url: req.url(), allowed});
    return allowed ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {if (message.type() === "error") errors.push(message.text());});
  page.setDefaultTimeout(5000);
  for (const width of [1280, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(base);
    const taxRow = page.getByRole("row").filter({has: page.getByRole("rowheader", {name: "Taxes", exact: true})});
    await taxRow.waitFor();
    assert.deepEqual(await taxRow.locator("td").allTextContents(), ["3%", "$300", "$100", "-$200", "1%", ""]);
    const headers = await page.getByRole("columnheader").allTextContents();
    assert.equal(headers[2], "Current allocation ($/month)");
    assert.equal(headers[3], "Budget needed ($/month)");
    const geometry = await page.evaluate(() => {
      const cell = document.querySelector("tbody td");
      const style = getComputedStyle(cell);
      return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth, padding: style.paddingTop, border: style.borderLeftWidth, radius: style.borderRadius};
    });
    assert.ok(geometry.scrollWidth <= width, "Only the table may scroll horizontally");
    assert.equal(geometry.padding, "6px");
    assert.equal(geometry.border, "1px");
    assert.equal(geometry.radius, "0px");
    await page.screenshot({path: path.join(out, `${width}-allocation.png`), fullPage: true});
    await page.getByText("Cost estimates and source periods", {exact: true}).click();
    const tax = page.getByRole("spinbutton", {name: "Quarterly tax planning estimate", exact: true});
    assert.equal(await tax.inputValue(), "300.00");
    await tax.fill("9000");
    assert.equal(await taxRow.locator("td").nth(2).textContent(), "$3,000");
    assert.equal(await page.evaluate(() => window.fixture.saved.length), 0);
    await tax.press("Enter");
    assert.equal(await page.evaluate(() => window.fixture.saved.at(-1).estimatedMonthlyValues.taxObligations), 3000);
    await tax.fill("-1");
    await page.locator("#blur").click();
    assert.equal(await tax.getAttribute("aria-invalid"), "true");
    assert.ok(await tax.getAttribute("aria-describedby"));
    assert.equal(await page.evaluate(() => window.fixture.saved.length), 1);
    await tax.fill("");
    await tax.press("Enter");
    assert.equal(await taxRow.locator("td").nth(2).textContent(), "Unknown");
    await tax.fill("0");
    assert.ok(await tax.isVisible());
    assert.ok(await tax.evaluate(node => node === document.activeElement));
    await tax.press("Enter");
    assert.equal(await page.evaluate(() => window.fixture.saved.at(-1).estimatedMonthlyValues.taxObligations), 0);
    await page.screenshot({path: path.join(out, `${width}-tax-editor.png`), fullPage: true});
    cases.push({width, geometry, status: "pass"});
  }
  assert.deepEqual(errors, []);
  assert.ok(requests.every(req => req.allowed));
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  const status = cases.length === 2 && !errors.length ? "pass" : "incomplete";
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify({status, cases, errors, requests, syntheticOnly: true}, null, 2));
  console.log(JSON.stringify({status, out, cases, errors}));
}
