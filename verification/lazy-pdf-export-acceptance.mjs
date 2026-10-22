import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root=path.resolve(import.meta.dirname,"..");
const out=path.resolve(root,"../lazy-pdf-export-evidence/browser");
await fs.mkdir(out,{recursive:true});
const require=createRequire(path.join(root,"artifacts/api-server/package.json"));
const {build}=require("esbuild");
const playwright=createRequire("/tmp/practice-oct20-render-deps/package.json")("playwright");
const sourcePath="artifacts/comp-dashboard/src/components/tabs/export-tab.tsx";
const baseline=execFileSync("git",["show",`f55d10ff4513f6e99f4258e5cfcc2ae65b99eb40:${sourcePath}`],{cwd:root,encoding:"utf8"});
const candidate=await fs.readFile(path.join(root,sourcePath),"utf8");
const clinician={id:1,label:"Synthetic clinician",roleType:"clinician",sessionRate:100,sessionsPerWeek:20,weeksWorkedPerYear:48,capEnabled:true,capAmount:1000,preCapClinicianSplit:60,preCapPracticeSplit:40,postCapClinicianSplit:70,postCapPracticeSplit:30,classification:"w2",w2EmployerFicaPct:7.65,futaSutaPct:1,workersCompPct:0,otherEmployerBurdenPct:0,nonClinicalHoursPerWeek:1,nonClinicalHourlyRate:25};
const goal={id:1,name:"Synthetic recurring goal",timeHorizon:"1 year",ownerPayGoal:12000,secondOwnerPayGoal:6000,annualOverheadGoal:24000,businessProfitGoal:12000,desiredCliniciansCount:2,buildingFundGoal:5000,emergencyReserveGoal:3000,growthFundGoal:2000};
const current={currentCliniciansCount:1,currentAvgSessionRate:100,currentAvgSessionsPerWeek:20,currentAvgWeeksWorkedPerYear:48,currentOwnerPay:10000,currentSecondOwnerPay:4000,currentAnnualOverhead:20000,currentBusinessProfit:10000,currentBuildingFund:2000,currentCashReserve:1000};
const staff={id:2,label:"Synthetic coordinator",roleType:"admin",classification:"w2",annualSalary:12000,hourlyRate:0,hoursPerWeek:0,weeksPerYear:52,w2EmployerFicaPct:7.65,futaSutaPct:0,workersCompPct:0,otherEmployerBurdenPct:0};
const mock=`const clinician=${JSON.stringify(clinician)},goal=${JSON.stringify(goal)},current=${JSON.stringify(current)},staff=${JSON.stringify(staff)};export const useListClinicians=()=>({data:[clinician]});export const useListScenarios=()=>({data:[{id:1,name:'Synthetic scenario'}]});export const useGetScenario=id=>({data:id===1?{clinicians:[{...clinician,label:'Synthetic scenario clinician'}]}:undefined});export const getGetScenarioQueryKey=id=>['scenario',id];export const useListBusinessGoals=()=>({data:[goal]});export const useGetCurrentReality=()=>({data:current});export const useListStaffMembers=()=>({data:[staff]});`;
const assetMap=new Map();
for(const [name,source] of [["baseline",baseline],["candidate",candidate]]) {
  const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import PDFExportTab from 'pdf-under-test';createRoot(document.getElementById('root')).render(<PDFExportTab/>);",loader:"tsx",resolveDir:path.join(root,"artifacts/comp-dashboard")},bundle:true,splitting:true,format:"esm",platform:"browser",jsx:"automatic",minify:true,write:false,outdir:path.join(out,name),entryNames:"app",chunkNames:"chunks/[name]-[hash]",alias:{"@":path.join(root,"artifacts/comp-dashboard/src")},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"synthetic-api-and-version",setup(b){b.onResolve({filter:/^pdf-under-test$/},()=>({path:"component",namespace:"test"}));b.onResolve({filter:/^@workspace\/api-client-react$/},()=>({path:"api",namespace:"test"}));b.onLoad({filter:/.*/,namespace:"test"},args=>({contents:args.path==="api"?mock:source,loader:"tsx",resolveDir:path.join(root,"artifacts/comp-dashboard")}));}}]});
  for(const file of bundle.outputFiles){const rel="/"+path.relative(out,file.path).split(path.sep).join("/");assetMap.set(rel,file.contents);await fs.mkdir(path.dirname(file.path),{recursive:true});await fs.writeFile(file.path,file.contents);}
}
const css=await fs.readFile("/tmp/practice-tidal-public-repro-fKvp4n/artifacts/comp-dashboard/dist/public/assets/index-BH0dfUm1.css");
const server=http.createServer((req,res)=>{if(req.url==="/style.css"){res.setHeader("Content-Type","text/css");res.end(css);return;}if(assetMap.has(req.url)){res.setHeader("Content-Type","text/javascript");res.end(assetMap.get(req.url));return;}const name=req.url==="/baseline"?"baseline":"candidate";res.setHeader("Content-Type","text/html");res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="margin:24px"><div id="root"></div><script type="module" src="/${name}/app.js"></script></body></html>`);});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.chromium.launch({headless:true,executablePath:"/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell"});
const results=[];
const normalized=bytes=>bytes.toString("latin1").replace(/\/ID\s*\[\s*<[A-Fa-f0-9]+>\s*<[A-Fa-f0-9]+>\s*\]/g,"/ID [ <FIXED> <FIXED> ]");
const outputs={};
try {
  for(const name of ["baseline","candidate"]) {
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    await context.addInitScript(()=>{const D=Date;window.Date=class extends D{constructor(...args){super(...(args.length?args:["2026-10-22T12:00:00Z"]));}static now(){return new D("2026-10-22T12:00:00Z").valueOf();}};});
    const page=await context.newPage();const requests=[];page.on("request",r=>requests.push(new URL(r.url()).pathname));
    await page.goto(origin+"/"+name);await page.getByRole("heading",{name:"Export Reports"}).waitFor();
    await page.getByLabel("Practice Name (for PDF headers)").fill("Synthetic practice");
    await page.screenshot({path:path.join(out,`${name}-1440.png`),fullPage:true});
    const initialRequests=[...requests];
    outputs[name]=[];
    for(let index=0;index<3;index++) {
      const download=page.waitForEvent("download");await page.getByRole("button",{name:"Generate PDF",exact:true}).nth(index).click();const saved=await download;
      const file=path.join(out,`${name}-${index}.pdf`);await saved.saveAs(file);const bytes=await fs.readFile(file);assert.ok(bytes.toString().startsWith("%PDF-"));outputs[name].push(normalized(bytes));
      results.push({test:`${name}-report-${index}`,pass:true,bytes:bytes.length,name:saved.suggestedFilename()});
    }
    await page.getByRole("combobox").click();
    await page.getByRole("option",{name:"Synthetic scenario",exact:true}).click();
    const scenarioDownload=page.waitForEvent("download");
    await page.getByRole("button",{name:"Generate PDF",exact:true}).nth(1).click();
    const scenario=await scenarioDownload;const scenarioFile=path.join(out,`${name}-scenario.pdf`);await scenario.saveAs(scenarioFile);
    const scenarioBytes=await fs.readFile(scenarioFile);assert.ok(scenarioBytes.toString().includes("scenario"));outputs[name].push(normalized(scenarioBytes));results.push({test:`${name}-scenario-selection`,pass:true});
    if(name==="candidate")assert.ok(initialRequests.every(p=>!p.includes("/chunks/jspdf")),"PDF chunks were loaded before action");
    results.push({test:`${name}-initial-network`,pass:true,initialRequests});
    if(name==="candidate")for(const width of [390,320]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(out,`candidate-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));results.push({test:`candidate-${width}-no-overflow`,pass:true});}
    await context.close();
  }
  for(let i=0;i<outputs.baseline.length;i++){assert.equal(outputs.candidate[i],outputs.baseline[i],`Report ${i} contents/layout changed`);results.push({test:`report-${i}-baseline-parity`,pass:true,normalizedSha256:createHash("sha256").update(outputs.candidate[i]).digest("hex")});}
  const context=await browser.newContext();const page=await context.newPage();
  let release;const blocked=new Promise(resolve=>release=resolve);
  await page.route("**/candidate/chunks/jspdf*.js",async route=>{await blocked;await route.continue();});
  await page.goto(origin+"/candidate");await page.getByRole("button",{name:"Generate PDF",exact:true}).first().click();
  await page.locator('[aria-busy="true"]').waitFor();assert.equal(await page.getByRole("button",{name:"Generate PDF",exact:true}).count(),3);assert.equal(await page.getByRole("button",{name:"Generate PDF",exact:true}).evaluateAll(bs=>bs.every(b=>b.disabled)),true);
  const pendingDownload=page.waitForEvent("download");release();await pendingDownload;await page.locator('[aria-busy="false"]').waitFor();results.push({test:"async-loading-disables-all-and-recovers",pass:true});await context.close();
  const failureContext=await browser.newContext();const failed=await failureContext.newPage();
  await failed.route("**/candidate/chunks/jspdf*.js",route=>route.abort());
  await failed.goto(origin+"/candidate");await failed.getByRole("button",{name:"Generate PDF",exact:true}).first().click();await failed.getByRole("alert").waitFor();assert.ok(await failed.getByRole("button",{name:"Generate PDF",exact:true}).first().isEnabled());results.push({test:"chunk-failure-visible-and-unlocks",pass:true});
  await failed.unroute("**/candidate/chunks/jspdf*.js");await failed.reload();const retry=failed.waitForEvent("download");await failed.getByRole("button",{name:"Generate PDF",exact:true}).first().click();await retry;results.push({test:"refresh-after-network-recovery-exports",pass:true});await failureContext.close();
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
await fs.writeFile(path.join(out,"results.json"),JSON.stringify({syntheticOnly:true,normalization:"PDF random document IDs only; fixed clock both versions",results},null,2));console.log(JSON.stringify({checks:results.length,results},null,2));
