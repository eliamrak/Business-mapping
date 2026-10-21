import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "..");
const out = await fs.mkdtemp("/tmp/practice-oct21-live-call-");
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const build = await require("esbuild").build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{TooltipProvider}from'@/components/ui/tooltip';import PracticeWorkspace from '@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><PracticeWorkspace/></TooltipProvider></QueryClientProvider>);`, loader: "tsx", resolveDir: path.join(root, "artifacts/comp-dashboard") }, bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic", alias: { "@": path.join(root, "artifacts/comp-dashboard/src") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"BASE_URL":"/"}' }, outdir: path.join(out, "bundle") });
const index = await fs.readFile(path.join(root, "artifacts/comp-dashboard/dist/public/index.html"), "utf8");
const cssName = index.match(/href="\/assets\/(index-[^"]+\.css)"/)[1];
const css = Buffer.concat([await fs.readFile(path.join(root, "artifacts/comp-dashboard/dist/public/assets", cssName)), ...build.outputFiles.filter(f => f.path.endsWith(".css")).map(f => Buffer.from(f.contents))]);
const server = http.createServer((req, res) => {
  if (req.method !== "GET") { res.writeHead(405); return res.end(); }
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(build.outputFiles.find(f => f.path.endsWith(".js")).contents); }
  if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
  res.setHeader("Content-Type", "text/html");res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/workspace`;
let setup = await fs.readFile(path.join(root, "verification/render-practice-workspace.mjs"), "utf8");
setup = setup.slice(0, setup.indexOf("const checks = [];"));
process.env.PRACTICE_PLAYWRIGHT_PACKAGE ??= "/tmp/practice-oct20-render-deps/package.json";
process.env.PRACTICE_CHROMIUM_PATH ??= "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell";
process.env.PRACTICE_RENDER_OUTPUT = out;
const tests = `const FIXTURE=${JSON.stringify(url)};const OUTPUT=${JSON.stringify(out)};` + String.raw`
const checks=[],writes=[],external=[];
const originals=JSON.stringify({snapshots,packages,context});
await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(FIXTURE).origin){external.push(u.origin);return route.abort();}if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push({path:u.pathname,method:req.method()});assert.equal(u.pathname,'/api/hub');}return route.fallback();});
async function check(name,body){try{await body();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:String(error.message).split('data:text/javascript')[0]});}}
async function section(label){await page.getByRole('navigation',{name:'Practice sections',exact:true}).getByRole('button',{name:new RegExp(label+'$')}).click();await page.getByRole('heading',{name:label,exact:true}).first().waitFor();}
async function save(){await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('button',{name:'Review changes',exact:true}).waitFor({state:'hidden'});}
try{
 await page.goto(FIXTURE);await page.getByText('2 converted snapshots loaded',{exact:true}).waitFor();
 for(const width of (process.env.PRACTICE_ACCEPTANCE_WIDTH ? [Number(process.env.PRACTICE_ACCEPTANCE_WIDTH)] : [1280,390,320])){
  await page.setViewportSize({width,height:900});
  for(const label of ['Overview','Sessions','Money','Goals'])await check(label+' layout '+width,async()=>{
   await section(label);await page.waitForTimeout(100);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);assert.equal(overflow,false,'No document horizontal overflow');
   await page.screenshot({path:path.join(OUTPUT,label.toLowerCase()+'-'+width+'.png'),fullPage:true});
   if(label==='Money')await fs.writeFile(path.join(OUTPUT,'money-'+width+'-bounds.json'),JSON.stringify(await page.locator('.pf-planning table,.pf-planning tbody,.pf-planning tbody tr,.pf-planning tbody td,.pf-planning tbody input').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{tag:node.tagName,label:node.getAttribute('aria-label')||node.getAttribute('data-label'),left:r.left,right:r.right,width:r.width,display:s.display,minWidth:s.minWidth,grid:s.gridTemplateColumns,boxSizing:s.boxSizing};})),null,2));
   if(label==='Overview'){assert.equal(await page.locator('.pw-overview-historical-summary .pw-percentage-kpi-ring').count(),8);assert.equal(await page.locator('.pw-overview-historical-summary > section').count(),4);}
   if(label==='Money'){assert.equal(await page.getByText('October allocations',{exact:true}).count(),1);assert.equal(await page.getByText('Targets and fund balances',{exact:true}).count(),0);const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Cost estimates and source periods$/})});assert.equal(await details.getAttribute('open'),null);if(width<=390){assert.ok(await page.locator('.pf-planning tbody td,.pf-planning tbody input').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;})),'Every mobile allocation cell and editor must fit, not merely the document');}const help=page.locator('.pf-planning details.pf-help').first();await help.locator('summary').focus();await page.keyboard.press('Enter');assert.notEqual(await help.getAttribute('open'),null);await help.locator('summary').click();assert.equal(await help.getAttribute('open'),null);}
  });
 }
 await page.setViewportSize({width:1280,height:900});
 await check('Sessions caption changes with relative and custom periods',async()=>{
  await section('Sessions');const selector=page.getByRole('combobox',{name:'Shared reporting period',exact:true});await selector.selectOption('60d');assert.ok((await page.locator('[aria-label="Session trends card"]').innerText()).includes('Last 60 days'));await selector.selectOption('custom');const dates=page.locator('.pw-shared-period input[type="date"]');assert.equal(await dates.count(),2);await dates.nth(0).fill('2026-09-01');await dates.nth(1).fill('2026-09-20');assert.ok((await page.locator('[aria-label="Session trends card"]').innerText()).includes('Selected activity dates: 2026-09-01 to 2026-09-20'));});
 await check('Money inline change recalculates, validates, saves and reopens synthetic data',async()=>{
  await section('Money');const revenue=page.getByRole('spinbutton',{name:'Monthly billed revenue estimate',exact:true});await revenue.fill('35000');await revenue.blur();const current=page.getByRole('spinbutton',{name:'Business profit current allocation percentage',exact:true});await current.fill('6');await current.blur();const profitRow=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Business profit',exact:true})});assert.equal(await profitRow.getByRole('cell').nth(1).innerText(),'$2,100');const floor=page.getByRole('spinbutton',{name:'Business profit scenario percentage floor',exact:true});await floor.fill('8');await floor.blur();await save();assert.equal(workspace.moneyPlanning.estimatedMonthlyValues.revenue,35000);assert.equal(workspace.moneyPlanning.currentPercents['business-profit'],6);assert.equal(workspace.moneyPlanning.scenarioPercents['business-profit'],8);await page.reload();await section('Money');assert.equal(await revenue.inputValue(),'35000.00');assert.equal(await current.inputValue(),'6');assert.equal(await floor.inputValue(),'8');await page.getByRole('button',{name:'Last month',exact:true}).click();assert.equal(await page.getByText('September allocations',{exact:true}).count(),1);
 });
 await check('Goals performance targets persist without changing observed evidence',async()=>{await section('Goals');const input=page.getByRole('spinbutton',{name:'Retention (%)',exact:true});await input.fill('80');await input.blur();await save();assert.equal(workspace.settings.performanceTargets.retentionPct,80);await page.reload();await section('Goals');assert.equal(await input.inputValue(),'80');});
 assert.equal(JSON.stringify({snapshots,packages,context}),originals);assert.deepEqual(browserErrors,[]);
 const result={syntheticOnly:true,checks,writes,external,browserErrors};await fs.writeFile(path.join(OUTPUT,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out:OUTPUT,pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>!c.pass)}));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await browser.close();}
`;
try { await import('data:text/javascript;base64,' + Buffer.from(setup + tests).toString('base64')); }
catch(error) { console.error(JSON.stringify({out,error:String(error.message).split('data:text/javascript')[0]}));process.exitCode=1; }
finally { server.closeAllConnections();await new Promise(resolve => server.close(resolve)); }
