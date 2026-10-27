import type { Workspace } from '@workspace/practice/hub';
import { acquisitionFunnel } from './acquisition-funnel.ts';
import { buildClinicalObservationIndex, type ClinicalFoundationInput } from './clinical-data-foundation.ts';
import { configuredWeeklyCapacity } from './configured-growth-capacity.ts';

/** Observed first-treatment cohort yield, not person-linked lead conversion.
 * Input snapshots must already pass canonical admission. Historical first-ever
 * status before imported coverage is not inferred. No IO or live wiring. */
export function establishedCohortYield(input:ClinicalFoundationInput & {
 leadWorkspace?:Pick<Workspace,'periods'|'funnels'>;
 /** Authorized current roster, resolved by the caller from the same source snapshot. */
 clinicians:readonly {id:number;label:string}[];
 scope:{kind:'practice'}|{kind:'clinician';clinicianId:number};
}) {
 const index=buildClinicalObservationIndex(input);
 const normalize=(name:string)=>name.trim().replace(/\s+/g,' ').toLowerCase();
 const scope=input.scope;
 const selected=scope.kind==='practice'?input.clinicians:input.clinicians.filter(c=>c.id===scope.clinicianId);
 const expected=selected.map(c=>normalize(c.label)).sort(),actual=input.clinicianNames.map(normalize).sort();
 if(!expected.length || new Set(input.clinicians.map(c=>c.id)).size!==input.clinicians.length
   || new Set(input.clinicians.map(c=>normalize(c.label))).size!==input.clinicians.length
   || JSON.stringify(expected)!==JSON.stringify(actual)) throw new RangeError('Scope ID and clinician labels must match the authorized roster');
 const months:string[]=[];
 for(let date=input.start.slice(0,7)+'-01';date<=input.end;){
  const next=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),1)).toISOString().slice(0,10);
  const end=new Date(Date.parse(next)-86400000).toISOString().slice(0,10);
  if(date<input.start||end>input.end) throw new RangeError('Lead comparison requires complete calendar-month cohort boundaries');
  months.push(date.slice(0,7));date=next;
 }
 const unresolvedEvidenceCount=(input.excludedFollowUpEvidence??[]).filter(row=>row.serviceDate>=input.start&&row.serviceDate<=input.asOf).length;
 const coverageComplete=unresolvedEvidenceCount===0&&index.scopeCovered(input.start,input.asOf)
  && index.evidence.intervals.some(r=>r.start<=input.start&&r.end>=input.asOf);
 const cohort=index.indexedClients.filter(c=>c.dates[0]>=input.start&&c.dates[0]<=input.end&&index.inScopeAt(c,c.dates[0]));
 const established=cohort.filter(c=>c.establishedOn!==null&&c.establishedOn<=input.asOf).length;
 let workspace=input.leadWorkspace;
 let providerAttributed=true;
 if(input.scope.kind==='clinician'){
  const clinicianId=input.scope.clinicianId;
  const ids=new Set(workspace?.periods.filter(p=>months.includes(p.start.slice(0,7))).map(p=>p.id));
  const rows=workspace?.funnels.filter(f=>ids.has(f.periodId))??[];
  providerAttributed=rows.length>0&&rows.every(f=>f.scope==='source'&&f.clinicianId!==null);
  workspace=workspace&&providerAttributed?{...workspace,funnels:workspace.funnels.filter(f=>f.clinicianId===clinicianId)}:undefined;
 }
 const funnel=acquisitionFunnel(workspace,months);
 const ratio=coverageComplete&&funnel.leads!==null&&Number.isFinite(funnel.leads)&&funnel.leads>0?established/funnel.leads:null;
 const followup=cohort.map(c=>(Date.parse(input.asOf)-Date.parse(c.dates[0]))/86400000);
 return {formulaVersion:'observed-start-cohort-established-yield-v1' as const,
  sourceBasis:'historical aggregate planning ratio; not linked lead probability' as const,
  scope:input.scope,window:{start:input.start,end:input.end,observedThrough:input.asOf},months,
  coverageComplete,unresolvedEvidenceCount,firstObservedStarts:coverageComplete?cohort.length:null,
  establishedByCutoff:coverageComplete?established:null,notYetEstablishedByCutoff:coverageComplete?cohort.length-established:null,
  reportedLeads:funnel.leads,establishedPerReportedLead:ratio,
  followupDays:followup.length?{minimum:Math.min(...followup),maximum:Math.max(...followup)}:null,
  reason:!coverageComplete?'Complete cohort and follow-up coverage required':!providerAttributed?'Recorded clinician lead attribution required':funnel.leads===null?'Complete reported leads for the same start months required':funnel.leads===0?'Positive reported lead denominator required':null,
  limitation:'First observed starts; later third visits remain possible. Lead arrival and treatment start may lag. Unlinked ratios may exceed 1 and are never clamped.' as const};
}

/** Daily activity events, dated when the 90-day state changes, not backdated
 * last visits. Transfers are separate from practice acquisition/reactivation. */
