import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
const root = new URL("../", import.meta.url).pathname,
  req = createRequire(path.join(root, "artifacts/comp-dashboard/package.json"));
const { build } = createRequire(req.resolve("vite/package.json"))("esbuild");
const out = "/tmp/practice-growth-cache-render";
await fs.mkdir(out, { recursive: true });
const result = await build({
  stdin: {
    loader: "tsx",
    resolveDir: path.join(root, "artifacts/comp-dashboard"),
    contents: `
import React,{useState} from 'react';import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';
import {GrowthWorkspaceView} from './src/components/practice/growth-workspace-view';
import {createGrowthResultCache} from './src/lib/growth-result-cache';
import {reviewedGrowthFromSources} from './src/lib/reviewed-growth-source';
import {DEFAULT_GROWTH_SETTINGS} from './src/lib/reviewed-growth-observations';import {emptyWorkspace} from '@workspace/practice/hub';
const providers=[{id:1,label:'Synthetic A',goalId:null,sessionsPerWeek:10},{id:2,label:'Synthetic B',goalId:null,sessionsPerWeek:15}];
const periods=Array.from({length:9},(_,i)=>({id:'m'+i,start:'2026-'+String(i+1).padStart(2,'0')+'-01',end:new Date(Date.UTC(2026,i+1,0)).toISOString().slice(0,10),archived:false,funnelComplete:true}));
const workspace={...emptyWorkspace('2026-10-27'),periods,funnels:periods.map(p=>({periodId:p.id,scope:'practice',clinicianId:null,leads:10,clients:2,campaignId:null,sourceName:''}))};
const rows=[];for(let c=0;c<18;c++)for(let v=0;v<20;v++){const d=new Date(Date.UTC(2026,c%9,2)+v*14*86400000).toISOString().slice(0,10);if(d<='2026-10-21')rows.push({clientId:'synthetic'+c,clinician:providers[c%2].label,serviceDate:d,status:'show',billingCode:'90837',sourceRowHash:c+'-'+v,location:null});}
const snapshots=[{id:'synthetic',kind:'attendance',sourceHash:'synthetic',importedAt:'2026-10-22',coverageStart:'2025-01-01',coverageEnd:'2026-10-21',reportCoverage:{start:'2025-01-01',end:'2026-10-21',complete:true},rows}];
let calls=0;const cache=createGrowthResultCache(input=>{calls++;return reviewedGrowthFromSources(input);});
function App(){const[settings,setSettings]=useState(DEFAULT_GROWTH_SETTINGS),[nav,setNav]=useState(0);
const input={workspace,context:{clinicians:providers,staff:[],sessions:[]},snapshots,overrides:{},today:'2026-10-27',settings,scenario:false};
window.fixture={calls:()=>calls,mutate:(goal)=>flushSync(()=>setSettings(s=>({...s,goalMonths:goal}))),benchmark:()=>{const start=performance.now();let uncached;for(let i=0;i<3;i++)uncached=reviewedGrowthFromSources(input);const middle=performance.now();let cached;for(let i=0;i<3;i++)cached=cache.calculate(input);return{uncachedMs:middle-start,cachedMs:performance.now()-middle,parity:JSON.stringify(uncached)===JSON.stringify(cached)};}};
return <main className='practice-theme pw-app' data-material='tidal' data-appearance='dark' style={{padding:16}}><button onClick={()=>setNav(nav+1)}>Unrelated navigation {nav}</button><GrowthWorkspaceView input={input} cache={cache} sourcePending={false} sourceError={false} onChange={setSettings}/></main>};createRoot(document.getElementById('root')).render(<App/>);`,
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
  await page
    .getByRole("heading", { name: "Growth outlook", exact: true })
    .waitFor();
  const initial = await page.evaluate(() => window.fixture.calls());
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: /Unrelated navigation/ }).click();
  assert.equal(await page.evaluate(() => window.fixture.calls()), initial);
  const benchmark = await page.evaluate(() => window.fixture.benchmark());
  assert.equal(benchmark.parity, true);
  const occupancy = page.getByLabel("Target occupancy (%)", { exact: true });
  await occupancy.focus();
  await occupancy.press("ControlOrMeta+A");
  await page.keyboard.type("75", { delay: 100 });
  assert.equal(await occupancy.inputValue(), "75");
  assert.equal(
    await occupancy.evaluate((el) => el === document.activeElement),
    true,
  );
  await occupancy.press("Tab");
  await page.getByLabel("Target occupancy (%)", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Target occupancy (%)", { exact: true }).inputValue(),
    "75",
  );
  await page.waitForFunction(() =>
    document.activeElement
      ?.closest("label")
      ?.textContent?.includes("Reach target in (months)"),
  );

  const pending = await page.evaluate(() => {
    window.fixture.mutate(5);
    return (
      !!document.querySelector('[aria-busy="true"]') &&
      document.body.innerText.includes("Recalculating Growth")
    );
  });
  assert.equal(pending, true);
  await page.getByText("Goal month: Feb 2027", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixture.calls()), initial + 2);
  await page.evaluate(() => {
    window.fixture.mutate(3);
    window.fixture.mutate(6);
  });
  await page.getByText("Goal month: Mar 2027", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("Goal month: Dec 2026", { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  checks.push(
    "Five unrelated navigation renders cause zero engine/provider rebuilds",
    "Cached and uncached numerical/warning bundles identical",
    "Real goal change immediately hides stale results and paints recalculation state",
    "Interrupted updates only commit coherent final horizon",
  );
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ checks, errors, benchmark }, null, 2),
  );
  console.log(JSON.stringify({ checks, benchmark }));
} finally {
  await browser?.close();
  server.close();
}
