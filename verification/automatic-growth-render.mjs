// Isolated real-component synthetic QA; no application or provider connections.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),out=process.env.PRACTICE_GROWTH_EVIDENCE??'/tmp/practice-growth-positive';
await fs.mkdir(out,{recursive:true});
const require=createRequire(new URL('../artifacts/comp-dashboard/package.json',import.meta.url));
const {build}=createRequire(require.resolve('vite/package.json'))('esbuild');
const fixture=await fs.readFile(path.join(root,'artifacts/comp-dashboard/src/lib/automatic-growth.test.ts'),'utf8');
const constants=fixture.slice(fixture.indexOf('const clinician='),fixture.indexOf("test('automatic default"));
const result=await build({stdin:{loader:'tsx',resolveDir:path.join(root,'artifacts/comp-dashboard'),contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {automaticGrowth} from './src/lib/automatic-growth';import {historicalPerformancePeriods} from './src/lib/historical-performance-periods';
import {periodSchema,funnelSchema} from '@workspace/practice/hub';import {GrowthPaceCard} from './src/components/practice/growth-pace-card';import {AcquisitionDashboard} from './src/components/practice/acquisition-dashboard';
${constants}
function App(){const [horizon,setHorizon]=useState('4'),[mode,setMode]=useState('positive');
const model=automaticGrowth({...base,reports:matched,workspace:{periods,funnels},capacity:mode==='full'?.1:20,horizon,coverage:mode==='empty'?[]:coverage});
window.expected=model;
return <main className="pw-app practice-theme" data-material="tidal" data-appearance="dark"><label>Synthetic fixture<select aria-label="Synthetic fixture" value={mode} onChange={e=>setMode(e.target.value)}><option>positive</option><option>empty</option><option>full</option></select></label><GrowthPaceCard model={model} horizon={horizon} onHorizon={setHorizon}/><AcquisitionDashboard model={model}/></main>}
createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',outdir:out,define:{'process.env.NODE_ENV':'"development"'}});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).contents;
const assets=path.join(root,'artifacts/comp-dashboard/dist/public/assets');
const css=await fs.readFile(path.join(assets,(await fs.readdir(assets)).find(n=>/^index-.*\.css$/.test(n))));
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{margin:0;background:linear-gradient(135deg,#91b9c6,#d5d4c1)}main.pw-app{padding:20px;display:block;max-width:1240px;margin:auto}.pw-metric-panel{margin-bottom:20px} @media(max-width:600px){main.pw-app{padding:10px}}</style><div id="root"></div><script type="module" src="/bundle.js"></script>';
const server=http.createServer((req,res)=>{const content=req.url==='/'?[html,'text/html']:req.url==='/bundle.js'?[js,'text/javascript']:req.url==='/styles.css'?[css,'text/css']:['','text/plain'];res.writeHead(200,{'content-type':content[1]});res.end(content[0]);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE??'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[];
try {const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
await page.getByRole('heading',{name:'Client acquisition',exact:true}).waitFor();
assert.equal(await page.locator('[data-state="growing"]').count(),2);
const before=await page.evaluate(()=>window.expected.periods.year.requiredLeads);assert.ok(before>0);
await page.getByLabel('Growth target horizon in months').fill('8');
assert.ok(await page.evaluate(()=>window.expected.periods.year.requiredLeads)<before);
await page.getByLabel('Growth target horizon in months').fill('4');
for(const width of [1280,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`positive-${width}.png`),fullPage:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,`positive-pace-viewport-${width}.png`)});await page.getByRole('heading',{name:'Client acquisition',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`positive-table-viewport-${width}.png`)});}
await page.getByLabel('Synthetic fixture').selectOption('empty');assert.equal(await page.locator('[data-state="unknown"]').count(),2);await page.screenshot({path:path.join(out,'missing-320.png'),fullPage:true});
await page.getByLabel('Synthetic fixture').selectOption('full');assert.equal(await page.locator('[data-state="full"]').count(),2);assert.equal(await page.evaluate(()=>window.expected.periods.year.additions),0);
assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({synthetic:true,positiveLeadEstimate:before,horizonInteraction:true,widths:[1280,390,320],missing:true,full:true,errors},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
