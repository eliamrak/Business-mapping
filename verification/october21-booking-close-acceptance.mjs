import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const base = await fs.readFile(path.join(root, "verification/october21-live-call-acceptance.mjs"), "utf8");
const prefix = base.slice(0, base.indexOf("const tests =")).replace('const root = path.resolve(import.meta.dirname, "..");', `const root = ${JSON.stringify(root)};`);
const body = String.raw`
const checks=[],writes=[],external=[];
const evidenceBefore=JSON.stringify({workspace,snapshots,packages,context});
page.setDefaultTimeout(10000);
await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(FIXTURE).origin){external.push(u.origin);return route.abort();}if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push({path:u.pathname,method:req.method()});return route.abort();}return route.fallback();});
async function check(name,body){try{await body();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:String(error.message).split('data:text/javascript')[0]});}}
async function section(label){await page.getByRole('navigation',{name:'Practice sections',exact:true}).getByRole('button',{name:new RegExp(label+'$')}).click();await page.getByRole('heading',{name:label,exact:true}).first().waitFor();}
try{
 await page.goto(FIXTURE);await page.getByText('2 converted snapshots loaded',{exact:true}).waitFor();
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});
  for(const label of ['Overview','Sessions']){
   await section(label);
   if(label==='Sessions'){await page.getByRole('combobox',{name:'Shared reporting period',exact:true}).selectOption('custom');const dates=page.locator('.pw-shared-period input[type="date"]');await dates.nth(0).fill('2026-01-01');await dates.nth(1).fill('2026-06-30');}
   for(const scope of ['Whole Practice','Elia','Erin'])await check(label+' '+scope+' booking evidence '+width,async()=>{
    await page.getByRole('group',{name:label+' contributor',exact:true}).getByRole('button',{name:scope,exact:true}).click();
    const historical=page.locator(label==='Overview'?'section[aria-label="Overview consult conversion"]':'section[aria-label="Historical close rate card"]');
    assert.equal(await historical.locator('.pw-percentage-kpi-ring[data-state="unknown"]').count(),2);
    assert.equal(await historical.locator('.pw-percentage-kpi-ring[aria-valuenow]').count(),0);
    if(label==='Overview')assert.match(await historical.innerText(),/booking.*unavailable|booking.*missing/i);
    if(label==='Sessions'){
     const current=page.locator('.pw-consult-summary');assert.match(await current.innerText(),/Verified booking closes\s+Unknown/);assert.match(await current.innerText(),/booking.*unavailable|booking.*missing/i);
     const calc=current.locator('details').filter({has:page.locator('summary',{hasText:'How these numbers are calculated'})}).first();await calc.locator('summary').first().click();
     assert.match(await calc.innerText(),/Observed treatment starts/);assert.match(await calc.innerText(),/Booking time determines/);await calc.locator('summary').first().click();
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1),false);
    await page.screenshot({path:path.join(OUTPUT,'booking-'+label.toLowerCase()+'-'+scope.replaceAll(' ','-')+'-'+width+'.png'),fullPage:true});
   });
  }
  await check('Team booking evidence '+width,async()=>{await section('Team');const metrics=page.locator('.pw-person-kpis > div').filter({hasText:/^Close rate/});assert.equal(await metrics.count(),2);assert.equal(await metrics.locator('.pw-percentage-kpi-ring[data-state="unknown"]').count(),4);assert.equal(await metrics.locator('.pw-percentage-kpi-ring[aria-valuenow]').count(),0);await page.screenshot({path:path.join(OUTPUT,'booking-team-'+width+'.png'),fullPage:true});});
 }
 await check('Legacy closer controls cannot manufacture scheduling evidence',async()=>{await section('Sessions');await page.getByRole('group',{name:'Sessions contributor',exact:true}).getByRole('button',{name:'Whole Practice',exact:true}).click();const history=page.locator('.pw-consult-resolution');await history.locator('summary').first().click();assert.match(await history.innerText(),/Legacy closer confirmations are preserved but cannot establish booking time/);assert.ok(await history.getByRole('button',{name:'Confirm closer',exact:true}).evaluateAll(nodes=>nodes.every(n=>n.disabled)));assert.ok(await history.getByRole('button',{name:'Assign missed',exact:true}).evaluateAll(nodes=>nodes.every(n=>n.disabled)));assert.ok(await history.getByRole('combobox').evaluateAll(nodes=>nodes.every(n=>n.disabled)));await page.screenshot({path:path.join(OUTPUT,'booking-legacy-review-320.png'),fullPage:true});});
 assert.equal(JSON.stringify({workspace,snapshots,packages,context}),evidenceBefore);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);assert.deepEqual(browserErrors,[]);
 const result={syntheticOnly:true,checks,writes,external,browserErrors};await fs.writeFile(path.join(OUTPUT,'booking-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out:OUTPUT,pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>!c.pass)}));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await browser.close();}
`;
const driver = prefix + 'const tests = `const FIXTURE=${JSON.stringify(url)};const OUTPUT=${JSON.stringify(out)};` + ' + JSON.stringify(body) + ';\n' + base.slice(base.indexOf('try { await import'));
await import('data:text/javascript;base64,' + Buffer.from(driver).toString('base64'));
