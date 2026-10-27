import test from 'node:test';
import assert from 'node:assert/strict';
import { clinicalDataFoundation, buildClinicalObservationIndex } from './clinical-data-foundation.ts';
import { sameDayVisitKey, type AttendanceRow, type LocalSnapshot } from './retention-local.ts';
const row=(clientId:string,serviceDate:string,patch:Partial<AttendanceRow>={}):AttendanceRow=>({clientId,serviceDate,clinician:'Current',status:'show',location:null,sourceRowHash:`${clientId}-${serviceDate}-${JSON.stringify(patch)}`,...patch});
function input(rows:AttendanceRow[],start='2026-07-01',end='2026-09-30',asOf=end){
 const snapshots:LocalSnapshot[]=[{id:'synthetic',kind:'attendance',importedAt:'2026-10-21',sourceHash:'synthetic-hash',coverageStart:'2026-01-01',coverageEnd:asOf,reportCoverage:{start:'2026-01-01',end:asOf,complete:true},coverageClinicians:['Current','Other'],rows}];
 return {snapshots,clinicianNames:['Current'],start,end,asOf};
}
test('weekly and monthly unique attendance are direct distinct counts with independent denominators',()=>{
 const data=input([row('one','2026-07-06'),row('one','2026-07-07'),row('two','2026-07-08'),row('one','2026-08-03'),row('one','2026-09-07')]);
 const result=clinicalDataFoundation(data);
 assert.equal(result.weekly.denominator,12);assert.equal(result.weekly.excludedBoundaryDays,8);
 assert.equal(result.weekly.sumDistinctClientBuckets,4);assert.equal(result.weekly.averageDistinctClients,4/12);
 assert.equal(result.monthly.denominator,3);assert.equal(result.monthly.averageDistinctClients,4/3);
 assert.deepEqual(result.monthly.buckets.map(b=>b.distinctClients),[2,1,1]);
 assert.equal(result.monthly.buckets[0].sessions,3);
});
test('consultations, cancellations, no-shows and duplicates cannot inflate attendance; same-day exceptions affect sessions only',()=>{
 const one=row('one','2026-07-06');
 const data=input([one,{...one,sourceRowHash:'duplicate'},row('consult','2026-07-06',{visitKind:'consultation'}),row('cancel','2026-07-06',{status:'cancelled'}),row('missed','2026-07-06',{status:'no show'})]);
 assert.equal(clinicalDataFoundation(data).monthly.buckets[0].sessions,1);
 const result=clinicalDataFoundation({...data,sameDayVisitOverrides:{[sameDayVisitKey(one)]:2}});
 assert.equal(result.monthly.buckets[0].sessions,2);assert.equal(result.monthly.buckets[0].distinctClients,1);
});
test('retained is initial three dates within 28-day gaps; establishment alone does not qualify',()=>{
 const rows=[row('retained','2026-07-01'),row('retained','2026-07-08'),row('retained','2026-07-15'),row('established-only','2026-07-01'),row('established-only','2026-08-10'),row('established-only','2026-09-20')];
 const result=clinicalDataFoundation(input(rows));
 assert.equal(result.retainedPopulation.value,1);assert.equal(result.retainedPopulation.notInitiallyRetained,1);
 assert.equal(result.retainedAttendance.clientDays,78); // Jul15 through Sep30, including quiet days.
 assert.equal(result.retainedAttendance.sessions,1); // Third qualifying visit, not first two.
 assert.equal(result.retainedAttendance.sessionsPerClientWeek,7/78);
});
test('90-day boundary, actual returns and earlier as-of never use future qualification',()=>{
 const rows=[row('one','2026-01-01'),row('one','2026-01-08'),row('one','2026-01-15'),row('one','2026-07-01')];
 const data=input(rows,'2026-01-01','2026-07-01');
 const index=buildClinicalObservationIndex(data),client=index.indexedClients[0];
 assert.equal(index.stateAt(client,'2026-01-08'),'not-retained');
 assert.equal(index.stateAt(client,'2026-04-14'),'not-ended');
 assert.equal(index.stateAt(client,'2026-04-15'),'ended');
 assert.equal(index.stateAt(client,'2026-07-01'),'not-ended');
 const result=clinicalDataFoundation(data);
 assert.equal(result.retainedPopulation.returnedAfterVerifiedGap,1);assert.equal(result.retainedPopulation.value,1);
 assert.equal(result.retainedPopulation.apparentlyEnded,0);
});
test('missing coverage is unknown; known empty buckets are zero; unresolved follow-up stays uncertain',()=>{
 const empty=clinicalDataFoundation(input([]));
 assert.equal(empty.weekly.averageDistinctClients,0);assert.equal(empty.retainedPopulation.value,0);
 const data=input([row('one','2026-07-01'),row('one','2026-07-08'),row('one','2026-07-15')]);
 const missing=clinicalDataFoundation({...data,snapshots:data.snapshots.map(s=>({...s,reportCoverage:undefined}))});
 assert.equal(missing.weekly.denominator,0);assert.equal(missing.weekly.averageDistinctClients,null);assert.equal(missing.retainedPopulation.value,null);
 const unresolved=clinicalDataFoundation({...data,excludedFollowUpEvidence:[{clientId:'one',serviceDate:'2026-08-01'}]});
 assert.equal(unresolved.retainedPopulation.uncertain,1);assert.equal(unresolved.retainedPopulation.value,null);
 assert.equal(unresolved.retainedAttendance.sessionsPerClientWeek,null);
});
test('cross-clinician attendance deduplicates clients practice-wide; latest-provider membership is explicit',()=>{
 const data=input([row('one','2026-07-01'),row('one','2026-07-08'),row('one','2026-07-15',{clinician:'Other'})]);
 const practice=clinicalDataFoundation({...data,clinicianNames:['Current','Other']});
 assert.equal(practice.monthly.buckets[0].distinctClients,1);assert.equal(practice.retainedPopulation.value,1);
 const current=clinicalDataFoundation(data);assert.equal(current.retainedPopulation.value,0);
 const other=clinicalDataFoundation({...data,clinicianNames:['Other']});assert.equal(other.retainedPopulation.value,1);
});
test('provenance, immutable inputs, private index and aggregate-only DTO stay separate',()=>{
 const data=input([row('private-synthetic-id','2026-07-01')]),before=JSON.stringify(data);
 const result=clinicalDataFoundation(data);assert.equal(JSON.stringify(data),before);
 assert.doesNotMatch(JSON.stringify(result),/private-synthetic-id/);
 assert.equal(result.provenance.snapshots[0].sourceHash,'synthetic-hash');
 const reordered={...data,snapshots:[...data.snapshots].reverse().map(snapshot=>({...snapshot,rows:[...snapshot.rows].reverse()} as LocalSnapshot))};
 assert.deepEqual(buildClinicalObservationIndex(data).sessionKeys,buildClinicalObservationIndex(reordered).sessionKeys);
 assert.throws(()=>clinicalDataFoundation({...data,end:'2026-11-01'}),RangeError);
 assert.throws(()=>clinicalDataFoundation({...data,clinicianNames:[]}),RangeError);
});
test('final conflict coverage can only restrict snapshot proof; no future cutoff qualifies a past client-day',()=>{
 const data=input([row('one','2026-07-01'),row('one','2026-07-08'),row('one','2026-07-15')]);
 const result=clinicalDataFoundation({...data,attendanceCoverage:[]});
 assert.equal(result.weekly.denominator,0);assert.equal(result.retainedAttendance.coveredDays,0);assert.equal(result.retainedPopulation.value,null);
 const earlier=clinicalDataFoundation({...data,end:'2026-07-10'});
 assert.equal(earlier.retainedAttendance.clientDays,0);assert.equal(earlier.retainedPopulation.value,1,'Population as-of stays explicit and independent from attendance window');
 const cutoff=clinicalDataFoundation({...data,end:'2026-07-10',asOf:'2026-07-10'});
 assert.equal(cutoff.retainedPopulation.retainedNotEnded,0);
});
test('canonical entry uses existing source admission and never invents identities from manual session totals',async()=>{
 const {derivePracticeClinicalMetrics}=await import('./clinical-data-foundation.ts');
 const {emptyWorkspace}=await import('@workspace/practice/hub');
 const workspace=emptyWorkspace('2026-10-21');
 const context={clinicians:[{id:1,label:'Current',goalId:null,sessionsPerWeek:20}],sessions:[],staff:[]} as any;
 const data=input([row('one','2026-07-06')]);
 const before=JSON.stringify({data,workspace,context});
 const result=derivePracticeClinicalMetrics({...data,workspace,context});
 assert.equal(result.status,'derived');
 assert.equal(result.metrics!.monthly.buckets[0].distinctClients,1);
 assert.equal(JSON.stringify({data,workspace,context}),before);
 const none=derivePracticeClinicalMetrics({...data,snapshots:[],workspace,context});
 assert.equal(none.metrics!.weekly.averageDistinctClients,null);
});
test('final proof constrains historical qualification, endings and returns, not only current coverage',()=>{
 const rows=[row('one','2026-01-01'),row('one','2026-01-08'),row('one','2026-01-15')];
 const recentProof=['Current','Other'].map(clinician=>({clinician,start:'2026-07-01',end:'2026-09-30'}));
 const data={...input(rows),attendanceCoverage:recentProof};
 const ended=clinicalDataFoundation(data);
 assert.equal(ended.retainedPopulation.apparentlyEnded,0);assert.equal(ended.retainedPopulation.uncertain,1);assert.equal(ended.retainedPopulation.value,null);
 const returned=clinicalDataFoundation({...data,snapshots:input([...rows,row('one','2026-07-01')]).snapshots});
 assert.equal(returned.retainedPopulation.returnedAfterVerifiedGap,0);assert.equal(returned.retainedPopulation.uncertain,1);
 assert.equal(returned.retainedAttendance.sessionsPerClientWeek,null);
});
test('clinician breakdown uses global qualification, deduplicated practice clients and explicit shared pairs',()=>{
 const data=input([row('shared','2026-07-01'),row('shared','2026-07-08',{clinician:'Other'}),row('shared','2026-07-15'),row('shared','2026-07-15',{clinician:'Other'}),row('transfer','2026-07-01'),row('transfer','2026-07-08'),row('transfer','2026-07-15',{clinician:'Other'})]);
 const result=clinicalDataFoundation({...data,clinicianNames:['Current','Other',' current ']}).retainedPopulation;
 assert.equal(result.value,2);assert.equal(result.byClinician.length,2);
 assert.deepEqual(result.byClinician.map(row=>row.value),[1,2]);
 assert.equal(result.clinicianClientPairs,3);assert.equal(result.sharedRetainedClients,1);assert.equal(result.excessClinicianClientPairs,1);
 assert.match(result.qualification,/practice-wide/);
});
test('3/12-month comparisons keep the same cutoff and source, with explicit calendar windows',async()=>{
 const {derivePracticeClinicalComparisons}=await import('./clinical-data-foundation.ts');
 const {emptyWorkspace}=await import('@workspace/practice/hub');
 const workspace=emptyWorkspace('2026-10-21');
 const context={clinicians:[{id:1,label:'Current',goalId:null,sessionsPerWeek:20}],sessions:[],staff:[]} as any;
 const data=input([row('one','2026-07-01'),row('one','2026-07-08'),row('one','2026-07-15')],'2026-07-01','2026-09-30','2026-10-21');
 const result=derivePracticeClinicalComparisons({...data,workspace,context});
 assert.equal(result.threeMonths.metrics!.window.start,'2026-07-01');assert.equal(result.threeMonths.metrics!.window.end,'2026-09-30');
 assert.equal(result.twelveMonths.metrics!.window.start,'2025-10-01');assert.equal(result.twelveMonths.metrics!.window.end,'2026-09-30');
 assert.deepEqual(result.threeMonths.metrics!.retainedPopulation,result.twelveMonths.metrics!.retainedPopulation);
 assert.deepEqual(result.threeMonths.metrics!.provenance,result.twelveMonths.metrics!.provenance);
 assert.throws(()=>derivePracticeClinicalComparisons({...data,workspace,context,calendarThrough:'2026-10-22'}),RangeError);
});

