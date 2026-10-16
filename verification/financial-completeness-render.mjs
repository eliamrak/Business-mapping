import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
process.env.PRACTICE_RENDER_OUTPUT ??= await fs.mkdtemp('/tmp/financial-completeness-render-');
const {build}=createRequire(root+'/artifacts/api-server/package.json')('esbuild');
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {TooltipProvider} from '@/components/ui/tooltip';import PracticeWorkspace from '@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><PracticeWorkspace/></TooltipProvider></QueryClientProvider>);`,loader:'tsx',resolveDir:root+'/artifacts/comp-dashboard'},bundle:true,write:false,platform:'browser',format:'esm',jsx:'automatic',alias:{'@':root+'/artifacts/comp-dashboard/src'},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{"BASE_URL":"/"}'},plugins:[{name:'css-external',setup(b){b.onLoad({filter:/\.css$/},()=>({contents:'',loader:'css'}));}}],outdir:'/tmp/historical-render-build'});
const assets=root+'/artifacts/comp-dashboard/dist/public/assets';
const css=await fs.readFile(assets+'/'+(await fs.readdir(assets)).find(file=>/^index-.*\.css$/.test(file)));
const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents);}if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');return res.end(css);}res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const setup=await fs.readFile(root+'/verification/render-practice-workspace.mjs','utf8');
const start=setup.indexOf('await page.goto(new URL');
const checks=String.raw`
const requests=[];
await page.route('**/*',route=>{const req=route.request();if(new URL(req.url()).hostname!=='127.0.0.1')return route.abort();requests.push(req.method());if(req.method()!=='GET')return route.abort();return route.fallback();});
workspace.periods=[{id:uuid('9901'),name:'Synthetic finalized cost period',start:'2026-01-01',end:'2026-10-07',status:'finalized',earnedRevenue:1000,revenue:25,clinicianPay:0,employerBurden:0,staffPay:0,ownerPay:0,expensesComplete:false}];
try{
await page.goto('http://127.0.0.1:PORT/workspace');
await clickSection('Overview');
await page.getByLabel('Shared reporting period',{exact:true}).selectOption('year');
await page.getByText('Actual billed session income · financial coverage incomplete',{exact:true}).waitFor();
for(const width of [1280,390]){await capture('financial-costs-incomplete',width,900);await page.getByLabel('Overview financial summary',{exact:true}).screenshot({path:path.join(outDir,'financial-incomplete-detail-'+width+'.png')});}
workspace.periods[0].expensesComplete=true;
await page.reload();await clickSection('Overview');await page.getByLabel('Shared reporting period',{exact:true}).selectOption('year');
await page.getByText('Actual billed session income · financial coverage complete',{exact:true}).waitFor();
for(const width of [1280,390])await capture('financial-costs-complete',width,900);
await clickSection('Sessions');
assert.deepEqual(await page.locator('nav[aria-label="Practice sections"] button span:last-child').allTextContents(),['Overview','Sessions','Team','Money','Growth','Goals']);
assert.ok(await page.locator('.pw-percentage-kpi-ring').count()>0);
await capture('sessions-circular-kpis',1280,900);await capture('sessions-circular-kpis',390,900);
assert.deepEqual(browserErrors,[]);assert.ok(requests.every(method=>method==='GET'));assert.ok(checks.every(c=>c.scrollWidth<=c.clientWidth+1&&c.topNavigation));
await fs.writeFile(path.join(outDir,'results.json'),JSON.stringify({syntheticOnly:true,productionAccess:false,writes:0,requests,browserErrors,checks},null,2));console.log(JSON.stringify({outDir,states:checks.length,browserErrors,overflow:false,writes:0}));
}finally{await browser.close();}
`;
try{await import('data:text/javascript;base64,'+Buffer.from(setup.slice(0,start)+checks.replace('127.0.0.1:PORT','127.0.0.1:'+server.address().port)).toString('base64'));}catch(e){console.error(e.message?.split('data:text/javascript')[0]);process.exitCode=1;}finally{await new Promise(r=>server.close(r));}


