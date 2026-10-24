import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=new URL('../',import.meta.url).pathname;
const require=createRequire(new URL('../artifacts/comp-dashboard/package.json',import.meta.url));
const {build}=createRequire(require.resolve('vite/package.json'))('esbuild');
const out=process.env.PRACTICE_KNOWLEDGE_SESSION_EVIDENCE??'/tmp/practice-knowledge-session';
await fs.mkdir(out,{recursive:true});
const compiled=await build({stdin:{loader:'tsx',resolveDir:path.join(root,'artifacts/comp-dashboard'),contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {KnowledgeReader} from './src/components/knowledge/knowledge-panel';
const client=new QueryClient();window.pending=[];window.identity='synthetic_a';
// Deliberately ignore abort to exercise late-response isolation even with an uncooperative transport.
window.fetch=(url,options)=>{if(url!=='/api/knowledge')throw Error('Unexpected request');return new Promise(resolve=>window.pending.push({owner:window.identity,signal:options.signal,resolve}));};
window.finish=(index)=>{const request=window.pending[index];request.resolve(new Response(JSON.stringify({resources:[{id:'10000000-0000-4000-8000-000000000001',title:request.owner+' private fixture',category:'operations',version:1,contentHash:'a'.repeat(64),approvedAt:'2026-01-01T00:00:00Z',content:{blocks:[{kind:'paragraph',text:request.owner+' synthetic private text'}]}}],status:'ready',sync:'not-connected'}),{status:200,headers:{'content-type':'application/json'}}));};
function App(){const [owner,setOwner]=useState('synthetic_a');return <><label>Test identity<select aria-label='Test identity' value={owner} onChange={e=>{window.identity=e.target.value;setOwner(e.target.value)}}><option>synthetic_a</option><option>synthetic_b</option><option value=''>Signed out</option></select></label><KnowledgeReader principalId={owner||null}/></>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
`},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',outdir:out,define:{'process.env.NODE_ENV':'"development"'}});
const js=compiled.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=compiled.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>';
const requests=[],checks=[],errors=[];
const server=http.createServer((req,res)=>{requests.push(req.url);const item={'/':[html,'text/html'],'/bundle.js':[js,'text/javascript'],'/style.css':[css,'text/css'],'/favicon.ico':['','image/x-icon']}[req.url];res.writeHead(item?200:404,{'content-type':item?.[1]??'text/plain'});res.end(item?.[0]??'Unexpected request');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE??'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.PRACTICE_FULL_CHROME??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>window.pending.length===1);
 await page.getByLabel('Test identity').selectOption('synthetic_b');await page.waitForFunction(()=>window.pending.length===2);
 assert.equal(await page.evaluate(()=>window.pending[0].signal.aborted),true);
 await page.evaluate(()=>window.finish(0));await page.getByRole('status').waitFor();
 assert.equal(await page.getByRole('article').count(),0);assert.equal(await page.getByText(/synthetic_a private/).count(),0);checks.push('delayed owner A response cannot appear in owner B context; abandoned request is cancelled');
 await page.evaluate(()=>window.finish(1));await page.getByRole('article',{name:'synthetic_b private fixture'}).waitFor();checks.push('owner B sees only its own resolved data');
 await page.getByLabel('Test identity').selectOption('synthetic_a');await page.waitForFunction(()=>window.pending.length===3);
 assert.equal(await page.getByRole('article').count(),0);
 await page.getByLabel('Test identity').selectOption('');await page.evaluate(()=>window.finish(2));await page.getByText('Sign in as the owner to read Knowledge.').waitFor();
 assert.equal(await page.getByRole('article').count(),0);assert.equal(await page.getByRole('button',{name:'Try again'}).count(),0);checks.push('sign-out hides resolved and delayed private data and disables refetch');
 await page.screenshot({path:path.join(out,'knowledge-signed-out.png'),fullPage:true});
 await page.getByLabel('Test identity').selectOption('synthetic_b');await page.waitForFunction(()=>window.pending.length===4);assert.equal(await page.getByRole('article').count(),0);
 await page.evaluate(()=>window.finish(3));await page.getByRole('article',{name:'synthetic_b private fixture'}).waitFor();await page.screenshot({path:path.join(out,'knowledge-owner-b.png'),fullPage:true});
 checks.push('returning owner starts a fresh request without prior account content');
 assert.deepEqual(errors,[]);assert.ok(requests.every(p=>['/','/bundle.js','/style.css','/favicon.ico'].includes(p)));
 const report={status:'passed',scope:'Synthetic delayed transport; real KnowledgeReader and React Query; no app/provider/DB connection',checks,errors,requests};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
