import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
const root = new URL("../", import.meta.url).pathname,
  req = createRequire(path.join(root, "artifacts/comp-dashboard/package.json"));
const { build } = createRequire(req.resolve("vite/package.json"))("esbuild");
const out = "/tmp/practice-growth-scope-render";
await fs.mkdir(out, { recursive: true });
const result = await build({
  stdin: {
    loader: "tsx",
    resolveDir: path.join(root, "artifacts/comp-dashboard"),
    contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {GrowthScopeView} from './src/components/practice/growth-scope-view';
import {ReviewedGrowthPanel} from './src/components/practice/reviewed-growth-panel';
import {reviewedGrowth,DEFAULT_GROWTH_SETTINGS} from './src/lib/reviewed-growth-observations';
import {providerGrowth,staffingPlanCandidates} from './src/lib/provider-growth';
import {emptyWorkspace,eventSchema} from '@workspace/practice/hub';
const providers=[{id:1,label:'Synthetic Clinician With A Long Name',sessionsPerWeek:10},{id:2,label:'Synthetic B',sessionsPerWeek:15}];
const periods=Array.from({length:9},(_,i)=>({id:'m'+i,start:'2026-'+String(i+1).padStart(2,'0')+'-01',end:new Date(Date.UTC(2026,i+1,0)).toISOString().slice(0,10),archived:false,funnelComplete:i!==8}));
const workspace={...emptyWorkspace('2026-10-27'),periods,funnels:periods.map(p=>({periodId:p.id,scope:'practice',clinicianId:null,leads:10,clients:2,campaignId:null,sourceName:''})),events:[eventSchema.parse({id:'00000000-0000-4000-8000-000000000001',name:'Synthetic saved hire',date:'2027-01-01',field:'clinician.hire',targetId:'1',value:20,delayMonths:1,rampMonths:2})]};
const visits=[];for(let c=0;c<18;c++){const start=Date.UTC(2026,c%9,2);for(let v=0;v<20;v++)visits.push({clientId:'synthetic'+c,clinicianId:c%2+1,date:new Date(start+v*14*86400000).toISOString().slice(0,10)});}
const original=JSON.stringify({workspace,visits,providers});
function App(){const [settings,setSettings]=useState(()=>JSON.parse(localStorage.getItem('synthetic-provider-plan')||'null')??DEFAULT_GROWTH_SETTINGS),[empty,setEmpty]=useState(false);
const input={today:'2026-10-27',workspace,visits,consults:[],coverage:empty?[]:providers.map(p=>({clinicianId:p.id,start:'2025-01-01',end:'2026-10-21'})),clinicianIds:[1,2],weeklyCapacity:25,weeksPerYear:48,settings,scenario:true};const practice=reviewedGrowth(input),model=providerGrowth(input,practice,providers);const candidates=staffingPlanCandidates(workspace,{clinicians:providers},settings.staffing??[]);
window.fixture={unchanged:()=>original===JSON.stringify({workspace,visits,providers}),model,settings};
return <main className='practice-theme pw-app' data-appearance='dark' data-material='tidal' style={{padding:16,maxWidth:1300,margin:'auto'}}><nav><button onClick={()=>setEmpty(!empty)}>Toggle coverage</button><button onClick={()=>localStorage.setItem('synthetic-provider-plan',JSON.stringify(settings))}>Save synthetic plan</button></nav><GrowthScopeView practice={<ReviewedGrowthPanel model={practice} settings={settings} onChange={setSettings} scenario={true}/>} model={model} settings={settings} onChange={setSettings} scenario={true} staffingCandidates={candidates}/></main>};createRoot(document.getElementById('root')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outdir: out,
  alias: { "@": path.join(root, "artifacts/comp-dashboard/src") },
  define: { "process.env.NODE_ENV": '"development"' },
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js")).contents,
  assets = path.join(root, "artifacts/comp-dashboard/dist/public/assets");
const cssName = (await fs.readdir(assets)).find((f) =>
  /^index-.*\.css$/.test(f),
);
const css = await fs.readFile(path.join(assets, cssName));
const html = `<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><link rel='stylesheet' href='/style.css'><style>body{margin:0}main{box-sizing:border-box;min-width:0}nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}</style></head><body><div id='root'></div><script type='module' src='/app.js'></script></body></html>`;
const server = http.createServer((req, res) => {
  const f = {
    "/": [html, "text/html"],
    "/app.js": [js, "text/javascript"],
    "/style.css": [css, "text/css"],
    "/favicon.ico": ["", "image/x-icon"],
  }[req.url];
  res.writeHead(f ? 200 : 404, { "content-type": f?.[1] ?? "text/plain" });
  res.end(f?.[0] ?? "Not found");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { chromium } = createRequire(
  "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json",
)("playwright");
let browser;
const errors = [],
  checks = [];
try {
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByRole("heading", { name: "Growth sandbox" }).waitFor();
  const scope = page.getByRole("group", { name: "Growth scope" });
  assert.equal(await scope.getByRole("button").count(), 3);
  assert.equal(
    await page
      .getByRole("heading", { name: "Clinician growth", exact: true })
      .count(),
    0,
  );
  const inspect = page.getByLabel("Inspect month", { exact: true });
  assert.equal(await inspect.locator("option").count(), 12);
  await inspect.selectOption("2026-09");
  assert.match(
    await page.locator("output").innerText(),
    /Sep 2026 · Actual sessions:/,
  );
  await inspect.selectOption("2027-01");
  assert.match(
    await page.locator("output").innerText(),
    /Estimated sessions:.*Target:.*Full capacity:/,
  );
  await page.getByLabel("Target occupancy (%)", { exact: true }).fill("70");
  await page.getByLabel("Target occupancy (%)", { exact: true }).press("Tab");
  await page.getByLabel("Reach target in (months)", { exact: true }).fill("5");
  await page
    .getByLabel("Reach target in (months)", { exact: true })
    .press("Tab");
  assert.match(await page.locator("main").innerText(), /Goal month: Feb 2027/);
  await page
    .getByRole("button", { name: "Last 12 months", exact: true })
    .click();
  assert.match(
    await page.locator("main").innerText(),
    /9 available lead months/,
  );
  const chart = page.getByRole("region", {
    name: "Actual and estimated monthly sessions chart",
  });
  const tickStyle = await page
    .locator(".recharts-cartesian-axis-tick-value")
    .first()
    .evaluate((el) => getComputedStyle(el).fill);
  assert.match(tickStyle, /rgb/);
  // Dark axis text on the light glass in this isolated Tidal fixture.
  const rgb = tickStyle
    .match(/[\d.]+/g)
    .map(Number)
    .slice(0, 3);
  const luminance = (values) =>
    values
      .map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const textL = luminance(rgb),
    cardL = luminance([124, 143, 155]);
  const axisContrast =
    (Math.max(textL, cardL) + 0.05) / (Math.min(textL, cardL) + 0.05);
  assert.ok(axisContrast >= 4.5, `axis contrast ${axisContrast}`);
  const box = await chart.boundingBox();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5);
  await page.screenshot({
    path: path.join(out, "practice-desktop.png"),
    fullPage: true,
  });
  await scope
    .getByRole("button", {
      name: "Synthetic Clinician With A Long Name",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .getByRole("heading", { name: "Growth outlook", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.getByLabel("Growth clinician", { exact: true }).count(),
    0,
  );
  await inspect.selectOption("2027-01");
  assert.match(
    await page.locator("output").innerText(),
    /Estimated sessions: Unavailable/,
  );
  assert.match(
    await page.locator("main").innerText(),
    /provider-attributed lead totals are missing/,
  );
  await page.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  assert.equal(
    await page.evaluate(() => window.fixture.model.rows[0].families[0].basis),
    "practice-proxy-scenario",
  );
  await page
    .getByText("Deep dive: model diagnostics and planning assumptions", {
      exact: true,
    })
    .click();
  await page
    .getByText("Monthly lead allocation scenario", { exact: true })
    .click();
  await page
    .getByLabel(
      "Allocated leads Synthetic Clinician With A Long Name 2026-10",
      { exact: true },
    )
    .fill("1000");
  await page
    .getByLabel(
      "Allocated leads Synthetic Clinician With A Long Name 2026-10",
      { exact: true },
    )
    .press("Tab");
  assert.match(
    await page.locator("main").innerText(),
    /Allocations exceed practice series/,
  );
  await scope.getByRole("button", { name: "Synthetic B", exact: true }).click();
  assert.equal(await page.getByRole("checkbox").isChecked(), false);
  await scope
    .getByRole("button", {
      name: "Synthetic Clinician With A Long Name",
      exact: true,
    })
    .click();
  assert.equal(await page.getByRole("checkbox").isChecked(), true);
  await page.getByRole("button", { name: "Save synthetic plan" }).click();
  await page.reload();
  await scope
    .getByRole("button", {
      name: "Synthetic Clinician With A Long Name",
      exact: true,
    })
    .click();
  assert.equal(await page.getByRole("checkbox").isChecked(), true);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await scope
      .getByRole("button", { name: "Whole Practice", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("heading", { name: "Growth sandbox", exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "Last 3 months", exact: true })
      .click();
    await page
      .getByLabel("Inspect month", { exact: true })
      .selectOption("2027-01");
    assert.match(await page.locator("output").innerText(), /Jan 2027/);
    await page.screenshot({
      path: path.join(out, `practice-mobile-${width}.png`),
      fullPage: true,
    });
    await scope
      .getByRole("button", {
        name: "Synthetic Clinician With A Long Name",
        exact: true,
      })
      .click();
    assert.equal(
      await page
        .getByRole("heading", { name: "Growth outlook", exact: true })
        .count(),
      1,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: path.join(out, `provider-mobile-${width}.png`),
      fullPage: true,
    });
  }
  // Touch-capable browser exercises chart tap and the native month picker.
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const touchPage = await touch.newPage();
  await touchPage.goto("http://127.0.0.1:" + server.address().port);
  await touchPage
    .getByRole("button", { name: "Last 12 months", exact: true })
    .tap();
  await touchPage
    .getByRole("region", {
      name: "Actual and estimated monthly sessions chart",
    })
    .tap();
  await touchPage
    .getByLabel("Inspect month", { exact: true })
    .selectOption("2026-10");
  assert.match(await touchPage.locator("output").innerText(), /Oct 2026/);
  await touch.close();
  await page.getByRole("button", { name: "Toggle coverage" }).click();
  assert.ok(await page.evaluate(() => window.fixture.unchanged()));
  assert.deepEqual(errors, []);
  checks.push(
    "Single shared scope; mobile320/390 buttons visible and switch practice/provider",
    "Six completed actual months plus six future months; unknown forecasts not invented",
    "Visible occupancy/horizon controls,3/12history choice and available lead-month count",
    "Mouse chart interaction, touch chart interaction and accessible month/value picker",
    "Explicit physical100percent ceiling vs selected target; proxy opt-in and provider isolation; diagnostics retained",
    "Saved synthetic settings reload; missing coverage and actual records preserved",
  );
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ out, checks, errors }));
} finally {
  await browser?.close();
  server.close();
}
