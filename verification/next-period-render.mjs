import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const out=process.env.NEXT_PERIOD_EVIDENCE || '/tmp/practice-next-period-render';
await fs.mkdir(out,{recursive:true});
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
const {build}=require('esbuild');
const {chromium}=createRequire('/tmp/practice-oct20-render-deps/package.json')('playwright');
const fixture=JSON.parse(await fs.readFile(path.join(root,'verification/fixtures/tidal-workspace.json'),'utf8'));
const nodeBundle=await build({stdin:{contents:`export {planNextReportPeriod} from './lib/practice/src/hub/next-report-period.ts'; export {importLocalPackage} from './artifacts/comp-dashboard/src/lib/retention-local.ts';`,resolveDir:root},bundle:true,write:false,platform:'node',format:'esm'});
const {planNextReportPeriod,importLocalPackage}=await import('data:text/javascript;base64,'+Buffer.from(nodeBundle.outputFiles[0].contents).toString('base64'));
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{TooltipProvider}from'@/components/ui/tooltip';import PracticeWorkspace from'@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><PracticeWorkspace/></TooltipProvider></QueryClientProvider>);`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:path.join(root,'artifacts/comp-dashboard')},bundle:true,write:false,minify:true,platform:'browser',format:'esm',jsx:'automatic',loader:{'.png':'file','.jpg':'file'},alias:{'@':path.join(root,'artifacts/comp-dashboard/src')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"BASE_URL":"/"}'},outdir:out});
const files=new Map(bundle.outputFiles.map(f=>['/'+path.basename(f.path),f.contents]));
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents;
const css=Buffer.concat([await fs.readFile('/tmp/practice-tidal-public-repro-fKvp4n/artifacts/comp-dashboard/dist/public/assets/index-BH0dfUm1.css'),...bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.contents)]);
const now='2026-10-22T12:00:00Z',hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const attendance=(clientId,serviceDate,clinician='Elia')=>({clientId,serviceDate,clinician,location:'Room A',status:'show'});
const billing=(clientId,serviceDate,clinician='Elia')=>({clientId,serviceDate,clinician,totalFeeCharged:150,billingCode:'90837'});
const carry=Array.from({length:25},(_,i)=>attendance(`carry-${i}`,'2026-10-07',i%2?'Erin':'Elia'));
const overlap=attendance('overlap','2026-10-12','Erin');
const collection=(rows,start,end)=>({coverageStart:start,coverageEnd:end,rowCount:rows.length,rows});
const pack=(packageId,a,b,start,end)=>({format:'emc-practice-local-import-package',version:1,packageId,exportedAt:now,collections:{attendance:collection(a,start,end),billing:collection(b,start,end)},billingCodeMinutes:{'90837':60}});
const prior=pack('synthetic-prior',[...carry,overlap],[billing('prior','2026-10-07'),billing('overlap','2026-10-12','Erin')],'2026-10-07','2026-10-12');
const incoming=pack('synthetic-next',[attendance('new-start','2026-10-08'),...carry.toReversed(),overlap,attendance('new-end','2026-10-21','Erin')],[billing('new-start','2026-10-08'),billing('overlap','2026-10-12','Erin'),billing('new-end','2026-10-21','Erin')],'2026-10-07','2026-10-21');
incoming.collections.billing.coverageStart='2026-10-08';
const parse=p=>{const parsed=importLocalPackage(p,now);return parsed.snapshots.map(s=>({...s,id:`${s.kind}-${s.sourceHash}`}));};
const oldSources=parse(prior),newSources=parse(incoming);
assert.equal(oldSources[0].rows.length,26);
assert.ok(newSources[0].rows.filter(r=>r.serviceDate==='2026-10-07').every(r=>oldSources[0].rows.find(o=>o.clientId===r.clientId).sourceRowHash!==r.sourceRowHash));
const declaration={revision:2,confirmedAt:'2026-10-13T12:00:00Z',data:{version:1,mappings:fixture.context.clinicians.map(c=>({sourceLabel:c.label,clinicianId:c.id,clinicianLabel:c.label,teamId:1})),sourceSets:oldSources.map(s=>({kind:s.kind,snapshotIds:[s.id],clinicianIds:[1,2],start:'2026-09-10',end:'2026-10-12',complete:true}))}};
let state,mode,requests,journal;
function addPackage(p,time=now){
  const sourceIds=parse(p).map(s=>s.id),duplicate=state.packages.some(v=>v.contentHash===hash(p));
  if(!duplicate){for(const s of parse(p))if(!state.snapshots.some(v=>v.id===s.id))state.snapshots.push(s);state.packages.push({packageId:p.packageId,contentHash:hash(p),exportedAt:p.exportedAt,importedAt:time,sourceIds});journal.push({action:'raw-package',sourceIds});}
  return {...structuredClone(state),importedSourceIds:sourceIds,status:duplicate?'duplicate':'added'};
}
function reset(scenario){mode=scenario;requests=[];journal=[];state={snapshots:[],packages:[],declarations:structuredClone(declaration),billingCodeMinutes:{'90837':60},sameDayVisitOverrides:{},billingResolutions:[],billingResolutionRevision:0};
  let baseline=prior,next=incoming;
  if(scenario==='saved-mixed'){
    next=structuredClone(incoming);next.packageId+='-mixed';
    next.collections.attendance.rows.push(attendance('synthetic-mixed','2026-10-14'),{...attendance('synthetic-mixed','2026-10-14'),status:'cancelled'});next.collections.attendance.rowCount+=2;
    next.collections.billing.rows.push(billing('synthetic-mixed','2026-10-14'));next.collections.billing.rowCount++;
  }
  if(['saved-billing-conflict','saved-code-conflict'].includes(scenario)){
    baseline=structuredClone(prior);next=structuredClone(incoming);baseline.packageId+='-billing-conflict';next.packageId+='-billing-conflict';
    for(const pkg of [baseline,next])for(const collection of Object.values(pkg.collections))for(const row of collection.rows)if(row.clientId==='overlap'){row.clientId='private-billing-marker-QXZ';row.serviceDate='2026-10-08';}
    for(const collection of Object.values(baseline.collections))collection.coverageEnd='2026-10-08';
    if(scenario==='saved-code-conflict'){
      baseline.collections.billing.rows.find(r=>r.clientId==='private-billing-marker-QXZ').billingCode=null;
      next.collections.billing.rows.find(r=>r.clientId==='private-billing-marker-QXZ').billingCode='0';
    }else next.collections.billing.rows.find(r=>r.clientId==='private-billing-marker-QXZ').totalFeeCharged=200;
    const members=parse(baseline);for(const set of state.declarations.data.sourceSets)set.snapshotIds=[members.find(s=>s.kind===set.kind).id];
  }
  addPackage(baseline,'2026-10-13T12:00:00Z');journal.push({action:'prior-source-proof'},{action:'prior-owner-confirmation'});
  if(scenario==='saved-code-conflict'){
    const variant=structuredClone(baseline);variant.packageId+='-code-variant';variant.collections.billing.rows.find(r=>r.clientId==='private-billing-marker-QXZ').billingCode='0';
    addPackage(variant,'2026-10-13T11:00:00Z');state.declarations.data.sourceSets.find(set=>set.kind==='billing').snapshotIds.push(parse(variant).find(s=>s.kind==='billing').id);
  }
  if(['saved','saved-historical','saved-mixed','saved-billing-conflict','saved-code-conflict','missing-source-ids','empty-source-ids','missing-frozen-member'].includes(scenario))addPackage(next);
  if(scenario==='saved-historical'){
    const label='(deleted) Synthetic Former';
    for(const source of state.snapshots.filter(s=>oldSources.some(old=>old.id===s.id)))source.rows.push(source.kind==='attendance'
      ?{...source.rows[0],clientId:'historical-synthetic',clinician:label,sourceRowHash:'historical-attendance'}
      :{...source.rows[0],clientId:'historical-synthetic',clinician:label,sourceRowHash:'historical-billing'});
    state.declarations.data.historicalBillingProviders=[{id:'00000000-0000-4000-8000-000000000001',sourceLabel:label,sourceSets:[{snapshotIds:[oldSources.find(s=>s.kind==='billing').id],start:'2026-09-10',end:'2026-10-12',complete:true}]}];
  }
  if(scenario==='missing-source-ids')delete state.packages.at(-1).sourceIds;
  if(scenario==='empty-source-ids')state.packages.at(-1).sourceIds=[];
  if(scenario==='missing-frozen-member')state.declarations.data.sourceSets[0].snapshotIds=['attendance-deadbeef'];
}
const plan=ids=>planNextReportPeriod({snapshots:state.snapshots,storedDeclarations:state.declarations,roster:fixture.context.clinicians,teamId:1,newSourceIds:ids,today:'2026-10-22',billingResolutions:[]});
const serverErrors=[],blocked=[];
const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')){
    let body='';for await(const chunk of req)body+=chunk;const input=body?JSON.parse(body):null;
    requests.push({method:req.method,path:u.pathname,...(input?{body:input}:{})});res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    const send=(data,status=200)=>{res.writeHead(status);res.end(JSON.stringify(data));};
    if(req.method==='POST'&&u.pathname==='/api/practice-imports/package'){send(addPackage(input.package));return;}
    if(req.method==='PUT'&&u.pathname==='/api/practice-imports/declarations'){
      assert.equal(typeof input.nextPeriod.packageId,'string');
      const pkg=state.packages.find(p=>p.packageId===input.nextPeriod.packageId);
      assert.ok(pkg,'Next-period packageId must identify a saved package');
      assert.equal(input.nextPeriod.sourceIds.length,2);assert.equal(new Set(input.nextPeriod.sourceIds).size,2);
      assert.deepEqual([...input.nextPeriod.sourceIds].sort(),[...pkg.sourceIds].sort(),'Next-period source pair must match exact saved package membership');
      const proposal=plan(input.nextPeriod.sourceIds);
      assert.equal(input.expectedRevision,state.declarations.revision);assert.equal(input.confirmed,true);assert.equal(input.nextPeriod.teamId,1);assert.equal(proposal.status,'ready',JSON.stringify(proposal));assert.deepEqual(input.data,proposal.data);
      if(mode==='stale'){send({error:'Synthetic stale revision; reload saved history.',code:'STALE_REVISION'},409);return;}
      state.declarations={revision:3,data:proposal.data,confirmedAt:now};journal.push({action:'known-next-reporting-period',carryover:proposal.carryover,period:proposal.period});
      if(mode==='unconfirmed'){send({error:'Synthetic metadata acknowledgement unavailable.'},500);return;}
      send(state);return;
    }
    if(req.method!=='GET'){send({error:'Forbidden synthetic write'},405);return;}
    send(u.pathname==='/api/hub'?{revision:1,data:fixture.workspace,updatedAt:now}:u.pathname==='/api/hub/context'?fixture.context:u.pathname==='/api/practice-imports'?state:u.pathname==='/api/practice-imports/billing-resolution-candidates'?{revision:0,candidates:[]}:u.pathname==='/api/business-goals'?fixture.goals:u.pathname==='/api/practice-imports/capabilities'?{}:[]);return;
  }
  if(u.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
  if(u.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  if(files.has(u.pathname)){res.end(files.get(u.pathname));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
}catch(e){serverErrors.push(e.stack);res.writeHead(500);res.end(JSON.stringify({error:e.message}));}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const context=await browser.newContext({viewport:{width:1440,height:1050}});
await context.addInitScript(()=>{const D=Date;window.Date=class extends D{constructor(...args){super(...(args.length?args:['2026-10-22T12:00:00Z']));}static now(){return new D('2026-10-22T12:00:00Z').valueOf();}};});
await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
const page=await context.newPage(),errors=[],checks=[],screenshots=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
const panel=()=>page.locator('.pw-import-start'),feedback=()=>panel().getByRole('status');
const count=method=>requests.filter(r=>r.method===method).length;
const raw=()=>JSON.stringify(state.snapshots),proof=()=>JSON.stringify(state.declarations);
async function enter(){await page.getByRole('button',{name:'Data & imports',exact:true}).click();await panel().getByRole('heading',{name:'Upload reports',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.pw-import-start [role=status]')?.dataset.stage==='loaded');}
async function open(scenario){reset(scenario);await page.goto(origin);await enter();}
async function settled(){await page.waitForFunction(()=>{const s=document.querySelector('.pw-import-start [role=status]')?.dataset.stage;return s&&!['loading','validating','saving'].includes(s);});await page.waitForTimeout(250);assert.ok(await panel().isVisible(),'Data view must remain visible after saving; do not work around navigation');}
async function upload(p=incoming){await panel().getByLabel('Upload converter package',{exact:true}).setInputFiles({name:'synthetic-next.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await settled();}
async function coverage(date){assert.ok((await panel().locator('.pw-import-coverage > div').filter({hasText:'Verified metric coverage through'}).innerText()).includes(date));}
async function steady(){await page.waitForFunction(()=>{
  const targets=[...document.querySelectorAll('.pw-import-start,.pw-data-disclosure')].filter(e=>e.checkVisibility());
  return targets.length>0&&targets.every(e=>{for(let n=e;n;n=n.parentElement)if(Number(getComputedStyle(n).opacity)!==1)return false;return true;});
});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function shot(name){await steady();const file=path.join(out,name+'.png');await page.screenshot({path:file,fullPage:true});screenshots.push(file);}
async function test(name,fn){try{await fn();checks.push({name,pass:true,requests:structuredClone(requests),declarationRevision:state.declarations.revision,sourceSets:state.declarations.data.sourceSets.length,journalEntries:journal.length});console.log('PASS '+name);}catch(e){checks.push({name,pass:false,error:e.stack,requests:structuredClone(requests),visibleText:await page.locator('body').innerText().catch(()=>'' )});await shot('failure-'+name);console.error('FAIL '+name+': '+e.message);}}
try{
  await test('saved-pair-explicit-reconcile',async()=>{
    await open('saved');await coverage('2026-10-07');assert.equal(count('PUT'),0);assert.equal(count('POST'),0);
    assert.equal(await page.getByRole('region',{name:'Missing complete report dates',exact:true}).count(),0);assert.equal(await page.getByText('Confirm full report period',{exact:true}).count(),0);
    const expected=plan(newSources.map(s=>s.id));assert.equal(expected.status,'ready');assert.deepEqual(expected.period,{start:'2026-10-08',end:'2026-10-21',payDate:'2026-10-22'});assert.deepEqual(expected.carryover,{rows:25,matched:25,conflicts:0});const before=raw();
    assert.match(await page.getByLabel('Saved report period reconciliation').innerText(),/2026-10-08.*2026-10-21/);
    const button=panel().getByRole('button',{name:'Reconcile this period',exact:true});await button.focus();await page.keyboard.press('Enter');await settled();
    assert.equal(count('PUT'),1);assert.equal(count('POST'),0);assert.equal(raw(),before);assert.equal(state.declarations.data.sourceSets.length,4);assert.deepEqual(state.declarations.data.sourceSets.slice(0,2),declaration.data.sourceSets);assert.equal(journal.length,5);await coverage('2026-10-21');
    await page.reload();await enter();await coverage('2026-10-21');assert.equal(count('PUT'),1);await shot('saved-pair-reconciled-1440');
  });
  await test('saved-frozen-historical-exclusion-preserved',async()=>{
    await open('saved-historical');await coverage('2026-10-07');
    const beforeRows=raw(),beforeData=structuredClone(state.declarations.data),beforeJournal=JSON.stringify(state.billingResolutions);
    const proposal=plan(newSources.map(s=>s.id));assert.equal(proposal.status,'ready',proposal.reasons.join(' '));assert.deepEqual(proposal.carryover,{rows:25,matched:25,conflicts:0});
    const review=panel().getByLabel('Saved report period reconciliation',{exact:true});assert.match(await review.innerText(),/25 \/ 25 prior-period rows match/);
    assert.equal(count('POST'),0);assert.equal(count('PUT'),0);
    await review.getByRole('button',{name:'Reconcile this period',exact:true}).click();await settled();
    assert.equal(count('POST'),0);assert.equal(count('PUT'),1);assert.equal(raw(),beforeRows);assert.equal(JSON.stringify(state.billingResolutions),beforeJournal);
    assert.deepEqual(state.declarations.data.historicalBillingProviders,beforeData.historicalBillingProviders);
    assert.deepEqual(state.declarations.data.mappings,beforeData.mappings);assert.deepEqual(state.declarations.data.sourceSets.slice(0,2),beforeData.sourceSets);
    assert.ok(state.declarations.data.sourceSets.every(set=>set.clinicianIds.every(id=>[1,2].includes(id))));
    await coverage('2026-10-21');await shot('saved-historical-preserved');
  });
  await test('saved-single-export-mixed-attendance',async()=>{
    await open('saved-mixed');const beforeRows=raw(),beforeData=structuredClone(state.declarations.data);
    const proposal=plan(state.packages.at(-1).sourceIds);assert.equal(proposal.status,'ready',proposal.reasons.join(' '));assert.deepEqual(proposal.carryover,{rows:25,matched:25,conflicts:0});
    const review=panel().getByLabel('Saved report period reconciliation',{exact:true});assert.match(await review.innerText(),/25 \/ 25 prior-period rows match/);assert.equal(count('POST'),0);assert.equal(count('PUT'),0);
    await review.getByRole('button',{name:'Reconcile this period',exact:true}).click();await settled();assert.equal(count('PUT'),1);assert.equal(count('POST'),0);assert.equal(raw(),beforeRows);assert.deepEqual(state.declarations.data.sourceSets.slice(0,2),beforeData.sourceSets);await coverage('2026-10-21');await shot('saved-mixed-attendance');
  });
  for(const width of [1440,390,320])await test('billing-conflict-bounded-diagnostics-'+width,async()=>{
    await page.setViewportSize({width,height:1050});await open('saved-billing-conflict');const beforeRows=raw(),beforeProof=proof();
    const review=panel().getByLabel('Saved report period reconciliation',{exact:true});assert.ok(await review.isVisible());assert.equal(await review.getByRole('button',{name:'Reconcile this period',exact:true}).count(),0);
    const more=review.getByText('More review details',{exact:true});if(await more.count()){await more.focus();await page.keyboard.press('Enter');}
    const text=await review.innerText();assert.match(text,/billing overlapping facts\/status\/fees or multiplicity conflict on 2026-10-08/);assert.match(text,/Fields: totalFeeCharged\./);
    const priorId=state.packages[0].sourceIds.find(id=>id.startsWith('billing-')),nextId=state.packages.at(-1).sourceIds.find(id=>id.startsWith('billing-'));
    assert.ok(text.includes(`Sources: ${priorId} (1 row), ${nextId} (1 row).`));assert.ok(!text.includes('private-billing-marker-QXZ'));assert.ok(!text.includes('$200'));assert.ok(!text.includes('200.00'));
    assert.equal(count('POST'),0);assert.equal(count('PUT'),0);assert.equal(raw(),beforeRows);assert.equal(proof(),beforeProof);await steady();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('billing-bounded-diagnostics-'+width);
  });
  for(const width of [1440,390,320])await test('billing-code-classification-'+width,async()=>{
    await page.setViewportSize({width,height:1050});await open('saved-code-conflict');const beforeRows=raw(),beforeProof=proof();
    const review=panel().getByLabel('Saved report period reconciliation',{exact:true});assert.ok(await review.isVisible());assert.equal(await review.getByRole('button',{name:'Reconcile this period',exact:true}).count(),0);
    const text=await review.innerText();assert.match(text,/Fields: billingCode\./);assert.match(text,/Code classification A: missing; B: explicit 0\./);
    assert.match(text,/Incoming rows: 1; code matches A: 0, B: 1, neither: 0\./);assert.match(text,/Approval applicability A: none; B: none\./);
    const a=state.packages[0].sourceIds.find(id=>id.startsWith('billing-')),b=state.packages[1].sourceIds.find(id=>id.startsWith('billing-'));
    assert.ok(text.includes(`Sources: ${a} (1 row), ${b} (1 row).`));assert.ok(!text.includes('private-billing-marker-QXZ'));assert.ok(!text.includes('150.00'));
    assert.equal(count('POST'),0);assert.equal(count('PUT'),0);assert.equal(raw(),beforeRows);assert.equal(proof(),beforeProof);await steady();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('billing-code-classification-'+width);
  });
  await test('upload-next-period',async()=>{
    await open('upload');const choice=panel().getByRole('button',{name:'Next full period',exact:true});assert.equal(await choice.getAttribute('aria-pressed'),'true');assert.match(await panel().locator('.pw-report-period-choice').innerText(),/2026-10-08.*2026-10-21/);
    assert.ok(await choice.evaluate(e=>e.getBoundingClientRect().top<document.querySelector('.pw-import-picker').getBoundingClientRect().top));await upload();
    assert.equal(count('POST'),1);assert.equal(count('PUT'),1);assert.match(await feedback().innerText(),/2026-10-08 through 2026-10-21 reconciled/);assert.match(await feedback().innerText(),/25 prior-period rows matched/);await coverage('2026-10-21');await shot('upload-success-1440');
  });
  await test('already-included-duplicate-no-metadata-write',async()=>{await open('saved');await panel().getByRole('button',{name:'Reconcile this period',exact:true}).click();await settled();const before=proof(),beforeRows=raw();await upload();assert.equal(count('POST'),1);assert.equal(count('PUT'),1);assert.equal(proof(),before);assert.equal(raw(),beforeRows);assert.equal(await feedback().getAttribute('data-stage'),'duplicate');});
  await test('other-report-raw-only',async()=>{await open('other');const before=proof();await panel().getByRole('button',{name:'Other report',exact:true}).focus();await page.keyboard.press('Space');await upload();assert.equal(count('POST'),1);assert.equal(count('PUT'),0);assert.equal(proof(),before);await coverage('2026-10-07');});
  await test('changed-carryover-review',async()=>{await open('changed');const p=structuredClone(incoming);p.packageId+='-changed';p.collections.attendance.rows[1].location='Room B';const before=proof();await upload(p);assert.equal(count('POST'),1);assert.equal(count('PUT'),0);assert.equal(proof(),before);assert.equal(state.snapshots.length,4);assert.equal(await feedback().getAttribute('data-stage'),'saved');assert.match(await panel().getByRole('alert').innerText(),/attendance carryover 2026-10-07: changed facts or multiplicity/);await shot('changed-carryover');});
  await test('metadata-409-rows-saved',async()=>{await open('stale');await upload();assert.equal(count('POST'),1);assert.equal(count('PUT'),1);assert.equal(await feedback().getAttribute('data-stage'),'saved');assert.match(await feedback().innerText(),/Report rows are saved/);assert.equal(state.declarations.revision,2);await shot('metadata-stale');});
  await test('metadata-500-after-commit-recover',async()=>{await open('unconfirmed');await upload();assert.equal(await feedback().getAttribute('data-stage'),'unconfirmed');assert.equal(state.declarations.revision,3);assert.ok(await panel().getByLabel('Upload converter package',{exact:true}).isDisabled());const reconcile=panel().getByRole('button',{name:'Reconcile this period',exact:true});if(await reconcile.count())assert.ok(await reconcile.isDisabled());await page.waitForTimeout(750);assert.equal(count('POST'),1);assert.equal(count('PUT'),1);await shot('metadata-unconfirmed');await panel().getByRole('button',{name:'Reload saved history',exact:true}).click();await settled();await coverage('2026-10-21');assert.ok(await panel().getByLabel('Upload converter package',{exact:true}).isEnabled());assert.equal(count('POST'),1);assert.equal(count('PUT'),1);await shot('metadata-recovered');});
  for(const width of [1440,390,320])for(const scenario of ['missing-source-ids','empty-source-ids','missing-frozen-member'])await test(`${scenario}-${width}`,async()=>{
    await page.setViewportSize({width,height:1050});await open(scenario);const beforeRows=raw(),beforeProof=proof();
    const review=panel().getByLabel('Saved report period reconciliation',{exact:true});assert.ok(await review.isVisible());assert.equal(await review.locator(':scope > strong').innerText(),'Saved report needs review');
    const first=review.locator(':scope > p').first();assert.ok(await first.isVisible());
    const attention=panel().getByLabel('Import attention items',{exact:true});assert.ok(await attention.isVisible());assert.match(await attention.innerText(),/Review the saved report issue above\. Original rows remain saved/);assert.match(await attention.innerText(),/known period dates do not need re-entry|Resolve that issue before changing coverage/);assert.doesNotMatch(await panel().innerText(),/Confirm (?:the )?full report period|Enter the full period/);
    const coverageReview=page.locator('#import-coverage-review'),manual=coverageReview.locator('details[aria-label="Missing complete report dates"]');assert.equal(await manual.count(),1);assert.equal(await manual.getAttribute('open'),null);assert.equal(await manual.locator(':scope > summary').textContent(),'Manual coverage for other reports');
    if(scenario==='missing-frozen-member'){
      const expected=plan(newSources.map(s=>s.id));assert.equal(expected.status,'blocked');assert.equal(expected.period,null);assert.ok(expected.reasons.length>1);assert.equal(await first.innerText(),expected.reasons[0]);assert.match(await first.innerText(),/Frozen attendance set is missing member attendance-deadbeef/);
      const more=review.locator(':scope > details').filter({has:page.getByText('More review details',{exact:true})});assert.equal(await more.count(),1);assert.equal(await more.getAttribute('open'),null);assert.equal(await more.getByRole('paragraph').filter({visible:true}).count(),0);
      for(const reason of expected.reasons.slice(1))assert.equal(await more.getByText(reason,{exact:true}).count(),1);
      await more.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await more.getAttribute('open'),'');await page.keyboard.press('Space');assert.equal(await more.getAttribute('open'),null);
    }else{
      assert.match(await first.innerText(),/saved upload's attendance and billing source pair is unavailable/);assert.match(await first.innerText(),/source receipt needs repair; do not upload the report again or re-enter its dates/);assert.equal(await review.getByText('More review details',{exact:true}).count(),0);
    }
    assert.equal(await page.getByRole('button',{name:'Reconcile this period',exact:true}).count(),0);assert.equal(await review.locator('input').count(),0);assert.equal(await page.getByText('Confirm full report period',{exact:true}).filter({visible:true}).count(),0);assert.equal(await page.locator('input[type=date]').filter({visible:true}).count(),0);
    assert.equal(count('POST'),0);assert.equal(count('PUT'),0);assert.ok(requests.every(r=>r.method==='GET'));assert.equal(raw(),beforeRows);assert.equal(proof(),beforeProof);assert.equal(state.snapshots.length,4);
    await steady();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot(`${scenario}-${width}`);
    const receipt=review.locator(':scope > details').filter({has:page.getByText('Source receipt',{exact:true})});assert.equal(await receipt.count(),1);assert.equal(await receipt.getAttribute('open'),null);assert.equal(await receipt.locator('p').filter({visible:true}).count(),0);
    await receipt.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await receipt.getAttribute('open'),'');
    const receiptLines=await receipt.locator('p').allTextContents();assert.deepEqual(receiptLines,[
      'Saved package: synthetic-next',
      `Package membership: ${scenario==='missing-source-ids'?'not supplied':scenario==='empty-source-ids'?'0 linked sources':'2 linked sources'}.`,
      `Matching active sources: ${scenario==='missing-frozen-member'?2:0}.`,
      `Missing or duplicate frozen links: ${scenario==='missing-frozen-member'?1:0}.`,
      'Configuration revision: 2.',
    ]);
    const receiptText=await receipt.innerText();for(const source of state.snapshots)for(const row of source.rows){assert.ok(!receiptText.includes(row.clientId));assert.ok(!receiptText.includes(row.sourceRowHash));assert.ok(!receiptText.includes(row.clinician));}assert.ok(!/Room A|150|2026-10-07|2026-10-12|2026-10-21/.test(receiptText));assert.equal(await receipt.locator('p').filter({visible:true}).count(),5);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot(`${scenario}-receipt-${width}`);await receipt.locator('summary').focus();await page.keyboard.press('Space');assert.equal(await receipt.getAttribute('open'),null);
    await coverageReview.locator(':scope > summary').focus();await page.keyboard.press('Enter');assert.equal(await manual.getAttribute('open'),null);assert.ok(await manual.locator(':scope > summary').isVisible());assert.equal(await manual.locator('input[type=date]').filter({visible:true}).count(),0);
    if(width===390)await shot(`${scenario}-manual-collapsed-${width}`);
    await manual.locator(':scope > summary').focus();await page.keyboard.press('Enter');assert.equal(await manual.getAttribute('open'),'');const sourceForm=manual.locator('.pw-import-source').first();await sourceForm.locator(':scope > summary').focus();await page.keyboard.press('Enter');assert.equal(await sourceForm.locator('input[type=date]').filter({visible:true}).count(),2,'Existing manual date forms remain reachable for other reports');assert.equal(count('POST'),0);assert.equal(count('PUT'),0);assert.equal(raw(),beforeRows);assert.equal(proof(),beforeProof);
    await sourceForm.locator(':scope > summary').focus();await page.keyboard.press('Space');await manual.locator(':scope > summary').focus();await page.keyboard.press('Space');await coverageReview.locator(':scope > summary').focus();await page.keyboard.press('Space');assert.equal(await manual.getAttribute('open'),null);assert.equal(await coverageReview.getAttribute('open'),null);
    await panel().getByRole('button',{name:'Reload saved history',exact:true}).click();await settled();assert.ok(await first.isVisible());assert.equal(count('POST'),0);assert.equal(count('PUT'),0);assert.equal(raw(),beforeRows);assert.equal(proof(),beforeProof);
  });
  for(const width of [1440,390,320])await test('layout-keyboard-contrast-'+width,async()=>{
    await page.setViewportSize({width,height:1050});await open('saved');const allRows=page.locator('.pw-data-disclosure');assert.ok(await allRows.evaluateAll(ds=>ds.every(d=>!d.open)));const rows=page.locator('.pw-data-disclosure').filter({visible:true});assert.equal(await rows.count(),4);
    for(let i=0;i<4;i++){const summary=rows.nth(i).locator(':scope > summary');await summary.focus();await page.keyboard.press('Enter');assert.equal(await rows.nth(i).getAttribute('open'),'');await page.keyboard.press('Space');assert.equal(await rows.nth(i).getAttribute('open'),null);}
    const fit=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('.pw-import-start button,.pw-data-disclosure > summary')].filter(e=>e.checkVisibility()).map(e=>({text:e.textContent.trim(),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scroll:e.scrollWidth,width:e.clientWidth}))}));assert.ok(fit.page<=width+1,JSON.stringify(fit));assert.ok(fit.controls.every(c=>c.left>=0&&c.right<=width+1&&c.scroll<=c.width+1),JSON.stringify(fit));
    await steady();const contrast=await page.locator('.pw-local-retention').evaluate(root=>{
      const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number),blend=(a,b)=>{const t=a[3]??1;return [0,1,2].map(i=>a[i]*t+b[i]*(1-t)).concat(1);},lum=c=>c.slice(0,3).map(x=>(x/=255)<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const failures=[];let sampled=0;
      for(const e of root.querySelectorAll('p,strong,small,span,button,summary,h2,h3,label,a')){if(!e.checkVisibility()||!e.textContent.trim()||e.disabled)continue;let chain=[],bg=[255,255,255,1],image=false;for(let n=e;n;n=n.parentElement)chain.push(n);for(const n of chain.reverse()){const s=getComputedStyle(n),color=rgb(s.backgroundColor);if((color[3]??1)===1)image=false;bg=blend(color,bg);if(s.backgroundImage!=='none')image=true;}const fg=blend(rgb(getComputedStyle(e).color),bg),a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);sampled++;if(image||ratio<4.5)failures.push({text:e.textContent.trim().slice(0,90),ratio:image?null:ratio,reason:image?'Translucent text surface over background image; solid-color contrast cannot establish 4.5:1.':'Contrast below 4.5:1'});}return {sampled,failures};});
    checks.push({name:'contrast-samples-'+width,pass:contrast.failures.length===0,...contrast,fit});await shot('data-'+width);assert.equal(contrast.failures.length,0,JSON.stringify(contrast.failures));
  });
}finally{
  checks.push({name:'isolated-api-and-no-runtime-errors',pass:errors.length===0&&serverErrors.length===0&&blocked.length===0,errors,serverErrors,blocked});await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));
  const result={syntheticOnly:true,mounted:'actual PracticeWorkspace',realPlannerServerRevalidation:true,contrastScope:'Computed CSS colors only. Inspect screenshots for artwork composited behind translucent surfaces; passing color samples do not establish pixel-level contrast.',period:{start:'2026-10-08',end:'2026-10-21',payDate:'2026-10-22'},fixture:{providers:fixture.context.clinicians.map(c=>({id:c.id,label:c.label,teamId:c.goalId})),priorAttendance:26,incomingAttendance:28,carryovers:25,individualReportCoverage:false},screenshots,checks};await fs.writeFile(path.join(root,'verification/next-period-render-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).map(c=>c.name),out}));if(checks.some(c=>!c.pass))process.exitCode=1;
}
