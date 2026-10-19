import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
let template=await fs.readFile(new URL('./recovered-live-decisions-render.mjs',import.meta.url),'utf8');
const begin=template.indexOf('const checks=String.raw`');
const end=template.indexOf('`;\ntry{await import',begin);
if(begin<0||end<0)throw new Error('Render harness markers changed');
const checks=String.raw`
const requests=[];
await page.route('**/*',route=>{const req=route.request();if(new URL(req.url()).hostname!=='127.0.0.1')return route.abort();requests.push(req.method());if(req.method()!=='GET')return route.abort();return route.fallback();});
Object.assign(workspace.settings,{forecastStart:'2026-09-01',baselineMode:'historical',historicalStart:'2026-09-01',historicalEnd:'2026-09-30',defaultInPersonPct:0,familyW2ClinicianId:2,overheadFloorMonthly:4338.05});
workspace.periods=[];workspace.rooms=[];workspace.staffTerms=[];workspace.terms=[];workspace.clinicians=[];workspace.moneyPlanning=undefined;
context.sessions=[];context.staff=[];context.clinicians=[];snapshots.splice(0);
for(let id=1;id<=6;id++){
 const person={id,goalId:1,label:'Synthetic clinician '+id,classification:id===1?'owner':'w2',sessionRate:100+10*id,sessionsPerWeek:50,weeksWorkedPerYear:52.1786,capEnabled:false,capAmount:0,preCapClinicianSplit:id===1?0:60,preCapPracticeSplit:id===1?100:40,postCapClinicianSplit:60,postCapPracticeSplit:40,w2EmployerFicaPct:7.65,futaSutaPct:0,workersCompPct:0,otherEmployerBurdenPct:0};context.clinicians.push(person);
 workspace.clinicians.push({id:uuid('980'+id),clinicianId:id,start:'2026-01-01',desiredWeeklySessions:50,inPersonPct:0,...(id===2?{payMode:'salary',payAmount:90000}:{})});
 snapshots.push({id:'attendance-synthetic-'+id,kind:'attendance',sourceHash:'synthetic-'+id,importedAt:'2026-10-14T00:00:00Z',coverageStart:'2026-09-24',coverageEnd:'2026-10-07',coverageClinicians:[person.label],reportCoverage:{start:'2026-09-24',end:'2026-10-07',complete:true},rows:['2026-09-24','2026-10-07'].flatMap(date=>Array.from({length:id*4},(_,index)=>attendance('synthetic-'+id+'-'+date+'-'+index,person.label,date)))});
}
context.importedBillingActuals=['2026-09-24','2026-10-10'].flatMap(serviceDate=>[100000,200000].map(totalFeeCharged=>({clinicianId:3,serviceDate,totalFeeCharged,sourceRowHash:'synthetic-conflict-'+serviceDate})));
Object.assign(workspace,(await import('file://'+process.cwd()+'/lib/practice/src/hub/model.ts')).workspaceSchema.parse(workspace));
const before=structuredClone({workspace,context,snapshots});
const planner=page.getByLabel('Money planning estimates',{exact:true});
const expected=context.clinicians.reduce((n,c)=>n+c.id*4*c.sessionRate,0)*31/7;
async function checkNumeric(){
 await planner.waitFor();assert.match(await planner.locator('header').innerText(),/2026-10-01 to 2026-10-31.*observed sessions through 2026-10-07/);
 assert.doesNotMatch(await planner.locator('tbody').innerText(),/Unknown/);
 const income=await planner.locator('.pf-summary strong').first().innerText();assert.equal(income,'$'+Math.round(expected).toLocaleString('en-US'));
 for(const label of [/^Monthly billed revenue estimate/,/^Processing cost estimate/,/^Owner clinical payroll estimate/,/^Total monthly clinician payroll estimate/,/^Clinician employer cost estimate/]){
  const input=planner.getByLabel(label);assert.notEqual(await input.inputValue(),'');
 }
}
try{
await page.goto('http://127.0.0.1:PORT/workspace');await clickSection('Overview');
await page.getByText('6 of 6 clinicians have observed session averages; desired sessions are not substituted. Unverified coverage remains an estimate.',{exact:true}).waitFor({state:'attached'});
await clickSection('Money');await planner.getByText('Cost estimates and source periods',{exact:true}).click();await checkNumeric();
for(const width of[1280,390])await capture('observed-monthly-planning',width,900);
await page.getByLabel('Shared reporting period',{exact:true}).selectOption('custom');await page.getByLabel('From',{exact:true}).fill('2026-09-19');await page.getByLabel('Through',{exact:true}).fill('2026-10-18');await checkNumeric();
await page.reload();await clickSection('Money');await planner.getByText('Cost estimates and source periods',{exact:true}).click();await checkNumeric();
for(const width of[1280,390])await capture('observed-monthly-planning-reload',width,900);
assert.deepEqual({workspace,context,snapshots},before);
snapshots[5].reportCoverage=null;await page.reload();await clickSection('Money');await planner.waitFor();
await page.waitForLoadState('networkidle');assert.equal(await planner.locator('.pf-summary strong').first().innerText(),'Unknown');
for(const width of[1280,390])await capture('missing-common-proof-unknown',width,900);
assert.deepEqual(browserErrors,[]);assert.ok(requests.every(method=>method==='GET'));assert.ok(checks.every(c=>c.scrollWidth<=c.clientWidth+1&&c.topNavigation));
await fs.writeFile(path.join(outDir,'results.json'),JSON.stringify({provenance,syntheticOnly:true,productionAccess:false,writes:0,requests,browserErrors,checks,expectedMonthlyRevenue:expected},null,2));console.log(JSON.stringify({outDir,states:checks.length,writes:0,browserErrors,expectedMonthlyRevenue:expected}));
}finally{await browser.close();}
`;
template=template.slice(0,begin)+'const checks=String.raw`'+checks+template.slice(end);
template=template.replace("new URL('../',import.meta.url)",JSON.stringify(root.href));
template=template.replace("const setup=await fs.readFile(root+'/verification/render-practice-workspace.mjs','utf8');","const setup=(await fs.readFile(root+'/verification/render-practice-workspace.mjs','utf8')).replace('2026-10-14T16:00:00Z','2026-10-18T16:00:00Z');");
await import('data:text/javascript;base64,'+Buffer.from(template).toString('base64'));
