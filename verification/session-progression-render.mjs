import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = process.env.PRACTICE_PROGRESSION_EVIDENCE ?? '/tmp/practice-progression-render';
await fs.mkdir(out, { recursive: true });
const result = await build({ stdin: { loader: 'tsx', resolveDir: path.join(root, 'artifacts/comp-dashboard'), contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SessionProgressionPanel} from './src/components/practice/session-progression-panel';
import {importAttendanceCsv} from './src/lib/retention-local';
import {completeReportCoverage} from './src/lib/complete-report-coverage';
import {sessionProgression} from './src/lib/session-progression';
import './src/pages/practice-tokens.css';
import './src/pages/practice-workspace.css';
import './src/pages/practice-approved.css';
const rows = [];
[8,8,7,6,5,4,3,2,2,1,1,1].forEach((visits, client) => {
  for (let i=0;i<visits;i++) rows.push(['synthetic-'+client, i > 1 ? 'Other' : 'Lane',new Date(Date.UTC(2026,0,2+i*7)).toISOString().slice(0,10),'Room','show'].join(','));
});
rows.push('synthetic-other,Other,2026-01-03,Room,show','synthetic-other,Other,2026-01-10,Room,show','synthetic-recent,Lane,2026-06-25,Room,show');
const snapshot = {...importAttendanceCsv('Client,Clinician,Date of service,Location,Status\\n'+rows.join('\\n')).snapshot,reportCoverage:{start:'2026-01-01',end:'2026-07-01',complete:true}};
const sources = [snapshot];
const before = JSON.stringify(sources);
const coverage = completeReportCoverage(sources,[{id:1,label:'Lane'},{id:2,label:'Other'}],'2026-07-01');
function App() {
 const [scope,setScope]=useState('practice'); const [theme,setTheme]=useState('tidal');
 const [start,setStart]=useState('2026-01-01');
 const identityVerified=scope!=='ambiguous';
 const clinician=scope==='Lane'||scope==='Other'?scope:undefined;
 const snapshots=scope==='empty'?[]:coverage.eligibleSnapshots;
 const excludedFollowUpEvidence=scope==='unresolved'?[{clientId:snapshot.rows[0].clientId,serviceDate:'2026-03-01'}]:[];
 window.fixture={expected:sessionProgression(snapshots,{start,end:'2026-06-30',asOf:'2026-07-01',clinician,classificationSnapshots:sources,excludedFollowUpEvidence}),unchanged:JSON.stringify(sources)===before};
 return <main className='pw-app fixture-app' data-material={theme}>
 <div className='fixture-controls' aria-label='Synthetic fixture controls'>
 <label>Fixture scope <select aria-label='Fixture scope' value={scope} onChange={e=>setScope(e.target.value)}>{['practice','Lane','Other','empty','ambiguous','unresolved'].map(s=><option key={s}>{s}</option>)}</select></label>
 <label>Fixture theme <select aria-label='Fixture theme' value={theme} onChange={e=>setTheme(e.target.value)}><option>tidal</option><option>dark</option></select></label>
 <label>Cohort start <input aria-label='Fixture cohort start' type='date' value={start} onChange={e=>setStart(e.target.value)} /></label>
 <span>Synthetic data only</span></div>
 <SessionProgressionPanel snapshots={snapshots} classificationSnapshots={sources} excludedFollowUpEvidence={excludedFollowUpEvidence} overrides={{}} start={start} end='2026-06-30' asOf='2026-07-01' clinician={clinician} identityVerified={identityVerified} coverage={coverage}/>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`}, bundle:true, write:false, format:'esm', platform:'browser', jsx:'automatic', outdir:out, define:{'process.env.NODE_ENV':'"development"'}, nodePaths:process.env.PRACTICE_UI_NODE_PATH ? [process.env.PRACTICE_UI_NODE_PATH] : [] });
const js = result.outputFiles.find(x=>x.path.endsWith('.js')).contents;
const css = result.outputFiles.find(x=>x.path.endsWith('.css')).contents;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{margin:0}.fixture-app{box-sizing:border-box;display:block;padding:28px;max-width:1280px;margin:auto;overflow:visible}.fixture-controls{display:flex;flex-wrap:wrap;gap:16px;padding:0 0 20px;font-size:12px;align-items:center}.fixture-controls label{display:flex;align-items:center;gap:6px}.fixture-controls select,.fixture-controls input{font-size:12px;padding:6px}@media(max-width:700px){.fixture-app{padding:12px}.fixture-controls{gap:10px}}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`;
await fs.writeFile(path.join(out, 'index.html'), html);
await fs.writeFile(path.join(out, 'bundle.js'), js);
await fs.writeFile(path.join(out, 'styles.css'), css);
if (process.argv.includes('--build-only')) { console.log(JSON.stringify({status:'built-not-rendered',out,jsBytes:js.length,cssBytes:css.length})); process.exit(0); }
const requests=[]; const errors=[]; const consoleErrors=[]; const checks=[];
const server=http.createServer((req,res)=>{requests.push({url:req.url,method:req.method});const item=req.url==='/'?[html,'text/html']:req.url==='/bundle.js'?[js,'text/javascript']:req.url==='/styles.css'?[css,'text/css']:req.url==='/favicon.ico'?['','image/x-icon']:null;if(!item){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':item[1]});res.end(item[0]);});
await new Promise(resolve=>server.listen(Number(process.env.PORT??4173),'0.0.0.0',resolve));
const port=server.address().port;
console.log('Synthetic component preview http://terminal.local:'+port+'/');
if(process.argv.includes('--serve-only')) await new Promise(()=>{});
const req=createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE??'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=req('playwright');
let browser;
try {
browser=await chromium.launch({headless:true,executablePath:process.env.PRACTICE_FULL_CHROME??'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1,acceptDownloads:true});
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
await page.goto('http://127.0.0.1:'+port+'/');
await page.getByRole('heading',{name:'Observed session progression',exact:true}).waitFor();
async function check(name,fn){await fn();checks.push(name);}
async function reset(){await page.getByLabel('Fixture scope').selectOption('practice');await page.getByLabel('Fixture theme').selectOption('tidal');await page.getByLabel('Fixture cohort start').fill('2026-01-01');await page.getByLabel('Session milestones').selectOption('8');}
async function counts(){const expected=await page.evaluate(()=>window.fixture.expected);const trs=page.locator('.pw-progression-table tbody tr');assert.equal(await trs.count(),8);for(let i=0;i<8;i++){const row=expected.rows[i];assert.deepEqual(await trs.nth(i).locator('th,td').allTextContents(),['Session '+row.session,String(row.eligibleClients),String(row.completions),row.reachedPct===null?'—':row.reachedPct.toFixed(1)+'%',row.changePercentagePoints===null?'—':row.changePercentagePoints.toFixed(1)+' pp']);}}
await check('real calculated counts, denominators and unrounded percentage-point display',counts);
await check('line graph uses actual row data with full size and accessible exact-data table',async()=>{assert.equal(await page.locator('.recharts-line-curve').count(),1);assert.equal(await page.locator('.recharts-line-dot').count(),8);const box=await page.locator('.recharts-surface').boundingBox();assert.ok(box.width>900&&box.height>200);assert.equal(await page.getByRole('table').count(),1);});
await check('chart tooltip exposes cohort counts and denominator',async()=>{await page.locator('.recharts-line-dot').nth(1).hover();await page.locator('.pw-progression-tooltip').waitFor();assert.match(await page.locator('.pw-progression-tooltip').innerText(),/of 14 clients/);});
await page.mouse.move(0,0);
await page.screenshot({path:path.join(out,'desktop-tidal.png'),fullPage:true});
await page.locator('.pw-progression-table').screenshot({path:path.join(out,'desktop-table.png')});
await check('session limit changes repeatedly without stale rows',async()=>{for(const count of [20,12,30,8]){await page.getByLabel('Session milestones').selectOption(String(count));assert.equal(await page.locator('.pw-progression-table tbody tr').count(),count);}});
await check('aggregate CSV export works and contains no synthetic client identifiers',async()=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV'}).click();const download=await event;await download.saveAs(path.join(out,'aggregate.csv'));const text=await fs.readFile(path.join(out,'aggregate.csv'),'utf8');assert.match(text,/Mean elapsed days/);assert.doesNotMatch(text,/synthetic-/);});
await check('clinician selection retains cross-clinician follow-up',async()=>{await page.getByLabel('Fixture scope').selectOption('Lane');await counts();assert.equal(await page.locator('.pw-progression-table tbody tr').nth(7).locator('td').nth(1).innerText(),'2');await page.getByLabel('Fixture scope').selectOption('Other');await counts();assert.equal(await page.locator('.pw-progression-table tbody tr').first().locator('td').first().innerText(),'1');});
await check('cohort dates select first observation without changing source rows',async()=>{await reset();await page.getByLabel('Fixture cohort start').fill('2026-06-01');await counts();assert.equal(await page.locator('.pw-progression-table tbody tr').first().locator('td').first().innerText(),'1');await reset();});
await check('empty cohort shows explicit unknowns, not zero percentages',async()=>{await page.getByLabel('Fixture scope').selectOption('empty');await page.getByText(/No eligible clients had/).waitFor();assert.equal(await page.locator('.recharts-line-curve').count(),0);await counts();assert.equal(await page.getByRole('button',{name:'Export CSV'}).isDisabled(),true);await page.screenshot({path:path.join(out,'empty.png'),fullPage:true});});
await check('ambiguous clinician suppresses metrics rather than showing another cohort',async()=>{await page.getByLabel('Fixture scope').selectOption('ambiguous');await page.getByText(/This clinician name maps to multiple records/).waitFor();assert.equal(await page.getByRole('table').count(),0);});
await check('unresolved evidence is visible and prevents unsupported lifetime certainty',async()=>{await page.getByLabel('Fixture scope').selectOption('unresolved');await page.getByText(/1 cohort clients have unresolved follow-up evidence/).waitFor();assert.match(await page.locator('.pw-progression-lifetime').innerText(),/not expected eventual lifetime/);});
await reset();
await check('keyboard details open and close with focus preserved',async()=>{const summary=page.getByText('How to read this',{exact:true});await summary.focus();await page.keyboard.press('Enter');assert.equal(await summary.evaluate(el=>el.parentElement.open),true);await page.keyboard.press('Enter');assert.equal(await summary.evaluate(el=>el.parentElement.open),false);assert.equal(await summary.evaluate(el=>document.activeElement===el),true);});
for(const width of [768,390,320]){
 await page.setViewportSize({width,height:900});await page.locator('.pw-progression-chart').waitFor();await page.waitForTimeout(150);
 await check(width+'px no page overflow; bounded table remains scrollable',async()=>{const g=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,table:document.querySelector('.pw-progression-table-scroll').scrollWidth,box:document.querySelector('.pw-progression-table-scroll').clientWidth}));assert.ok(g.page<=g.viewport+1,JSON.stringify(g));if(width<700)assert.ok(g.table>g.box);});
 await page.screenshot({path:path.join(out,width+'-tidal.png'),fullPage:true});
}
await page.setViewportSize({width:1280,height:1000});await page.getByLabel('Fixture theme').selectOption('dark');await page.screenshot({path:path.join(out,'desktop-dark.png'),fullPage:true});
await check('source inputs remain unchanged; no business/API requests',async()=>{assert.equal(await page.evaluate(()=>window.fixture.unchanged),true);assert.ok(requests.every(r=>r.method==='GET'&&['/','/bundle.js','/styles.css','/favicon.ico'].includes(r.url)));assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);});
const report={status:'passed',checks,errors,consoleErrors,requests,scope:'Actual component and domain, synthetic sources; not authenticated production or full-app acceptance'};
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch (error) {
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify({status:'failed',checks,errors,consoleErrors,error:String(error),scope:'Synthetic fixture only'},null,2));
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
