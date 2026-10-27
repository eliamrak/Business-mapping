import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace,periodSchema,funnelSchema} from '@workspace/practice/hub';
import {deriveClinicalMetricCatalog} from './clinical-metric-catalog.ts';
import type {LocalSnapshot} from './retention-local.ts';
const workspace=emptyWorkspace('2026-10-21');
workspace.periods=['07','08','09'].map((m,i)=>periodSchema.parse({id:`00000000-0000-4000-8000-00000000000${i}`,name:m,start:`2026-${m}-01`,end:`2026-${m}-${m==='09'?'30':'31'}`,funnelComplete:true}));
workspace.funnels=workspace.periods.map((p,i)=>funnelSchema.parse({id:`10000000-0000-4000-8000-00000000000${i}`,periodId:p.id,scope:'practice',leads:10,clients:3,spend:null,scheduled:null,attended:null,firstSessions:null}));
const context={clinicians:[{id:1,label:'One',goalId:null,sessionsPerWeek:20},{id:2,label:'Two',goalId:null,sessionsPerWeek:25}],sessions:[],staff:[]} as any;
const snapshots:LocalSnapshot[]=[{id:'synthetic',kind:'attendance',sourceHash:'synthetic',importedAt:'2026-10-21',coverageStart:'2025-01-01',coverageEnd:'2026-10-21',reportCoverage:{start:'2025-01-01',end:'2026-10-21',complete:true},coverageClinicians:['One','Two'],rows:['2026-07-01','2026-07-08','2026-07-15','2026-09-15'].flatMap((date,i)=>[{clientId:'shared',clinician:i===1?'Two':'One',serviceDate:date,status:'show' as const,location:null,sourceRowHash:date},...(i>=2?[{clientId:'shared',clinician:'Two',serviceDate:date,status:'show' as const,location:null,sourceRowHash:date+'other'}]:[])])}];
const input={workspace,context,snapshots,asOf:'2026-10-21'};
test('catalog produces all clinical metric scopes and both histories without splitting practice leads',()=>{
 const before=JSON.stringify(input),result=deriveClinicalMetricCatalog(input);
 assert.equal(result.clinicians.length,2);assert.equal(JSON.stringify(input),before);
 const get=(rows:any[],id:string)=>rows.find(row=>row.id===id);
 assert.equal(get(result.practice.periods.threeMonths.metrics,'retained_not_ended').value,1);
 assert.deepEqual(result.clinicians.map(c=>get(c.periods.threeMonths.metrics,'retained_not_ended').value),[1,1]);
 assert.equal(get(result.practice.periods.threeMonths.metrics,'reported_leads').value,30);
 for(const c of result.clinicians){assert.equal(get(c.periods.threeMonths.metrics,'reported_leads').value,null);assert.equal(get(c.periods.threeMonths.metrics,'provider_lead_requirement').value,null);}
 assert.equal(get(result.practice.periods.threeMonths.metrics,'desired_weekly_capacity').value,45);
 assert.equal(get(result.practice.periods.threeMonths.metrics,'retained_sessions_per_client_week').model,'proposed-retained');
 assert.equal(result.practice.periods.twelveMonths.source.metrics!.window.start,'2025-10-01');
});
test('fully recorded clinician-source leads remain attributable, never equal-split',()=>{
 const funnels=workspace.funnels.flatMap(f=>[{...f,scope:'source' as const,sourceName:'Synthetic',clinicianId:1,leads:7},{...f,id:f.id+'other',scope:'source' as const,sourceName:'Synthetic',clinicianId:2,leads:3}]);
 const result=deriveClinicalMetricCatalog({...input,workspace:{...workspace,funnels}});
 assert.deepEqual(result.clinicians.map(c=>c.periods.threeMonths.metrics.find(m=>m.id==='reported_leads')!.value),[21,9]);
 assert.equal(result.practice.periods.threeMonths.metrics.find(m=>m.id==='reported_leads')!.value,30);
});
test('workflow adapter requires matching cutoff and never reuses a practice model for clinician targets',async()=>{
 const {automaticGrowth}=await import('./automatic-growth.ts');
 const {historicalPerformancePeriods}=await import('./historical-performance-periods.ts');
 const reports=historicalPerformancePeriods({snapshots,today:input.asOf});
 const model=automaticGrowth({snapshots,clinicians:context.clinicians,coverage:context.clinicians.map((p:any)=>({clinicianId:p.id,start:'2025-01-01',end:input.asOf})),start:'2025-10-01',end:'2026-09-30',asOf:input.asOf,reports,workspace,capacity:45,horizon:'4'});
 const result=deriveClinicalMetricCatalog({...input,currentModels:{asOf:input.asOf,practice:model}});
 for(const clinician of result.clinicians)assert.equal(clinician.periods.threeMonths.metrics.find(m=>m.id==='required_leads_per_month')!.value,null);
 assert.throws(()=>deriveClinicalMetricCatalog({...input,currentModels:{asOf:'2026-09-30',practice:model}}),RangeError);
 assert.throws(()=>deriveClinicalMetricCatalog({...input,currentModels:{asOf:input.asOf,practice:model,clinicians:{1:model}}} as any),RangeError);
 const mismatched={...model,periods:{...model.periods,'3mo':{...model.periods['3mo'],range:{start:'2026-06-01',end:'2026-08-31'}}}};
 const rejected=deriveClinicalMetricCatalog({...input,currentModels:{asOf:input.asOf,practice:mismatched}});
 assert.equal(rejected.practice.periods.threeMonths.workflowSource,null);
 assert.equal(rejected.practice.periods.threeMonths.metrics.find(m=>m.id==='required_leads_per_month')!.value,null);
});
