import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticGrowth, growthAttendance, workloadTrend } from './automatic-growth.ts';
import { historicalPerformancePeriods } from './historical-performance-periods.ts';
import { periodSchema, funnelSchema } from '@workspace/practice/hub';
import { sameDayVisitKey, type LocalSnapshot } from './retention-local.ts';
const clinician={id:1,label:'Synthetic Clinician'};
const snapshots:LocalSnapshot[]=[{id:'synthetic',kind:'attendance',importedAt:'2026-10-27',sourceHash:'synthetic',coverageStart:'2025-10-01',coverageEnd:'2026-09-30',reportCoverage:{start:'2025-10-01',end:'2026-09-30',complete:true},rows:Array.from({length:12},(_,i)=>Array.from({length:i+1},(_,j)=>({clientId:'synthetic-'+j,clinician:clinician.label,serviceDate:`${i<3?'2025':'2026'}-${String(i<3?i+10:i-2).padStart(2,'0')}-10`,status:'show' as const,location:null,sourceRowHash:`${i}-${j}`}))).flat()}];
const coverage=[{clinicianId:1,start:'2025-10-01',end:'2026-09-30'}];
const base={snapshots,coverage,clinicians:[clinician],start:'2025-10-01',end:'2026-09-30',asOf:'2026-10-27'};
const reports=historicalPerformancePeriods({snapshots,today:'2026-10-27'});
const flow={months:['2026-04','2026-05','2026-06'],maturedStarts:30,averageStarts:10,averageEndings:2,difference:8};
const matched={...reports,'3mo':{...reports['3mo'],attritionActivity:{...reports['3mo'].attritionActivity!,maturedStartsComparison:flow}},year:{...reports.year,attritionActivity:{...reports.year.attritionActivity!,maturedStartsComparison:flow}}};
const periods=flow.months.map((m,i)=>periodSchema.parse({id:`00000000-0000-4000-8000-00000000000${i}`,name:m,start:m+'-01',end:m+(m.endsWith('05')?'-31':'-30'),funnelComplete:true}));
const funnels=periods.map((p,i)=>funnelSchema.parse({id:`10000000-0000-4000-8000-00000000000${i}`,periodId:p.id,scope:'practice',leads:40,clients:12,spend:null,scheduled:null,attended:null,firstSessions:null}));
test('automatic default derives both histories, positive pace and lead requirement without manual inputs',()=>{
 const input={...base,reports:matched,workspace:{periods,funnels},capacity:20,horizon:'4'};
 const before=JSON.stringify(input),result=automaticGrowth(input);
 assert.equal(result.periods.year.months.length,12);assert.equal(result.periods['3mo'].months.length,3);
 assert.equal(result.periods.year.pace.status,'growing');assert.ok(result.periods.year.requiredLeads!>0);
 const p=result.periods.year;
 assert.equal(p.requiredStarts,p.additions!+2);assert.equal(p.requiredLeads,p.requiredStarts!/.25);
 assert.equal(JSON.stringify(input),before);assert.equal(p.startsPerLead,.25);
 assert.equal(p.additions,p.pace.requiredGrowth!/p.frequency!);
});
test('attendance frequency uses client-month exposure, not lifetime or initial three visits',()=>{
 const m=growthAttendance({...base,start:'2026-09-01'});
 assert.equal(m.length,1);assert.equal(m[0].sessions,12);assert.equal(m[0].clientWeeks,12*30/7);
 const result=automaticGrowth({...base,reports,capacity:20,horizon:'4'});
 assert.ok(result.periods.year.frequency!<1);
});
test('coverage omissions retain calendar spacing; dates/providers do not manufacture zero months',()=>{
 const months=growthAttendance({...base,coverage:[{clinicianId:1,start:'2025-10-01',end:'2025-10-31'},{clinicianId:1,start:'2026-09-01',end:'2026-09-30'}]});
 assert.deepEqual(months.map(m=>m.index),[0,11]);assert.ok(workloadTrend(months)!<1);
 assert.deepEqual(growthAttendance({...base,clinicians:[clinician,{id:2,label:'Uncovered'}]}),[]);
 assert.equal(growthAttendance({...base,asOf:'2026-09-15'}).length,11);
});
test('consults and duplicate visits excluded; explicit same-day exceptions retained',()=>{
 const row=snapshots[0].rows[0];
 const changed:LocalSnapshot[]=[{...snapshots[0],rows:[row,{...row,sourceRowHash:'duplicate'},{...row,clientId:'consult',visitKind:'consultation',sourceRowHash:'consult'}]} as LocalSnapshot];
 assert.equal(growthAttendance({...base,snapshots:changed})[0].sessions,1);
 assert.equal(growthAttendance({...base,snapshots:changed,overrides:{[sameDayVisitKey(row)]:2}})[0].sessions,2);
});
test('zero attendance is known flat, declining workload is not a generic unknown, and missing denominator stays unknown',()=>{
 const empty:LocalSnapshot[]=[{...snapshots[0],rows:[]} as LocalSnapshot];
 const zero=automaticGrowth({...base,snapshots:empty,reports:matched,capacity:20,horizon:'4'});
 assert.equal(zero.periods.year.pace.status,'flat');assert.equal(zero.periods.year.requiredLeads,null);
 const months=growthAttendance(base).map(m=>({...m,weekly:20-m.index}));
 assert.equal(workloadTrend(months),-1);
 const missing=automaticGrowth({...base,coverage:[],reports:matched,capacity:20,horizon:'4'});
 assert.equal(missing.periods.year.pace.status,'unknown');assert.equal(missing.periods.year.requiredLeads,null);
 const full=automaticGrowth({...base,reports:matched,capacity:.1,horizon:'4'});
 assert.equal(full.periods.year.pace.status,'full');assert.equal(full.periods.year.additions,0);
 assert.equal(automaticGrowth({...base,reports:matched,capacity:20,horizon:'0'}).periods.year.requiredLeads,null);
});
test('ending replacement never gets subtracted twice from observed workload; aggregate ratios may exceed 100%',()=>{
 const input={...base,reports:matched,workspace:{periods,funnels},capacity:20,horizon:'4'};
 const original=automaticGrowth(input);
 const changedReports={...matched,year:{...matched.year,attritionActivity:{...matched.year.attritionActivity!,maturedStartsComparison:{...flow,averageEndings:8}}}};
 const changed=automaticGrowth({...input,reports:changedReports});
 assert.deepEqual(changed.periods.year.pace,original.periods.year.pace);
 assert.equal(changed.periods.year.requiredStarts!-original.periods.year.requiredStarts!,6);
 const smallLeads=funnels.map(f=>({...f,leads:2,clients:1}));
 assert.equal(automaticGrowth({...input,workspace:{periods,funnels:smallLeads}}).periods.year.startsPerLead,5);
});
test('zero lead or zero matured-start denominators never produce a finite empirical lead target',()=>{
 const input={...base,reports:matched,capacity:20,horizon:'4'};
 const zeroLeads=funnels.map(f=>({...f,leads:0,clients:0}));
 const noLeads=automaticGrowth({...input,workspace:{periods,funnels:zeroLeads}});
 assert.equal(noLeads.periods.year.startsPerLead,null);assert.equal(noLeads.periods.year.requiredLeads,null);
 const noStartsReports={...matched,year:{...matched.year,attritionActivity:{...matched.year.attritionActivity!,maturedStartsComparison:{...flow,averageStarts:0,maturedStarts:0}}}};
 const noStarts=automaticGrowth({...input,reports:noStartsReports,workspace:{periods,funnels}});
 assert.equal(noStarts.periods.year.startsPerLead,0);assert.equal(noStarts.periods.year.requiredLeads,null);
 assert.match(noStarts.periods.year.reason,/No matured starts/);
});
test('departed clinicians with capacity but no coverage do not inflate or block current-roster forecast',async()=>{
 const {emptyWorkspace,clinicianSettingSchema}=await import('@workspace/practice/hub');
 const {currentPracticeClinicians}=await import('./practice-scope.ts');
 const {overviewHistoricalCapacity}=await import('./overview-historical-capacity.ts');
 const workspace=emptyWorkspace('2026-10-27');
 workspace.clinicians=[clinicianSettingSchema.parse({id:'20000000-0000-4000-8000-000000000001',clinicianId:2,start:'2025-01-01',desiredWeeklySessions:99,onTeam:false})];
 const context={clinicians:[{...clinician,goalId:null,sessionsPerWeek:20},{id:2,label:'Former synthetic',goalId:null,sessionsPerWeek:99}],sessions:[],staff:[]} as any;
 const current=currentPracticeClinicians(workspace,context,'2026-10-27');
 const cap=overviewHistoricalCapacity({workspace,context,attendanceCoverage:coverage,historicalReports:reports,selectedClinicianIds:current.map(p=>p.id),today:'2026-10-27'});
 assert.equal(cap['3mo'].currentDesiredWeekly,20);
 const model=automaticGrowth({...base,reports,clinicians:current,capacity:cap['3mo'].currentDesiredWeekly,horizon:'4'});
 assert.equal(model.periods.year.months.length,12);assert.equal(model.capacity,20);
});
