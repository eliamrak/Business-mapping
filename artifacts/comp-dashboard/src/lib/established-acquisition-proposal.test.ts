import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace,periodSchema,funnelSchema} from '@workspace/practice/hub';
import {establishedCohortYield,establishedLeadTargetProposal,establishedActivityLedger} from './established-acquisition-proposal.ts';
import type {LocalSnapshot} from './retention-local.ts';
const period=periodSchema.parse({id:'00000000-0000-4000-8000-000000000001',name:'Synthetic April',start:'2026-04-01',end:'2026-04-30',funnelComplete:true});
const funnel=funnelSchema.parse({id:'10000000-0000-4000-8000-000000000001',periodId:period.id,scope:'practice',leads:8,clients:null,spend:null,scheduled:null,attended:null,firstSessions:null});
const row=(clientId:string,date:string,clinician='One')=>({clientId,serviceDate:date,clinician,status:'show' as const,location:null,sourceRowHash:clientId+date});
const input=()=>({snapshots:[{id:'synthetic',kind:'attendance',sourceHash:'synthetic',importedAt:'2026-10-21',reportCoverage:{start:'2025-01-01',end:'2026-10-21',complete:true},coverageStart:'2025-01-01',coverageEnd:'2026-10-21',coverageClinicians:['One','Two'],rows:[row('qualifies','2026-04-01'),row('qualifies','2026-06-01','Two'),row('qualifies','2026-08-01'),row('pending','2026-04-15'),row('prior','2026-03-01'),row('prior','2026-04-01'),row('prior','2026-04-15'),row('return','2026-01-01'),row('return','2026-01-08'),row('return','2026-01-15'),row('return','2026-04-20')]}] as LocalSnapshot[],clinicianNames:['One','Two'],clinicians:[{id:1,label:'One'},{id:2,label:'Two'}],start:'2026-04-01',end:'2026-04-30',asOf:'2026-10-21',scope:{kind:'practice' as const},leadWorkspace:{...emptyWorkspace('2026-10-21'),periods:[period],funnels:[funnel]}});
test('start-cohort yield counts eventual observed third date despite early gaps, not all starts or returning clients',()=>{
 const data=input(),before=JSON.stringify(data),result=establishedCohortYield(data);
 assert.equal(result.firstObservedStarts,2);assert.equal(result.establishedByCutoff,1);assert.equal(result.notYetEstablishedByCutoff,1);
 assert.equal(result.reportedLeads,8);assert.equal(result.establishedPerReportedLead,1/8);
 assert.deepEqual(result.followupDays,{minimum:189,maximum:203});assert.equal(JSON.stringify(data),before);
 assert.equal(establishedCohortYield({...data,asOf:'2026-07-31'}).establishedByCutoff,0);
});
test('missing leads, missing follow-up, unresolved evidence and provider attribution stay unknown',()=>{
 const data=input();
 assert.equal(establishedCohortYield({...data,leadWorkspace:{...data.leadWorkspace,funnels:[]}}).establishedPerReportedLead,null);
 assert.equal(establishedCohortYield({...data,attendanceCoverage:[]}).establishedPerReportedLead,null);
 assert.equal(establishedCohortYield({...data,excludedFollowUpEvidence:[{clientId:'pending',serviceDate:'2026-06-01'}]}).establishedPerReportedLead,null);
 const clinician={...data,scope:{kind:'clinician' as const,clinicianId:1},clinicianNames:['One']};
 assert.equal(establishedCohortYield(clinician).establishedPerReportedLead,null);
 assert.throws(()=>establishedCohortYield({...clinician,scope:{kind:'clinician',clinicianId:2}}),/authorized roster/);
 const attributed={...data.leadWorkspace,funnels:[{...funnel,scope:'source' as const,clinicianId:1,sourceName:'Synthetic',leads:4}]};
 assert.equal(establishedCohortYield({...clinician,leadWorkspace:attributed}).establishedPerReportedLead,1/4);
 assert.throws(()=>establishedCohortYield({...data,start:'2026-04-02'}),/complete calendar/);
});
test('aggregate ratios above one are not clamped; zero denominators never become measured conversion',()=>{
 const data=input(),attendance=data.snapshots[0];if(attendance.kind!=='attendance')throw Error('fixture');
 attendance.rows.push(row('pending','2026-05-01'),row('pending','2026-06-01'));
 const leads=(count:number)=>({...data,leadWorkspace:{...data.leadWorkspace,funnels:[{...funnel,leads:count}]}});
 assert.equal(establishedCohortYield(leads(1)).establishedPerReportedLead,2);
 assert.equal(establishedCohortYield(leads(0)).establishedPerReportedLead,null);
});
test('proposal uses matching established frequency and explicit replacement WORKLOAD; no assumed ledger or copied target',()=>{
 const data={clinicians:[{id:1,sessionsPerWeek:94}],observedWeeklySessions:45.505,activeEstablishedSessionsPerClientWeek:.5,horizonMonths:4,establishedActivity:{expiries:12,reactivations:0,months:3},establishedPerReportedLead:.4};
 const result=establishedLeadTargetProposal(data);
 assert.equal(result.requiredEstablishedPerMonth,(94-Math.max(0,45.505-4*.5*4))/(4*.5));
 assert.equal(result.estimatedLeadsPerMonth,result.requiredEstablishedPerMonth!/.4);
 const changed=establishedLeadTargetProposal({...data,clinicians:[{id:1,sessionsPerWeek:70}]});
 assert.ok(Math.abs(changed.signedWeeklySessionGap!-24.495)<1e-10);
 assert.ok(changed.estimatedLeadsPerMonth!<result.estimatedLeadsPerMonth!);
 assert.equal(establishedLeadTargetProposal({...data,establishedActivity:null}).estimatedLeadsPerMonth,null);
 assert.equal(establishedLeadTargetProposal({...data,establishedPerReportedLead:0}).estimatedLeadsPerMonth,null);
 assert.equal(establishedLeadTargetProposal({...data,activeEstablishedSessionsPerClientWeek:0}).estimatedLeadsPerMonth,null);
 assert.equal(establishedLeadTargetProposal({...data,observedWeeklySessions:94,establishedActivity:{expiries:0,reactivations:0,months:3}}).estimatedLeadsPerMonth,0);
 assert.equal(establishedLeadTargetProposal({...data,establishedActivity:{expiries:0,reactivations:600,months:3}}).estimatedLeadsPerMonth,0);
});

