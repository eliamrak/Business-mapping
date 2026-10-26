// Isolated synthetic app QA. Requires the existing DEV-only local preview, never a live app.
import fs from 'node:fs/promises';
const url = new URL(process.env.PRACTICE_PREVIEW_URL ?? 'http://127.0.0.1:4319');
if (!['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('Synthetic preview must be loopback');
const setup = await fs.readFile(new URL('./render-practice-workspace.mjs',import.meta.url),'utf8');
const prefix = setup.slice(0,setup.indexOf('await page.goto(new URL'));
const probe = String.raw`
const requests=[];
await page.route('**/*',route=>{
 const request=route.request();const url=new URL(request.url());
 if(!['127.0.0.1','localhost'].includes(url.hostname)) return route.abort();
 if(url.pathname.startsWith('/api/')) requests.push({method:request.method(),path:url.pathname});
 return route.fallback();
});
const interactiveContrast=[];
const surfaceChecks=[];
async function checkCardSurfaces(section,width) {
 const samples=await page.evaluate(()=>{
  const selector=':is(.pw-section-widget--card,.pw-clinical-card,.pf-planning,.pw-money-budget,.pw-data-disclosure,.pw-import-start,.pw-import-conflict,.pw-local-retention,#retention-calculations,.pw-overview-primary-grid,.pw-overview-report-controls,.pw-money-month-control,.pw-content > details,.pw-person,.pw-edit-item,.pw-metric-panel,.pw-money-bridge-panel,.pw-focused-plan,.pw-session-tracker,.pw-progression,.pw-overview-composition > section,.pw-local-import-grid > section,.pw-local-tables > section,.pw-billing-codes,.pw-section-heading,.pw-marketing-breakdown,.pw-empty,.pw-overview-historical-summary.pw-overview-kpi-grid .sw-content > section,.pw-goal-editor .pw-section-widget-content > .pw-edit-item)';
  return [...document.querySelectorAll('.pw-content '+selector)].filter(el=>el.getClientRects().length).map(el=>{
   const css=getComputedStyle(el),nested=Boolean(el.parentElement.closest(selector));
   const contentOpaque=[el,...el.querySelectorAll('h2,h3,h4,p,svg,input,select,button')].filter(node=>node.getClientRects().length&&!node.matches(':disabled')).every(node=>getComputedStyle(node).opacity==='1');
   return {classes:el.className,nested,background:css.backgroundColor,image:css.backgroundImage,opacity:css.opacity,contentOpaque};
  });
 });
 assert.ok(samples.length>0,section+' has sampled cards');
 for(const sample of samples) {
  assert.equal(sample.image,'none','No opaque legacy gradient');
  assert.equal(sample.background,sample.nested?'rgba(0, 0, 0, 0)':'rgba(241, 246, 248, 0.5)',section+' card alpha');
  assert.equal(sample.opacity,'1');assert.ok(sample.contentOpaque,'Card contents retain opacity');
 }
 surfaceChecks.push({section,width,samples});
}
async function checkInteractiveContrast(section) {
 const samples=await page.evaluate(()=>{
  const rgba=s=>{const parts=s.match(/[\d.]+/g);return parts?parts.map(Number):[0,0,0,0];};
  const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  return [...document.querySelectorAll('.pw-content button,.pw-content summary,.pw-content a,.pw-content label,.pw-import-attention .pw-tag')].filter(el=>el.getClientRects().length&&!el.closest('[disabled],[aria-disabled="true"]')).map(el=>{
   const ancestors=[];for(let p=el;p;p=p.parentElement)ancestors.push(p);
   let bg=[0,0,0];
   for(const ancestor of ancestors.reverse()){const c=rgba(getComputedStyle(ancestor).backgroundColor),a=c[3]??1;bg=bg.map((v,i)=>c[i]*a+v*(1-a));}
   const fg=luminance(rgba(getComputedStyle(el).color)),back=luminance(bg);
   return {tag:el.tagName,text:el.textContent.trim().slice(0,70),ratio:(Math.max(fg,back)+.05)/(Math.min(fg,back)+.05)};
  }).filter(row=>row.text);
 });
 interactiveContrast.push({section,samples});
 assert.ok(samples.every(row=>row.ratio>=4.5),section+' interactive text contrast: '+JSON.stringify(samples.filter(row=>row.ratio<4.5)));
}
const {campaignSchema}=await import('file://'+process.cwd()+'/lib/practice/src/hub/model.ts');
workspace.campaigns=[campaignSchema.parse({id:uuid('777'),name:'Synthetic outreach campaign with a deliberately long descriptive title for narrow screens',source:'Synthetic source with a long name',monthlySpend:100,method:'manual'})];
snapshots[0].rows.push(attendance('synthetic-open-follow-up','Elia','2026-10-12',true));
snapshots[0].coverageEnd='2026-10-14';
const previousName=context.clinicians[1].label;
context.clinicians[1].label='Synthetic Alexandra Long-Doublebarrel Clinician Name';
for(const source of snapshots) for(const row of source.rows) if(row.clinician===previousName) row.clinician=context.clinicians[1].label;
try {
 await page.goto(new URL('/workspace',process.env.PRACTICE_PREVIEW_URL).href);
 for(const section of ['Overview','Team','Growth','Sessions','Money','Goals']) {
  await clickSection(section);
  for(const width of [1280,390,320]) {
   await capture(section.toLowerCase(),width,900);
   assert.ok(checks.at(-1).scrollWidth<=checks.at(-1).clientWidth+1,section+' page overflow at '+width);
   await checkCardSurfaces(section,width);
  }
 }
 await clickSection('Overview');
 for(const label of ['Forecast controls','Projection basis','Forecast and historical details']) assert.equal(await page.locator('summary').filter({hasText:new RegExp('^'+label+'$')}).count(),0,label+' removed from Overview');
 assert.equal(await page.getByRole('button',{name:'Open Imports',exact:true}).count(),0);
 await checkInteractiveContrast('Overview');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const admin=page.getByRole('region',{name:'Forecast and import administration'});
 for(const label of ['Forecast controls','Projection basis','Forecast and historical details']) {
  const summary=admin.locator('summary').filter({hasText:new RegExp('^'+label+'$')});
  assert.equal(await summary.count(),1);
  assert.equal(await summary.evaluate(el=>el.parentElement.open),false);
  await summary.focus();await page.keyboard.press('Enter');
  assert.equal(await summary.evaluate(el=>el.parentElement.open),true);
  await page.keyboard.press('Enter');
  assert.equal(await summary.evaluate(el=>el.parentElement.open),false);
 }
 assert.equal(await admin.getByRole('button',{name:'Open Imports',exact:true}).count(),1);
 await checkInteractiveContrast('Settings');
 await capture('settings-administration',1280,900);await capture('settings-administration',320,900);
 await admin.locator('summary').filter({hasText:/^Forecast controls$/}).click();
 const summaryMonth=admin.getByLabel('Summary month',{exact:true});
 const summaryOptions=await summaryMonth.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
 if(summaryOptions.length>1) {await summaryMonth.selectOption(summaryOptions[1]);assert.equal(await summaryMonth.inputValue(),summaryOptions[1]);}
 await capture('settings-forecast-expanded',320,900);
 await admin.getByRole('button',{name:'Open Imports',exact:true}).click();
 assert.equal(await page.locator('.pw-forecast-administration').count(),0);
 await capture('data-imports',1280,900);await capture('data-imports',320,900);
 await clickSection('Money');
 await page.locator('.pf-payroll-breakdown > summary').click();
 await capture('payroll-breakdown',1280,900);await capture('payroll-breakdown',320,900);
 await page.getByRole('group',{name:'Money view',exact:true}).getByRole('button',{name:'Budget',exact:true}).click();
 await capture('money-budget',1280,900);await capture('money-budget',320,900);
 await clickSection('Team');
 const history=page.locator('.pw-team-history').first();
 await history.locator('summary').first().focus();await page.keyboard.press('Enter');
 assert.equal(await history.evaluate(el=>el.open),true);
 await page.setViewportSize({width:320,height:900});
 assert.equal(await history.evaluate(el=>el.open),true);
 await capture('team-expanded',320,900);
 await clickSection('Sessions');
 assert.equal(await page.getByLabel('Unresolved consultation reasons',{exact:true}).count(),1);
 assert.match(await page.getByLabel('Unresolved consultation reasons',{exact:true}).innerText(),/Follow-up window open\s+1/);
 assert.equal(await page.locator('#session-attribution-audit').evaluate(el=>el.open),false);
 const positions=await page.evaluate(()=>({audit:document.querySelector('#session-attribution-audit').getBoundingClientRect().top,primary:document.querySelector('.pw-consult-summary').getBoundingClientRect().bottom}));
 assert.ok(positions.audit>=positions.primary);
 const panel=page.locator('.pw-progression');
 assert.equal(await panel.getByLabel('Progression cohort period').inputValue(),'all');
 const cohort=await panel.locator('.pw-progression-overview strong').innerText();
 const globalPeriod=page.locator('.pw-shared-period select').first();
 const options=await globalPeriod.locator('option').evaluateAll(items=>items.map(i=>i.value));
 if(options.length>1) await globalPeriod.selectOption(options[0]);
 assert.equal(await panel.locator('.pw-progression-overview strong').innerText(),cohort);
 const disclosure=panel.locator('.pw-progression-data');
 assert.equal(await disclosure.evaluate(el=>el.open),false);
 await disclosure.locator('summary').focus();await page.keyboard.press('Enter');
 assert.equal(await disclosure.evaluate(el=>el.open),true);
 await panel.getByLabel('Progression cohort period').selectOption('six-months');
 assert.equal(await disclosure.evaluate(el=>el.open),true);
 await panel.getByLabel('Progression cohort period').selectOption('custom');
 await panel.getByLabel('Progression cohort start').fill('2026-10-13');
 await panel.getByLabel('Progression cohort end').fill('2026-10-14');
 assert.match(await panel.locator('.pw-progression-overview strong').innerText(),/^0 /);
 await panel.getByLabel('Progression cohort start').fill('2026-10-15');
 assert.equal(await panel.getByRole('alert').count(),1);
 await panel.getByLabel('Progression cohort period').selectOption('all');
 assert.equal(await panel.locator('.pw-progression-overview strong').innerText(),cohort);
 const downloadPromise=page.waitForEvent('download');await panel.getByRole('button',{name:'Export CSV'}).click();
 const download=await downloadPromise;await download.saveAs(path.join(outDir,'synthetic-progression.csv'));
 assert.match(await fs.readFile(path.join(outDir,'synthetic-progression.csv'),'utf8'),/Session/);
 await capture('progression-expanded',390,900);
 await clickSection('Growth');
 const inputs=page.locator('.pw-edit-grid input');
 assert.ok(await inputs.count()>0);
 const bounds=await inputs.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),p=node.closest('.pw-edit-item').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1;}));
 assert.ok(bounds.every(Boolean),'Campaign inputs stay within their card');
 await page.evaluate(()=>document.body.style.zoom='2');
 await capture('growth-zoom',1280,900);
 await page.evaluate(()=>document.body.style.zoom='');
 // Conservative contrast: retained 75% page backing against black, even without an extra card fill.
 const contrast=await page.evaluate(()=>{
  const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
  const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  const bg=luminance([241,246,248].map(v=>v*.75));
  return [...document.querySelectorAll('.pw-content h3,.pw-content label,.pw-content p,.pw-content th')].filter(el=>el.getClientRects().length).map(el=>{const fg=luminance(rgb(getComputedStyle(el).color));return {tag:el.tagName,text:el.textContent.slice(0,60),ratio:(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)};});
 });
 assert.ok(contrast.every(item=>item.ratio>=4.5),'All sampled text passes conservative glass contrast');
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
 const fallback=await page.locator('.pw-edit-item').first().evaluate(el=>({background:getComputedStyle(el).backgroundColor,blur:getComputedStyle(el).backdropFilter}));
 assert.ok(!fallback.background.startsWith('rgba('),'Reduced transparency uses solid card');
 assert.equal(fallback.blur,'none');
 await capture('growth-reduced-transparency',390,900);
 await cdp.send('Emulation.setEmulatedMedia',{features:[]});
 assert.equal(requests.filter(r=>r.method!=='GET').length,0,'No business writes');
 await fs.writeFile(path.join(outDir,'report.json'),JSON.stringify({checks,contrast,interactiveContrast,surfaceChecks,requests,browserErrors},null,2));
} finally {await browser.close();}
`;
await import('data:text/javascript;base64,'+Buffer.from(prefix+probe).toString('base64'));
