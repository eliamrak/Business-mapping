import test from 'node:test';import assert from 'node:assert/strict';
import {completeReportCoverage} from './complete-report-coverage.ts';
import {consultationLeadMonth,importedConsultationRates,type ConsultationLeadSource} from './consultation-lead-flow.ts';
import type {LocalSnapshot,AttendanceRow} from './retention-local.ts';
const people=[{id:1,label:'One',goalId:null},{id:2,label:'Two',goalId:null}];
const row=(status:AttendanceRow['status'],day='2026-07-15',extra:Partial<AttendanceRow>={}):AttendanceRow=>({clientId:'synthetic',clinician:'One',serviceDate:day,status,location:null,visitKind:'consultation',sourceRowHash:status+day+JSON.stringify(extra),...extra});
function source(rows:AttendanceRow[],extra:LocalSnapshot[]=[]):ConsultationLeadSource{
 const snapshots:LocalSnapshot[]=[{id:'original',kind:'attendance',sourceHash:'synthetic',importedAt:'2026-10-21',coverageStart:'2026-01-01',coverageEnd:'2026-10-21',reportCoverage:{start:'2026-01-01',end:'2026-10-21',complete:true},coverageClinicians:people.map(p=>p.label),rows:[...rows,...people.map(p=>row('show','2026-01-01',{clinician:p.label,visitKind:undefined,billingCode:'90837'}))]},...extra];
 return {report:completeReportCoverage(snapshots,people,'2026-10-21',people,{teamId:null}),classificationSnapshots:snapshots,clinicians:people,identityClinicians:people,teamId:null,asOf:'2026-10-21'};
}
test('eligible scheduled includes client cancellations/late/no-show but excludes clinician cancellation',()=>{
 const data=source([row('show'),row('cancelled','2026-07-16'),row('cancelled','2026-07-17',{cancellationSubtype:'late_cancelled'}),row('no show','2026-07-18'),row('clinician cancelled','2026-07-19')]);
 const before=JSON.stringify(data),m=consultationLeadMonth(data,'2026-07');
 assert.equal(m.status,'available');assert.equal(m.scheduled,4);assert.equal(m.attended,1);assert.equal(m.didNotAttend,3);assert.equal(m.clinicianCancelled,1);assert.equal(m.totalScheduled,5);assert.equal(m.uniquePeople,1);
 assert.deepEqual(importedConsultationRates(m,2,true),{scheduledConsult:'200%',show:'25%',scheduleProvisional:false});
 assert.equal(importedConsultationRates(m,2,false).scheduleProvisional,true);assert.equal(JSON.stringify(data),before);
});
test('same-export mixed outcomes are separate, exact cross-export copies deduplicate without hash identity',()=>{
 const rows=[row('show'),row('cancelled')],data=source(rows);
 const clone={...data.classificationSnapshots[0],id:'copy',rows:rows.map((r,i)=>({...r,sourceRowHash:'copy-'+i}))} as LocalSnapshot;
 const m=consultationLeadMonth(source(rows,[clone]),'2026-07');
 assert.equal(m.scheduled,2);assert.equal(m.attended,1);assert.equal(m.didNotAttend,1);
});
test('within-source same-outcome multiplicity and conflicting exports stay unknown',()=>{
 const duplicate=consultationLeadMonth(source([row('show'),row('show','2026-07-15',{sourceRowHash:'second'})]),'2026-07');
 assert.equal(duplicate.scheduled,null);assert.equal(duplicate.ambiguousGroups,1);
 const data=source([row('show')]);const conflict={...data.classificationSnapshots[0],id:'conflict',rows:[row('no show')]} as LocalSnapshot;
 const m=consultationLeadMonth(source([row('show')],[conflict]),'2026-07');
 assert.equal(m.scheduled,null);assert.ok(m.conflictPeriods>0);assert.equal(importedConsultationRates(m,10,true).show,'—');
});
test('consultation/date/clinician scope excludes treatments and never uses another scope lead denominator',()=>{
 const data=source([row('show'),row('no show','2026-07-16',{clinician:'Two'}),row('show','2026-08-01'),row('show','2026-07-20',{visitKind:undefined,billingCode:'90837'})]);
 assert.equal(consultationLeadMonth(data,'2026-07',1).scheduled,1);
 assert.equal(consultationLeadMonth(data,'2026-07',2).scheduled,1);
 assert.equal(consultationLeadMonth(data,'2026-08',1).scheduled,1);
 assert.equal(consultationLeadMonth(data,'2026-07',999).scheduled,null);
 assert.equal(importedConsultationRates(consultationLeadMonth(data,'2026-07',2),null,true).scheduledConsult,'—');
});
test('quiet covered months are zero, partial/future months unknown, zero leads do not create rates',()=>{
 const data=source([]),m=consultationLeadMonth(data,'2026-07');assert.equal(m.scheduled,0);
 assert.equal(importedConsultationRates(m,0,true).scheduledConsult,'—');assert.equal(importedConsultationRates(m,10,true).show,'—');
 assert.equal(consultationLeadMonth(data,'2026-10').scheduled,null);
 assert.equal(consultationLeadMonth({...data,report:{...data.report,completeAttendanceCoverage:[]}},'2026-07').scheduled,null);
});