test('extreme finite inputs cannot produce infinite lead estimates',()=>{
 const base={clinicians:[{id:1,sessionsPerWeek:100}],observedWeeklySessions:0,activeEstablishedSessionsPerClientWeek:.5,horizonMonths:4,establishedActivity:{expiries:0,reactivations:0,months:3},establishedPerReportedLead:.4};
 for(const patch of [{horizonMonths:1e-308},{activeEstablishedSessionsPerClientWeek:1e-308},{establishedPerReportedLead:1e-308}]){
  const result=establishedLeadTargetProposal({...base,...patch});
  assert.equal(result.estimatedLeadsPerMonth,null);assert.match(result.reason!,/numeric range/);
 }
});

test('signed over-capacity gap offsets replacement before final floor; no second ending deduction',()=>{
 const result=establishedLeadTargetProposal({clinicians:[{id:1,sessionsPerWeek:20}],observedWeeklySessions:24,activeEstablishedSessionsPerClientWeek:.5,horizonMonths:4,establishedActivity:{expiries:9,reactivations:0,months:3},establishedPerReportedLead:.5});
 assert.equal(result.signedWeeklySessionGap,-4);assert.equal(result.requiredEstablishedPerMonth,1);assert.equal(result.estimatedLeadsPerMonth,2);
});
test('activity ledger records expiry on day90, return on treatment date and reconciles established stock',()=>{
 const data=input();
 const ledger=establishedActivityLedger({...data,start:'2026-01-01',end:'2026-10-21'});
 assert.equal(ledger.status,'available');
 const c=ledger.counts!;assert.equal(c.activeAtEnd-c.activeAtStart,c.newlyEstablished+c.reactivations-c.expiries+c.transfersIn-c.transfersOut);
 const attendance=data.snapshots[0];if(attendance.kind!=='attendance')throw Error('fixture');
 attendance.rows=[row('one','2026-01-01'),row('one','2026-02-10'),row('one','2026-03-20'),row('one','2026-09-01')];
 const exact=establishedActivityLedger({...data,start:'2026-03-01',end:'2026-09-30'});
 assert.deepEqual(exact.counts,{activeAtStart:0,activeAtEnd:1,newlyEstablished:1,expiries:1,reactivations:1,transfersIn:0,transfersOut:0});
 assert.equal(establishedActivityLedger({...data,start:'2026-03-01',end:'2026-06-17'}).counts!.expiries,0);
 assert.equal(establishedActivityLedger({...data,start:'2026-03-01',end:'2026-06-18'}).counts!.expiries,1);
 assert.equal(establishedActivityLedger({...data,attendanceCoverage:[]}).counts,null);
});