test('average active caseload is daily exposure, separate from end-date population and future qualification',()=>{
 const data=input([row('one','2026-07-01'),row('one','2026-07-08'),row('one','2026-07-15')]);
 const result=clinicalDataFoundation(data);
 assert.equal(result.averageActiveCaseload.clientDays,78);
 assert.equal(result.averageActiveCaseload.denominatorDays,92);
 assert.equal(result.averageActiveCaseload.value,78/92);
 assert.equal(result.retainedPopulation.value,1);
 const early=clinicalDataFoundation({...data,end:'2026-07-14'});
 assert.equal(early.averageActiveCaseload.value,0);
 assert.equal(early.retainedPopulation.value,1);
});
test('daily caseload excludes exact 90-day ending and includes an observed return only from its date',()=>{
 const result=clinicalDataFoundation(input([row('one','2026-01-01'),row('one','2026-01-08'),row('one','2026-01-15'),row('one','2026-07-01')],'2026-01-01','2026-07-01'));
 assert.equal(result.averageActiveCaseload.clientDays,91); // Jan15–Apr14:90; Jul1:1.
 assert.equal(result.averageActiveCaseload.value,91/182);
});
test('daily clinician membership follows transfers without moving past exposure; shared providers are pairs',()=>{
 const data=input([row('one','2026-07-01'),row('one','2026-07-02'),row('one','2026-07-03'),row('one','2026-07-05',{clinician:'Other'}),row('one','2026-07-07'),row('one','2026-07-07',{clinician:'Other'})],'2026-07-01','2026-07-07');
 const all=clinicalDataFoundation({...data,clinicianNames:['Current','Other']}).averageActiveCaseload;
 assert.equal(all.clientDays,5);assert.equal(all.value,5/7);
 assert.deepEqual(all.byClinician.map(c=>c.clientDays),[3,3]);
 assert.equal(clinicalDataFoundation(data).averageActiveCaseload.value,3/7);
 assert.equal(clinicalDataFoundation({...data,clinicianNames:['Other']}).averageActiveCaseload.value,3/7);
});
test('daily caseload preserves known zero but never treats missing or uncertain days as zero',()=>{
 assert.equal(clinicalDataFoundation(input([])).averageActiveCaseload.value,0);
 const data=input([row('one','2026-07-01'),row('one','2026-07-08'),row('one','2026-07-15')]);
 const missing=clinicalDataFoundation({...data,attendanceCoverage:[{clinician:'Current',start:'2026-07-01',end:'2026-09-29'},{clinician:'Other',start:'2026-01-01',end:'2026-09-30'}]});
 assert.equal(missing.averageActiveCaseload.value,null);
 assert.equal(missing.averageActiveCaseload.denominatorDays,92);
 assert.equal(missing.averageActiveCaseload.coveredDays,91);
 const uncertain=clinicalDataFoundation({...data,excludedFollowUpEvidence:[{clientId:'one',serviceDate:'2026-08-01'}]});
 assert.equal(uncertain.averageActiveCaseload.value,null);
 assert.ok(uncertain.averageActiveCaseload.uncertainClientDays>0);
});
