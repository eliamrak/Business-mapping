import { resolveImportedProvider, type ImportEvidenceDeclarations } from '@workspace/practice/hub';
import { consultAttendanceClassifier, type AttendanceRow, type LocalSnapshot } from './retention-local.ts';
import type { CompleteReportCoverage } from './complete-report-coverage.ts';
export type ConsultationLeadSource={
 report:CompleteReportCoverage; classificationSnapshots:LocalSnapshot[];
 clinicians:readonly {id:number;label:string;goalId?:number|null}[];
 identityClinicians:readonly {id:number;label:string;goalId?:number|null}[];
 teamId:number|null;declarations?:ImportEvidenceDeclarations;asOf:string;
};
/** Read-only appointment counts. Existing raw statuses/manual funnel records are
 * never modified. Same-source mixed outcomes are separate appointments; lacking
 * appointment IDs, repeated same-outcome rows within a source are unresolved. */
export function consultationLeadMonth(source:ConsultationLeadSource,month:string,clinicianId?:number){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new RangeError('Valid calendar month required');
 const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 const people=clinicianId===undefined?source.clinicians:source.clinicians.filter(p=>p.id===clinicianId);
 const ids=new Set(people.map(p=>p.id));
 const covers=(id:number)=>{
  let next=Date.parse(start);
  for(const r of source.report.completeAttendanceCoverage.filter(r=>r.clinicianId===id).sort((a,b)=>a.start.localeCompare(b.start))){
   if(Date.parse(r.start)>next)break;next=Math.max(next,Date.parse(r.end)+86400000);
  }
  return next>Date.parse(end);
 };
 const coverageComplete=people.length>0&&end<=source.asOf&&people.every(p=>covers(p.id));
 const isConsult=consultAttendanceClassifier(source.classificationSnapshots);
 const groups=new Map<string,Map<string,AttendanceRow[]>>(),seenSnapshots=new Set<string>();
 for(const snapshot of source.report.eligibleSnapshots){
  if(snapshot.kind!=='attendance'||seenSnapshots.has(snapshot.id))continue;
  seenSnapshots.add(snapshot.id);
  for(const row of snapshot.rows){
   if(row.serviceDate<start||row.serviceDate>end||row.serviceDate>source.asOf||!isConsult(row))continue;
   const id=resolveImportedProvider(row.clinician,source.identityClinicians,source.teamId,source.declarations);
   if(id===null||!ids.has(id))continue;
   const key=JSON.stringify([row.clientId,id,row.serviceDate]);
   const group=groups.get(key)??new Map<string,AttendanceRow[]>();
   group.set(snapshot.id,[...(group.get(snapshot.id)??[]),row]);groups.set(key,group);
  }
 }
 const observed={attended:0,clientCancelled:0,lateCancelled:0,noShow:0,clinicianCancelled:0};
 let ambiguousGroups=0,unknownStatusRows=0;const eligiblePeople=new Set<string>();
 for(const sources of groups.values()){
  const variants=[...sources.values()];
  const signature=(row:AttendanceRow)=>`${row.status}:${row.cancellationSubtype??''}`;
  const signatures=variants.map(rows=>rows.map(signature).sort());
  if(signatures.some(keys=>new Set(keys).size!==keys.length)||new Set(signatures.map(keys=>JSON.stringify(keys))).size!==1){ambiguousGroups++;continue;}
  for(const row of variants[0]){
   if(row.status==='show')observed.attended++;
   else if(row.status==='cancelled')row.cancellationSubtype==='late_cancelled'?observed.lateCancelled++:observed.clientCancelled++;
   else if(row.status==='no show')observed.noShow++;
   else if(row.status==='clinician cancelled')observed.clinicianCancelled++;
   else {unknownStatusRows++;continue;}
   if(row.status!=='clinician cancelled')eligiblePeople.add(row.clientId);
  }
 }
 const conflictPeriods=source.report.incompletePeriods.filter(p=>p.conflictKind==='attendance-status'&&p.clinicianId!==undefined&&ids.has(p.clinicianId)&&p.start!==null&&p.end!==null&&p.start<=end&&p.end>=start).length;
 const known=coverageComplete&&ambiguousGroups===0&&unknownStatusRows===0&&conflictPeriods===0;
 const didNotAttend=observed.clientCancelled+observed.lateCancelled+observed.noShow;
 const eligible=observed.attended+didNotAttend;
 return {start,end,status:known?'available' as const:'unavailable' as const,coverageComplete,
  scheduled:known?eligible:null,attended:known?observed.attended:null,didNotAttend:known?didNotAttend:null,
  clinicianCancelled:known?observed.clinicianCancelled:null,totalScheduled:known?eligible+observed.clinicianCancelled:null,
  uniquePeople:known?eligiblePeople.size:null,observed,ambiguousGroups,unknownStatusRows,conflictPeriods,
  reason:conflictPeriods?'Conflicting import statuses':ambiguousGroups?'Ambiguous repeated appointment records':unknownStatusRows?'Unknown consultation outcome':!coverageComplete?'Complete covered month unavailable':null,
  basis:'Appointments by consultation date; scheduled excludes clinician cancellations; not unique people or booking-entry dates' as const};
}
export type ConsultationLeadMonth=ReturnType<typeof consultationLeadMonth>;
export function importedConsultationRates(counts:ConsultationLeadMonth,leads:number|null,leadsComplete=false){
 const percent=(a:number|null,b:number|null)=>a===null||b===null||!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=0?'—':`${Math.round(100*a/b)}%`;
 return {scheduleProvisional:counts.scheduled!==null&&leads!==null&&leads>0&&!leadsComplete,scheduledConsult:percent(counts.scheduled,leads),show:percent(counts.attended,counts.scheduled)};
}