test('bounded workload scenario floors future workload, not capacity gap, and handles zero capacity independently',()=>{
 const data={clinicians:[{id:1,sessionsPerWeek:10}],observedWeeklySessions:2,activeEstablishedSessionsPerClientWeek:.5,horizonMonths:4,establishedActivity:{expiries:30,reactivations:0,months:3},establishedPerReportedLead:.5};
 const result=establishedLeadTargetProposal(data);
 assert.equal(result.noAcquisitionWeeklyWorkload,0);assert.equal(result.requiredEstablishedPerMonth,5);assert.equal(result.estimatedLeadsPerMonth,10);
 const zero=establishedLeadTargetProposal({...data,clinicians:[{id:1,sessionsPerWeek:0}],establishedPerReportedLead:null,activeEstablishedSessionsPerClientWeek:null,horizonMonths:null,establishedActivity:null,observedWeeklySessions:null});
 assert.equal(zero.requiredEstablishedPerMonth,0);assert.equal(zero.estimatedLeadsPerMonth,0);assert.equal(zero.reason,null);
 assert.equal(establishedLeadTargetProposal({...data,horizonMonths:0}).estimatedLeadsPerMonth,null);
 assert.equal(establishedLeadTargetProposal({...data,establishedPerReportedLead:Infinity}).estimatedLeadsPerMonth,null);
 const returns=establishedLeadTargetProposal({...data,establishedActivity:{expiries:0,reactivations:30,months:3},establishedPerReportedLead:null});
 assert.equal(returns.noAcquisitionWeeklyWorkload,22);assert.equal(returns.estimatedLeadsPerMonth,0);
});
test('provider transfers are not practice acquisition or reactivation and ledger never uses a future return',()=>{
 const data=input(),attendance=data.snapshots[0];if(attendance.kind!=='attendance')throw Error('fixture');
 attendance.rows=[row('one','2026-01-01'),row('one','2026-02-10'),row('one','2026-03-20'),row('one','2026-04-20','Two'),row('one','2026-09-01')];
 const window={...data,start:'2026-04-01',end:'2026-04-30'};
 const practice=establishedActivityLedger(window).counts!;
 assert.equal(practice.activeAtStart,1);assert.equal(practice.activeAtEnd,1);
 assert.equal(practice.newlyEstablished,0);assert.equal(practice.reactivations,0);assert.equal(practice.transfersIn,0);
 const one=establishedActivityLedger({...window,clinicianNames:['One']}).counts!;
 const two=establishedActivityLedger({...window,clinicianNames:['Two']}).counts!;
 assert.equal(one.transfersOut,1);assert.equal(two.transfersIn,1);
 assert.equal(one.activeAtEnd,0);assert.equal(two.activeAtEnd,1);
 assert.equal(establishedActivityLedger({...window,end:'2026-08-31'}).counts!.activeAtEnd,0);
});
