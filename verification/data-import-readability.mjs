import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const phase=process.argv.includes('--baseline')?'baseline':'candidate';
const out=path.resolve(root,'../data-import-readability-evidence',phase);await fs.mkdir(out,{recursive:true});
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
const {build}=require('esbuild');
const {chromium}=createRequire('/tmp/practice-oct20-render-deps/package.json')('playwright');
const fixture=JSON.parse(await fs.readFile(path.join(root,'verification/fixtures/tidal-workspace.json'),'utf8'));
const golden=await fs.readFile(path.join(root,'docs/practice-local-import-package-v1.golden.json'),'utf8');
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{TooltipProvider}from'@/components/ui/tooltip';import PracticeWorkspace from'@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><PracticeWorkspace/></TooltipProvider></QueryClientProvider>);`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:path.join(root,'artifacts/comp-dashboard')},bundle:true,write:false,minify:true,platform:'browser',format:'esm',jsx:'automatic',loader:{'.png':'file','.jpg':'file'},alias:{'@':path.join(root,'artifacts/comp-dashboard/src')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"BASE_URL":"/"}'},outdir:out});
const files=new Map(bundle.outputFiles.map(f=>['/'+path.basename(f.path),f.contents]));
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents;
const css=Buffer.concat([await fs.readFile('/tmp/practice-tidal-public-repro-fKvp4n/artifacts/comp-dashboard/dist/public/assets/index-BH0dfUm1.css'),...bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.contents)]);
let mode='loaded',posts=0;
const history=()=>({snapshots:mode==='empty'?[]:fixture.snapshots,packages:mode==='empty'?[]:fixture.packages,billingCodeMinutes:{'90837':60},sameDayVisitOverrides:{},declarations:null,billingResolutions:[],billingResolutionRevision:0});
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(req.method==='POST'&&u.pathname==='/api/practice-imports/package'){
      posts++;for await(const _ of req){}await new Promise(resolve=>setTimeout(resolve,200));
      if(mode==='overlap'){res.writeHead(409);res.end(JSON.stringify({error:'Synthetic overlap needs review',code:'OVERLAP_REVIEW_REQUIRED',existing:fixture.snapshots}));return;}
      if(mode==='server-error'){res.writeHead(500);res.end(JSON.stringify({error:'Synthetic upload unavailable; nothing saved.'}));return;}
      res.end(JSON.stringify({...history(),status:'added'}));return;
    }
    if(req.method!=='GET'){res.writeHead(405);res.end(JSON.stringify({error:'Synthetic test forbids this write'}));return;}
    const data=u.pathname==='/api/hub'?{revision:1,data:fixture.workspace,updatedAt:'2026-10-14T00:00:00Z'}:u.pathname==='/api/hub/context'?fixture.context:u.pathname==='/api/practice-imports'?history():u.pathname==='/api/practice-imports/billing-resolution-candidates'?{revision:0,candidates:mode==='empty'?[]:[{caseToken:'synthetic-case',clinicianLabel:'Synthetic clinician',serviceDate:'2026-09-15',billingCode:'90837',amounts:[100,80],rawRowCount:2,sourceCount:2,resolutionId:null,stale:false,canAccept:true}]}:u.pathname==='/api/business-goals'?fixture.goals:u.pathname==='/api/practice-imports/capabilities'?{}:[];
    res.end(JSON.stringify(data));return;
  }
  if(u.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
  if(u.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  if(files.has(u.pathname)){res.setHeader('Content-Type',u.pathname.endsWith('.jpg')?'image/jpeg':'image/png');res.end(files.get(u.pathname));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const checks=[],errors=[];const context=await browser.newContext({viewport:{width:1440,height:1050}});
await context.addInitScript(()=>{const D=Date;window.Date=class extends D{constructor(...args){super(...(args.length?args:['2026-10-22T12:00:00Z']));}static now(){return new D('2026-10-22T12:00:00Z').valueOf();}};});
await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
async function openData(scenario='loaded'){
  mode=scenario;await page.goto(origin);await page.getByRole('button',{name:'Data & imports',exact:true}).click();await page.getByRole('heading',{name:'Imported clinical history',exact:true}).waitFor();await page.waitForTimeout(150);
}
async function contrast(){return page.locator('.pw-local-retention, #retention-calculations').evaluateAll(roots=>{
  const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);const blend=(a,b)=>{const alpha=a[3]??1;return[a[0]*alpha+b[0]*(1-alpha),a[1]*alpha+b[1]*(1-alpha),a[2]*alpha+b[2]*(1-alpha),1];};
  const luminance=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
  const findings=[];let sampled=0;
  for(const root of roots)for(const e of root.querySelectorAll('p,h2,h3,label,legend,summary,td,th,button,textarea,input,select')){
    if(!e.getClientRects().length||e.disabled)continue;
    if((e.tagName==='INPUT'&&['checkbox','radio'].includes(e.type))||(!e.textContent.trim()&&!['INPUT','TEXTAREA','SELECT'].includes(e.tagName)))continue;
    let chain=[];for(let n=e;n;n=n.parentElement)chain.push(n);let bg=[255,255,255,1];for(const n of chain.reverse())bg=blend(rgb(getComputedStyle(n).backgroundColor),bg);
    const style=getComputedStyle(e),fg=blend(rgb(style.color),bg);const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);sampled++;
    if(ratio<4.5)findings.push({tag:e.tagName,className:e.className,ratio:+ratio.toFixed(2),color:style.color,background:bg.slice(0,3).map(Math.round)});
  }return{sampled,findings};
});}
try{
  await openData();
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1050});await page.evaluate(()=>{scrollTo(0,0);document.querySelectorAll('.pw-local-retention details').forEach(d=>d.open=true);});await page.waitForTimeout(120);
    await page.screenshot({path:path.join(out,`data-top-${width}.png`)});
    for(const [name,selector] of [['upload','.pw-local-import-grid'],['billing','section[aria-label="Billing charge exceptions"]'],['tables','.pw-local-tables'],['calculations','#retention-calculations']])await page.locator(selector).screenshot({path:path.join(out,`${name}-${width}.png`)});
    const c=await contrast();checks.push({name:`expanded-all-subviews-${width}`,pass:phase==='baseline'||c.findings.length===0,...c});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);checks.push({name:`page-fit-${width}`,pass:!overflow});
  }
  if(phase==='candidate'){
    await page.setViewportSize({width:390,height:1050});await openData('empty');await page.screenshot({path:path.join(out,'empty-390.png'),fullPage:true});checks.push({name:'empty-state-contrast',pass:(await contrast()).findings.length===0});
    await page.locator('input[type=file]').first().setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('not json')});await page.getByRole('alert').filter({hasText:'not valid JSON'}).waitFor();checks.push({name:'invalid-json-local-rejection',pass:posts===0});
    await page.getByLabel('Upload converter package',{exact:true}).setInputFiles({name:'wrong-envelope',mimeType:'text/plain',buffer:Buffer.from('{}')});await page.getByRole('alert').filter({hasText:'not a supported Practice import package'}).waitFor();checks.push({name:'wrong-schema-rejected-before-api',pass:posts===0});
    checks.push({name:'native-picker-does-not-hide-extensionless-package',pass:await page.getByLabel('Upload converter package',{exact:true}).getAttribute('accept')===null});
    const upload=()=>page.locator('input[type=file]').first().setInputFiles({name:'practice-package 10.22',mimeType:'text/plain',buffer:Buffer.from(golden)});
    await upload();assert.ok(await page.getByLabel('Upload converter package',{exact:true}).isDisabled());checks.push({name:'upload-busy-state-prevents-duplicate-submission',pass:true});await page.getByText(/^Saved package /).waitFor();checks.push({name:'extensionless-valid-package-uses-synthetic-api',pass:posts===1});
    await openData('overlap');await upload();await page.getByRole('button',{name:'Keep history and reconcile overlap',exact:true}).waitFor();await page.locator('.pw-overlap-review').screenshot({path:path.join(out,'overlap-390.png')});checks.push({name:'overlap-review-contrast',pass:(await contrast()).findings.length===0});
    await openData('server-error');await upload();await page.getByRole('alert').filter({hasText:'Synthetic upload unavailable'}).waitFor();await page.locator('.pw-error').screenshot({path:path.join(out,'upload-error-390.png')});checks.push({name:'server-error-readable-and-not-saved',pass:(await contrast()).findings.length===0});
  }
  checks.push({name:'no-runtime-errors',pass:errors.length===0});
}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
const result={phase,syntheticOnly:true,noOwnerFiles:true,checks,errors};await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(checks.some(c=>!c.pass))process.exitCode=1;
