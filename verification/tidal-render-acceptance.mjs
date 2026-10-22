import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire('/tmp/practice-oct20-render-deps/package.json');
const {chromium}=require('playwright');
const dir="/Users/eliam/Documents/Codex/2026-10-14/task-2/tidal-preview/integrated";
await fs.mkdir(path.join(dir,'evidence'),{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const context=await browser.newContext({viewport:{width:1440,height:1050},recordVideo:{dir:path.join(dir,'evidence'),size:{width:1440,height:1050}}});
await context.addInitScript(()=>{const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-14T16:00:00Z']));}static now(){return new RealDate('2026-10-14T16:00:00Z').valueOf();}};});
const page=await context.newPage();
const errors=[],external=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort();}return route.continue();});
async function check(name,fn){try{await fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false,error:e.message});}}
async function section(name){await page.getByRole('navigation',{name:'Practice sections',exact:true}).getByRole('button',{name:new RegExp(name+'$')}).click();await page.getByRole('heading',{name,exact:true}).first().waitFor();await page.waitForTimeout(350);}
try{
 await page.goto('http://127.0.0.1:4183');await page.getByText('2 converted snapshots loaded',{exact:true}).waitFor();
 await page.waitForTimeout(700);
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1050});
  for(const name of ['Overview','Sessions','Money','Goals']){
   await section(name);await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);
   await page.screenshot({path:path.join(dir,'evidence',`${name.toLowerCase()}-${width}.png`),fullPage:true});
   await check(`${name} ${width}: no horizontal page overflow`,async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false));
  }
 }
 await page.setViewportSize({width:1440,height:1050});await section('Overview');await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(200);
 await check('Actual scroll parallax moves background independently',async()=>{
  const before=await page.locator('.pw-tidal-art').evaluate(n=>getComputedStyle(n).transform);
  await page.mouse.wheel(0,600);await page.waitForTimeout(500);
  const after=await page.locator('.pw-tidal-art').evaluate(n=>getComputedStyle(n).transform);
  assert.notEqual(after,before);await page.screenshot({path:path.join(dir,'evidence','overview-parallax.png')});
 });
 await check('Reduced motion disables scroll displacement',async()=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(100);
  assert.equal(await page.locator('.pw-tidal-art').evaluate(n=>getComputedStyle(n).transform),'none');
  await page.mouse.wheel(0,400);await page.waitForTimeout(100);assert.equal(await page.locator('.pw-tidal-art').evaluate(n=>getComputedStyle(n).transform),'none');
  await section('Sessions');assert.equal(await page.locator('.pw-content').evaluateAll(ns=>ns.reduce((n,s)=>n+s.getAnimations().length,0)),0);
 });
 await page.emulateMedia({reducedMotion:'no-preference'});
 await check('Real Budget controls remain reachable',async()=>{await section('Money');await page.getByRole('button',{name:'Budget',exact:true}).click();await page.getByRole('button',{name:/Add budget/i}).first().waitFor();await page.screenshot({path:path.join(dir,'evidence','budget-1440.png'),fullPage:true});});
 await check('No runtime errors or external requests',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(external,[]);});
}finally{
 await context.close();await browser.close();
 const result={checks,errors,external,syntheticOnly:true};await fs.writeFile(path.join(dir,'evidence/results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(checks.some(c=>!c.pass))process.exitCode=1;
}
