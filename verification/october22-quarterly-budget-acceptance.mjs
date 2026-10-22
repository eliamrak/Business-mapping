import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const base = await fs.readFile(path.join(root, "verification/october21-live-call-acceptance.mjs"), "utf8");
const prefix = base.slice(0, base.indexOf("const tests =")).replace('const root = path.resolve(import.meta.dirname, "..");', `const root = ${JSON.stringify(root)};`);
const body = String.raw`
const checks=[],writes=[],external=[];
const originalEvidence=JSON.stringify({snapshots,packages,context});
const originalBudget=structuredClone(workspace.budgets[0]);
page.setDefaultTimeout(10000);
await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==new URL(FIXTURE).origin){external.push(u.origin);return route.abort();}if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push({path:u.pathname,method:req.method()});assert.equal(u.pathname,'/api/hub');}return route.fallback();});
async function check(name,body){try{await body();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:String(error.message).split('data:text/javascript')[0]});}}
async function section(label){await page.getByRole('navigation',{name:'Practice sections',exact:true}).getByRole('button',{name:new RegExp(label+'$')}).click();await page.getByRole('heading',{name:label,exact:true}).first().waitFor();}
async function save(){await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('button',{name:'Review changes',exact:true}).waitFor({state:'hidden'});}
try{
 await page.goto(FIXTURE);await page.getByText('2 converted snapshots loaded',{exact:true}).waitFor();await section('Money');await page.getByLabel('Money month',{exact:true}).fill('2026-01');await page.getByRole('button',{name:'Budget',exact:true}).click();
 await check('Quarterly cadence edits and preserves existing Budget record identity',async()=>{
  const frequency=page.getByRole('combobox',{name:'Rent and utilities frequency',exact:true});await frequency.selectOption('quarterly');assert.equal(await frequency.inputValue(),'quarterly');
  const amount=page.getByRole('spinbutton',{name:'Rent and utilities amount ($)',exact:true});await amount.fill('900');await amount.blur();
  const first=page.getByLabel('Rent and utilities first bill date',{exact:true});await first.fill('2026-01-31');await first.blur();
  const details=page.locator('.pw-quarterly-budget-schedule');assert.equal(await details.getAttribute('open'),null);await details.locator('summary').click();
  assert.match(await details.innerText(),/2026-01-31, 2026-04-30, 2026-07-31, 2026-10-31/);assert.match(await details.innerText(),/not recorded payments/);assert.match(await details.innerText(),/per calendar quarter/);
  await save();const saved=workspace.budgets.find(b=>b.id===originalBudget.id);assert.equal(saved.cadence,'quarterly');assert.equal(saved.amount,900);assert.equal(saved.billingReferenceStart,'2026-01-31');assert.deepEqual({...saved,cadence:originalBudget.cadence,amount:originalBudget.amount,billingReferenceStart:originalBudget.billingReferenceStart},originalBudget);assert.equal(workspace.budgets.length,1);
 });
 await check('Quarterly Budget survives reload and uses correct selected-month accrual',async()=>{
  await page.reload();await section('Money');await page.getByLabel('Money month',{exact:true}).fill('2026-01');
  assert.match(await page.locator('.pf-cost-source').filter({hasText:'Overhead (Budget source)'}).innerText(),/310/);
  await page.getByLabel('Money month',{exact:true}).fill('2026-02');assert.match(await page.locator('.pf-cost-source').filter({hasText:'Overhead (Budget source)'}).innerText(),/280/);
  await page.getByRole('button',{name:'Budget',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'Rent and utilities frequency',exact:true}).inputValue(),'quarterly');assert.equal(await page.getByRole('spinbutton',{name:'Rent and utilities amount ($)',exact:true}).inputValue(),'900');
 });
 await check('Generic Budget editor represents quarterly without staging an unrelated edit',async()=>{
  const before=writes.length;await page.getByRole('button',{name:'Edit Rent and utilities',exact:true}).click();const dialog=page.getByRole('dialog');const cadence=dialog.getByRole('combobox',{name:'Repeats',exact:true});assert.equal(await cadence.inputValue(),'quarterly');assert.ok(await cadence.locator('option[value="quarterly"]').count());await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(writes.length,before);
 });
 for(const width of [1280,390,320])await check('Expanded planned quarterly schedule fits '+width,async()=>{
  await page.setViewportSize({width,height:900});const details=page.locator('.pw-quarterly-budget-schedule');if(await details.getAttribute('open')===null)await details.locator('summary').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1),false);
  const bad=await details.locator('summary,p').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1;}).map(n=>n.textContent));assert.deepEqual(bad,[]);
  await page.screenshot({path:path.join(OUTPUT,'quarterly-budget-'+width+'.png'),fullPage:true});
 });
 assert.equal(JSON.stringify({snapshots,packages,context}),originalEvidence);assert.deepEqual(external,[]);assert.deepEqual(browserErrors,[]);
 const result={syntheticOnly:true,checks,writes,external,browserErrors,actualFinancialRecordsCreated:false};await fs.writeFile(path.join(OUTPUT,'quarterly-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({out:OUTPUT,pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>!c.pass)}));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await browser.close();}
`;
const driver = prefix + 'const tests = `const FIXTURE=${JSON.stringify(url)};const OUTPUT=${JSON.stringify(out)};` + ' + JSON.stringify(body) + ';\n' + base.slice(base.indexOf('try { await import'));
await import('data:text/javascript;base64,' + Buffer.from(driver).toString('base64'));
