import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const git = (...args) => execFileSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" }).trim();
const provenance = { commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}") };
const runtimeChanges = () => git("diff", "HEAD", "--name-only", "--", "artifacts", "lib", "package.json", "pnpm-lock.yaml");
if (runtimeChanges()) throw new Error("Commit runtime changes before capturing candidate acceptance.");
execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  cwd: new URL("artifacts/comp-dashboard/", root), env: { ...process.env, PORT: "4318", BASE_PATH: "/" }, stdio: "pipe",
});
let template = await fs.readFile(new URL("./financial-completeness-render.mjs", import.meta.url), "utf8");
const probes = `import {Dialog,DialogContent,DialogTitle,DialogDescription,DialogTrigger} from '@/components/ui/dialog';function ControlledProbe({name,locked=false,explicit=false}){const[open,setOpen]=React.useState(false);const[lock,setLock]=React.useState(locked);return <><button onClick={()=>setOpen(true)}>Open {name}</button><Dialog open={open} onOpenChange={next=>{if(next||!lock)setOpen(next)}}><DialogContent onCloseAutoFocus={explicit?event=>{event.preventDefault();document.getElementById('explicit-focus').focus()}:undefined}><DialogTitle>{name}</DialogTitle><DialogDescription>Synthetic focus contract</DialogDescription><input autoFocus aria-label={name+' field'}/><button onClick={()=>setLock(false)}>Unlock</button></DialogContent></Dialog></>;}function FocusContracts(){return <><button id='explicit-focus'>Explicit focus target</button><ControlledProbe name='autofocus'/><ControlledProbe name='veto' locked/><ControlledProbe name='explicit' explicit/><Dialog><DialogTrigger asChild><button>Open uncontrolled</button></DialogTrigger><DialogContent><DialogTitle>uncontrolled</DialogTitle><DialogDescription>Synthetic focus contract</DialogDescription><input autoFocus aria-label='uncontrolled field'/></DialogContent></Dialog></>;}function FixtureRoot(){return location.pathname==='/focus-contracts'?<FocusContracts/>:<PracticeWorkspace/>;}`;
template = template.replace("import PracticeWorkspace from '@/pages/practice-workspace';", "import PracticeWorkspace from '@/pages/practice-workspace';" + probes).replace("<PracticeWorkspace/></TooltipProvider>", "<FixtureRoot/></TooltipProvider>");
template = template.replace("plugins:[", `plugins:[{name:'fixture-identity',setup(b){b.onResolve({filter:/^@clerk\\/react$/},()=>({path:'clerk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const useAuth=()=>({isLoaded:true,isSignedIn:true});export const useUser=()=>({user:{primaryEmailAddress:{emailAddress:'fixture@example.test'}}});export const useClerk=()=>({signOut:async()=>{}});",loader:'js'}));}},`);
template = template.replace("const setup=await fs.readFile(root+'/verification/render-practice-workspace.mjs','utf8');", "const setup=(await fs.readFile(root+'/verification/render-practice-workspace.mjs','utf8')).replace('viewport: { width: 1280, height: 900 }', 'viewport: { width: 1280, height: 900 }, deviceScaleFactor: '+(process.env.PRACTICE_QA_DPR ?? '1'));");
const begin = template.indexOf("const checks=String.raw`");
const end = template.indexOf("`;\ntry{await import", begin);
if (begin < 0 || end < 0) throw new Error("Synthetic harness markers changed");
const tests = String.raw`
const matrix=[], requests=[], geometry=[];
await page.route('**/*',route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.hostname!=='127.0.0.1')return route.abort();
 requests.push({method:req.method(),path:url.pathname});
 if(req.method()!=='GET')return route.abort();
 if(['/api/hub/attachments','/api/hub/history'].includes(url.pathname))return route.fulfill({status:200,contentType:'application/json',body:'[]'});
 return route.fallback();
});
async function check(name,body){try{await body();matrix.push({name,status:'PASS'});}catch(error){matrix.push({name,status:'FAIL',error:error.message?.split('data:text/javascript')[0]});}}
async function fresh(){const accept=d=>d.accept();page.on('dialog',accept);try{await page.reload();await page.waitForLoadState('networkidle');}finally{page.off('dialog',accept);}await page.setViewportSize({width:1280,height:900});}
const owner=()=>page.locator('.pw-edit-item',{has:page.getByRole('heading',{name:'Owner pay',exact:true})});
const amount=()=>owner().getByLabel('Goal amount',{exact:true});
const nav=()=>page.locator('nav[aria-label="Practice sections"] button');
async function focusedInside(locator){assert.ok(await locator.evaluate(el=>el.contains(document.activeElement)),'keyboard focus remains within modal');}
async function dialogCycle(button,title){
 await button.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:title,exact:true});await dialog.waitFor();
 await focusedInside(dialog);
 const count=await dialog.locator('button,input,select,textarea,a[href],[tabindex="0"]').evaluateAll(nodes=>nodes.filter(n=>!n.disabled&&n.tabIndex>=0&&n.getBoundingClientRect().width>0).length);
 for(let i=0;i<count+2;i++){await page.keyboard.press('Tab');await focusedInside(dialog);}
 for(let i=0;i<3;i++){await page.keyboard.press('Shift+Tab');await focusedInside(dialog);}
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 assert.ok(await button.evaluate(el=>el===document.activeElement),'Escape returns focus to opener');
}
async function shot(name,layout){
 await page.waitForLoadState('networkidle');
 await page.locator('[role="dialog"]').evaluateAll(nodes=>nodes.forEach(node=>node.getAnimations({subtree:true}).forEach(animation=>{if(Number.isFinite(animation.effect?.getComputedTiming().endTime))animation.finish();})));
 const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,dialog:(()=>{const el=document.querySelector('[role="dialog"]');if(!el)return null;const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight};})()}));
 assert.equal(metrics.width,layout.width,name+': intended CSS width');assert.equal(metrics.height,layout.height,name+': intended CSS height');assert.equal(metrics.dpr,layout.dpr,name+': intended device scale');
 await page.screenshot({path:path.join(outDir,name+'.png')});geometry.push({name,...metrics});
 const png=await fs.readFile(path.join(outDir,name+'.png'));assert.equal(png.readUInt32BE(16),layout.width*layout.dpr,name+': physical screenshot width');assert.equal(png.readUInt32BE(20),layout.height*layout.dpr,name+': physical screenshot height');
 assert.ok(metrics.scroll<=metrics.client+1,name+': no document horizontal overflow');
 if(metrics.dialog)assert.ok(metrics.dialog.left>=-1&&metrics.dialog.right<=metrics.width+1&&metrics.dialog.top>=-1&&metrics.dialog.bottom<=metrics.height+1,name+': modal fits viewport');
}
try{
await page.goto('http://127.0.0.1:PORT/workspace');await clickSection('Overview');
await check('Keyboard Today navigation and visible focus',async()=>{
 await nav().first().focus();await page.keyboard.press('Tab');assert.ok(await nav().nth(1).evaluate(el=>el===document.activeElement));
 assert.ok(await nav().nth(1).evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth)>0),'focused destination has visible outline');
 await page.keyboard.press('Enter');assert.equal(await page.locator('h1').innerText(),'Sessions');
 await page.keyboard.press('Tab');assert.ok(await nav().nth(2).evaluate(el=>el===document.activeElement));await page.keyboard.press('Space');assert.equal(await page.locator('h1').innerText(),'Team');
});
await check('Reports modal Tab trap, reverse Tab, Escape and opener focus',()=>dialogCycle(page.getByRole('button',{name:'Reports',exact:true}),'Compensation reports'));
await clickSection('Money');
await check('Move data modal keyboard/Escape/opener focus',()=>dialogCycle(page.getByRole('button',{name:'Move data',exact:true}),'Move section data'));
await fresh();await page.locator('.pw-rail-bottom').getByRole('button',{name:'Settings',exact:true}).click();
await check('Record editor dirty Escape keeps or explicitly discards draft',async()=>{
 const opener=page.getByRole('button',{name:'Add decision rules',exact:true});await opener.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByLabel('Name',{exact:true}).fill('Synthetic unsaved rule');
 await page.keyboard.press('Escape');await dialog.getByRole('heading',{name:'Discard unsaved changes?',exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Keep editing',exact:true}).click();assert.equal(await dialog.getByLabel('Name',{exact:true}).inputValue(),'Synthetic unsaved rule');
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.getByRole('heading',{name:'Discard unsaved changes?',exact:true}).waitFor();await dialog.getByRole('button',{name:'Keep editing',exact:true}).click();
 await page.keyboard.press('Escape');await dialog.getByRole('button',{name:'Discard changes',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.ok(await opener.evaluate(el=>el===document.activeElement),'explicit discard restores opener focus');
});
await fresh();await clickSection('Goals');
await check('Focused Goal Escape restores value without saving',async()=>{
 const original=await amount().inputValue();await amount().fill('181234');await page.keyboard.press('Escape');await page.keyboard.press('Tab');assert.equal(await amount().inputValue(),original);assert.equal(await page.getByLabel('Pending practice edits',{exact:true}).count(),0);
});
await check('Reload while Goal text remains focused warns and can be cancelled',async()=>{
 await amount().fill('181234');let warned=false;const cancel=async dialog=>{warned=dialog.type()==='beforeunload';await dialog.dismiss();};page.on('dialog',cancel);
 try{await page.reload({waitUntil:'domcontentloaded',timeout:5000}).catch(error=>{if(!/ERR_ABORTED|cancel|Timeout/i.test(error.message))throw error;});}finally{page.off('dialog',cancel);}
 assert.ok(warned,'focused unblurred draft triggers real beforeunload dialog');assert.equal(await amount().inputValue(),'181234');await amount().press('Escape');
});
await fresh();await clickSection('Goals');
await check('Staged Goal survives section/date changes and blocks workspace switch',async()=>{
 await amount().fill('181234');await amount().press('Tab');await page.getByLabel('Pending practice edits',{exact:true}).waitFor();
 await clickSection('Money');await page.getByLabel('Shared reporting period',{exact:true}).selectOption('custom');await page.getByLabel('From',{exact:true}).fill('2026-09-24');await page.getByLabel('Through',{exact:true}).fill('2026-10-07');
 await page.getByLabel('From',{exact:true}).fill('');await page.getByRole('status').filter({hasText:'Custom dates are incomplete or reversed. Showing 2026-09-24 to 2026-10-07.'}).waitFor();
 await clickSection('Goals');assert.equal(await amount().inputValue(),'181234');assert.equal(await page.getByLabel('From',{exact:true}).inputValue(),'2026-09-24');assert.equal(await page.getByLabel('Through',{exact:true}).inputValue(),'2026-10-07');
 await page.getByRole('button',{name:'Sandbox',exact:true}).click();assert.equal(await page.locator('h1').innerText(),'Goals');await page.getByRole('alert').filter({hasText:'pending practice edits before switching areas'}).waitFor();
 await page.getByLabel('Pending practice edits',{exact:true}).getByRole('button',{name:'Discard',exact:true}).click();assert.equal(await amount().inputValue(),'180000');
});
await fresh();await clickSection('Growth');
await check('Bulk lead draft blocks destructive section change and year filter',async()=>{
 const flow=page.getByLabel('Lead flow',{exact:true});await flow.getByLabel('Leads, 2026-02',{exact:true}).fill('111');assert.equal(await flow.getByRole('spinbutton',{name:'Year',exact:true}).isDisabled(),true);
 let warned=false;const cancel=async d=>{warned=true;await d.dismiss();};page.on('dialog',cancel);try{await nav().filter({hasText:'Money'}).click();}finally{page.off('dialog',cancel);}
 assert.ok(warned,'changing section asks before discarding local lead draft');assert.equal(await page.locator('h1').innerText(),'Growth');assert.equal(await flow.getByLabel('Leads, 2026-02',{exact:true}).inputValue(),'111');
 await flow.getByRole('button',{name:'Discard',exact:true}).click();
 assert.equal(await flow.getByRole('spinbutton',{name:'Year',exact:true}).isDisabled(),false);
 await flow.getByLabel('Leads, 2026-02',{exact:true}).fill('112');const accept=d=>d.accept();page.once('dialog',accept);await nav().filter({hasText:'Money'}).click();assert.equal(await page.locator('h1').innerText(),'Money');await clickSection('Growth');assert.equal(await flow.getByLabel('Leads, 2026-02',{exact:true}).inputValue(),'');
});
await fresh();await clickSection('Growth');
await check('Unsaved month-entry values survive cancelled month-filter change',async()=>{
 const flow=page.getByLabel('Lead flow',{exact:true});await flow.getByRole('button',{name:'Month details',exact:true}).click();await flow.getByLabel('Lead flow month',{exact:true}).fill('2026-02');await flow.getByLabel('New leads',{exact:true}).fill('88');
 let warned=false;const cancel=async d=>{warned=true;await d.dismiss();};page.on('dialog',cancel);try{await flow.getByLabel('Lead flow month',{exact:true}).fill('2026-03');}finally{page.off('dialog',cancel);}
 assert.ok(warned,'month change asks before resetting unsaved entry');assert.equal(await flow.getByLabel('Lead flow month',{exact:true}).inputValue(),'2026-02');assert.equal(await flow.getByLabel('New leads',{exact:true}).inputValue(),'88');
 await flow.getByRole('button',{name:'Year totals',exact:true}).click();page.once('dialog',d=>d.dismiss());await flow.getByRole('button',{name:'March',exact:true}).click();await flow.getByRole('button',{name:'Month details',exact:true}).click();assert.equal(await flow.getByLabel('Lead flow month',{exact:true}).inputValue(),'2026-02');assert.equal(await flow.getByLabel('New leads',{exact:true}).inputValue(),'88');
 await flow.getByRole('button',{name:'Year totals',exact:true}).click();page.once('dialog',d=>d.accept());await flow.getByRole('button',{name:'March',exact:true}).click();assert.equal(await flow.getByLabel('Lead flow month',{exact:true}).inputValue(),'2026-03');assert.equal(await flow.getByLabel('New leads',{exact:true}).inputValue(),'');
 await flow.getByLabel('New leads',{exact:true}).fill('77');page.once('dialog',d=>d.accept());await flow.getByLabel('Lead flow month',{exact:true}).fill('2026-04');assert.equal(await flow.getByLabel('New leads',{exact:true}).inputValue(),'');
});
await fresh();
const {build:modelBuild}=createRequire(process.cwd()+'/artifacts/api-server/package.json')('esbuild');const built=await modelBuild({stdin:{contents:'export {periodSchema,funnelSchema} from "./lib/practice/src/hub/index.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});const schema=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
workspace.periods.push(schema.periodSchema.parse({id:uuid('9912'),name:'Synthetic February',start:'2026-02-01',end:'2026-02-28'}));workspace.funnels.push(schema.funnelSchema.parse({id:uuid('9913'),periodId:uuid('9912'),scope:'source',sourceName:'QA source',spend:null,firstSessions:null,leads:100,scheduled:50,attended:40,clients:10}));await fresh();await clickSection('Growth');
await check('Unblurred saved lead count and source text warn before reload',async()=>{
 const flow=page.getByLabel('Lead flow',{exact:true});await flow.getByRole('button',{name:'February',exact:true}).click();
 for(const [label,changed,original]of [['Leads for QA source','111','100'],['Lead source','QA changed','QA source']]){
  const field=flow.getByLabel(label,{exact:true});await field.fill(changed);let warned=false;const cancel=async d=>{warned=d.type()==='beforeunload';await d.dismiss();};page.on('dialog',cancel);try{await page.reload({waitUntil:'domcontentloaded',timeout:5000}).catch(error=>{if(!/ERR_ABORTED|cancel|Timeout/i.test(error.message))throw error;});}finally{page.off('dialog',cancel);}assert.ok(warned,label+' warns');assert.equal(await field.inputValue(),changed);await field.fill(original);
 }
});
await fresh();
await page.goto('http://127.0.0.1:PORT/focus-contracts');
for(const name of ['autofocus','veto','explicit','uncontrolled'])await check('Dialog focus contract '+name,async()=>{
 const opener=page.getByRole('button',{name:'Open '+name,exact:true});await opener.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name,exact:true});await dialog.waitFor();assert.ok(await dialog.getByLabel(name+' field',{exact:true}).evaluate(el=>el===document.activeElement),'autofocus input receives focus');
 if(name==='veto'){await page.keyboard.press('Escape');assert.ok(await dialog.isVisible());await dialog.getByRole('button',{name:'Unlock',exact:true}).click();}
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});const target=name==='explicit'?page.getByRole('button',{name:'Explicit focus target',exact:true}):opener;assert.ok(await target.evaluate(el=>el===document.activeElement),'focus contract preserved');
});
await page.goto('http://127.0.0.1:PORT/workspace');await clickSection('Overview');
const layouts=[{name:'desktop',width:1280,height:900,dpr:1},{name:'narrow390',width:390,height:900,dpr:1},{name:'narrow320',width:320,height:800,dpr:1},{name:'zoom200-desktop',width:640,height:450,dpr:2},{name:'zoom200-narrow',width:320,height:400,dpr:2}].filter(layout=>layout.dpr===Number(process.env.PRACTICE_QA_DPR??1));
for(const layout of layouts){
 const configure=async()=>{await page.setViewportSize({width:layout.width,height:layout.height});};
 for(const section of ['Overview','Goals','Money','Growth'])await check(layout.name+' '+section+' reflow',async()=>{await configure();await nav().filter({hasText:section}).click();await shot(layout.name+'-'+section.toLowerCase(),layout);});
 await check(layout.name+' Reports modal reflow',async()=>{await configure();await page.getByRole('button',{name:'Reports',exact:true}).click();await page.getByRole('dialog',{name:'Compensation reports',exact:true}).waitFor();try{await shot(layout.name+'-reports',layout);}finally{await page.keyboard.press('Escape');}});
 await check(layout.name+' pending review keyboard reachability',async()=>{
  try{await configure();await nav().filter({hasText:'Goals'}).click();await amount().fill('181234');await amount().press('Tab');const pending=page.getByLabel('Pending practice edits',{exact:true});await pending.waitFor();await pending.getByRole('button',{name:'Review changes',exact:true}).focus();await page.keyboard.press('Enter');await shot(layout.name+'-pending-review',layout);
   for(const name of ['Discard','Save changes']){await page.keyboard.press('Tab');const button=pending.getByRole('button',{name,exact:true});assert.ok(await button.evaluate(el=>el===document.activeElement),'Tab reaches '+name);assert.ok(await button.evaluate(el=>{const r=el.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;return x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}),name+' focused control is visible and not covered');}
   await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');const review=pending.getByRole('button',{name:'Hide review',exact:true});assert.ok(await review.evaluate(el=>el===document.activeElement),'reverse Tab reaches review toggle');assert.ok(await review.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'review toggle remains within viewport');
  }finally{await fresh();}
 });
}
await page.setViewportSize({width:1280,height:900});
assert.deepEqual(browserErrors,[]);assert.ok(requests.every(request=>request.method==='GET'),'no save/import/export mutations during QA');
const result={candidate:provenance.commit,tree:provenance.tree,syntheticOnly:true,productionAccess:false,identity:'frontend hook fixture; no new signin or real account',transport:'loopback intercepted fixture GETs; actual components; no database',zoom:'200% reflow emulation:1280x900physical=>640x450CSS atDPR2;640x800physical=>320x400CSS atDPR2;notnative browser chrome zoom',writes:0,browserErrors,matrix,geometry};
await fs.writeFile(path.join(outDir,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({outDir,pass:matrix.filter(t=>t.status==='PASS').length,fail:matrix.filter(t=>t.status==='FAIL'),browserErrors}));if(matrix.some(t=>t.status==='FAIL'))process.exitCode=1;
}finally{await browser.close();}
`;
template = template.slice(0, begin) + "const checks=String.raw`" + "const provenance=" + JSON.stringify(provenance) + ";\n" + tests + template.slice(end);
template = template.replace("checks.replace('127.0.0.1:PORT'", "checks.replaceAll('127.0.0.1:PORT'");
template = template.replace("new URL('../',import.meta.url)", JSON.stringify(root.href));
await import("data:text/javascript;base64," + Buffer.from(template).toString("base64"));
if (git("rev-parse", "HEAD") !== provenance.commit || runtimeChanges()) throw new Error("Candidate changed during acceptance; results are not release evidence.");
