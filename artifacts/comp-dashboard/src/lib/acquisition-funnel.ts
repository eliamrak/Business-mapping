import type { Workspace } from '@workspace/practice/hub';
/** Complete, non-overlapping practice totals or validated source/clinician breakdowns; never infer cohort linkage. */
export function acquisitionFunnel(workspace:Pick<Workspace,'periods'|'funnels'>|undefined,months:readonly string[]) {
 const unknown={leads:null,averageLeads:null,bookedPerLeadPct:null};
 if(!workspace||!months.length)return unknown;
 let leads=0,clients=0,clientsKnown=true;
 for(const month of months){
  const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  const overlapping=workspace.periods.filter(p=>!p.archived&&p.start<=end&&p.end>=start);
  if(overlapping.length!==1||overlapping[0].start!==start||overlapping[0].end!==end||!overlapping[0].funnelComplete)return unknown;
  const rows=workspace.funnels.filter(r=>r.periodId===overlapping[0].id);
  if(!rows.length||rows.some(r=>r.leads===null))return unknown;
  if(rows.some(r=>r.scope==='practice')&&(rows.length!==1||rows[0].clinicianId!==null))return unknown;
  const keys=new Map<string,Set<number|null>>();
  for(const row of rows){
   const source=row.campaignId??`other:${row.sourceName.trim().toLowerCase()||'other'}`;
   const owners=keys.get(source)??new Set<number|null>();
   if(owners.has(row.clinicianId)||(owners.size>0&&(row.clinicianId===null||owners.has(null))))return unknown;
   owners.add(row.clinicianId);keys.set(source,owners);
   if(!Number.isFinite(row.leads)||row.leads!<0)return unknown;
   if(row.clients===null)clientsKnown=false;
   else if(!Number.isFinite(row.clients)||row.clients<0)return unknown;
   leads+=row.leads!;clients+=row.clients??0;
  }
 }
 return {leads,averageLeads:leads/months.length,bookedPerLeadPct:clientsKnown&&leads>0&&clients<=leads?clients/leads*100:null};
}
