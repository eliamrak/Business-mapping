import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
const root = new URL("../", import.meta.url).pathname,
  req = createRequire(path.join(root, "artifacts/comp-dashboard/package.json"));
const { build } = createRequire(req.resolve("vite/package.json"))("esbuild");
const out = "/tmp/practice-reviewed-growth-render";
await fs.mkdir(out, { recursive: true });
const result = await build({
  stdin: {
    loader: "tsx",
    resolveDir: path.join(root, "artifacts/comp-dashboard"),
    contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ReviewedGrowthPanel} from './src/components/practice/reviewed-growth-panel';
import {reviewedGrowth,DEFAULT_GROWTH_SETTINGS} from './src/lib/reviewed-growth-observations';
const periods=Array.from({length:9},(_,i)=>({id:'m'+i,start:'2026-'+String(i+1).padStart(2,'0')+'-01',end:new Date(Date.UTC(2026,i+1,0)).toISOString().slice(0,10),archived:false,funnelComplete:i!==8}));
const workspace={periods,funnels:periods.map(p=>({periodId:p.id,scope:'practice',clinicianId:null,leads:10,clients:2,campaignId:null,sourceName:''}))};
const visits=[];for(let c=0;c<18;c++){const start=Date.UTC(2026,c%9,2);for(let v=0;v<20;v++){const date=new Date(start+v*14*86400000).toISOString().slice(0,10);visits.push({clientId:'synthetic'+c,clinicianId:1,date});}}
const original=JSON.stringify({workspace,visits});
function App(){const [settings,setSettings]=useState(()=>JSON.parse(localStorage.getItem('synthetic-plan')||'null')??DEFAULT_GROWTH_SETTINGS),[scenario,setScenario]=useState(false),[empty,setEmpty]=useState(false),[visible,setVisible]=useState(true);
const model=reviewedGrowth({today:'2026-10-27',workspace,visits,consults:[],coverage:empty?[]:[{clinicianId:1,start:'2025-01-01',end:'2026-10-21'}],clinicianIds:[1],weeklyCapacity:94,weeksPerYear:48,settings,scenario});
window.fixture={unchanged:()=>original===JSON.stringify({workspace,visits}),model};
return <main className='practice-theme pw-app' data-appearance='dark' data-material='tidal' style={{padding:16,maxWidth:1300,margin:'auto'}}><nav aria-label='Synthetic verification controls'><button onClick={()=>setScenario(!scenario)}>Toggle Sandbox</button><button onClick={()=>setEmpty(!empty)}>Toggle coverage</button><button onClick={()=>setVisible(!visible)}>Toggle navigation</button><button onClick={()=>localStorage.setItem('synthetic-plan',JSON.stringify(settings))}>Save synthetic plan</button></nav>{visible&&<ReviewedGrowthPanel model={model} settings={settings} onChange={setSettings} scenario={scenario}/>}</main>};createRoot(document.getElementById('root')).render(<App/>);`,
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
assert.ok(cssName);
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
  await page.getByRole("heading", { name: "Growth outlook" }).waitFor();
  assert.ok(
    await page.evaluate(() =>
      window.fixture.model.families.every((f) => f.projection),
    ),
  );
  await page.screenshot({
    path: path.join(out, "standard-desktop.png"),
    fullPage: true,
  });
  checks.push("default Standard produces estimates without manual setup");
  await page.locator("summary").focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Occupancy goal (%)", { exact: true }).fill("70");
  assert.equal(
    await page.getByLabel("Occupancy goal (%)", { exact: true }).inputValue(),
    "70",
  );
  await page.getByRole("button", { name: "Toggle Sandbox" }).click();
  await page.getByLabel("Future leads 2026-10", { exact: true }).fill("50");
  assert.equal(
    await page.evaluate(() => window.fixture.model.families[0].leadSeries[0]),
    50,
  );
  await page
    .getByRole("button", { name: "Add hypothetical clinician", exact: true })
    .click();
  await page.getByLabel("Weekly capacity", { exact: true }).fill("20");
  await page.getByLabel("Ramp months", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save synthetic plan" }).click();
  assert.match(await page.getByRole("region", {name:"Reviewed growth forecast"}).innerText(), /456 sessions \/ month capacity/);
  await page.screenshot({
    path: path.join(out, "sandbox-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle Sandbox" }).click();
  assert.equal(
    await page.evaluate(() => window.fixture.model.families[0].leadSeries[0]),
    10,
  );
  assert.equal(
    await page.evaluate(() => window.fixture.model.families[0].capacity[0]),
    376,
  );
  checks.push(
    "scenario changes update estimates; Standard ignores scenario overrides",
  );
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.reload();
  await page.locator("summary").click();
  assert.equal(
    await page.getByLabel("Occupancy goal (%)", { exact: true }).inputValue(),
    "70",
  );
  checks.push(
    "synthetic plan survives navigation/reload without actual mutations",
  );
  await page.locator("summary").click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    });
    await page.screenshot({
      path: path.join(out, "standard-mobile-" + width + ".png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  const trajectory = page.getByRole("region", { name: /Monthly trajectory/ });
  await trajectory.focus();
  await page.keyboard.press("End");
  assert.ok(await trajectory.evaluate((el) => el.scrollWidth > el.clientWidth));
  checks.push("mobile trajectory is labeled and keyboard focusable");
  await page.getByRole("button", { name: "Toggle coverage" }).click();
  await page.screenshot({
    path: path.join(out, "missing-coverage.png"),
    fullPage: true,
  });
  assert.match(
    await page.locator("main").innerText(),
    /Complete attendance coverage/,
  );
  assert.ok(await page.evaluate(() => window.fixture.unchanged()));
  assert.deepEqual(errors, []);
  checks.push(
    "missing coverage fails unavailable; mobile page fits; no runtime errors",
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
