import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
const root = new URL("../", import.meta.url).pathname,
  req = createRequire(path.join(root, "artifacts/comp-dashboard/package.json"));
const { build } = createRequire(req.resolve("vite/package.json"))("esbuild");
const out = "/tmp/practice-provider-growth-render";
await fs.mkdir(out, { recursive: true });
const result = await build({
  stdin: {
    loader: "tsx",
    resolveDir: path.join(root, "artifacts/comp-dashboard"),
    contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ProviderGrowthPanel} from './src/components/practice/provider-growth-panel';
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
return <main className='practice-theme pw-app' data-appearance='dark' data-material='tidal' style={{padding:16,maxWidth:1300,margin:'auto'}}><nav><button onClick={()=>setEmpty(!empty)}>Toggle coverage</button><button onClick={()=>localStorage.setItem('synthetic-provider-plan',JSON.stringify(settings))}>Save synthetic plan</button></nav><ProviderGrowthPanel model={model} settings={settings} onChange={setSettings} scenario={true} staffingCandidates={candidates}/></main>};createRoot(document.getElementById('root')).render(<App/>);`,
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
  await page.getByRole("heading", { name: "Clinician growth" }).waitFor();
  assert.match(await page.locator("main").innerText(), /No attributed leads/);
  assert.equal(await page.getByRole("checkbox").isChecked(), false);
  await page.screenshot({
    path: path.join(out, "history-desktop.png"),
    fullPage: true,
  });
  checks.push("provider history available without fabricated lead attribution");
  await page.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  assert.match(await page.locator("main").innerText(), /estimates are provisional/);
  assert.equal(
    await page.evaluate(() => window.fixture.model.rows[0].families[0].basis),
    "practice-proxy-scenario",
  );
  await page
    .getByText("Monthly lead allocation scenario", { exact: true })
    .click();
  await page
    .getByLabel(
      "Allocated leads Synthetic Clinician With A Long Name 2026-10",
      { exact: true },
    )
    .fill("1000");
  assert.match(
    await page.locator("main").innerText(),
    /Allocations exceed practice series/,
  );
  assert.match(
    await page.locator("main").innerText(),
    /Provider capacity exceeded/,
  );
  await page.screenshot({
    path: path.join(out, "proxy-desktop.png"),
    fullPage: true,
  });
  await page.getByLabel("Growth clinician", { exact: true }).selectOption("2");
  assert.equal(await page.getByRole("checkbox").isChecked(), false);
  await page.getByLabel("Growth clinician", { exact: true }).selectOption("1");
  assert.equal(await page.getByRole("checkbox").isChecked(), true);
  checks.push(
    "keyboard opt-in; allocations/capacity warnings; provider settings isolated",
  );
  await page
    .getByText("Reconcile saved staffing plans", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use Synthetic saved hire in Growth overlay" })
    .click();
  assert.equal(
    await page.evaluate(() => window.fixture.settings.staffing.length),
    1,
  );
  assert.equal(
    await page
      .getByRole("button", {
        name: "Use Synthetic saved hire in Growth overlay",
      })
      .count(),
    0,
  );
  checks.push(
    "saved hire copied once to separate overlay without mutating saved plan",
  );
  await page.getByRole("button", { name: "Save synthetic plan" }).click();
  await page.reload();
  await page.getByRole("checkbox").waitFor();
  assert.equal(await page.getByRole("checkbox").isChecked(), true);
  checks.push("synthetic settings persist through reload");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    });
    await page.screenshot({
      path: path.join(out, "provider-mobile-" + width + ".png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  await page
    .getByText("Monthly lead allocation scenario", { exact: true })
    .click();
  const region = page.getByRole("region", {
    name: /Provider lead allocations;/,
  });
  await region.focus();
  await page.keyboard.press("ArrowRight");
  assert.ok(await region.evaluate((el) => el.scrollWidth > el.clientWidth));
  await page.getByRole("button", { name: "Toggle coverage" }).click();
  await page.screenshot({
    path: path.join(out, "missing-coverage.png"),
    fullPage: true,
  });
  assert.ok(await page.evaluate(() => window.fixture.unchanged()));
  assert.deepEqual(errors, []);
  checks.push(
    "mobile scroll/accessibility, missing coverage and source preservation",
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
