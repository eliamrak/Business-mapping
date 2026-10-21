import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const out = await fs.mkdtemp("/tmp/profit-first-help-");
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const baseline = process.argv.includes("--baseline");
const plugins = [{name:"reproduction-base",setup(builder){
  const original = args => ({contents:execFileSync("git",["show",`da803da:${path.relative(root,args.path)}`],{cwd:root,encoding:"utf8"}),loader:args.path.endsWith(".css")?"css":"tsx"});
  if (baseline) builder.onLoad({filter:/profit-first-planning\.(tsx|css)$/},original);
  if (process.argv.includes("--base-workspace")) builder.onLoad({filter:/pages\/practice-workspace\.tsx$/},original);
  else if (process.argv.includes("--budget-mode")) builder.onLoad({filter:/pages\/practice-workspace\.tsx$/},async args=>({contents:(await fs.readFile(args.path,"utf8")).replaceAll("<ProfitFirstPlanning",'<ProfitFirstPlanning costSource="budget"'),loader:"tsx"}));
}}];
const build = await require("esbuild").build({ plugins, stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{TooltipProvider}from'@/components/ui/tooltip';import PracticeWorkspace from '@/pages/practice-workspace';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><TooltipProvider><PracticeWorkspace/></TooltipProvider></QueryClientProvider>);`, loader: "tsx", resolveDir: path.join(root, "artifacts/comp-dashboard") }, bundle: true, write: false, platform: "browser", format: "esm", jsx: "automatic", alias: { "@": path.join(root, "artifacts/comp-dashboard/src") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"BASE_URL":"/"}' }, outdir: path.join(out, "bundle") });
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
setup = setup.replace('viewport: { width: 1280, height: 900 }', 'hasTouch: true, viewport: { width: 1280, height: 900 }');
process.env.PRACTICE_PLAYWRIGHT_PACKAGE ??= "/tmp/practice-oct20-render-deps/package.json";
process.env.PRACTICE_RENDER_OUTPUT = out;
const tests = `const FIXTURE=${JSON.stringify(url)},BUDGET_MODE=${process.argv.includes("--budget-mode")};` + String.raw`
const results=[],writes=[],external=[];
await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(FIXTURE).origin){external.push(u.origin);return route.abort();}if(req.method()!=='GET'){writes.push(req.method()+' '+u.pathname);return route.abort();}return route.fallback();});
try{
 await page.goto(FIXTURE);await page.getByText('2 converted snapshots loaded',{exact:true}).waitFor();
 await page.getByRole('navigation',{name:'Practice sections',exact:true}).getByRole('button',{name:/Money$/}).click();
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});
  if(BUDGET_MODE){assert.equal(await page.locator('.pf-planning input[aria-label="Overhead set-aside estimate"],.pf-planning input[aria-label="Processing cost estimate"],.pf-planning input[aria-label="Existing marketing estimate"]').count(),0,'Budget costs must not have duplicate Money editors');if(width<=390)assert.ok(await page.locator('.pf-cost-source').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})),'Read-only cost sources fit the viewport');}
  const row=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Business profit',exact:true})});
  const trigger=row.locator('.pf-help').first();
  const legacy=await trigger.evaluate(node=>node.tagName==='DETAILS');
  const control=legacy?trigger.locator('summary'):trigger;
  await control.scrollIntoViewIfNeeded();await control.focus();await page.keyboard.press('Enter');
  const content=legacy?trigger.locator('span'):page.locator('.pf-help-content');
  await content.waitFor({state:'visible'});
  await page.waitForTimeout(200);
  const geometry=await content.evaluate(node=>{const r=node.getBoundingClientRect();const samples=[];const range=document.createRange();range.selectNodeContents(node);const rects=[r,...range.getClientRects()];for(const rect of rects)for(const fx of [.1,.5,.9])for(const fy of [.1,.5,.9]){const x=rect.left+rect.width*fx,y=rect.top+rect.height*fy,hit=document.elementFromPoint(x,y);samples.push({x,y,clear:!!hit&&(hit===node||node.contains(hit)),hit:hit?.tagName});}return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,contentWidth:r.width,height:r.height,viewport:innerWidth,samples,bodyPortal:!node.closest('.pf-planning'),overflow:document.documentElement.scrollWidth>innerWidth+1};});
  const pass=geometry.left>=0&&geometry.right<=width&&geometry.top>=0&&geometry.bottom<=900&&geometry.samples.every(s=>s.clear)&&!geometry.overflow&&(legacy||geometry.bodyPortal);
  results.push({width,legacy,pass,...geometry});
  await page.screenshot({path:path.join(outDir,'help-'+width+'.png'),fullPage:true});
  if(legacy)await control.click();else{await page.keyboard.press('Escape');await page.waitForFunction(node=>node===document.activeElement,await control.elementHandle());assert.equal(await control.evaluate(node=>node===document.activeElement),true,'Escape restores trigger focus');await control.tap();await content.waitFor({state:'visible'});await page.keyboard.press('Escape');await content.waitFor({state:'hidden'});}
 }
 assert.deepEqual(writes,[]);assert.deepEqual(external,[]);assert.deepEqual(browserErrors,[]);
 await fs.writeFile(path.join(outDir,'results.json'),JSON.stringify({syntheticOnly:true,results,writes,external,browserErrors},null,2));
 console.log(JSON.stringify({out:outDir,results:results.map(({samples,...result})=>({...result,samples:samples.length,occluded:samples.filter(s=>!s.clear).length}))}));
 assert.ok(results.every(r=>r.pass),'Help bounds and every elementFromPoint sample must be unobstructed');
}finally{await browser.close();}
`;
try { await import('data:text/javascript;base64,' + Buffer.from(setup + tests).toString('base64')); }
catch(error) { console.error(String(error.message).split('data:text/javascript')[0]);process.exitCode=1; }
finally { server.closeAllConnections();await new Promise(resolve => server.close(resolve)); }
