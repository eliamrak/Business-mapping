import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');
const phase=process.argv.includes('--baseline')?'baseline':'candidate';
const out=path.resolve(root,'../minimal-import-evidence',phase);await fs.mkdir(out,{recursive:true});
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
let mode='loaded',posts=0,gets=0,savedSnapshots=[],savedPackages=[],savedMinutes={};
const requests=[],blocked=[];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function reset(scenario){mode=scenario;savedSnapshots=structuredClone(scenario==='empty'?[]:fixture.snapshots);savedPackages=structuredClone(scenario==='empty'?[]:fixture.packages);savedMinutes={'90837':60};}
const history=()=>({snapshots:savedSnapshots,packages:savedPackages,billingCodeMinutes:savedMinutes,sameDayVisitOverrides:{},declarations:null,billingResolutions:[],billingResolutionRevision:0});
function persist(input){
  const contentHash=hash(input);
  if(savedPackages.some(p=>p.packageId===input.packageId&&p.contentHash===contentHash))return 'duplicate';
  for(const kind of ['attendance','billing']){
    const collection=input.collections[kind],sourceHash=hash(collection);
    if(savedSnapshots.some(s=>s.kind===kind&&s.sourceHash===sourceHash))continue;
    savedSnapshots.push({id:`${kind}-${sourceHash}`,kind,sourceHash,importedAt:'2026-10-22T12:00:00Z',coverageStart:collection.coverageStart,coverageEnd:collection.coverageEnd,rows:collection.rows.map(row=>({...row,sourceRowHash:hash(row)}))});
  }
  savedPackages.push({packageId:input.packageId,contentHash,exportedAt:input.exportedAt,importedAt:'2026-10-22T12:00:00Z'});
  savedMinutes={...savedMinutes,...input.billingCodeMinutes};return 'added';
}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')){
    requests.push({method:req.method,path:u.pathname});
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(req.method==='POST'&&u.pathname==='/api/practice-imports/package'){
      posts++;let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);await new Promise(resolve=>setTimeout(resolve,350));
      if(['overlap','overlap-unconfirmed'].includes(mode)&&!input.retainOverlaps&&!input.replaceOverlaps){res.writeHead(409);res.end(JSON.stringify({error:'Synthetic overlap needs review',code:'OVERLAP_REVIEW_REQUIRED',existing:savedSnapshots}));return;}
      if(mode==='server-error'||mode==='overlap-unconfirmed'){persist(input.package);res.writeHead(500);res.end(JSON.stringify({error:'Synthetic acknowledgement unavailable.'}));return;}
      const status=persist(input.package);res.end(JSON.stringify({...history(),status:status==='duplicate'?status:input.retainOverlaps?'retained':status}));return;
    }
    if(req.method!=='GET'){res.writeHead(405);res.end(JSON.stringify({error:'Synthetic test forbids this write'}));return;}
    if(u.pathname==='/api/practice-imports')gets++;
    const data=u.pathname==='/api/hub'?{revision:1,data:fixture.workspace,updatedAt:'2026-10-14T00:00:00Z'}:u.pathname==='/api/hub/context'?fixture.context:u.pathname==='/api/practice-imports'?history():u.pathname==='/api/practice-imports/billing-resolution-candidates'?{revision:0,candidates:[]}:u.pathname==='/api/business-goals'?fixture.goals:u.pathname==='/api/practice-imports/capabilities'?{}:[];
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
const observedStages=new Set();await context.exposeFunction('__recordImportStage',stage=>observedStages.add(stage));
await context.addInitScript(()=>{const D=Date;window.Date=class extends D{constructor(...args){super(...(args.length?args:['2026-10-22T12:00:00Z']));}static now(){return new D('2026-10-22T12:00:00Z').valueOf();}};});
await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
await context.addInitScript(()=>{
  const read=File.prototype.text;
  File.prototype.text=async function(){await new Promise(resolve=>setTimeout(resolve,250));return read.call(this);};
  window.__importStages=[];
  new MutationObserver(()=>{const el=document.querySelector('.pw-import-start [role=status]');if(el){window.__importStages.push({stage:el.dataset.stage,text:el.textContent});void window.__recordImportStage(el.dataset.stage);}}).observe(document,{subtree:true,childList:true,characterData:true});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
async function openData(scenario='loaded'){
  reset(scenario);await page.goto(origin);await enterData();
}
async function enterData(){await page.getByRole('button',{name:'Data & imports',exact:true}).click();await panel().getByRole('heading',{name:'Upload reports',exact:true}).waitFor();await status('Loaded from saved history');await page.waitForTimeout(350);}
const panel=()=>page.locator('.pw-import-start');
async function status(title){await panel().getByRole('status').getByText(title,{exact:true}).waitFor();}
async function savedStatus(){
  await page.waitForFunction(()=>!document.querySelector('.pw-import-start')||document.querySelector('.pw-import-start [role=status]')?.dataset.stage==='saved');
  await page.waitForTimeout(200);
  const stayed=await panel().isVisible();checks.push({name:'upload-keeps-data-receipt-visible',pass:stayed});
  assert.ok(stayed,'Upload must keep Data and its receipt visible; no automatic Rooms navigation');
  await status('Saved to practice storage');
}
async function sourceCount(count){await page.waitForFunction(n=>[...document.querySelectorAll('.pw-import-coverage > div')].some(e=>e.textContent===`Saved sources${n}`),count);}
async function contrast(){return page.locator('.pw-local-retention, #retention-calculations').evaluateAll(roots=>{
  const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);const blend=(a,b)=>{const alpha=a[3]??1;return[a[0]*alpha+b[0]*(1-alpha),a[1]*alpha+b[1]*(1-alpha),a[2]*alpha+b[2]*(1-alpha),1];};
  const luminance=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
  const findings=[];let sampled=0;
  for(const root of roots)for(const e of root.querySelectorAll('p,h2,h3,label,legend,summary,td,th,button,textarea,input,select,span,strong,small,a')){
    if(!e.getClientRects().length||e.disabled||!e.checkVisibility())continue;
    if((e.tagName==='INPUT'&&['checkbox','radio'].includes(e.type))||(!e.textContent.trim()&&!['INPUT','TEXTAREA','SELECT'].includes(e.tagName)))continue;
    let chain=[];for(let n=e;n;n=n.parentElement)chain.push(n);let bg=[255,255,255,1],unresolvedImage=false;for(const n of chain.reverse()){
      const s=getComputedStyle(n),color=rgb(s.backgroundColor);
      if((color[3]??1)===1)unresolvedImage=false;
      bg=blend(color,bg);if(s.backgroundImage!=='none')unresolvedImage=true;
    }
    const style=getComputedStyle(e),fg=blend(rgb(style.color),bg);const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);sampled++;
    if(unresolvedImage||ratio<4.5)findings.push({tag:e.tagName,className:e.className,ratio:unresolvedImage?null:+ratio.toFixed(2),reason:unresolvedImage?'Transparent text surface over background image; computed solid-color contrast is insufficient':undefined,color:style.color,background:bg.slice(0,3).map(Math.round)});
  }return{sampled,findings};
});}
try{
  page.setDefaultTimeout(10000);
  const record=(name,pass,detail={})=>checks.push({name,pass,...detail});
  const upload=(contents=golden,name='practice-package 10.22')=>panel().getByLabel('Upload converter package',{exact:true}).setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(contents)});
  for(const width of [1440,1280,390,320]){
    await page.setViewportSize({width,height:1050});await openData();
    const disclosures=page.locator('.pw-data-disclosure');
    record(`default-collapsed-${width}`,await disclosures.count()>=4&&await disclosures.evaluateAll(ds=>ds.every(d=>!d.open)));
    record(`four-default-review-rows-${width}`,await disclosures.locator(':scope > summary:visible').count()===4);
    record(`upload-first-no-checkbox-wall-${width}`,await page.locator('.pw-local-retention').evaluate(el=>el.firstElementChild.matches('.pw-import-start'))&&await page.locator('.pw-local-retention input[type=checkbox]:visible').count()===0);
    await page.screenshot({path:path.join(out,`data-top-${width}.png`)});
    let c=await contrast();record(`collapsed-contrast-${width}`,c.findings.length===0,c);
    for(let i=0;i<await disclosures.count();i++){
      const disclosure=disclosures.nth(i),summary=disclosure.locator(':scope > summary');
      await disclosure.evaluate(el=>{for(let p=el.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true;});
      await summary.focus();await page.keyboard.press('Enter');assert.equal(await disclosure.getAttribute('open'),'');
      await page.keyboard.press('Space');assert.equal(await disclosure.getAttribute('open'),null);
    }
    record(`keyboard-expand-collapse-${width}`,true);
    await disclosures.evaluateAll(ds=>ds.forEach(d=>d.open=false));
    const reviewPaths=[];
    for(const [label,id] of [['Review coverage and identities','import-coverage-review'],['Review billing exceptions','import-billing-review']]){
      const link=panel().getByRole('link',{name:label,exact:true}),review=page.locator(`#${id}`);
      if(id==='import-coverage-review')assert.ok(await link.isVisible(),'Actionable fixture coverage must expose its review link');
      if(id==='import-billing-review')assert.equal(await link.count(),0,'Fixture without billing exceptions must not claim billing needs review');
      if(await link.isVisible()){
        await link.click();reviewPaths.push({id,via:'attention-link'});
      }else{
        await review.locator(':scope > summary').click();reviewPaths.push({id,via:'disclosure-summary'});
      }
      assert.equal(await review.getAttribute('open'),'');
    }
    record(`attention-links-open-review-${width}`,true,{reviewPaths});
    await page.evaluate(()=>document.querySelectorAll('.pw-local-retention details, #retention-calculations').forEach(d=>d.open=true));
    await page.locator('#retention-calculations').screenshot({path:path.join(out,`calculations-${width}.png`)});
    await page.locator('#import-billing-review').screenshot({path:path.join(out,`billing-${width}.png`)});
    c=await contrast();record(`expanded-contrast-${width}`,c.findings.length===0,c);
    const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));record(`expanded-page-fit-${width}`,overflow.scrollWidth<=width+1,overflow);
    await page.evaluate(()=>{document.querySelectorAll('.pw-data-disclosure').forEach(d=>d.open=false);scrollTo(0,0);});
    const fit=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);record(`collapsed-page-fit-${width}`,fit);
  }
  await page.setViewportSize({width:390,height:1050});await openData('empty');await sourceCount(0);
  await page.screenshot({path:path.join(out,'empty-390.png'),fullPage:true});
  await upload('not json','broken.json');await panel().getByRole('alert').filter({hasText:'not valid JSON'}).waitFor();record('invalid-json-rejected-before-api',posts===0);
  await upload('{}','wrong-envelope');await panel().getByRole('alert').filter({hasText:'not a supported Practice import package'}).waitFor();record('wrong-schema-rejected-before-api',posts===0);
  await panel().getByRole('alert').screenshot({path:path.join(out,'invalid-file-390.png')});
  record('extensionless-picker',await panel().getByLabel('Upload converter package',{exact:true}).getAttribute('accept')===null);
  await upload();await status('Checking your file');assert.ok(await panel().getByLabel('Upload converter package',{exact:true}).isDisabled());
  await page.screenshot({path:path.join(out,'checking-390.png')});await status('Saving and reconciling');await page.screenshot({path:path.join(out,'saving-390.png')});
  await savedStatus();await sourceCount(2);
  const receipt=await panel().getByRole('status').innerText();record('saved-receipt-incoming-4-plus-4-not-new-sessions',/4 attendance rows and 4 billing rows/.test(receipt)&&/not new-session totals/.test(receipt),{receipt});
  record('mock-persists-exact-package-rows',posts===1&&savedSnapshots.length===2&&savedSnapshots.every(s=>s.rows.length===4)&&savedPackages.length===1);
  await page.screenshot({path:path.join(out,'saved-390.png')});
  await upload();await status('Already saved');await sourceCount(2);record('duplicate-no-additional-sources-or-rows',posts===2&&savedSnapshots.length===2&&savedPackages.length===1&&/no additional rows/.test(await panel().getByRole('status').innerText()));
  await page.screenshot({path:path.join(out,'duplicate-390.png')});
  const beforeReload=gets;await panel().getByRole('button',{name:'Reload saved history',exact:true}).click();await status('Loaded from saved history');await sourceCount(2);record('reload-gets-persisted-history',gets>beforeReload);
  await page.reload();await enterData();await sourceCount(2);record('page-refresh-keeps-saved-counts',savedSnapshots.length===2);await page.screenshot({path:path.join(out,'reloaded-390.png')});
  await openData('overlap');const beforeOverlap=posts;await upload();await status('Review needed');
  const overlap=page.locator('.pw-overlap-review');record('409-review-visible-without-disclosure-interaction',await overlap.isVisible());
  assert.ok(await overlap.isVisible(),'Overlap review must be visible without expanding technical tools');
  await page.getByRole('button',{name:'Keep history and reconcile overlap',exact:true}).waitFor();
  record('409-opens-visible-review-without-saving',posts===beforeOverlap+1&&savedSnapshots.length===fixture.snapshots.length);
  await page.locator('.pw-overlap-review').screenshot({path:path.join(out,'overlap-390.png')});
  await page.getByRole('button',{name:'Keep history and reconcile overlap',exact:true}).click();await savedStatus();await sourceCount(4);record('retain-overlap-preserves-prior-sources',savedSnapshots.length===4&&fixture.snapshots.every(s=>savedSnapshots.some(n=>n.id===s.id)));
  await openData('server-error');await upload();await status('Save not confirmed');await panel().getByRole('alert').filter({hasText:'Synthetic acknowledgement unavailable'}).waitFor();
  const failure=await panel().innerText();record('500-unconfirmed-does-not-claim-nothing-saved',/save may have completed/.test(failure)&&!/nothing saved|nothing was saved/i.test(failure),{message:await panel().getByRole('status').innerText()});
  record('unconfirmed-upload-disabled',await panel().getByLabel('Upload converter package',{exact:true}).isDisabled());
  const uncertainPosts=posts;await page.waitForTimeout(700);record('unconfirmed-no-automatic-resubmit',posts===uncertainPosts);
  await page.screenshot({path:path.join(out,'upload-error-390.png')});
  const failureContrast=await contrast();record('visible-error-contrast',failureContrast.findings.length===0,failureContrast);
  await panel().getByRole('button',{name:'Reload saved history',exact:true}).click();await status('Loaded from saved history');await page.waitForTimeout(350);
  const reloadStayed=await panel().isVisible();record('uncertain-reload-keeps-data-visible',reloadStayed);assert.ok(reloadStayed,'Reload must keep Data and its recovered status visible');
  await sourceCount(4);record('reload-recovers-committed-save-after-500',savedSnapshots.length===4&&posts===uncertainPosts);record('successful-reload-enables-upload',await panel().getByLabel('Upload converter package',{exact:true}).isEnabled());
  await openData('overlap-unconfirmed');const beforeDecision=posts;await upload();await status('Review needed');
  const pendingReview=page.locator('.pw-overlap-review');assert.ok(await pendingReview.isVisible());
  await pendingReview.getByRole('button',{name:'Keep history and reconcile overlap',exact:true}).click();await status('Save not confirmed');
  await panel().getByRole('alert').filter({hasText:'Synthetic acknowledgement unavailable'}).waitFor();await sourceCount(2);
  record('overlap-retain-committed-before-500',posts===beforeDecision+2&&savedSnapshots.length===4&&savedPackages.length===fixture.packages.length+1&&await pendingReview.isVisible());
  await pendingReview.locator('summary').filter({hasText:'Advanced replacement'}).click();
  const pendingActions=pendingReview.getByRole('button'),decisionFeedback=await panel().getByRole('status').innerText();
  record('unconfirmed-overlap-all-actions-and-upload-disabled',await pendingActions.count()===3&&await pendingActions.evaluateAll(buttons=>buttons.every(button=>button.disabled))&&await panel().getByLabel('Upload converter package',{exact:true}).isDisabled());
  await pendingActions.evaluateAll(buttons=>buttons.forEach(button=>button.click()));
  const decisionPosts=posts;await page.waitForTimeout(700);
  record('unconfirmed-overlap-no-resubmit-or-cancel',posts===decisionPosts&&posts===beforeDecision+2&&await pendingReview.isVisible()&&await panel().getByRole('status').innerText()===decisionFeedback&&!/unchanged|nothing (?:was )?saved|cancelled/i.test(decisionFeedback),{feedback:decisionFeedback});
  await pendingReview.screenshot({path:path.join(out,'overlap-unconfirmed-actions-390.png')});
  await page.screenshot({path:path.join(out,'overlap-unconfirmed-390.png')});
  const decisionGets=gets;await panel().getByRole('button',{name:'Reload saved history',exact:true}).click();await status('Loaded from saved history');await page.waitForTimeout(350);await sourceCount(4);
  record('overlap-unconfirmed-get-recovers-and-clears-pending',gets>decisionGets&&posts===decisionPosts&&await pendingReview.count()===0&&await panel().getByRole('alert').count()===0&&await panel().getByLabel('Upload converter package',{exact:true}).isEnabled());
  await page.screenshot({path:path.join(out,'overlap-recovered-390.png')});
  record('progress-stages-observed',['validating','saving','saved','duplicate','unconfirmed'].every(stage=>observedStages.has(stage)),{stages:[...observedStages]});
  record('only-isolated-mock-api',requests.every(r=>r.method==='GET'||r.method==='POST'&&r.path==='/api/practice-imports/package'),{posts,gets,blockedExternalRequests:blocked});
  checks.push({name:'no-runtime-errors',pass:errors.length===0});
}catch(error){checks.push({name:'harness-completed',pass:false,error:error.stack});await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
const result={phase,syntheticOnly:true,noOwnerFiles:true,checks,errors};await fs.writeFile(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(checks.some(c=>!c.pass))process.exitCode=1;
