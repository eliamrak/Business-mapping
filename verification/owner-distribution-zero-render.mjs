import fs from "node:fs/promises";
const template = await fs.readFile(new URL("./financial-completeness-render.mjs", import.meta.url), "utf8");
const begin = template.indexOf("const checks=String.raw`");
const end = template.indexOf("`;\ntry{await import", begin);
if (begin < 0 || end < 0) throw new Error("Synthetic harness markers changed");
const checks = String.raw`
const requests=[];
await page.route('**/*',route=>{const req=route.request();if(new URL(req.url()).hostname!=='127.0.0.1')return route.abort();requests.push(req.method());if(req.method()!=='GET')return route.abort();return route.fallback();});
workspace.settings.distributionPct=0;workspace.allocations=[];workspace.budgets=[];workspace.settings.overheadFloorMonthly=0;context.staff=[];
const owner=()=>page.locator('.pw-edit-item',{has:page.getByRole('heading',{name:'Owner pay',exact:true})});
const amount=()=>owner().locator('.pw-progress-comparison > div').first().locator('strong');
async function goals(){await clickSection('Goals');await owner().waitFor();await page.waitForLoadState('networkidle');assert.equal(await owner().getByText('Pre-tax owner distribution target. Owner clinical revenue remains business revenue.',{exact:true}).count(),1);}
async function future(){await clickSection('Overview');await page.getByLabel('Summary month',{exact:true}).selectOption('2026-11-01');await goals();assert.match(await owner().innerText(),/Nov 2026 estimated pre-tax measure/);}
try{
await page.goto('http://127.0.0.1:PORT/workspace');await future();assert.equal(await amount().innerText(),'$0');
for(const width of [1280,390]){await capture('owner-known-zero',width,900);await owner().screenshot({path:path.join(outDir,'owner-known-zero-detail-'+width+'.png')});}
// Recent synthetic shows establish nonzero forward pace despite earlier quiet months.
workspace.settings.distributionPct=25;for(const person of context.clinicians)person.sessionRate=10000;for(let i=0;i<20;i++)snapshots[0].rows.push(attendance('synthetic-positive-'+i,'Elia','2026-10-05'));snapshots[0].coverageEnd='2026-10-05';await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await page.reload();await future();assert.equal(await amount().innerText(),'--');
const profit=page.locator('.pw-edit-item',{has:page.getByRole('heading',{name:'Business Profit',exact:true})}).locator('.pw-progress-comparison > div').first().locator('strong');assert.ok(Number((await profit.innerText()).replace(/[$,]/g,''))>0,'positive fixture has known positive modeled profit');
for(const width of [1280,390]){await capture('owner-positive-unattributed',width,900);await owner().screenshot({path:path.join(outDir,'owner-positive-unattributed-detail-'+width+'.png')});}
snapshots.splice(0);context.sessions=[];await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await page.reload();await goals();assert.equal(await amount().innerText(),'--');
for(const width of [1280,390])await capture('owner-missing-coverage',width,900);
assert.deepEqual(browserErrors,[]);assert.ok(requests.every(method=>method==='GET'));assert.ok(checks.every(c=>c.scrollWidth<=c.clientWidth+1&&c.topNavigation));
await fs.writeFile(path.join(outDir,'results.json'),JSON.stringify({candidate:(await import('node:child_process')).execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),syntheticOnly:true,productionAccess:false,writes:0,assertions:['Future known zero displays $0','Positive unattributed future displays --','Missing coverage displays --','Owner target and dated pre-tax labels unchanged'],browserErrors,checks},null,2));console.log(JSON.stringify({outDir,states:checks.length,writes:0,browserErrors}));
}finally{await browser.close();}
`;
let source=template.slice(0,begin)+"const checks=String.raw`"+checks+template.slice(end);
source=source.replace("checks.replace('127.0.0.1:PORT'","checks.replaceAll('127.0.0.1:PORT'");
source=source.replace("new URL('../',import.meta.url)",JSON.stringify(new URL('../',import.meta.url).href));
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
