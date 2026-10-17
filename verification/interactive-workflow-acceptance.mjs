import fs from "node:fs/promises";
const template = await fs.readFile(new URL("./financial-completeness-render.mjs", import.meta.url), "utf8");
const begin = template.indexOf("const checks=String.raw`");
const end = template.indexOf("`;\ntry{await import", begin);
if (begin < 0 || end < 0) throw new Error("Synthetic harness markers changed");
const checks = String.raw`
const repo=process.cwd();
const {build:bundleModel}=createRequire(repo+'/artifacts/api-server/package.json')('esbuild');
const compiled=await bundleModel({stdin:{contents:'export * from "./artifacts/comp-dashboard/src/lib/retention-local.ts";export * from "./lib/practice/src/hub/index.ts";export * from "./artifacts/api-server/src/lib/import-backup-validation.ts";',resolveDir:repo,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const model=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const {createHash,randomUUID}=await import('node:crypto');
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let saved=structuredClone(workspace),rev=1,saveMode='normal',held=null,commits=0,importMode='normal',restoreMode='normal',emptyTarget=false;
const writeLog=[],requests=[],journal=[],seen=new Map(),importSeen=new Map();
let history={snapshots:structuredClone(snapshots),packages:structuredClone(packages).map(p=>({...p,contentHash:fingerprint(p)})),billingCodeMinutes:{},sameDayVisitOverrides:{},declarations:{revision:2,confirmedAt:today+'T00:00:00Z',data:{version:1,mappings:[{sourceLabel:'Elia',clinicianId:1,clinicianLabel:'Elia',teamId:1}],sourceSets:[]}},billingResolutions:journal,billingResolutionRevision:5};
for(const snapshot of history.snapshots)if(snapshot.kind==='attendance')for(const row of snapshot.rows)if(row.visitKind==='treatment')delete row.visitKind;
for(let i=0;i<5;i++){
 const entries=[100,150].map((totalFeeCharged,j)=>({snapshotId:history.snapshots[1].id,row:{clientId:'Synthetic approved '+i,clinician:'Elia',serviceDate:'2026-01-0'+(i+2),billingCode:'90837',totalFeeCharged,sourceRowHash:'approved-'+i+'-'+j}}));
 history.snapshots[1].rows.push(...entries.map(entry=>entry.row));
 journal.push({...model.prepareBillingChargeResolution(entries),id:randomUUID(),clinicianId:1,approvalToken:String(i+1).repeat(64),confirmedAt:today+'T00:00:00Z',approvalNote:'Synthetic workflow approval only'});
}
for(const snapshot of history.snapshots){const dates=snapshot.rows.map(row=>row.serviceDate).sort();snapshot.coverageStart=dates[0];snapshot.coverageEnd=dates.at(-1);}
const journalBefore=fingerprint(journal),historyBefore=fingerprint(history.snapshots),contextBefore=fingerprint(context);
const respond=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
const hubSnapshot=()=>({revision:rev,data:structuredClone(saved),updatedAt:today+'T00:00:00Z'});
const backupNames=['business_goals','current_reality','clinicians','staff_members','scenarios','scenario_clinicians','scenario_staff_members','hub_workspaces','hub_attachments','session_records','session_goal_years','session_record_history','hub_history','practice_import_packages','practice_import_snapshots','practice_import_declarations','practice_import_audit'];
function backup(){
 const scope={practice_id:'synthetic-workflow',account_id:'synthetic-workflow'},stamp=today+'T00:00:00Z';
 const packageRows=history.packages.map((p,i)=>({id:uuid(String(7000+i)),...scope,package_id:p.packageId,content_hash:p.contentHash,exported_at:p.exportedAt,imported_at:p.importedAt,imported_by:'owner@example.test',billing_code_minutes:history.billingCodeMinutes,same_day_visit_overrides:history.sameDayVisitOverrides,active:1}));
 const imports={practice_import_packages:packageRows,practice_import_snapshots:history.snapshots.map((s,i)=>({id:uuid(String(7100+i)),package_import_id:packageRows[0].id,...scope,kind:s.kind,source_hash:s.sourceHash,rows:s.rows,row_count:s.rows.length,coverage_start:s.coverageStart,coverage_end:s.coverageEnd,report_coverage:s.reportCoverage??null,active:1,created_at:stamp})),practice_import_declarations:[{...scope,...{revision:history.declarations.revision,data:history.declarations.data,confirmed_at:history.declarations.confirmedAt,confirmed_by:'owner@example.test'}}],practice_import_audit:history.billingResolutions.map((resolution,i)=>({id:uuid(String(7200+i)),...scope,package_id:'billing-resolution:'+resolution.id,action:'accept-billing-charge-exception',actor:'owner@example.test',detail:{oldRevision:i,revision:i+1,resolution},created_at:stamp}))};
 return {format:'emc-business-data-v2',exportedAt:stamp,schema:'a'.repeat(64),tables:Object.fromEntries(backupNames.map(name=>[name,imports[name]??(name==='hub_workspaces'?[{id:1,revision:rev,data:structuredClone(saved)}]:name==='clinicians'?structuredClone(context.clinicians):[])]))};
}
let reviewed=null,reviewToken=null,restoreCalls=0,restored=false;
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort());
await page.route('**/api/**',async route=>{
 const req=route.request(),url=new URL(req.url()),method=req.method();requests.push({path:url.pathname,method});
 if(url.pathname==='/api/hub'&&method==='GET')return respond(route,hubSnapshot());
 if(url.pathname==='/api/hub'&&method==='POST'){
  const body=req.postDataJSON();writeLog.push(structuredClone(body));
  if(saveMode==='reject'){saveMode='normal';return respond(route,{error:'Synthetic temporary save failure'},503);}
  if(saveMode==='conflict'){saveMode='normal';rev++;saved.settings.practiceName='Synthetic concurrent edit';return respond(route,{error:'Synthetic stale revision; reload saved practice.'},409);}
  if(body.expectedRevision!==rev&&!seen.has(body.requestId))return respond(route,{error:'Synthetic stale revision'},409);
  if(!seen.has(body.requestId)){saved=structuredClone(model.workspaceSchema.parse(body.data));rev++;commits++;seen.set(body.requestId,hubSnapshot());}
  if(saveMode==='drop-after-commit'){saveMode='normal';return route.abort('failed');}
  if(saveMode==='hold'){held={route,result:seen.get(body.requestId)};return;}
  return respond(route,seen.get(body.requestId));
 }
 if(url.pathname==='/api/practice-imports')return respond(route,history);
 if(url.pathname==='/api/practice-imports/package'){
  const body=req.postDataJSON(),pkg=body.package,key=pkg.packageId,hash=fingerprint(pkg);
  if(importSeen.has(key)&&importSeen.get(key)!==hash)return respond(route,{error:'Synthetic package identity content conflict'},409);
  if(importMode==='reject'){importMode='normal';return respond(route,{error:'Synthetic import unavailable'},503);}
  if(!importSeen.has(key)&&!body.retainOverlaps&&!body.replaceOverlaps)return respond(route,{error:'Synthetic overlap review required',code:'OVERLAP_REVIEW_REQUIRED',incoming:[],existing:history.snapshots.slice(0,2)},409);
  const duplicate=importSeen.has(key);
  if(!duplicate){const parsed=model.importLocalPackage(pkg);history.snapshots.push(...parsed.snapshots);history.packages.push({packageId:key,exportedAt:pkg.exportedAt,importedAt:today+'T00:00:00Z',contentHash:hash});importSeen.set(key,hash);}
  if(importMode==='drop-after-commit'&&!duplicate){importMode='normal';return route.abort('failed');}
  return respond(route,{...history,status:duplicate?'duplicate':'retained'});
 }
 if(url.pathname==='/api/hub/backup'&&method==='GET')return route.fulfill({status:200,headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="emc-business-data-backup.json"'},body:JSON.stringify(backup())});
 if(url.pathname==='/api/hub/backup/preview'){
  const body=req.postDataJSON();if(body.format!=='emc-business-data-v2'||body.schema!=='a'.repeat(64)||backupNames.some(name=>!Array.isArray(body.tables?.[name])))return respond(route,{error:'Synthetic backup validation failed. No data was changed.'},400);
  try{model.validateDurableImportBackup(body.tables);}catch{return respond(route,{error:'Synthetic durable-import validation failed. No data was changed.'},400);}
  reviewed=body;reviewToken=randomUUID();const counts=Object.fromEntries(backupNames.map(name=>[name,body.tables[name].length]));
  return respond(route,{token:emptyTarget?reviewToken:null,digest:fingerprint(body),counts,existing:Object.fromEntries(backupNames.map(name=>[name,emptyTarget?0:backup().tables[name].length])),canRestore:emptyTarget,exportedAt:body.exportedAt});
 }
 if(url.pathname==='/api/hub/backup/restore'){
  restoreCalls++;const body=req.postDataJSON();
  if(restoreMode==='expired'){restoreMode='normal';return respond(route,{error:'Preview expired. Review the backup again.'},409);}
  if(restoreMode==='fail'){restoreMode='normal';return respond(route,{error:'Synthetic restore rolled back. No data was changed.'},500);}
  if(!emptyTarget||body.token!==reviewToken||body.digest!==fingerprint(reviewed)||body.confirmation!=='RESTORE EMPTY APP')return respond(route,{error:'Synthetic restore refused'},409);
  saved=structuredClone(reviewed.tables.hub_workspaces[0].data);rev=reviewed.tables.hub_workspaces[0].revision;emptyTarget=false;restored=true;
  history={snapshots:reviewed.tables.practice_import_snapshots.map(s=>({id:s.kind+'-'+s.source_hash,kind:s.kind,sourceHash:s.source_hash,rows:s.rows,coverageStart:s.coverage_start,coverageEnd:s.coverage_end,reportCoverage:s.report_coverage??undefined,importedAt:s.created_at})),packages:reviewed.tables.practice_import_packages.map(p=>({packageId:p.package_id,contentHash:p.content_hash,exportedAt:p.exported_at,importedAt:p.imported_at})),declarations:{revision:reviewed.tables.practice_import_declarations[0].revision,data:reviewed.tables.practice_import_declarations[0].data,confirmedAt:reviewed.tables.practice_import_declarations[0].confirmed_at},billingResolutions:reviewed.tables.practice_import_audit.map(row=>row.detail.resolution),billingResolutionRevision:5,billingCodeMinutes:reviewed.tables.practice_import_packages[0].billing_code_minutes,sameDayVisitOverrides:reviewed.tables.practice_import_packages[0].same_day_visit_overrides};
  return respond(route,{ok:true});
 }
 return route.fallback();
});
async function shot(name,width=1280){await page.setViewportSize({width,height:900});await page.waitForLoadState('networkidle');await page.screenshot({path:path.join(outDir,name+'-'+width+'.png'),fullPage:true});const size=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));assert.ok(size.scrollWidth<=size.clientWidth+1,name+' overflow');checks.push({name,width,...size});}
async function leads(){await clickSection('Growth');await page.getByLabel('Lead flow',{exact:true}).waitFor();}
async function reloadLeads(){page.once('dialog',dialog=>dialog.accept());await page.reload();await leads();}
const cell=(field,month='2026-02')=>page.getByLabel(field+', '+month,{exact:true});
async function fillMonth(values,month='2026-02'){for(const [field,value]of Object.entries(values))await cell(field,month).fill(value);}
async function imports(){await clickSection('Sessions');await page.getByText('Session entry, history and hiring',{exact:true}).click();await page.locator('.pw-session-tools > summary').click();await page.getByRole('button',{name:'Converted attendance & billing imports',exact:true}).click();await page.getByLabel('Local retention workspace',{exact:true}).waitFor();}
try{
await page.goto('http://127.0.0.1:PORT/workspace');await leads();
await fillMonth({'Leads':'100','Consults scheduled':'50','Consults attended':'40','Clients booked':'10'});
assert.match(await cell('Leads').locator('xpath=ancestor::tr').innerText(),/50%[\s\S]*80%[\s\S]*25%[\s\S]*10%/);
await page.getByRole('button',{name:'Save months',exact:true}).click();await page.getByText('Saved 1 month.',{exact:true}).waitFor();
assert.equal(saved.funnels.length,1);await reloadLeads();assert.equal(await cell('Leads').inputValue(),'100');
await cell('Leads').fill('-1');assert.equal(await page.getByRole('button',{name:'Save months',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Discard',exact:true}).click();assert.equal(await cell('Leads').inputValue(),'100');
saveMode='reject';await cell('Leads').fill('110');await page.getByRole('button',{name:'Save months',exact:true}).click();await page.getByText('Synthetic temporary save failure',{exact:true}).first().waitFor();assert.equal(saved.funnels[0].leads,100);assert.equal(await cell('Leads').inputValue(),'110');
const beforeChangedRetry=writeLog.length;await cell('Leads').fill('111');await page.getByRole('button',{name:'Save months',exact:true}).click();await page.getByRole('alert').filter({hasText:'A previous save is unconfirmed.'}).waitFor();assert.equal(writeLog.length,beforeChangedRetry);await cell('Leads').fill('110');
await page.getByRole('button',{name:'Save months',exact:true}).click();await page.getByText('Saved 1 month.',{exact:true}).waitFor();assert.equal(saved.funnels[0].leads,110);
saveMode='hold';await cell('Leads').fill('120');const beforeHeld=commits;await page.getByRole('button',{name:'Save months',exact:true}).click();await page.getByRole('button',{name:'Saving...',exact:true}).waitFor();assert.equal(await cell('Leads').isDisabled(),true);assert.equal(commits,beforeHeld+1);await respond(held.route,held.result);held=null;saveMode='normal';await page.getByText('Saved 1 month.',{exact:true}).waitFor();
saveMode='drop-after-commit';await cell('Leads').fill('130');const beforeDrop=commits;await page.getByRole('button',{name:'Save months',exact:true}).click();await page.getByRole('button',{name:'Save months',exact:true}).waitFor();assert.equal(commits,beforeDrop+1);const droppedId=writeLog.at(-1).requestId;
await page.getByRole('button',{name:'Save months',exact:true}).click();await page.getByText('Saved 1 month.',{exact:true}).waitFor();assert.equal(writeLog.at(-1).requestId,droppedId);assert.equal(commits,beforeDrop+1);
saveMode='conflict';await cell('Leads').fill('140');await page.getByRole('button',{name:'Save months',exact:true}).click();await page.getByText('Synthetic stale revision; reload saved practice.',{exact:true}).first().waitFor();assert.equal(saved.funnels[0].leads,130);assert.equal(await cell('Leads').inputValue(),'140');
await shot('lead-conflict-preserved',390);await page.getByRole('button',{name:'Discard',exact:true}).click();await reloadLeads();assert.equal(await cell('Leads').inputValue(),'130');
await cell('Leads').fill('150');await page.getByRole('button',{name:'Save months',exact:true}).click();await page.getByText('Saved 1 month.',{exact:true}).waitFor();assert.equal(saved.settings.practiceName,'Synthetic concurrent edit');assert.equal(saved.funnels[0].leads,150);
await shot('lead-saved',1280);await shot('lead-saved',390);
await page.getByRole('button',{name:'February',exact:true}).click();await page.getByLabel('Leads for whole practice',{exact:true}).fill('160');await page.getByLabel('Leads for whole practice',{exact:true}).press('Tab');await page.getByRole('button',{name:'Save edits',exact:true}).click();await page.getByRole('button',{name:'Save edits',exact:true}).waitFor({state:'hidden'});assert.equal(saved.funnels[0].leads,160);await reloadLeads();assert.equal(await cell('Leads').inputValue(),'160');
saved.campaigns=[model.campaignSchema.parse({id:uuid('8101'),name:'Synthetic General',start:'2026-01-01',monthlySpend:850}),model.campaignSchema.parse({id:uuid('8102'),name:'Synthetic October',start:'2026-10-01',monthlySpend:500})];
for(const [i,amount]of [150,750,30,30,12].entries())saved.budgets.push(model.budgetSchema.parse({id:uuid(String(8200+i)),name:'Synthetic marketing service '+i,categoryId:uuid('102'),start:'2026-01-01',amount,cadence:'monthly',billingDay:5,billingReferenceStart:null}));
async function moneyWindow(){await page.reload();await clickSection('Money');await page.getByLabel('Shared reporting period',{exact:true}).selectOption('custom');await page.getByLabel('From',{exact:true}).fill('2026-09-24');await page.getByLabel('Through',{exact:true}).fill('2026-10-07');}
await moneyWindow();const finance=page.getByLabel('Billed-charge financial estimate',{exact:true});await finance.getByText('Estimate sources and assumptions',{exact:true}).click();assert.match(await finance.locator('.pw-overview-total').filter({hasText:/^marketing /}).locator('strong').innerText(),/949/);assert.doesNotMatch(await finance.locator('.pw-bridge-step').nth(2).innerText(),/--/);await finance.getByText('Estimate sources and assumptions',{exact:true}).click();await shot('configured-marketing-known-profit',1280);await shot('configured-marketing-known-profit',390);
saved.campaigns.push(model.campaignSchema.parse({id:uuid('8103'),name:'Synthetic undated',monthlySpend:200}));await moneyWindow();assert.match(await finance.locator('.pw-bridge-step').nth(2).innerText(),/--/);assert.match(await finance.locator('.pw-bridge-step').nth(3).innerText(),/Estimated surplus before unconfigured marketing/);assert.doesNotMatch(await finance.locator('.pw-bridge-step').nth(3).locator('strong').innerText(),/--/);await shot('partial-marketing-not-profit',1280);await shot('partial-marketing-not-profit',390);saved.campaigns.pop();
await imports();const pkg=JSON.parse(await fs.readFile(repo+'/tools/practice-converter/Tests/fixtures/golden_package.json','utf8'));pkg.collections.attendance.rows[0].clinician='Elia';pkg.collections.billing.rows[0].clinician='Elia';pkg.packageId='pkg_synthetic_workflow_01';
const file=()=>({name:'synthetic-package.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pkg))});
const upload=page.getByLabel('Local retention workspace',{exact:true}).locator('input[type="file"]').first();
await upload.setInputFiles(file());await page.getByText('Overlapping local data',{exact:true}).waitFor();
await page.getByRole('button',{name:'Keep history and reconcile overlap',exact:true}).click();await page.getByText(/Kept existing history and saved package/).waitFor();const afterFirst=history.snapshots.length;
await upload.setInputFiles(file());await page.getByText(/is already loaded. Nothing was added/).waitFor();assert.equal(history.snapshots.length,afterFirst);assert.equal(fingerprint(journal),journalBefore);
const postsBeforeBad=requests.filter(req=>req.path==='/api/practice-imports/package').length;
await upload.setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});await page.locator('.pw-local-retention .pw-error').waitFor();assert.equal(requests.filter(req=>req.path==='/api/practice-imports/package').length,postsBeforeBad);
pkg.packageId='pkg_synthetic_workflow_02';importMode='reject';await upload.setInputFiles(file());await page.getByRole('alert').filter({hasText:'Synthetic import unavailable'}).waitFor();assert.equal(history.snapshots.length,afterFirst);
await upload.setInputFiles(file());await page.getByText('Overlapping local data',{exact:true}).waitFor();await page.getByRole('button',{name:'Cancel import',exact:true}).click();assert.equal(history.snapshots.length,afterFirst);
await upload.setInputFiles(file());await page.getByText('Overlapping local data',{exact:true}).waitFor();importMode='drop-after-commit';await page.getByRole('button',{name:'Keep history and reconcile overlap',exact:true}).click();await page.locator('.pw-local-retention .pw-error').waitFor();assert.equal(history.snapshots.length,afterFirst+2);
await upload.setInputFiles(file());await page.getByText(/is already loaded. Nothing was added/).waitFor();assert.equal(history.snapshots.length,afterFirst+2);assert.equal(fingerprint(journal),journalBefore);
pkg.collections.billing.rows[0].totalFeeCharged=151;await upload.setInputFiles(file());await page.getByText('Synthetic package identity content conflict',{exact:true}).waitFor();assert.equal(history.snapshots.length,afterFirst+2);
await page.reload();await imports();assert.equal(fingerprint(journal),journalBefore);assert.equal(history.billingResolutionRevision,5);
const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download JSON backup',exact:true}).click();const dl=await downloadPromise;const clinicalPath=path.join(outDir,dl.suggestedFilename());await dl.saveAs(clinicalPath);const clinical=JSON.parse(await fs.readFile(clinicalPath,'utf8'));assert.equal(clinical.format,'emc-local-retention-v1');assert.deepEqual(clinical.snapshots,history.snapshots);
assert.equal(fingerprint(context),contextBefore);await shot('repeat-import-preserved',1280);await shot('repeat-import-preserved',390);
await page.goto('http://127.0.0.1:PORT/reports');await page.getByRole('heading',{name:'Backup and recovery',exact:true}).waitFor();
model.validateDurableImportBackup(backup().tables);process.env.PRACTICE_SYNTHETIC_WORKFLOW_BACKUP=JSON.stringify(backup());
await page.context().route('**/api/hub/backup',route=>route.fulfill({status:200,headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="emc-business-data-backup.json"'},body:JSON.stringify(backup())}));
const backupDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Business-data backup',exact:true}).click();const bd=await backupDownload;const backupPath=path.join(outDir,bd.suggestedFilename());await bd.saveAs(backupPath);const exported=JSON.parse(await fs.readFile(backupPath,'utf8'));assert.equal(exported.format,'emc-business-data-v2');assert.equal(exported.tables.hub_users,undefined);assert.equal(exported.tables.hub_auth_sessions,undefined);
const review=page.getByLabel('Review backup',{exact:false});await review.setInputFiles(backupPath);await page.getByText('This app already contains data. Nothing will be overwritten.',{exact:true}).waitFor();assert.equal(restoreCalls,0);
emptyTarget=true;saved=model.emptyWorkspace(today);rev=0;history={snapshots:[],packages:[],billingResolutions:[],billingResolutionRevision:0,declarations:null,billingCodeMinutes:{},sameDayVisitOverrides:{}};await review.setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.getByRole('alert').waitFor();assert.equal(restoreCalls,0);
const malformed=structuredClone(exported);malformed.tables.practice_import_declarations[0].data.mappings='broken';await review.setInputFiles({name:'malformed-declarations.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(malformed))});await page.getByRole('alert').filter({hasText:'Synthetic durable-import validation failed.'}).waitFor();assert.equal(restoreCalls,0);assert.equal(emptyTarget,true);assert.equal(await page.getByRole('button',{name:'Restore reviewed backup',exact:true}).count(),0);await shot('malformed-import-backup-refused',390);
await review.setInputFiles(backupPath);const confirm=page.getByLabel('Type RESTORE EMPTY APP to confirm',{exact:true});await confirm.waitFor();const restore=page.getByRole('button',{name:'Restore reviewed backup',exact:true});assert.equal(await restore.isDisabled(),true);await confirm.fill('RESTORE');assert.equal(await restore.isDisabled(),true);await confirm.fill('RESTORE EMPTY APP');
restoreMode='expired';await restore.click();await page.getByRole('alert').filter({hasText:'Preview expired. Review the backup again.'}).waitFor();assert.equal(restored,false);
await review.setInputFiles(backupPath);await confirm.fill('RESTORE EMPTY APP');restoreMode='fail';await restore.click();await page.getByRole('alert').filter({hasText:'Synthetic restore rolled back. No data was changed.'}).waitFor();assert.equal(restored,false);await shot('restore-failure',390);
await review.setInputFiles(backupPath);await confirm.fill('RESTORE EMPTY APP');await Promise.all([page.waitForEvent('load'),restore.click()]);await page.waitForLoadState('networkidle');await page.getByRole('heading',{name:'Backup and recovery',exact:true}).waitFor();assert.equal(restored,true);assert.deepEqual(saved,exported.tables.hub_workspaces[0].data);assert.equal(saved.funnels[0].leads,160);
await review.setInputFiles(backupPath);await page.getByText('This app already contains data. Nothing will be overwritten.',{exact:true}).waitFor();await shot('restore-complete',1280);await shot('restore-complete',390);
assert.equal(fingerprint(history.billingResolutions),journalBefore);assert.equal(history.declarations.revision,2);assert.deepEqual(browserErrors,[]);
await fs.writeFile(path.join(outDir,'results.json'),JSON.stringify({candidate:(await import('node:child_process')).execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),syntheticOnly:true,transport:'fixture mocks of real endpoint contracts; actual components/customFetch/parser; attachment served by loopback fixture server',productionAccess:false,realDatabase:false,commits,writeRequests:writeLog.length,restoreCalls,approvalsPreserved:history.billingResolutions.length===5&&fingerprint(history.billingResolutions)===journalBefore,checks,requests,browserErrors},null,2));console.log(JSON.stringify({outDir,states:checks.length,commits,restoreCalls,browserErrors}));
}catch(error){console.error(JSON.stringify({outDir,browserErrors,errors:await page.locator('[role="alert"],.pw-error,.pr-error').allTextContents(),requests:requests.slice(-16),body:(await page.locator('body').innerText()).slice(-1500)}));throw error;}finally{await browser.close();}
`;
let source=template.slice(0,begin)+"const checks=String.raw`"+checks+template.slice(end);
const extra="import Reports from '@/components/hub/reports';function WorkflowReports(){const [data,setData]=React.useState(null);React.useEffect(()=>{Promise.all([fetch('/api/hub').then(r=>r.json()),fetch('/api/hub/context').then(r=>r.json())]).then(([hub,context])=>setData({hub,context}));},[]);return data?<div className='practice-theme' data-appearance='dark'><main className='hub-main'><div className='hub-content'><Reports workspace={data.hub.data} context={data.context} months={[]} range={{start:'2026-01-01',end:'2026-10-14'}}/></div></main></div>:null;}function WorkflowRoot(){return location.pathname==='/reports'?<WorkflowReports/>:<PracticeWorkspace/>;}";
source=source.replace("import PracticeWorkspace from '@/pages/practice-workspace';","import PracticeWorkspace from '@/pages/practice-workspace';"+extra).replace('<PracticeWorkspace/></TooltipProvider>','<WorkflowRoot/></TooltipProvider>');
source=source.replace("checks.replace('127.0.0.1:PORT'","checks.replaceAll('127.0.0.1:PORT'");
source=source.replace("const server=http.createServer((req,res)=>{","const server=http.createServer((req,res)=>{if(req.url==='/api/hub/backup'&&process.env.PRACTICE_SYNTHETIC_WORKFLOW_BACKUP){res.setHeader('Content-Type','application/json');res.setHeader('Content-Disposition','attachment; filename=emc-business-data-backup.json');return res.end(process.env.PRACTICE_SYNTHETIC_WORKFLOW_BACKUP);}");
await import('data:text/javascript;base64,'+Buffer.from(source.replace("new URL('../',import.meta.url)",JSON.stringify(new URL('../',import.meta.url).href))).toString('base64'));
