import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const base = await fs.readFile(path.join(root, "verification/october21-live-call-acceptance.mjs"), "utf8");
const prefix = base.slice(0, base.indexOf("const tests =")).replace('const root = path.resolve(import.meta.dirname, "..");', `const root = ${JSON.stringify(root)};`);
const body = String.raw`
const checks=[],writes=[],external=[];
snapshots[0].rows.push(attendance('same-pair','Elia','2026-01-04',true),attendance('same-pair','Elia','2026-01-11'),attendance('cancel-pair','Elia','2026-01-05',true),{...attendance('cancel-pair','Elia','2026-01-12'),status:'cancelled'},attendance('unresolved-pair','Elia','2026-01-06',true),attendance('unresolved-pair','Elia','2026-02-20'));
snapshots.push({id:'future-schedule-cccccccc',kind:'attendance',importedAt:today+'T00:00:00Z',coverageStart:'2026-10-08',coverageEnd:'2026-10-25',sourceHash:'cccccccc',rows:[attendance('future-pair','Erin','2026-10-08',true),attendance('future-pair','Erin','2026-10-25')]});
const before=JSON.stringify({workspace,snapshots,packages,context});
page.setDefaultTimeout(10000);
await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(FIXTURE).origin){external.push(u.origin);return route.abort();}if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push({path:u.pathname,method:req.method()});return route.abort();}return route.fallback();});
async function check(name,body){try{await body();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:String(error.message).split('data:text/javascript')[0]});}}
async function section(label){await page.getByRole('navigation',{name:'Practice sections',exact:true}).getByRole('button',{name:new RegExp(label+'$')}).click();await page.getByRole('heading',{name:label,exact:true}).first().waitFor();}
async function dates(start,end){await page.getByRole('combobox',{name:'Shared reporting period',exact:true}).selectOption('custom');const fields=page.locator('.pw-shared-period input[type="date"]');await fields.nth(0).fill(start);await fields.nth(1).fill(end);}
const near=actual=>assert.ok(Math.abs(Number(actual)-200/3)<0.1,'Same-clinician rate uses 2 closes / 3 evaluated, excluding referral');
try{
 await page.goto(FIXTURE);await page.getByText('3 converted snapshots loaded',{exact:true}).waitFor();
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});
  for(const label of ['Overview','Sessions']){
   await section(label);if(label==='Sessions')await dates('2026-01-01','2026-06-30');
   for(const scope of ['Whole Practice','Elia','Erin'])await check(label+' '+scope+' same-clinician evidence '+width,async()=>{
    await page.getByRole('group',{name:label+' contributor',exact:true}).getByRole('button',{name:scope,exact:true}).click();
    const historical=page.locator(label==='Overview'?'section[aria-label="Overview consult conversion"]':'section[aria-label="Historical close rate card"]');
    assert.match(await historical.innerText(),/Observed close rate/);
    const values=await historical.locator('.pw-percentage-kpi-ring[aria-valuenow]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-valuenow')));
    if(scope==='Erin')assert.deepEqual(values,[]);else{assert.equal(values.length,1);near(values[0]);}
    if(label==='Overview'&&width===320){const overlap=await page.locator('.pw-overview-historical-summary .pw-historical-period-value').evaluateAll(nodes=>nodes.some(n=>{const a=n.querySelector('.pw-historical-period-detail > details > summary')?.getBoundingClientRect(),b=n.querySelector('.pw-historical-period-date-help > summary')?.getBoundingClientRect();return a&&b&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;}));assert.equal(overlap,false,'Narrow period disclosures stack without overlap');}
    if(label==='Sessions'){
     const current=page.locator('.pw-consult-summary');assert.match(await current.innerText(),/Observed close rate/);assert.match(await current.innerText(),scope==='Erin'?/Same-clinician closes\s+Unknown/:/Same-clinician closes\s+2/);if(scope!=='Erin'){assert.match(await current.innerText(),/2 of 3 evaluated/);assert.match(await current.innerText(),/1 unresolved/);assert.match(await current.innerText(),/Some cohort outcomes unresolved/);}
     const calc=current.locator('details').filter({has:page.locator('summary',{hasText:'How these numbers are calculated'})}).first();await calc.locator('summary').first().click();assert.match(await calc.innerText(),/attendance|cancelled or missed/);assert.match(await calc.innerText(),/booking-created timestamps are not required or invented/);await calc.locator('summary').first().click();
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1),false);
    await page.screenshot({path:path.join(OUTPUT,'same-'+label.toLowerCase()+'-'+scope.replaceAll(' ','-')+'-'+width+'.png'),fullPage:true});
   });
  }
  await check('Team matches observed same-clinician histories '+width,async()=>{await section('Team');const metrics=page.locator('.pw-person-kpis > div').filter({hasText:/^Observed close rate/});assert.equal(await metrics.count(),2);const values=await metrics.locator('.pw-percentage-kpi-ring[aria-valuenow]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-valuenow')));assert.equal(values.length,1);near(values[0]);await page.screenshot({path:path.join(OUTPUT,'same-team-'+width+'.png'),fullPage:true});});
  await check('Future full appointment counts without attendance or complete service period '+width,async()=>{await section('Sessions');await dates('2026-10-01','2026-10-31');await page.getByRole('group',{name:'Sessions contributor',exact:true}).getByRole('button',{name:'Erin',exact:true}).click();const current=page.locator('.pw-consult-summary');assert.match(await current.innerText(),/Same-clinician closes\s+1/);assert.equal(Number(await current.locator('.pw-percentage-kpi-ring').getAttribute('aria-valuenow')),100);const calc=current.locator('details').filter({has:page.locator('summary',{hasText:'How these numbers are calculated'})}).first();await calc.locator('summary').first().click();assert.match(await calc.innerText(),/Observed treatment starts\s+0/);await page.screenshot({path:path.join(OUTPUT,'same-future-'+width+'.png'),fullPage:true});await calc.locator('summary').first().click();});
 }
 assert.equal(JSON.stringify({workspace,snapshots,packages,context}),before);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);assert.deepEqual(browserErrors,[]);
 const result={syntheticOnly:true,expected:{january:{consultations:5,sameClinicianCloses:2,missed:1,pending:1,referralsExcluded:1,evaluated:3,observedConversionRate:200/3,conversionRate:null},future:{sameClinicianCloses:1,completedTreatmentStarts:0}},checks,writes,external,browserErrors};await fs.writeFile(path.join(OUTPUT,'same-clinician-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out:OUTPUT,pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>!c.pass)}));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await browser.close();}
`;
const driver = prefix + 'const tests = `const FIXTURE=${JSON.stringify(url)};const OUTPUT=${JSON.stringify(out)};` + ' + JSON.stringify(body) + ';\n' + base.slice(base.indexOf('try { await import'));
await import('data:text/javascript;base64,' + Buffer.from(driver).toString('base64'));
