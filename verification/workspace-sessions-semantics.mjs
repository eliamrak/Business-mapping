import fs from 'node:fs/promises';

// Reuse the supplied isolated fixture, Chrome profile and native zoom machinery.
const root = new URL('../', import.meta.url);
let harness = await fs.readFile(new URL('./semantics-native-zoom.mjs', import.meta.url), 'utf8');
const start = harness.indexOf("await page.goto('http://127.0.0.1:PORT/workspace');", harness.indexOf('const tests=String.raw`'));
const end = harness.indexOf('\nawait zoom(1);assert.deepEqual', start);
if (start < 0 || end < 0) throw new Error('Session semantics fixture markers changed.');
process.env.PRACTICE_QA_EXPLORATORY = '1';
const checks = String.raw`
page.setDefaultTimeout(5000);
const prepare = async () => {
 await fresh();await section('Sessions');
 await page.getByText('Session entry, history and hiring',{exact:true}).click();
 await page.getByRole('button',{name:'Enter or edit totals',exact:true}).click();
};
const tabs = () => page.getByRole('tablist',{name:'Session entry',exact:true});
const single = () => tabs().getByRole('tab',{name:'One period',exact:true});
const bulk = () => tabs().getByRole('tab',{name:'Bulk entry',exact:true});
const history = () => page.locator('.pw-session-matrix tbody th button');
const close = () => page.getByRole('button',{name:'Close entry',exact:true});
const focused = async locator => {
 await page.clock.runFor(50);
 try {
  await page.waitForFunction(node=>node===document.activeElement,await locator.elementHandle(),{timeout:2000});
 } catch {
  throw new Error(JSON.stringify(await locator.evaluate(node=>({expected:node.outerHTML.slice(0,300),hidden:node.hidden,active:document.activeElement?.outerHTML.slice(0,300)}))));
 }
};
await page.goto('http://127.0.0.1:PORT/workspace');
for(const factor of [1,2,4]) {
 await zoom(factor);
 await prepare();
 await check('Session tabs: arrows, wrap, roving focus and paired panels at '+factor*100+'%',async()=>{
  await single().focus();
  for(const [key,selected,other] of [['ArrowRight',bulk,single],['ArrowLeft',single,bulk],['End',bulk,single],['Home',single,bulk],['ArrowLeft',bulk,single]]) {
   await page.keyboard.press(key);
   await focused(selected());
   assert.equal(await selected().getAttribute('aria-selected'),'true');
   assert.equal(await selected().getAttribute('tabindex'),'0');
   assert.equal(await other().getAttribute('tabindex'),'-1');
   const id=await selected().getAttribute('aria-controls');assert.ok(id);
   const panel=page.locator('[id="'+id+'"]');assert.equal(await panel.getAttribute('role'),'tabpanel');
   assert.equal(await panel.getAttribute('aria-labelledby'),await selected().getAttribute('id'));
   assert.ok(await panel.isVisible());assert.equal(await page.getByRole('tabpanel').count(),1);
  }
  await page.keyboard.press('Tab');assert.ok(await page.getByRole('tabpanel').evaluate(node=>node.contains(document.activeElement)));
 });
 await prepare();
 await check('Clinician disclosures: unique targets, state and keyboard toggle at '+factor*100+'%',async()=>{
  const buttons=page.getByRole('button',{name:/^Add details for /});
  assert.ok(await buttons.count()>1);
  const ids=await buttons.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-controls')));
  assert.equal(new Set(ids).size,ids.length);
  const button=page.getByRole('button',{name:'Add details for Elia',exact:true});
  const id=await button.getAttribute('aria-controls');assert.ok(id);
  const region=page.locator('[id="'+id+'"]');assert.equal(await region.count(),1);assert.ok(await region.isHidden());
  await button.focus();await page.keyboard.press('Enter');
  const expanded=page.getByRole('button',{name:'Hide details for Elia',exact:true});
  assert.equal(await expanded.getAttribute('aria-expanded'),'true');assert.ok(await region.isVisible());
  await region.getByLabel('Elia Scheduled',{exact:true}).waitFor();
  await page.keyboard.press('Space');assert.equal(await button.getAttribute('aria-expanded'),'false');assert.ok(await region.isHidden());
 });
 await prepare();
 await check('History editor focus and close return, including repeated activation at '+factor*100+'%',async()=>{
  await page.getByText('Recorded period history',{exact:true}).click();
  const opener=history().first();
  for(let attempt=0;attempt<2;attempt++) {
   if(attempt===0)await bulk().click();
   await opener.focus();await page.keyboard.press('Enter');
   const editor=page.getByRole('tabpanel',{name:'One period',exact:true});
   await focused(editor);
   assert.equal(await single().getAttribute('aria-selected'),'true');
   await close().click();await focused(opener);
  }
  await page.getByRole('button',{name:'Enter or edit totals',exact:true}).click();
  await close().focus();await page.keyboard.press('Enter');
  await focused(page.getByRole('button',{name:'Enter or edit totals',exact:true}));
 });
 await prepare();
 await check('Entry toggle controls a stable root when open and closed at '+factor*100+'%',async()=>{
  const id=await close().getAttribute('aria-controls');assert.ok(id);
  const root=page.locator('[id="'+id+'"]');assert.equal(await root.count(),1);assert.ok(await root.isVisible());
  await close().click();assert.equal(await root.count(),1);assert.ok(await root.isHidden());
  const opener=page.getByRole('button',{name:'Enter or edit totals',exact:true});assert.equal(await opener.getAttribute('aria-controls'),id);
  await opener.click();assert.equal(await close().getAttribute('aria-controls'),id);assert.ok(await root.isVisible());
 });
 await prepare();
 await check('Single dirty guard preserves input and blocks tab, close and history at '+factor*100+'%',async()=>{
  const input=page.getByLabel('Elia completed sessions',{exact:true});await input.fill('123');
  assert.ok(await bulk().isDisabled());assert.ok(await close().isDisabled());
  assert.ok(await history().first().isDisabled());
  await single().focus();await page.keyboard.press('ArrowRight');
  assert.equal(await single().getAttribute('aria-selected'),'true');assert.equal(await input.inputValue(),'123');
 });
 await prepare();
 await check('Bulk dirty guard preserves input and blocks tab, close and history at '+factor*100+'%',async()=>{
  await bulk().click();const input=page.locator('.pw-bulk-table input').first();await input.fill('123');
  assert.ok(await single().isDisabled());assert.ok(await close().isDisabled());assert.ok(await history().first().isDisabled());
  await bulk().focus();await page.keyboard.press('ArrowLeft');assert.equal(await bulk().getAttribute('aria-selected'),'true');assert.equal(await input.inputValue(),'123');
 });
 await prepare();await shot('session-entry-native-'+factor,factor);await snapshot('session-entry-native-'+factor);
}
`;
harness = harness.slice(0, start) + checks + harness.slice(end);
harness = harness.replace("new URL('../',import.meta.url)", `new URL(${JSON.stringify(root.href)})`);
harness = harness.replace("new URL('./financial-completeness-render.mjs',import.meta.url)",
  `new URL(${JSON.stringify(new URL('./financial-completeness-render.mjs', import.meta.url).href)})`);
await import('data:text/javascript;base64,' + Buffer.from(harness).toString('base64'));