export function establishedActivityLedger(input:ClinicalFoundationInput) {
 const index=buildClinicalObservationIndex(input);
 const shift=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
 const prior=shift(input.start,-1);
 const counts={activeAtStart:0,activeAtEnd:0,newlyEstablished:0,expiries:0,reactivations:0,transfersIn:0,transfersOut:0};
 let uncertain=false;
 const covered=index.scopeCovered(prior,input.end)&&index.evidence.intervals.some(r=>r.start<=prior&&r.end>=input.end);
 for(const client of index.indexedClients){
  let previous=index.establishedStateAt(client,prior);
  let before=previous==='not-ended'&&index.inScopeAt(client,prior);
  if(previous==='uncertain') uncertain=true;
  if(before)counts.activeAtStart++;
  for(let date=input.start;date<=input.end;date=shift(date,1)){
   const current=index.establishedStateAt(client,date);
   if(current==='uncertain')uncertain=true;
   const after=current==='not-ended'&&index.inScopeAt(client,date);
   if(after&&!before){
    if(client.establishedOn===date)counts.newlyEstablished++;
    else if(previous==='ended')counts.reactivations++;
    else if(previous==='not-ended')counts.transfersIn++;
   }
   if(before&&!after){
    if(current==='ended')counts.expiries++;
    else if(current==='not-ended')counts.transfersOut++;
   }
   before=after;previous=current;
  }
  if(before)counts.activeAtEnd++;
 }
 const balanced=counts.activeAtEnd-counts.activeAtStart===counts.newlyEstablished+counts.reactivations-counts.expiries+counts.transfersIn-counts.transfersOut;
 return {formulaVersion:'daily-established-activity-events-v1' as const,window:{start:input.start,end:input.end,asOf:input.asOf},
  scope:input.clinicianNames,coverageComplete:covered,uncertain,balanced,
  status:covered&&!uncertain&&balanced?'available' as const:'unavailable' as const,
  counts:covered&&!uncertain&&balanced?counts:null,
  reason:!covered?'Complete daily and opening-state coverage required':uncertain?'Unresolved daily active state':!balanced?'Activity ledger does not reconcile':null};
}

/** Assumption-bound equation proposal. Expiry/return events must come from the
 * matching established ledger. Marginal, expiry and return workload is assumed
 * equal to period A7 frequency. Non-established workload is included in W;
 * its future path and marginal first-two-visit workload are not separately modeled. */
export function establishedLeadTargetProposal(input:{
 clinicians:readonly {id:number;sessionsPerWeek:number}[];
 observedWeeklySessions:number|null; activeEstablishedSessionsPerClientWeek:number|null;
 horizonMonths:number|null; establishedActivity:{expiries:number;reactivations:number;months:number}|null;
 establishedPerReportedLead:number|null;
}) {
 const capacity=configuredWeeklyCapacity(input.clinicians);
 let overflow=false;
 const finite=(n:number)=>{if(!Number.isFinite(n)){overflow=true;return null;}return n;};
 const valid=(n:number|null)=>n!==null&&Number.isFinite(n)&&n>=0;
 const gap=capacity!==null&&valid(input.observedWeeklySessions)?finite(capacity-input.observedWeeklySessions!):null;
 const expansion=gap!==null&&input.horizonMonths!==null&&Number.isFinite(input.horizonMonths)&&input.horizonMonths>0?finite(gap/input.horizonMonths):null;
 const frequency=input.activeEstablishedSessionsPerClientWeek;
 const activity=input.establishedActivity;
 const replacement=activity&&Number.isSafeInteger(activity.expiries)&&activity.expiries>=0&&Number.isSafeInteger(activity.reactivations)&&activity.reactivations>=0
   &&Number.isFinite(activity.months)&&activity.months>0?finite((activity.expiries-activity.reactivations)/activity.months):null;
 const exposure=input.horizonMonths!==null&&Number.isFinite(input.horizonMonths)&&input.horizonMonths>0&&valid(frequency)&&frequency!>0
  ?finite(input.horizonMonths*frequency!):null;
 const lossWorkload=exposure!==null&&exposure>0&&replacement!==null?finite(exposure*replacement):null;
 const projectedWorkload=valid(input.observedWeeklySessions)&&lossWorkload!==null?finite(input.observedWeeklySessions!-lossWorkload):null;
 const noAcquisitionWorkload=projectedWorkload!==null?Math.max(0,projectedWorkload):null;
 const requiredEstablished=capacity===0?0:capacity!==null&&noAcquisitionWorkload!==null&&exposure!==null&&exposure>0
  ?finite(Math.max(0,capacity-noAcquisitionWorkload)/exposure):null;
 const yieldRatio=input.establishedPerReportedLead;
 const requiredLeads=requiredEstablished===0?0:requiredEstablished!==null&&valid(yieldRatio)&&yieldRatio!>0?finite(requiredEstablished/yieldRatio!):null;
 return {formulaVersion:'established-workload-lead-target-proposal-v2' as const,status:'review-only; not installed' as const,
  capacity,signedWeeklySessionGap:gap,expansionWeeklyWorkloadPerMonth:expansion,
  netReplacementEstablishedPerMonth:replacement,noAcquisitionWeeklyWorkload:noAcquisitionWorkload,requiredEstablishedPerMonth:requiredEstablished,estimatedLeadsPerMonth:requiredLeads,
  reason:requiredEstablished===0?null:overflow?'Inputs exceed supported numeric range':gap===null?'Configured capacity and observed workload required':expansion===null?'Positive target horizon required':replacement===null?'Matching established expiry/reactivation ledger required':requiredEstablished===null?'Positive matching established-active attendance frequency required':requiredLeads===null?'Positive observed leads-to-established planning ratio required':null,
  assumptions:'Marginal established load and expiry/return load equal period A7; flows stable. Non-established workload is included in W, not counted as new established-client gains; its future path is not separately modeled. Marginal first-two-visit workload is not separately credited.' as const,
  limitation:'Steady-state workload estimate, not guaranteed acquisition or time-to-capacity. Establishment lag and ramp are not modeled.' as const};
}
