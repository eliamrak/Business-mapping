import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const dashboardRequire=createRequire(new URL('../artifacts/comp-dashboard/package.json',import.meta.url));
const {build}=createRequire(dashboardRequire.resolve('vite/package.json'))('esbuild');
const out=process.env.PRACTICE_KNOWLEDGE_EVIDENCE??'/tmp/practice-knowledge-render';
await fs.mkdir(out,{recursive:true});
const compiled=await build({stdin:{loader:'tsx',resolveDir:path.join(root,'artifacts/comp-dashboard'),contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {KnowledgeView} from './src/components/knowledge/knowledge-panel';
import {knowledgeDocumentSchema} from '@workspace/practice/knowledge';
import './src/pages/practice-tokens.css';import './src/pages/practice-workspace.css';import './src/pages/practice-approved.css';
const documents=['operations','archetypes','voice','resources'].map((category,index)=>knowledgeDocumentSchema.parse({id:'10000000-0000-4000-8000-00000000000'+(index+1),title:'Synthetic '+category+' reference',category,version:1,contentHash:'a'.repeat(64),approvedAt:'2026-01-01T00:00:00Z',content:{blocks:[{kind:'heading',text:'Fictional demonstration'},{kind:'paragraph',text:'This is synthetic test content, not approved Practice policy or a real source import. It demonstrates a readable, versioned reference.'}]}}));
function App(){const [state,setState]=useState('empty');return <main className='pw-app fixture' data-material='tidal'><label className='fixture-controls'>Synthetic fixture <select aria-label='Synthetic fixture' value={state} onChange={e=>setState(e.target.value)}>{['empty','populated','loading','error'].map(value=><option key={value}>{value}</option>)}</select></label><KnowledgeView documents={state==='populated'?documents:[]} loading={state==='loading'} error={state==='error'?'Synthetic unavailable-store response.':undefined} retry={()=>setState('empty')}/></main>}
createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',outdir:out,define:{'process.env.NODE_ENV':'"development"'}});
const js=compiled.outputFiles.find(file=>file.path.endsWith('.js')).contents;
const css=compiled.outputFiles.find(file=>file.path.endsWith('.css')).contents;
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0}.fixture{box-sizing:border-box;display:block;max-width:1280px;margin:auto;padding:28px}.fixture-controls{display:block;margin-bottom:20px;font-size:12px}.fixture-controls select{margin-left:12px;padding:6px}@media(max-width:700px){.fixture{padding:12px}}</style></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>';
const requests=[];const checks=[];const errors=[];
const server=http.createServer((req,res)=>{requests.push(req.url);const entry={'/':[html,'text/html'],'/bundle.js':[js,'text/javascript'],'/style.css':[css,'text/css'],'/favicon.ico':['','image/x-icon']}[req.url];if(!entry){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':entry[1]});res.end(entry[0]);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=createRequire(process.env.PRACTICE_PLAYWRIGHT_PACKAGE??'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.PRACTICE_FULL_CHROME??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1280,height:1000}});
 page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('heading',{name:'Knowledge',exact:true}).waitFor();
 async function check(name,fn){await fn();checks.push(name)}
 await check('empty SOP slot, private audience and disconnected sync are explicit',async()=>{assert.equal(await page.getByRole('tab').count(),4);await page.getByText(/No approved SOPs yet/).waitFor();await page.getByText('Private · owner only').waitFor();await page.getByText(/Google sync is not connected/).waitFor();});
 await page.screenshot({path:path.join(out,'knowledge-desktop-empty.png'),fullPage:true});
 await check('all tabs open; planned sources contain no imported content',async()=>{for(const name of ['Archetypes & Ideal Clients','Copy & Brand Voice','Resources & Visual Maps','Operations & SOPs']){await page.getByRole('tab',{name,exact:true}).click();assert.equal(await page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');}await page.getByRole('tab',{name:'Resources & Visual Maps',exact:true}).click();await page.getByText(/Their content has not been imported/).waitFor();});
 await check('tab keyboard navigation wraps and controls focus',async()=>{await page.getByRole('tab',{name:'Resources & Visual Maps',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'Operations & SOPs',exact:true}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{name:'Resources & Visual Maps',exact:true}).evaluate(el=>el===document.activeElement),true);});
 await page.getByLabel('Synthetic fixture').selectOption('populated');
 await check('synthetic approved reference displays version and validated plain-text content',async()=>{await page.getByRole('article',{name:'Synthetic resources reference'}).waitFor();await page.getByText('Fictional demonstration').waitFor();assert.match(await page.getByRole('article').innerText(),/version 1/i);assert.equal(await page.locator('article iframe,article script,article img').count(),0);});
 await page.screenshot({path:path.join(out,'knowledge-desktop-synthetic.png'),fullPage:true});
 for(const width of [768,390,320]){await page.setViewportSize({width,height:900});await check(width+'px layout has no horizontal page overflow',async()=>{const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1,JSON.stringify(size))});await page.screenshot({path:path.join(out,'knowledge-'+width+'.png'),fullPage:true});}
 await check('loading and unavailable states with retry never show stale content',async()=>{await page.getByLabel('Synthetic fixture').selectOption('loading');await page.getByRole('status').waitFor();assert.equal(await page.getByRole('article').count(),0);await page.getByLabel('Synthetic fixture').selectOption('error');await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('article').count(),0);await page.getByRole('button',{name:'Try again'}).click();await page.getByText(/Their content has not been imported/).waitFor();});
 await check('no API/provider/business requests or runtime errors',async()=>{assert.deepEqual(errors,[]);assert.ok(requests.every(url=>['/','/bundle.js','/style.css','/favicon.ico'].includes(url)));});
 const report={status:'passed',scope:'Isolated real KnowledgeView with synthetic or empty data. No live app/database/provider connection.',checks,errors,requests};await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(error){await fs.writeFile(path.join(out,'report.json'),JSON.stringify({status:'failed',checks,errors,error:String(error)},null,2));throw error;} finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
