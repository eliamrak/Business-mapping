import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {practiceScaleFixture} from './practice-scale-fixture.ts';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const out=await fs.mkdtemp('/tmp/practice-full-scale-');
const frozenRef=process.env.PRACTICE_SCALE_REF??null;
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
const ts=createRequire(path.join(root,'package.json'))('typescript');
const targets=new Set(['PracticeWorkspace','historicalPerformance','historicalPerformancePeriods','periodClientAttrition','historicalClinicianEarningsPerSession','overviewHistoricalCapacity','practiceFinancialRange','practiceFinancialEstimateRange','financialSessionGoal','buildPracticeProjection']);
const hashes={};
const {build}=require('esbuild');
const bundle=await build({stdin:{contents:`import React,{Profiler} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{TooltipProvider}from'@/components/ui/tooltip';import PracticeWorkspace from '@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<Profiler id="workspace" onRender={(id,phase,duration)=>{const a=window.__commits??=[];a.push({phase,duration,time:performance.now()});if(a.length>2000)a.shift();}}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><PracticeWorkspace/></TooltipProvider></QueryClientProvider></Profiler>);`,loader:'tsx',resolveDir:path.join(root,'artifacts/comp-dashboard')},bundle:true,write:false,platform:'browser',format:'esm',jsx:'automatic',alias:{'@':path.join(root,'artifacts/comp-dashboard/src')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"BASE_URL":"/"}'},outdir:path.join(out,'bundle'),plugins:[{name:'bounded-profiling',setup(builder){builder.onLoad({filter:/\.(ts|tsx)$/},async args=>{
  if(!args.path.startsWith(root+'/artifacts/')&&!args.path.startsWith(root+'/lib/'))return;
  const original=frozenRef?execFileSync('git',['show',frozenRef+':'+path.relative(root,args.path)],{cwd:root,encoding:'utf8',maxBuffer:5*1024*1024}):await fs.readFile(args.path,'utf8');hashes[path.relative(root,args.path)]=createHash('sha256').update(original).digest('hex');
  const ast=ts.createSourceFile(args.path,original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[];
  for(const node of ast.statements)if(ts.isFunctionDeclaration(node)&&node.body&&node.name&&targets.has(node.name.text)){
    const name=JSON.stringify(node.name.text);
    edits.push({position:node.body.getStart(ast)+1,text:'const __probeStart=performance.now();try{'},{position:node.body.end-1,text:`}finally{const __d=performance.now()-__probeStart;const __map=globalThis.__perfCalls??={};const __v=__map[${name}]??={count:0,total:0,max:0};__v.count++;__v.total+=__d;__v.max=Math.max(__v.max,__d);if(__d>250)console.debug('PROBE_TIMING',${name},Math.round(__d));}`});
  }
  let contents=original;for(const edit of edits.sort((a,b)=>b.position-a.position))contents=contents.slice(0,edit.position)+edit.text+contents.slice(edit.position);
  return{contents,loader:args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:path.dirname(args.path)};
});}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents;
const index=await fs.readFile(path.join(root,'artifacts/comp-dashboard/dist/public/index.html'),'utf8');
const cssName=index.match(/href="\/assets\/(index-[^"]+\.css)"/)?.[1];
const css=Buffer.concat([await fs.readFile(path.join(root,'artifacts/comp-dashboard/dist/public/assets',cssName)),...bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>Buffer.from(f.contents))]);
const server=http.createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);return res.end();}if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(js);}if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');return res.end(css);}res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/workspace`;
const scale=practiceScaleFixture();
scale.asOf='2026-10-21';
const start=Date.parse('2025-07-01T00:00:00Z');
const date=i=>new Date(start+(Math.floor(i/6)%469)*86400000).toISOString().slice(0,10);
const client=i=>`synthetic-client-${Math.floor(i/6)%120}`;
const attendance=Array.from({length:4823},(_,i)=>({clientId:client(i),clinician:`Synthetic provider ${i%6+1}`,serviceDate:date(i),location:null,status:'show',sourceRowHash:`synthetic-attendance-${i}`}));
const billing=Array.from({length:3681},(_,i)=>({clientId:client(i),clinician:`Synthetic provider ${i%6+1}`,serviceDate:date(i),billingCode:i<276?'PHONE':'90837',totalFeeCharged:i<276?0:75,sourceRowHash:`synthetic-billing-${i}`}));
const snapshots=[];
for(const[kind,rows]of[['attendance',attendance],['billing',billing]])for(let part=0;part<3;part++){
  const selected=part===2?rows:rows.slice(0,kind==='attendance'?1600:1200).filter((_,i)=>i%2===part);
  snapshots.push({id:`synthetic-${kind}-${part}`,kind,sourceHash:`synthetic-source-${kind}-${part}`,importedAt:'2026-10-20T00:00:00Z',coverageStart:'2025-07-01',coverageEnd:'2026-10-12',rows:selected});
}
scale.snapshots=snapshots;
for(const set of scale.declarations.sourceSets){set.end='2026-10-12';set.snapshotIds=snapshots.filter(s=>s.kind===set.kind).map(s=>s.id);}
let scaffold=await fs.readFile(path.join(root,'verification/render-practice-workspace.mjs'),'utf8');
scaffold=scaffold.slice(0,scaffold.indexOf('await page.goto(new URL')).replace('const today = "2026-10-14";','const today = "2026-10-21";').replace('2026-10-14T16:00:00Z','2026-10-21T16:00:00Z');
process.env.PRACTICE_PLAYWRIGHT_PACKAGE='/tmp/practice-oct20-render-deps/package.json';
process.env.PRACTICE_CHROMIUM_PATH='/Users/eliam/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
process.env.PRACTICE_RENDER_OUTPUT=out;
const checks=`const scale=${JSON.stringify(scale)};const FIXTURE=${JSON.stringify(url)};const OUTPUT=${JSON.stringify(out)};`+String.raw`
const writes=[],external=[],navigation=[],displayed={};
const requests=[];page.on('request',request=>requests.push({url:new URL(request.url()).pathname,method:request.method()}));
page.on('console',message=>{if(message.text().startsWith('PROBE_TIMING'))void fs.appendFile(path.join(OUTPUT,'timing-stream.log'),message.text()+'\n');});
const oldTerm=structuredClone(workspace.terms[0]);
Object.assign(workspace,scale.workspace);Object.assign(context,scale.context);snapshots.splice(0,snapshots.length,...scale.snapshots);
workspace.settings.familyW2ClinicianId=2;
workspace.terms=[{...oldTerm,payAmount:90000}];
workspace.goals=[{id:uuid('991'),name:'Owner pay',metric:'ownerDistributionsPretax',amount:90000,basis:'annual',archived:false,date:null,notes:'',sourceAttachmentId:null},{id:uuid('992'),name:'Co-owner pay',metric:'coOwnerSalaryPretax',amount:100000,basis:'annual',archived:false,date:null,notes:'',sourceAttachmentId:null}];
declarations={revision:2,data:scale.declarations,confirmedAt:today+'T00:00:00Z'};
const original=JSON.stringify({workspace,context,snapshots,declarations});
await page.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==new URL(FIXTURE).origin){external.push(u.origin);return route.abort();}if(!['GET','HEAD','OPTIONS'].includes(r.method())){writes.push(r.method()+' '+u.pathname);return route.abort();}return route.fallback();});
await page.addInitScript(()=>{window.__longTasks=[];window.__heartbeat=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(x=>({start:x.startTime,duration:x.duration})))).observe({type:'longtask',buffered:true});setInterval(()=>{window.__heartbeat.push(performance.now());if(window.__heartbeat.length>2000)window.__heartbeat.shift();},100);});
page.setDefaultTimeout(60000);
const watchdog=setTimeout(()=>{console.error('PROBE WATCHDOG: 120 seconds');process.exit(2);},120000);
try{
 const begin=performance.now();await page.goto(FIXTURE);await page.getByText('6 converted snapshots loaded',{exact:true}).waitFor();await page.waitForTimeout(1500);
 const initialMs=performance.now()-begin;
 displayed.initialOverview=await page.locator('body').innerText();
 const ready=await page.evaluate(()=>({commits:window.__commits??[],functions:window.__perfCalls,longTasks:window.__longTasks}));
 for(const label of ['Money','Sessions','Team','Overview','Team','Overview']){const t=performance.now();await clickSection(label);await page.locator('h1').filter({hasText:label}).waitFor();await page.waitForTimeout(200);navigation.push({label,ms:performance.now()-t});displayed[label]=await page.locator('body').innerText();}
 const idleBefore=await page.evaluate(()=>({commits:window.__commits?.length??0,functions:structuredClone(window.__perfCalls)}));await page.waitForTimeout(1500);
 const final=await page.evaluate(()=>({commits:window.__commits??[],functions:window.__perfCalls,longTasks:window.__longTasks,heartbeats:window.__heartbeat}));
 await page.screenshot({path:path.join(OUTPUT,'overview.png')});
 assert.equal(JSON.stringify({workspace,context,snapshots,declarations}),original);assert.deepEqual(writes,[]);
 const result={syntheticOnly:true,productionAccess:false,attendanceRows:4823,billingRows:3681,snapshots:snapshots.length,rawAttendanceRows:snapshots.filter(x=>x.kind==='attendance').reduce((n,s)=>n+s.rows.length,0),rawBillingRows:snapshots.filter(x=>x.kind==='billing').reduce((n,s)=>n+s.rows.length,0),manualRecords:context.sessions.length,rosterRows:context.clinicians.length,initialMs,navigation,displayed,ready,idleBefore,final,writes,external,browserErrors};
 await fs.writeFile(path.join(OUTPUT,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out:OUTPUT,initialMs,navigation,readyFunctions:ready.functions,finalFunctions:final.functions,commits:final.commits.length,idleCommitDelta:final.commits.length-idleBefore.commits,errors:browserErrors},null,2));
}catch(error){const state=await Promise.race([page.evaluate(()=>({body:document.body.innerText.slice(0,4000),functions:window.__perfCalls,longTasks:window.__longTasks,heartbeats:window.__heartbeat.length})).catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve('Main thread did not answer within 2 seconds'),2000))]);await fs.writeFile(path.join(OUTPUT,'failure.json'),JSON.stringify({error:String(error.stack??error).split('data:text/javascript')[0],writes,browserErrors,requests,state},null,2));await page.screenshot({path:path.join(OUTPUT,'failure.png'),timeout:2000}).catch(()=>{});throw error;}finally{clearTimeout(watchdog);await browser.close();}
`;
await fs.writeFile(path.join(out,'source-hashes.json'),JSON.stringify({commit:frozenRef??execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),hashes},null,2));
try{await import('data:text/javascript;base64,'+Buffer.from(scaffold+checks).toString('base64'));}catch(error){console.error(JSON.stringify({out,error:String(error.stack??error).split('data:text/javascript')[0]}));process.exitCode=1;}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

