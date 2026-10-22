import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire('/tmp/practice-oct20-render-deps/package.json');
const {chromium}=require('playwright');
const dir="/Users/eliam/Documents/Codex/2026-10-14/task-2/tidal-preview/integrated";
const browser=await chromium.launch({headless:true,executablePath:'/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await ctx.newPage(),errors=[],network=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
await ctx.route('**/*',r=>{if(new URL(r.request().url()).hostname!=='127.0.0.1'){network.push(r.request().url());return r.abort();}return r.continue();});
async function check(name,fn){try{await fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false,error:e.message});}}
async function section(name){await page.getByRole('navigation',{name:'Practice sections',exact:true}).getByRole('button',{name:new RegExp(name+'$')}).click();await page.getByRole('heading',{name,exact:true}).first().waitFor();await page.waitForTimeout(300);}
try{
 await page.goto('http://127.0.0.1:4183');await page.getByText('2 converted snapshots loaded',{exact:true}).waitFor();
 await check('Owned source renders without external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(network,[]);assert.equal(await page.locator('.pw-tidal-art').evaluate(n=>getComputedStyle(n).backgroundImage.includes('practice-tidal-art')),true);});
 await check('Exact synthetic initial values remain stable across section transitions',async()=>{const before=await page.locator('.pw-overview-historical-summary').innerText();await section('Money');await section('Overview');assert.equal(await page.locator('.pw-overview-historical-summary').innerText(),before);});
 await check('Keyboard widget reorder, resize and save stay real',async()=>{
  await page.getByRole('button',{name:'Edit layout',exact:true}).first().click();
  const widgets=page.locator('[aria-label="Overview widgets"] .pw-section-widget');
  const id=await widgets.first().getAttribute('data-widget-id');
  await page.getByRole('button',{name:'Move Caseload',exact:true}).focus();await page.keyboard.press('Alt+ArrowDown');assert.equal(await widgets.nth(1).getAttribute('data-widget-id'),id);
  await page.getByRole('combobox',{name:'Caseload size',exact:true}).selectOption('wide');assert.equal(await widgets.nth(1).getAttribute('data-widget-size'),'wide');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('button',{name:'Review changes',exact:true}).waitFor({state:'hidden'});
  await section('Money');await section('Overview');assert.equal(await widgets.nth(1).getAttribute('data-widget-id'),id);assert.equal(await widgets.nth(1).getAttribute('data-widget-size'),'wide');
 });
 await check('Inline allocation recalculates with synthetic state only',async()=>{await section('Money');const income=page.getByRole('spinbutton',{name:'Monthly billed revenue estimate',exact:true});await income.fill('35000');await income.blur();const percent=page.getByRole('spinbutton',{name:'Business profit current allocation percentage',exact:true});await percent.fill('6');await percent.blur();const row=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Business profit',exact:true})});assert.equal(await row.getByRole('cell').nth(1).innerText(),'$2,100');});
 await check('Chart is native and hover remains interactive',async()=>{await section('Sessions');assert.ok(await page.locator('.recharts-wrapper svg').count()>0);await page.locator('.recharts-wrapper').first().hover({position:{x:300,y:100}});});
 await check('Enabling reduced motion cancels an active section transition',async()=>{
  await page.evaluate(()=>{const nav=document.querySelector('nav[aria-label="Practice sections"]');[...nav.querySelectorAll('button')].find(b=>b.textContent.endsWith('Money')).click();});
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(30);
  assert.equal(await page.locator('.pw-content').evaluateAll(nodes=>nodes.reduce((count,node)=>count+node.getAnimations().length,0)),0);
  assert.equal(await page.locator('.pw-tidal-art').evaluate(n=>getComputedStyle(n).transform),'none');await page.emulateMedia({reducedMotion:'no-preference'});
 });
 await check('Scroll frame timing sample',async()=>{
  await section('Overview');const timing=await page.evaluate(async()=>{const samples=[];let previous=performance.now();for(let i=0;i<45;i++){await new Promise(requestAnimationFrame);const now=performance.now();samples.push(now-previous);previous=now;scrollBy(0,i<23?8:-8);}return {frames:samples.length,p95:samples.sort((a,b)=>a-b)[Math.floor(samples.length*.95)],max:Math.max(...samples)};});
  checks.push({name:'Measured desktop frame sample (not device guarantee)',pass:true,measurement:timing});assert.ok(timing.p95<100,'Desktop p95 frame sample exceeded 100ms');
 });
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
}finally{await ctx.close();await browser.close();await fs.writeFile(path.join(dir,'evidence/interaction-results.json'),JSON.stringify({checks,errors,network},null,2));console.log(JSON.stringify({checks,errors,network}));if(checks.some(c=>!c.pass))process.exitCode=1;}
