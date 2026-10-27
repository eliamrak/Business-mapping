import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '@workspace/practice/hub';
import {createClinicalComputationCoordinator} from './clinical-computation-bundle.ts';
import {sameDayVisitKey,type LocalSnapshot} from './retention-local.ts';
const makeInput=()=>({workspace:emptyWorkspace('2026-10-21'),context:{clinicians:[{id:1,label:'Synthetic',goalId:null,sessionsPerWeek:94}],sessions:[],staff:[]} as any,
 snapshots:[{id:'synthetic',kind:'attendance',sourceHash:'synthetic-v1',importedAt:'2026-10-21',coverageStart:'2025-01-01',coverageEnd:'2026-10-21',reportCoverage:{start:'2025-01-01',end:'2026-10-21',complete:true},coverageClinicians:['Synthetic'],rows:['2026-07-01','2026-08-10','2026-09-20'].map(date=>({clientId:'synthetic',clinician:'Synthetic',serviceDate:date,status:'show',location:null,sourceRowHash:date}))}] as LocalSnapshot[],asOf:'2026-10-21'});
const metric=(bundle:any,id:string,period='threeMonths')=>bundle.catalog.practice.periods[period].metrics.find((m:any)=>m.id===id).value;
test('one captured revision computes all periods/scopes and capacity edits cannot mutate historical facts',()=>{
 const coordinator=createClinicalComputationCoordinator(),input=makeInput();
 const old=coordinator.begin(input);input.context.clinicians[0].sessionsPerWeek=70;
 const a=old.compute();assert.equal(metric(a,'desired_weekly_capacity'),94);
 assert.ok(coordinator.accept(a));
 const next=coordinator.begin(input);assert.equal(coordinator.read().status,'pending');assert.equal(coordinator.read().bundle,null);
 const b=next.compute();assert.ok(coordinator.accept(b));
 for(const period of ['threeMonths','twelveMonths']){
  assert.equal(metric(b,'desired_weekly_capacity',period),70);
  assert.equal(metric(a,'treatment_sessions',period),metric(b,'treatment_sessions',period));
  assert.equal(metric(a,'average_active_caseload',period),metric(b,'average_active_caseload',period));
 }
 assert.ok(Object.isFrozen(b.catalog.clinicians[0].periods.threeMonths.metrics));
 assert.equal(metric(b,'required_leads_per_month'),null,'No unapproved model silently connected');
});
test('attendance, overrides, settings and roster always create fresh coherent bundles',()=>{
 const coordinator=createClinicalComputationCoordinator(),input=makeInput();
 const first=coordinator.begin(input).compute();
 const attendance=input.snapshots[0];if(attendance.kind!=='attendance')throw Error('fixture');
 const row=attendance.rows[2];
 const secondInput={...input,sameDayVisitOverrides:{[sameDayVisitKey(row)]:2}};
 const second=coordinator.begin(secondInput).compute();
 assert.ok(second.revision>first.revision);
 assert.equal(second.catalog.practice.periods.threeMonths.source.metrics!.provenance.sameDayOverrideCount,1);
 assert.equal(metric(second,'average_active_caseload'),metric(first,'average_active_caseload'));
 attendance.sourceHash='synthetic-v2';attendance.rows.push({...row,serviceDate:'2026-09-21',sourceRowHash:'new-row'});
 const third=coordinator.begin(secondInput).compute();
 assert.equal(metric(third,'treatment_sessions'),metric(second,'treatment_sessions')+1);
 assert.ok(third.revision>second.revision);
 const changed={...secondInput,context:{...input.context,clinicians:[]}};
 const fourth=coordinator.begin(changed).compute();assert.equal(fourth.catalog.clinicians.length,0);
 assert.equal(metric(fourth,'desired_weekly_capacity'),null);
 assert.equal(coordinator.accept(third),false);assert.ok(coordinator.accept(fourth));
});
test('delayed results, foreign bundles and sign-out cannot replace current pending/ready data',()=>{
 const c=createClinicalComputationCoordinator(),other=createClinicalComputationCoordinator();
 const a=c.begin(makeInput()),b=c.begin(makeInput());
 assert.equal(c.accept(a.compute()),false);assert.equal(c.read().bundle,null);
 assert.equal(c.accept(other.begin(makeInput()).compute()),false);
 const current=b.compute();assert.ok(c.accept(current));assert.equal(c.accept(current),false);
 const delayed=c.begin(makeInput());c.clear();assert.equal(c.accept(delayed.compute()),false);
 assert.equal(c.read().status,'idle');assert.equal(c.read().bundle,null);
 assert.throws(()=>c.begin({...makeInput(),currentModels:{}} as any),/Precomputed/);
});
test('coverage/settings invalidation and failures never publish a mixed partial bundle',()=>{
 const c=createClinicalComputationCoordinator(),input=makeInput();
 const incomplete={...input,snapshots:input.snapshots.map(s=>({...s,reportCoverage:undefined}))};
 const unavailable=c.begin(incomplete).compute();assert.equal(metric(unavailable,'average_active_caseload'),null);
 const changed=makeInput();changed.workspace.settings.teamId=99;
 const otherScope=c.begin(changed).compute();assert.equal(otherScope.catalog.clinicians.length,0);
 const bad=c.begin({...input,asOf:'not-a-date'});
 const healthy=c.begin(input);
 assert.throws(()=>bad.compute());assert.equal(c.read().status,'pending');
 assert.ok(c.accept(healthy.compute()));
 const failed=c.begin({...input,asOf:'not-a-date'});
 assert.throws(()=>failed.compute());assert.equal(c.read().status,'error');assert.equal(c.read().bundle,null);
});
test('invalid new capture invalidates both ready and pending earlier revisions',()=>{
 const c=createClinicalComputationCoordinator();
 assert.ok(c.accept(c.begin(makeInput()).compute()));
 assert.throws(()=>c.begin({...makeInput(),currentModels:{}} as any));
 assert.equal(c.read().status,'error');assert.equal(c.read().bundle,null);
 const pending=c.begin(makeInput());
 assert.throws(()=>c.begin({...makeInput(),invalid:()=>{}} as any));
 assert.equal(c.accept(pending.compute()),false);assert.equal(c.read().bundle,null);
});
